import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, isScraperBackedRetailer, parsePrice } from "../serper";
import { updateTrackedProductRefresh } from "../utils/tracked-product-refresh";
import { verifyCompetitorPrice } from "../utils/lightweight-fetch";
import { recoverPriceLightweight } from "../utils/recover-price";
import { urlMatchKey } from "../utils/url-match";
import { isPlausiblePriceChange } from "../utils/price-sanity";
import { getScraper } from "../scrapers";
import { verifyProductMatch, MatchResult } from "../matcher";
import { isPackagingListing, withinPriceBand } from "../utils/competitor-quality";
import { buildSearchQueries } from "../utils/search-queries";
import { maybeEnqueueAlerts } from "./processor";
import { Marketplace } from "@prisma/client";

interface RefreshJobData {
  productId: string;
  isDeduped?: boolean;
}

function retailerToMarketplace(retailerName: string): Marketplace {
  const map: Record<string, Marketplace> = {
    Trendyol: "TRENDYOL",
    Hepsiburada: "HEPSIBURADA",
    "Amazon TR": "AMAZON_TR",
    N11: "N11",
    Pazarama: "PAZARAMA",
    MediaMarkt: "MEDIAMARKT",
    Teknosa: "TEKNOSA",
    Vatan: "VATAN",
    Decathlon: "DECATHLON",
    "PTT AVM": "PTTAVM",
    Çiçeksepeti: "CICEKSEPETI",
    Akakçe: "AKAKCE",
    Cimri: "CIMRI",
    Epey: "EPEY",
    Boyner: "BOYNER",
    Watsons: "WATSONS",
    Kitapyurdu: "KITAPYURDU",
    Sephora: "SEPHORA",
    Koçtaş: "KOCTAS",
    İtopya: "ITOPYA",
    Gratis: "GRATIS",
  };
  return map[retailerName] ?? "CUSTOM";
}

function isInPriceBand(price: number, sourcePrice: number | null): boolean {
  if (!sourcePrice || sourcePrice <= 0) return true;
  return withinPriceBand(sourcePrice, price);
}

export async function processRefreshJob(job: Job<RefreshJobData>) {
  const { productId } = job.data;

  const product = await prisma.trackedProduct.findUnique({
    where: { id: productId },
    include: { competitors: true },
  });

  if (!product) {
    console.warn(`⚠️ Refresh: ürün bulunamadı ${productId}`);
    return;
  }

  console.log(`🔄 Fiyat yenileniyor: ${product.productName} (${productId})`);
  await updateTrackedProductRefresh(productId, { refreshStatus: "processing" });

  // Faz 2: alert tetikleme için refresh ÖNCESİ saklı fiyat/stok durumunu yakala.
  // `product` in-memory nesnesi prisma.update çağrılarıyla değişmediğinden bu
  // değerler güncelleme sonrasında da "önceki" değeri verir.
  const previousOwnPrice = product.currentPrice ? Number(product.currentPrice) : null;
  const previousOwnInStock = product.status !== "OUT_OF_STOCK";

  try {
    const now = new Date();
    let refreshedOwnPrice: number | null = null;

    // ============================================
    // Kendi ürün scrape
    // ============================================
    try {
      const scraper = getScraper(product.marketplace);
      const sourceData = await scraper(product.productUrl);

      const prevOwnPrice = product.currentPrice ? Number(product.currentPrice) : null;
      if (
        sourceData?.price &&
        sourceData.price > 0 &&
        !isPlausiblePriceChange(prevOwnPrice, sourceData.price)
      ) {
        // Implausible jump vs. last known price → almost certainly a parse
        // error. Skip the write so we neither store a bad price nor fire a
        // false alert; the next refresh re-checks.
        console.warn(
          `⚠️ Source refresh fiyat sanity-check başarısız: ${productId} eski=${prevOwnPrice} yeni=${sourceData.price} — atlanıyor`,
        );
      } else if (sourceData?.price && sourceData.price > 0) {
        refreshedOwnPrice = sourceData.price;
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

        await prisma.trackedProduct.update({
          where: { id: productId },
          data: updateData,
        });

        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price: sourceData.price,
            currency: sourceData.currency || product.currency,
            inStock: sourceData.inStock,
            sellerName:
              updateData.sellerName ||
              (extractRetailer(product.productUrl).name !== "Diğer"
                ? extractRetailer(product.productUrl).name
                : "Benim Ürünüm"),
            scrapedAt: now,
          },
        });

        console.log(
          `✅ Source refresh başarılı: ${productId} — ${sourceData.price} ${sourceData.currency}`,
        );
      } else {
        console.warn(
          `⚠️ Source refresh price bulunamadı: ${productId} (${product.marketplace}) ${product.productUrl}`,
        );
      }
    } catch (sourceError) {
      console.error(
        `⚠️ Source refresh scrape hatası: ${productId} (${product.marketplace}) ${product.productUrl}`,
        sourceError,
      );
    }

    // ============================================
    // Serper araması — competitor güncelleme + Audit P0-2: yeni keşif
    // ============================================
    // Sorgu CANLI ürün adından kurulur; bayat "Trendyol ürünü" gibi placeholder
    // keywords elenir (buildSearchQueries). Geçerli sorgu yoksa Serper'ı ATLA —
    // aksi halde jenerik adla arayıp alakasız ürünleri AI'a reddettirir + kota
    // israfı olur.
    const refreshQueries = buildSearchQueries(
      product.productName,
      product.productName,
      product.metadata,
    );
    const refreshQuery = refreshQueries[0];

    const results = refreshQuery ? await searchProduct(refreshQuery) : [];

    // Kaynak fiyat Serper'dan kurtarma (mevcut davranış — Akamai bloğunda kullanılıyor).
    // KRİTİK KORUMA: URL belirli bir satıcıya işaret ediyorsa (?merchantId=...)
    // Google Shopping'in ilan fiyatı BUYBOX fiyatıdır, o satıcının değil —
    // urlMatchKey query'yi attığı için ikisi aynı anahtara düşer ve yanlış
    // satıcının fiyatı "Benim Fiyatım" olarak yazılırdı (üretimde ₺1.058/₺1.189,99
    // vakasının kök nedeni). Satıcıya özel üründe bu kurtarma atlanır; fiyat
    // eski kalır ama YANLIŞ olmaz.
    const urlHasMerchantId = /[?&]merchantId=\d+/i.test(product.productUrl);
    if (!refreshedOwnPrice && !urlHasMerchantId) {
      const ownKey = urlMatchKey(product.productUrl);
      for (const result of results) {
        if (urlMatchKey(result.link) !== ownKey) continue;
        const serperOwnPrice = parsePrice(result.price);
        if (!serperOwnPrice || serperOwnPrice <= 0) continue;

        refreshedOwnPrice = serperOwnPrice;
        const ownRetailer = extractRetailer(product.productUrl);
        const ownSellerName = ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm";

        try {
          await prisma.trackedProduct.update({
            where: { id: productId },
            data: {
              currentPrice: serperOwnPrice,
              lastScrapedAt: now,
              status: "ACTIVE",
            },
          });

          await prisma.priceHistory.create({
            data: {
              trackedProductId: productId,
              price: serperOwnPrice,
              currency: product.currency,
              inStock: true,
              sellerName: ownSellerName,
              scrapedAt: now,
            },
          });

          console.log(
            `✅ Kendi fiyat Serper'dan kurtarıldı: ${productId} — ${serperOwnPrice} ${product.currency}`,
          );
        } catch (err) {
          console.error(`Serper own-price kaydetme hatası:`, err);
        }
        break;
      }
    }

    let updatedCount = 0;
    let newlyDiscoveredCount = 0;
    let priceRecoveredCount = 0;

    const competitorByUrl = new Map<
      string,
      { competitorUrl: string; id: string; competitorName: string | null }
    >(product.competitors.map((c) => [c.competitorUrl, c]));

    const sourcePrice =
      refreshedOwnPrice ?? (product.currentPrice ? Number(product.currentPrice) : null);

    for (const result of results) {
      if (urlMatchKey(result.link) === urlMatchKey(product.productUrl)) continue;

      // Deterministik ambalaj/koli filtresi — AI çağrısından önce, maliyetsiz.
      if (isPackagingListing(result.title, product.productName)) {
        console.log(`📦 Refresh: ambalaj/koli sonucu elendi: ${result.title.slice(0, 60)}`);
        continue;
      }

      const retailer = extractRetailer(result.link);
      const isScraperBacked = isScraperBackedRetailer(retailer.name);
      const existingCompetitor = competitorByUrl.get(result.link);

      let serperPrice = parsePrice(result.price);

      // Audit P0-1 (refresh path): Fiyat boş gelirse Hepsiburada/Trendyol fallback
      let priceRecovered = false;
      // Kurtarma yolundaki eşleşme skoru da SAKLANMALI — aksi halde yeni rakip
      // matchScore=null ile yaratılıp kalite politikasının dışında kalıyor.
      let recoveryMatch: MatchResult | null = null;
      if ((!serperPrice || serperPrice <= 0) && isScraperBacked) {
        // Yeni rakip için title-AI gate; existing için zaten kabul edilmiş
        if (!existingCompetitor) {
          try {
            const preMatch = await verifyProductMatch(
              {
                title: product.productName,
                price: sourcePrice ?? undefined,
                marketplace: product.marketplace,
              },
              {
                title: result.title,
                url: result.link,
                marketplace: retailer.name,
              },
            );
            if (!preMatch.isMatch) {
              continue;
            }
            recoveryMatch = preMatch;
          } catch {
            continue;
          }
        }

        try {
          const recovered = await recoverPriceLightweight(result.link);
          if (recovered.price && recovered.price > 0) {
            serperPrice = recovered.price;
            priceRecovered = true;
            priceRecoveredCount++;
            console.log(
              `🛟 Refresh fiyat kurtarıldı (${recovered.source}, ${retailer.name}): ${serperPrice} ₺`,
            );
          } else {
            // Recovery başarısız — drop
            continue;
          }
        } catch (err) {
          console.error(`Refresh recovery hatası (${result.link}):`, err);
          continue;
        }
      }

      if (!serperPrice || serperPrice <= 0) continue;

      // Existing competitor → güncelle (eski davranış korundu, recovery'yi de kapsar)
      if (existingCompetitor) {
        let verifiedPrice = serperPrice;
        if (!priceRecovered) {
          try {
            const verification = await verifyCompetitorPrice(
              existingCompetitor.competitorUrl,
              serperPrice,
            );
            if (verification.price && verification.price > 0) {
              verifiedPrice = verification.price;
              if (
                verification.source !== "serper-cache" &&
                Math.abs(verifiedPrice - serperPrice) > 1
              ) {
                console.log(
                  `🔄 Fiyat düzeltildi: ${existingCompetitor.competitorUrl.slice(0, 50)} — Serper: ₺${serperPrice} → Gerçek: ₺${verifiedPrice}`,
                );
              }
            }
          } catch {
            // Doğrulama başarısız — Serper fiyatını kullan
          }
        }

        try {
          await prisma.competitor.update({
            where: { id: existingCompetitor.id },
            data: {
              currentPrice: verifiedPrice,
              competitorName: result.title || existingCompetitor.competitorName,
              lastScrapedAt: now,
            },
          });
          await prisma.competitorPrice.create({
            data: {
              competitorId: existingCompetitor.id,
              price: verifiedPrice,
              currency: "TRY",
              inStock: true,
              scrapedAt: now,
            },
          });
          await prisma.priceHistory.create({
            data: {
              trackedProductId: productId,
              price: verifiedPrice,
              currency: "TRY",
              inStock: true,
              sellerName: retailer.name,
              scrapedAt: now,
            },
          });
          updatedCount++;
        } catch (err) {
          console.error(`Refresh güncelleme hatası (${result.link}):`, err);
        }
        continue;
      }

      // ============================================
      // Audit P0-2: Yeni keşfedilen competitor refresh sırasında da eklensin
      // ============================================
      if (!isInPriceBand(serperPrice, sourcePrice)) continue;

      let matchResult: MatchResult | null = recoveryMatch;
      if (!priceRecovered) {
        // priceRecovered=true ise AI title-only gate zaten geçti
        try {
          matchResult = await verifyProductMatch(
            {
              title: product.productName,
              price: sourcePrice ?? undefined,
              marketplace: product.marketplace,
            },
            {
              title: result.title,
              url: result.link,
              price: serperPrice,
              marketplace: retailer.name,
            },
          );
        } catch {
          continue;
        }
        if (!matchResult.isMatch) continue;
      }

      const marketplace = retailerToMarketplace(retailer.name);

      try {
        const newCompetitor = await prisma.competitor.create({
          data: {
            trackedProductId: productId,
            competitorUrl: result.link,
            competitorName: result.title,
            marketplace,
            currentPrice: serperPrice,
            lastScrapedAt: now,
            matchScore: matchResult?.score,
            matchReason: matchResult?.reason,
            matchAttributes: matchResult?.attributes,
          },
        });

        await prisma.competitorPrice.create({
          data: {
            competitorId: newCompetitor.id,
            price: serperPrice,
            currency: "TRY",
            inStock: true,
            scrapedAt: now,
          },
        });
        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price: serperPrice,
            currency: "TRY",
            inStock: true,
            sellerName: retailer.name,
            scrapedAt: now,
          },
        });

        newlyDiscoveredCount++;
      } catch (err) {
        console.error(`Refresh new-competitor hatası (${result.link}):`, err);
      }
    }

    // ============================================
    // Bayat rakip tazeleme (Serper sonuçlarında görünmeyenler)
    // ============================================
    // Eski davranış: yalnızca güncel Serper sonuçlarında link'i geçen rakipler
    // tazeleniyordu; diğerleri haftalarca "Eski" kalıyor ve kullanıcı
    // "Fiyatları Yenile'ye bastım ama 9/13 rakip hâlâ eski" diyordu. Serper'da
    // görünmeyen bayat rakipler için hafif HTTP fiyat kurtarması denenir
    // (Puppeteer YOK; job süresi sınırlı kalsın diye en fazla 10 rakip).
    const STALE_MS = 72 * 60 * 60 * 1000;
    const refreshedUrls = new Set(results.map((r) => r.link));
    const staleCompetitors = product.competitors
      .filter((c) => !refreshedUrls.has(c.competitorUrl))
      .filter((c) => !c.lastScrapedAt || now.getTime() - c.lastScrapedAt.getTime() > STALE_MS)
      .slice(0, 10);
    let staleRefreshedCount = 0;
    for (const stale of staleCompetitors) {
      try {
        const recovered = await recoverPriceLightweight(stale.competitorUrl);
        if (!recovered.price || recovered.price <= 0) continue;
        await prisma.competitor.update({
          where: { id: stale.id },
          data: { currentPrice: recovered.price, lastScrapedAt: now },
        });
        await prisma.competitorPrice.create({
          data: {
            competitorId: stale.id,
            price: recovered.price,
            currency: "TRY",
            inStock: true,
            scrapedAt: now,
          },
        });
        staleRefreshedCount++;
      } catch {
        // Erişilemeyen rakip bayat kalır; bir sonraki refresh yeniden dener.
      }
    }
    if (staleCompetitors.length > 0) {
      console.log(
        `🧊 Bayat rakip tazeleme: ${staleRefreshedCount}/${staleCompetitors.length} güncellendi`,
      );
    }

    if (!refreshedOwnPrice && product.currentPrice && Number(product.currentPrice) > 0) {
      const ownRetailer = extractRetailer(product.productUrl);
      try {
        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price: Number(product.currentPrice),
            currency: product.currency,
            inStock: product.status !== "OUT_OF_STOCK",
            sellerName: ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm",
            scrapedAt: now,
          },
        });
      } catch (err) {
        console.error(`Kendi fiyatı kaydetme hatası:`, err);
      }
    }

    if (job.data.isDeduped) {
      const siblingProducts = await prisma.trackedProduct.findMany({
        where: {
          productUrl: product.productUrl,
          id: { not: product.id },
          status: { in: ["ACTIVE", "OUT_OF_STOCK"] },
        },
        select: { id: true },
      });

      if (siblingProducts.length > 0) {
        const updatedSource = await prisma.trackedProduct.findUnique({
          where: { id: product.id },
          select: {
            currentPrice: true,
            lastScrapedAt: true,
            productName: true,
            productImage: true,
          },
        });

        if (updatedSource) {
          await prisma.trackedProduct.updateMany({
            where: { id: { in: siblingProducts.map((s) => s.id) } },
            data: {
              currentPrice: updatedSource.currentPrice,
              lastScrapedAt: updatedSource.lastScrapedAt,
              productName: updatedSource.productName,
              productImage: updatedSource.productImage,
            },
          });

          console.log(
            `📡 Sonuç yayıldı: ${siblingProducts.length} sibling ürün güncellendi (${product.productUrl.slice(0, 60)})`,
          );
        }
      }
    }

    // Faz 2: fiyat/competitor güncellemesi bitti — refresh ÖNCESİ saklı fiyata
    // karşı bir değişiklik oluştuysa alert kontrolünü kuyruğa al. Scheduled
    // scrape ile ortak yardımcı; rule cooldown'ları çift bildirimi engeller.
    try {
      const refreshed = await prisma.trackedProduct.findUnique({
        where: { id: productId },
        select: { currentPrice: true, status: true },
      });
      if (refreshed?.currentPrice != null) {
        await maybeEnqueueAlerts({
          productId,
          previousPrice: previousOwnPrice,
          currentPrice: Number(refreshed.currentPrice),
          previousInStock: previousOwnInStock,
          inStock: refreshed.status !== "OUT_OF_STOCK",
        });
      }
    } catch (alertError) {
      console.error(`⚠️ Alert kuyruğa alma hatası (refresh): ${productId}`, alertError);
    }

    // Ürünün kendi fiyatı HÂLÂ yoksa "Tamamlandı + hiç veri yok" çelişkisini
    // kullanıcıya sessizce bırakma: veri alınamadığını ve ne yapabileceğini söyle.
    const finalState = await prisma.trackedProduct.findUnique({
      where: { id: productId },
      select: { currentPrice: true },
    });
    const noOwnPriceError =
      finalState && finalState.currentPrice == null
        ? "Ürün sayfasından fiyat alınamadı (marketplace erişimi engellemiş olabilir). Bir süre sonra tekrar deneyin veya ürün linkini kontrol edin."
        : null;

    await updateTrackedProductRefresh(productId, {
      refreshStatus: "completed",
      refreshCompletedAt: new Date(),
      refreshError: noOwnPriceError,
    });

    console.log(
      `✅ Refresh tamamlandı: ${productId} — ${updatedCount} güncellendi, ${newlyDiscoveredCount} yeni keşfedildi, ${priceRecoveredCount} kurtarıldı`,
    );
    return {
      updated: updatedCount,
      newlyDiscovered: newlyDiscoveredCount,
      priceRecovered: priceRecoveredCount,
    };
  } catch (error) {
    try {
      await updateTrackedProductRefresh(productId, {
        refreshStatus: "failed",
        refreshCompletedAt: new Date(),
        refreshError: error instanceof Error ? error.message : "Bilinmeyen hata",
      });
    } catch (statusUpdateError) {
      console.error("Failed to update refresh status:", statusUpdateError);
    }
    throw error;
  }
}
