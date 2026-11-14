import { Job } from "bullmq";

import { prisma } from "../db";
import { searchProduct, extractRetailer, parsePrice } from "../serper";
import type { SerperShoppingResult } from "../serper";
import { buildSearchQueries } from "../utils/search-queries";
import { getScraper, isProductUnavailableError } from "../scrapers";
import { updateTrackedProductRefresh } from "../utils/tracked-product-refresh";
import { maybeEnqueueAlerts } from "./processor";
import { competitorUrlKey, urlMatchKey } from "../utils/url-match";
import { isPlausiblePriceChange } from "../utils/price-sanity";
import {
  detectCompetitorMove,
  pickStaleCompetitorsForDirectScrape,
  type CompetitorMove,
  type KnownCompetitorSnapshot,
} from "../utils/stale-competitors";
import { competitorQueue } from "./processor";
import { readMatchReview } from "../utils/match-review";

interface RefreshUrlJobData {
  productUrl: string;
}

/**
 * Multi-keyword Serper search with URL dedup. competitor-processor.ts ile aynı pattern.
 */
async function searchWithKeywords(keywords: string[]): Promise<SerperShoppingResult[]> {
  const seenUrls = new Set<string>();
  const allResults: SerperShoppingResult[] = [];

  const primary = keywords[0];
  console.log(`🔎 URL-refresh primary search: "${primary}"`);
  try {
    const primaryResults = await searchProduct(primary);
    for (const r of primaryResults) {
      const normalizedUrl = (r.link || "").replace(/\/$/, "").toLowerCase();
      if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        allResults.push(r);
      }
    }
  } catch (err) {
    console.error(`URL-refresh primary search hatası ("${primary}"):`, err);
  }

  if (allResults.length < 5 && keywords.length > 1) {
    for (let i = 1; i < Math.min(keywords.length, 3); i++) {
      const fallback = keywords[i];
      console.log(`🔎 URL-refresh fallback [${i}]: "${fallback}"`);
      try {
        const fallbackResults = await searchProduct(fallback);
        for (const r of fallbackResults) {
          const normalizedUrl = (r.link || "").replace(/\/$/, "").toLowerCase();
          if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl);
            allResults.push(r);
          }
        }
      } catch (err) {
        console.error(`URL-refresh fallback hatası ("${fallback}"):`, err);
      }
      if (allResults.length >= 15) break;
    }
  }

  return allResults;
}

/**
 * URL bazlı dedup edilmiş refresh işleyicisi.
 * Aynı productUrl'i takip eden tüm sibling TrackedProduct'ları tek source-scrape +
 * tek Serper search ile günceller.
 *
 * Existing semantic korunuyor: sadece *bilinen* competitor URL'lerinin fiyatı güncellenir,
 * yeni competitor eklenmez (onboarding işi).
 */
export async function processRefreshUrlJob(job: Job<RefreshUrlJobData>) {
  const { productUrl } = job.data;

  // 1. Bu URL'i takip eden tüm aktif TrackedProduct'ları bul
  const siblings = await prisma.trackedProduct.findMany({
    where: {
      productUrl,
      status: { in: ["ACTIVE", "OUT_OF_STOCK"] },
    },
    include: { competitors: true },
  });

  if (siblings.length === 0) {
    console.log(`⚠️ URL refresh: sibling bulunamadı: ${productUrl}`);
    return { processedSiblings: 0 };
  }

  console.log(`🔄 URL refresh: ${productUrl} (${siblings.length} sibling)`);

  const siblingIds = siblings.map((s) => s.id);
  const now = new Date();

  // Faz 2: refresh ÖNCESİ her sibling'in saklı fiyat/stok durumu. `siblings`
  // in-memory dizisi updateMany ile değişmediğinden, güncelleme sonrası
  // karşılaştırma için orijinal ("önceki") değerleri verir.
  const previousStateById = new Map(
    siblings.map((s) => [
      s.id,
      {
        price: s.currentPrice ? Number(s.currentPrice) : null,
        inStock: s.status !== "OUT_OF_STOCK",
      },
    ]),
  );

  // 2. Tüm siblingsleri "processing" olarak işaretle
  await Promise.all(
    siblingIds.map((id) =>
      updateTrackedProductRefresh(id, { refreshStatus: "processing" }).catch(() => {
        // Yumuşak hata — devam et
      }),
    ),
  );

  // Primary sibling — metadata + scraper seçimi için kullanılacak
  const primary = siblings[0];

  // Source scrape başarısızsa Serper sonuçlarında kendi URL'imizi arayıp fiyatı kurtaracağız.
  let sourcePriceResolved = false;

  try {
    // 3. Source URL'i BİR KEZ scrape et
    try {
      const scraper = getScraper(primary.marketplace);
      const sourceData = await scraper(productUrl);

      const prevUrlPrice = primary.currentPrice ? Number(primary.currentPrice) : null;
      if (
        sourceData?.price &&
        sourceData.price > 0 &&
        !isPlausiblePriceChange(prevUrlPrice, sourceData.price)
      ) {
        // Implausible jump vs. last known price → almost certainly a parse
        // error. Crucially, this path fans the value out to every sibling via
        // updateMany, so skipping prevents one bad scrape from corrupting all
        // products tracking this URL.
        console.warn(
          `⚠️ URL refresh fiyat sanity-check başarısız: ${productUrl} eski=${prevUrlPrice} yeni=${sourceData.price} — ${siblings.length} sibling'e yayılması engellendi`,
        );
      } else if (sourceData?.price && sourceData.price > 0) {
        sourcePriceResolved = true;
        const updateData: {
          currentPrice: number;
          lastScrapedAt: Date;
          productName?: string;
          productImage?: string;
          sellerName?: string;
          status?: "ACTIVE" | "OUT_OF_STOCK";
        } = {
          currentPrice: sourceData.price,
          lastScrapedAt: now,
          status: sourceData.inStock ? "ACTIVE" : "OUT_OF_STOCK",
        };

        if (typeof sourceData.name === "string" && sourceData.name.trim().length > 3) {
          updateData.productName = sourceData.name.trim();
        }
        if (typeof sourceData.imageUrl === "string" && sourceData.imageUrl.trim().length > 0) {
          updateData.productImage = sourceData.imageUrl.trim();
        }
        if (typeof sourceData.sellerName === "string" && sourceData.sellerName.trim().length > 0) {
          updateData.sellerName = sourceData.sellerName.trim();
        }

        // 4. TÜM siblings'i tek update ile güncelle
        await prisma.trackedProduct.updateMany({
          where: { id: { in: siblingIds } },
          data: updateData,
        });

        // Her sibling için PriceHistory snapshot
        const ownRetailer = extractRetailer(productUrl);
        const sellerName =
          (typeof sourceData.sellerName === "string" && sourceData.sellerName.trim().length > 0
            ? sourceData.sellerName.trim()
            : null) || (ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm");

        await prisma.priceHistory.createMany({
          data: siblings.map((s) => ({
            trackedProductId: s.id,
            price: sourceData.price,
            currency: sourceData.currency || s.currency,
            inStock: sourceData.inStock,
            sellerName,
            scrapedAt: now,
          })),
        });

        console.log(
          `✅ Source scrape başarılı: ${productUrl} — ${sourceData.price} (${siblings.length} sibling güncellendi)`,
        );
      } else {
        console.warn(`⚠️ Source scrape price bulunamadı: ${productUrl}`);
      }
    } catch (sourceError) {
      // Başarısız scrape'te ESKİ fiyatla "taze" PriceHistory satırı ÜRETME:
      // PriceHistory'nin son kaydı kullanıcıya "son başarılı güncelleme"
      // olarak gösterilir — sahte satır, bayat fiyatı taze gibi gösterir ve
      // grafikte gerçek olmayan veri noktaları oluşturur.
      if (isProductUnavailableError(sourceError)) {
        // Sayfa sağlıklı, ürün satın alınamıyor: hata değil stok durumu. Son
        // bilinen fiyat korunur; Serper'dan "fiyat kurtarma" da denenmez.
        await prisma.trackedProduct.updateMany({
          where: { id: { in: siblingIds } },
          data: { status: "OUT_OF_STOCK", lastScrapedAt: now },
        });
        sourcePriceResolved = true;
        console.log(`ℹ️ Ürün şu an satın alınamıyor (stokta yok sayıldı): ${productUrl}`);
      } else {
        console.error(`⚠️ Source scrape hatası: ${productUrl}`, sourceError);
      }
    }

    // 5. Tüm siblings'in bilinen competitor URL'lerini topla (URL → [competitor records])
    const competitorByUrl = new Map<
      string,
      Array<KnownCompetitorSnapshot & { trackedProductId: string; competitorUrl: string }>
    >();

    for (const sibling of siblings) {
      for (const c of sibling.competitors) {
        // Onay bekleyen olası eşleşmeler bu turun dışında: fiyat geçmişine
        // yazılmaz, hareket/alarm üretmez (keşif turu fiyatını taze tutar).
        if (readMatchReview(c.matchAttributes) === "pending") continue;
        // Anahtar: izleme parametrelerinden arındırılmış URL. Google Shopping
        // bağlantılara her aramada farklı izleme parametresi ekleyebiliyor; ham
        // URL karşılaştırması kayıtlı rakibin fiyat güncellemesini kaçırıyordu.
        const urlKey = competitorUrlKey(c.competitorUrl);
        const list = competitorByUrl.get(urlKey) ?? [];
        list.push({
          id: c.id,
          trackedProductId: sibling.id,
          competitorUrl: c.competitorUrl,
          competitorName: c.competitorName,
          currentPrice: c.currentPrice != null ? Number(c.currentPrice) : null,
          matchScore: c.matchScore,
          marketplace: c.marketplace,
          lastScrapedAt: c.lastScrapedAt,
        });
        competitorByUrl.set(urlKey, list);
      }
    }

    if (competitorByUrl.size === 0) {
      console.log(`ℹ️ URL refresh: bilinen competitor yok, Serper atlanıyor`);
      await Promise.all(
        siblingIds.map((id) =>
          updateTrackedProductRefresh(id, {
            refreshStatus: "completed",
            refreshCompletedAt: now,
            refreshError: null,
          }),
        ),
      );
      return {
        processedSiblings: siblings.length,
        knownCompetitorUrls: 0,
        updatedCount: 0,
      };
    }

    // 6. Serper search BİR KEZ — sorgular canlı ürün adından kurulur; bayat
    // "Trendyol ürünü" gibi placeholder keywords elenir (buildSearchQueries).
    const queries = buildSearchQueries(primary.productName, primary.productName, primary.metadata);

    if (queries.length === 0) {
      console.warn(`⚠️ URL refresh: keyword yok, Serper atlanıyor: ${productUrl}`);
      await Promise.all(
        siblingIds.map((id) =>
          updateTrackedProductRefresh(id, {
            refreshStatus: "completed",
            refreshCompletedAt: now,
            refreshError: null,
          }),
        ),
      );
      return { processedSiblings: siblings.length, updatedCount: 0 };
    }

    console.log(`🧠 URL refresh arama sorguları: ${JSON.stringify(queries)}`);

    const serperResults = await searchWithKeywords(queries);
    console.log(`📦 URL refresh: ${serperResults.length} unique Serper sonucu`);

    // 6.5. Source scrape başarısızsa Serper sonuçlarında kendi URL'imizi ara
    if (!sourcePriceResolved) {
      const ownKey = urlMatchKey(productUrl);
      for (const result of serperResults) {
        if (urlMatchKey(result.link) !== ownKey) continue;
        const serperOwnPrice = parsePrice(result.price);
        if (!serperOwnPrice || serperOwnPrice <= 0) continue;

        const ownRetailer = extractRetailer(productUrl);
        const ownSellerName = ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm";

        try {
          await prisma.trackedProduct.updateMany({
            where: { id: { in: siblingIds } },
            data: {
              currentPrice: serperOwnPrice,
              lastScrapedAt: now,
              status: "ACTIVE",
            },
          });

          await prisma.priceHistory.createMany({
            data: siblings.map((s) => ({
              trackedProductId: s.id,
              price: serperOwnPrice,
              currency: s.currency,
              inStock: true,
              sellerName: ownSellerName,
              scrapedAt: now,
            })),
          });

          sourcePriceResolved = true;
          console.log(
            `✅ Kendi fiyat Serper'dan kurtarıldı (URL refresh): ${productUrl} — ${serperOwnPrice}`,
          );
        } catch (err) {
          console.error(`Serper own-price kaydetme hatası (URL refresh):`, err);
        }
        break;
      }
    }

    // 7. Her bilinen competitor URL'i için Serper'da match varsa fiyatı güncelle
    let updatedCount = 0;
    const competitorPriceSnapshots: Array<{
      competitorId: string;
      price: number;
      currency: string;
      inStock: boolean;
      scrapedAt: Date;
    }> = [];
    const priceHistorySnapshots: Array<{
      trackedProductId: string;
      price: number;
      currency: string;
      inStock: boolean;
      sellerName: string;
      scrapedAt: Date;
    }> = [];

    // Bu turda fiyatı güncellenen rakipler ve sibling başına rakip hareketleri.
    const updatedCompetitorIds = new Set<string>();
    const competitorMovesBySibling = new Map<string, CompetitorMove[]>();

    for (const result of serperResults) {
      const matchingCompetitors = competitorByUrl.get(competitorUrlKey(result.link));
      if (!matchingCompetitors || matchingCompetitors.length === 0) continue;

      const price = parsePrice(result.price);
      if (!price || price <= 0) continue;
      // Aynı URL'in Serper'da ikinci kez görünmesi (farklı sorgu) hareketi
      // çift saymasın / ilk fiyatın üstüne yazmasın.
      if (matchingCompetitors.every((c) => updatedCompetitorIds.has(c.id))) continue;

      const retailer = extractRetailer(result.link);
      const matchingIds = matchingCompetitors.map((c) => c.id);

      try {
        // Aynı URL'i paylaşan tüm competitor kayıtlarını tek query ile güncelle.
        // result.title boşsa undefined → Prisma alanı atlar → mevcut competitorName korunur.
        await prisma.competitor.updateMany({
          where: { id: { in: matchingIds } },
          data: {
            currentPrice: price,
            competitorName: result.title || undefined,
            lastScrapedAt: now,
          },
        });

        for (const c of matchingCompetitors) {
          updatedCompetitorIds.add(c.id);
          const move = detectCompetitorMove(c, price, result.title);
          if (move) {
            const moves = competitorMovesBySibling.get(c.trackedProductId) ?? [];
            moves.push(move);
            competitorMovesBySibling.set(c.trackedProductId, moves);
          }
          competitorPriceSnapshots.push({
            competitorId: c.id,
            price,
            currency: "TRY",
            inStock: true,
            scrapedAt: now,
          });
          priceHistorySnapshots.push({
            trackedProductId: c.trackedProductId,
            price,
            currency: "TRY",
            inStock: true,
            sellerName: retailer.name,
            scrapedAt: now,
          });
          updatedCount++;
        }
      } catch (err) {
        console.error(`Bulk competitor update hatası (${result.link}):`, err);
      }
    }

    // Snapshotları toplu yaz — N×M tek-tek insert yerine 2 tek createMany.
    if (competitorPriceSnapshots.length > 0) {
      try {
        await prisma.competitorPrice.createMany({ data: competitorPriceSnapshots });
      } catch (err) {
        console.error("Bulk competitorPrice insert hatası:", err);
      }
    }
    if (priceHistorySnapshots.length > 0) {
      try {
        await prisma.priceHistory.createMany({ data: priceHistorySnapshots });
      } catch (err) {
        console.error("Bulk priceHistory insert hatası:", err);
      }
    }

    // 7.5. Google'ın bu turda döndürmediği bilinen rakipler: bayatlamaya
    // başlayanları (24 saat+) worker'ın doğrudan scraper zincirine ver. Bu işler
    // kendi fiyat geçmişini yazar ve hareket varsa kendi uyarısını kuyruğa alır.
    const staleTargets = pickStaleCompetitorsForDirectScrape(
      [...competitorByUrl.values()].flat(),
      updatedCompetitorIds,
      now,
    );
    const hourBucket = Math.floor(now.getTime() / (60 * 60 * 1000));
    let directScrapesQueued = 0;
    for (const target of staleTargets) {
      try {
        await competitorQueue.add(
          "scrape-competitor",
          { competitorId: target.id },
          {
            // Aynı saat içinde tekrar kuyruğa alınmasın; bir sonraki tur yeniden dener.
            jobId: `stale-competitor-${target.id}-${hourBucket}`,
            attempts: 1,
          },
        );
        directScrapesQueued++;
      } catch (err) {
        console.error(`Bayat rakip tarama kuyruğa alınamadı (${target.id}):`, err);
      }
    }

    // Faz 2: tüm fiyat/competitor güncellemeleri bitti — her sibling için
    // refresh ÖNCESİ saklı fiyata karşı değişiklik oluştuysa alert kuyruğa al.
    try {
      const finalStates = await prisma.trackedProduct.findMany({
        where: { id: { in: siblingIds } },
        select: { id: true, currentPrice: true, status: true },
      });
      for (const fs of finalStates) {
        if (fs.currentPrice == null) continue;
        const prev = previousStateById.get(fs.id);
        if (!prev) continue;
        await maybeEnqueueAlerts({
          productId: fs.id,
          previousPrice: prev.price,
          currentPrice: Number(fs.currentPrice),
          previousInStock: prev.inStock,
          inStock: fs.status !== "OUT_OF_STOCK",
          competitorMoves: competitorMovesBySibling.get(fs.id) ?? [],
        });
      }
    } catch (alertError) {
      console.error(`⚠️ Alert kuyruğa alma hatası (URL refresh): ${productUrl}`, alertError);
    }

    // 8. Tüm siblings "completed"
    await Promise.all(
      siblingIds.map((id) =>
        updateTrackedProductRefresh(id, {
          refreshStatus: "completed",
          refreshCompletedAt: now,
          refreshError: null,
        }),
      ),
    );

    console.log(
      `✅ URL refresh tamamlandı: ${productUrl} — ${siblings.length} sibling, ${competitorByUrl.size} unique competitor URL, ${updatedCount} update, ${competitorMovesBySibling.size} ürün için rakip hareketi, ${directScrapesQueued} bayat rakip doğrudan taramaya`,
    );

    return {
      processedSiblings: siblings.length,
      knownCompetitorUrls: competitorByUrl.size,
      updatedCount,
      directScrapesQueued,
    };
  } catch (error) {
    // Tüm siblings "failed"
    await Promise.all(
      siblingIds.map((id) =>
        updateTrackedProductRefresh(id, {
          refreshStatus: "failed",
          refreshCompletedAt: now,
          refreshError: error instanceof Error ? error.message : "Bilinmeyen hata",
        }).catch(() => {
          // ignore
        }),
      ),
    );
    throw error;
  }
}
