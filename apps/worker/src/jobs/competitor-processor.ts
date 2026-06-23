import { Job } from "bullmq";
import { prisma } from "../db";
import { searchProduct, extractRetailer, isScraperBackedRetailer, parsePrice } from "../serper";
import type { SerperShoppingResult } from "../serper";
import { verifyProductMatch, MatchResult } from "../matcher";
import { Marketplace } from "@prisma/client";
import { updateTrackedProductRefresh } from "../utils/tracked-product-refresh";
import { recoverPriceLightweight } from "../utils/recover-price";
import { isPackagingListing, withinPriceBand } from "../utils/competitor-quality";
import { urlMatchKey } from "../utils/url-match";
import { buildSearchQueries } from "../utils/search-queries";
import { alertQueue } from "./processor";

interface OnboardJobData {
  productId: string;
  title: string;
  url: string;
}

/**
 * Domain → Prisma Marketplace enum eşlemesi.
 */
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

interface KeywordSearchOutcome {
  results: SerperShoppingResult[];
  /** Arama denendi ama servis hatası aldı (kota/auth/ağ). Boş sonuçtan FARKLI. */
  errored: boolean;
  errorMessage: string | null;
}

/**
 * Tek keyword ile Serper araması yapar; daha önce görülen URL'leri eler ve
 * yalnızca YENİ sonuçları döner. seenUrls çağrılar arasında paylaşılır.
 *
 * Hata YUTULMAZ, outcome olarak döner: "arama servisi çalışmadı" ile "gerçekten
 * sonuç yok" aynı şey değildir — eski davranış ikisini de sessizce boş liste
 * yapıp kullanıcıya yanıltıcı bir "Rakip yok" gösteriyordu.
 */
async function searchSingleKeyword(
  keyword: string,
  seenUrls: Set<string>,
): Promise<KeywordSearchOutcome> {
  const fresh: SerperShoppingResult[] = [];
  try {
    const results = await searchProduct(keyword);
    for (const r of results) {
      const normalizedUrl = (r.link || "").replace(/\/$/, "").toLowerCase();
      if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        fresh.push(r);
      }
    }
    return { results: fresh, errored: false, errorMessage: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Serper arama hatası ("${keyword}"): ${message}`);
    return { results: fresh, errored: true, errorMessage: message };
  }
}

function isInPriceBand(price: number, sourcePrice: number | null): boolean {
  if (!sourcePrice || sourcePrice <= 0) return true;
  return withinPriceBand(sourcePrice, price);
}

/**
 * 0 rakip durumunda kullanıcıya gösterilecek insana okunur, baskın-sebep odaklı
 * tek cümle. Sıfır olan kalemler ("0 ambalaj/koli") ASLA yazılmaz.
 */
export function buildZeroReason(
  candidates: number,
  c: { packaging: number; priceFiltered: number; aiRejected: number; priceUnrecoverable: number },
): string {
  // Baskın sebep neyse ana mesajı ona göre kur.
  const max = Math.max(c.aiRejected, c.priceFiltered, c.packaging, c.priceUnrecoverable);
  if (max === 0) {
    return `${candidates} aday incelendi ama birebir aynı ürün bulunamadı.`;
  }
  if (c.aiRejected === max) {
    return `${candidates} benzer ürün incelendi; hiçbiri birebir aynı ürün değil (farklı model, varyant veya marka). Bu ürünün piyasada birebir rakibi görünmüyor.`;
  }
  if (c.priceFiltered === max) {
    return `${candidates} benzer ürün bulundu ama fiyatları kıyas için fazla farklı (büyük olasılıkla farklı paket/boyut). Birebir aynı ürün eşleşmedi.`;
  }
  if (c.packaging === max) {
    return `${candidates} sonucun çoğu ambalaj/aksesuar ürünüydü; birebir aynı ürün bulunamadı.`;
  }
  return `${candidates} aday bulundu ama fiyat bilgisi alınamadığı için eşleştirilemedi.`;
}

/**
 * Periyodik döngü ve doğrudan çağrılar için sarmalayıcı: tek bir ürün için
 * Serper tabanlı rakip keşfi + fiyat tazeleme çalıştırır. processCompetitorJob
 * yalnızca job.data kullandığı için sentetik bir job ile güvenle çağrılabilir.
 */
export function runCompetitorDiscovery(input: OnboardJobData) {
  return processCompetitorJob({ data: input } as Job<OnboardJobData>);
}

export async function processCompetitorJob(job: Job<OnboardJobData>) {
  const { productId, title, url } = job.data;
  console.log(`🔍 Competitor arama başlıyor: ${title} (${productId})`);

  try {
    await updateTrackedProductRefresh(productId, { refreshStatus: "processing" });
  } catch {
    // Product may not exist yet, continue
  }

  const product = await prisma.trackedProduct.findUnique({
    where: { id: productId },
  });

  if (!product) {
    console.warn(`⚠️ Ürün bulunamadı: ${productId}`);
    return { found: 0 };
  }

  try {
    // Sorgular CANLI ürün adından kurulur; bayat/jenerik ("Trendyol ürünü")
    // placeholder keywords elenir. Bu eleme olmadan Serper alakasız ürünler
    // döndürüp tüm rakipleri AI'a reddettiriyordu.
    const queries = buildSearchQueries(product.productName, title, product.metadata);
    console.log(`🧠 Arama sorguları: ${JSON.stringify(queries)}`);

    if (queries.length === 0) {
      console.warn(`⚠️ Geçerli arama sorgusu üretilemedi: ${productId}`);
      await updateTrackedProductRefresh(productId, {
        refreshStatus: "completed",
        refreshCompletedAt: new Date(),
        refreshError: "Ürün adı çözülemediği için rakip araması yapılamadı.",
      });
      return { found: 0 };
    }

    const now = new Date();
    let savedCount = 0;
    let priceFilteredCount = 0;
    let aiRejectedCount = 0;
    let packagingFilteredCount = 0;
    let priceRecoveredCount = 0;
    let priceUnrecoverableCount = 0;

    const sourcePrice = product.currentPrice ? Number(product.currentPrice) : null;
    const seenUrls = new Set<string>();
    // Kendi ürün URL'siyle normalize karşılaştırma. product.productUrl her zaman
    // dolu; onboard yolu url="" geçse bile kendi ürünü kendi rakibi yapmayalım.
    const ownUrlKey = urlMatchKey(product.productUrl || url || "") || null;

    // Daha önce kabul edilmiş rakip URL'leri: periyodik yeniden taramada bunlara
    // tekrar AI çalıştırmıyoruz (maliyet + AI varyansının kabul edilmiş bir
    // rakibi düşürmesini önler). Sadece fiyatları Serper'dan tazelenir.
    const knownCompetitors = await prisma.competitor.findMany({
      where: { trackedProductId: productId },
      select: { competitorUrl: true },
    });
    const knownUrls = new Set(knownCompetitors.map((c) => c.competitorUrl));

    const processResults = async (batch: SerperShoppingResult[]) => {
      for (const result of batch) {
        if (ownUrlKey && urlMatchKey(result.link) === ownUrlKey) continue;

        const isKnown = knownUrls.has(result.link);

        // Deterministik ambalaj/koli filtresi — AI çağrısından önce, maliyetsiz.
        // Bilinen rakipler bu filtreyi zaten geçmişti; tekrar uygulamaya gerek yok.
        if (!isKnown && isPackagingListing(result.title, product.productName)) {
          packagingFilteredCount++;
          console.log(`📦 Ambalaj/koli sonucu elendi: ${result.title.slice(0, 60)}`);
          continue;
        }

        const retailer = extractRetailer(result.link);
        const isScraperBacked = isScraperBackedRetailer(retailer.name);

        let price = parsePrice(result.price);

        // ============================================
        // Audit P0-1: Fiyat boş geldiğinde recovery dene
        // ============================================
        // Eski davranış: fiyat null → sessizce drop. Hepsiburada en sık kurbandı çünkü
        // Akamai Google'a price feed vermiyor. Yeni davranış: scraper destekli retailer'larda
        // önce AI title match'i (ucuz), sonra fiyat kurtarma (HTTP only — Puppeteer DEĞİL).
        let priceRecovered = false;
        // Kurtarma yolunda da eşleşme skoru SAKLANMALI — aksi halde rakip kaydı
        // matchScore=null ile yaratılıp UI'da "güvenilir" muamelesi görüyor.
        let recoveryMatch: MatchResult | null = null;
        const needsRecovery = (!price || price <= 0) && isScraperBacked;
        if (needsRecovery) {
          // Yeni aday için AI title-only gate; bilinen rakip için zaten geçmiş.
          if (!isKnown) {
            let preMatch: MatchResult;
            try {
              preMatch = await verifyProductMatch(
                { title, price: sourcePrice ?? undefined, marketplace: product.marketplace },
                { title: result.title, url: result.link, marketplace: retailer.name },
              );
            } catch {
              continue;
            }

            if (!preMatch.isMatch) {
              aiRejectedCount++;
              console.log(
                `❌ AI reddetti (pre-match no-price, skor: ${preMatch.score}): ${result.title.slice(0, 50)}`,
              );
              continue;
            }
            recoveryMatch = preMatch;
          }

          // Title eşleşti (veya bilinen rakip) → lightweight HTTP fallback ile fiyat çek
          try {
            const recovered = await recoverPriceLightweight(result.link);
            if (recovered.price && recovered.price > 0) {
              price = recovered.price;
              priceRecovered = true;
              priceRecoveredCount++;
              console.log(
                `🛟 Fiyat kurtarıldı (${recovered.source}, ${retailer.name}): ${price} ₺ — ${result.title.slice(0, 50)}`,
              );
            } else {
              priceUnrecoverableCount++;
              console.log(
                `⚠️ Fiyat kurtarılamadı (${recovered.source}, ${retailer.name}): ${result.title.slice(0, 50)} — drop`,
              );
              continue;
            }
          } catch (err) {
            priceUnrecoverableCount++;
            console.error(`Recovery hatası (${result.link}):`, err);
            continue;
          }
        }

        if (!price || price <= 0) {
          // Hâlâ fiyat yok → drop. Burayı sayaca eklemiyoruz; eskiden tüm flow buydu.
          continue;
        }

        // Price band filter
        if (!isInPriceBand(price, sourcePrice)) {
          priceFilteredCount++;
          console.log(
            `⏭️  Fiyat bandı dışı (${price.toFixed(2)} ₺, kaynak ${sourcePrice?.toFixed(2)} ₺): ${result.title.slice(0, 60)}`,
          );
          continue;
        }

        // AI matcher — recovery yaptıysak veya bilinen rakipse yeniden çalıştırma.
        // recoveryMatch: pre-match skoru; isKnown: önceden kabul edilmiş.
        let matchResult: MatchResult | null = recoveryMatch;
        if (!priceRecovered && !isKnown) {
          try {
            matchResult = await verifyProductMatch(
              { title, price: sourcePrice ?? undefined, marketplace: product.marketplace },
              { title: result.title, url: result.link, price, marketplace: retailer.name },
            );
          } catch {
            continue;
          }

          if (!matchResult.isMatch) {
            aiRejectedCount++;
            console.log(
              `❌ AI reddetti (skor: ${matchResult.score}): ${result.title.slice(0, 50)} — ${matchResult.reason}`,
            );
            continue;
          }
        }

        const marketplace = retailerToMarketplace(retailer.name);

        try {
          const competitor = await prisma.competitor.upsert({
            where: {
              trackedProductId_competitorUrl: {
                trackedProductId: productId,
                competitorUrl: result.link,
              },
            },
            update: {
              competitorName: result.title,
              currentPrice: price,
              marketplace,
              lastScrapedAt: now,
              matchScore: matchResult?.score,
              matchReason: matchResult?.reason,
              matchAttributes: matchResult?.attributes,
            },
            create: {
              trackedProductId: productId,
              competitorUrl: result.link,
              competitorName: result.title,
              marketplace,
              currentPrice: price,
              lastScrapedAt: now,
              matchScore: matchResult?.score,
              matchReason: matchResult?.reason,
              matchAttributes: matchResult?.attributes,
            },
          });

          await prisma.competitorPrice.create({
            data: {
              competitorId: competitor.id,
              price,
              currency: "TRY",
              inStock: true,
              scrapedAt: now,
            },
          });

          await prisma.priceHistory.create({
            data: {
              trackedProductId: productId,
              price,
              currency: "TRY",
              inStock: true,
              sellerName: retailer.name,
              scrapedAt: now,
            },
          });

          savedCount++;
        } catch (err) {
          console.error(`Competitor kaydetme hatası (${result.link}):`, err);
        }
      }
    };

    // Kademeli arama: önce birincil anahtar kelime. Niş/markasız ürünlerde
    // birincil arama bol sonuç döndürse bile AI matcher hepsini reddedebilir
    // ("birebir aynı ürün" piyasada olmayabilir) — bu yüzden yedek kelimeler
    // HAM sonuç sayısına değil, KAYDEDİLEN rakip sayısına göre devreye girer.
    const MIN_SAVED_BEFORE_FALLBACK = 3;
    let searchErrorCount = 0;
    let lastSearchError: string | null = null;

    const primaryOutcome = await searchSingleKeyword(queries[0], seenUrls);
    if (primaryOutcome.errored) {
      searchErrorCount++;
      lastSearchError = primaryOutcome.errorMessage;
    }
    console.log(`🔎 Primary "${queries[0]}": ${primaryOutcome.results.length} yeni sonuç`);
    await processResults(primaryOutcome.results);

    if (savedCount < MIN_SAVED_BEFORE_FALLBACK && queries.length > 1) {
      for (let i = 1; i < Math.min(queries.length, 3); i++) {
        console.log(`🔎 Fallback [${i}] "${queries[i]}" deneniyor (kaydedilen: ${savedCount})`);
        const fallbackOutcome = await searchSingleKeyword(queries[i], seenUrls);
        if (fallbackOutcome.errored) {
          searchErrorCount++;
          lastSearchError = fallbackOutcome.errorMessage;
        }
        await processResults(fallbackOutcome.results);
        if (savedCount >= MIN_SAVED_BEFORE_FALLBACK) break;
      }
    }

    // Hiç sonuç yok VE en az bir arama servisi hatası varsa bu bir BAŞARISIZLIK,
    // "rakip yok" değil — kullanıcıya yanıltıcı boş durum yerine tarama hatası
    // gösterilsin (kota biten Serper, tüm ürünleri sessizce "rakipsiz" yapıyordu).
    if (seenUrls.size === 0 && searchErrorCount > 0) {
      const reason = `Rakip araması başarısız: ${(lastSearchError ?? "bilinmeyen hata").slice(0, 300)}`;
      console.error(`❌ ${productId}: ${reason}`);
      await updateTrackedProductRefresh(productId, {
        refreshStatus: "failed",
        refreshCompletedAt: new Date(),
        refreshError: reason,
      });
      return { found: 0, searchFailed: true };
    }

    if (seenUrls.size === 0) {
      console.log(`⚠️ Sonuç bulunamadı: ${title}`);
      await updateTrackedProductRefresh(productId, {
        refreshStatus: "completed",
        refreshCompletedAt: new Date(),
        refreshError: null,
      });
      return { found: 0 };
    }

    if (sourcePrice && sourcePrice > 0) {
      try {
        const ownRetailer = extractRetailer(product.productUrl);
        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price: sourcePrice,
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

    // COMPETITOR_CHEAPER alarmlarını rakip fiyatları güncellendiğinde de tetikle.
    if (savedCount > 0 && sourcePrice && sourcePrice > 0) {
      await alertQueue.add("check-alerts", {
        productId,
        eventTypes: ["competitor-change"],
        currentPrice: sourcePrice,
        previousPrice: null,
        priceChange: null,
        priceChangePct: null,
        inStock: product.status !== "OUT_OF_STOCK",
        previousInStock: null,
      });
    }

    // Tamamlandı — 0 kayıtta kullanıcıya YALNIZCA anlamlı, baskın sebebi yaz
    // (sıfır olan kalemleri "0 ambalaj/koli" gibi listeleme).
    const zeroSummary =
      savedCount === 0 && seenUrls.size > 0
        ? buildZeroReason(seenUrls.size, {
            packaging: packagingFilteredCount,
            priceFiltered: priceFilteredCount,
            aiRejected: aiRejectedCount,
            priceUnrecoverable: priceUnrecoverableCount,
          })
        : null;

    await updateTrackedProductRefresh(productId, {
      refreshStatus: "completed",
      refreshCompletedAt: new Date(),
      refreshError: zeroSummary,
    });

    console.log(
      `✅ ${productId}: ${savedCount} competitor kaydedildi ` +
        `(price filtered: ${priceFilteredCount}, AI rejected: ${aiRejectedCount}, ` +
        `packaging filtered: ${packagingFilteredCount}, ` +
        `recovered: ${priceRecoveredCount}, unrecoverable: ${priceUnrecoverableCount})`,
    );
    return {
      found: savedCount,
      priceFiltered: priceFilteredCount,
      aiRejected: aiRejectedCount,
      packagingFiltered: packagingFilteredCount,
      priceRecovered: priceRecoveredCount,
      priceUnrecoverable: priceUnrecoverableCount,
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
