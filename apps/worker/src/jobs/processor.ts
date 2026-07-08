import { Queue, Worker, Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { extractRetailer } from "../serper";
import { getScraper, ScrapedProduct, ScraperError } from "../scrapers";
import { sendAlerts } from "../services/notifications";
import { logger } from "../utils/logger";
import { normalizeProductImage } from "../utils/normalize-product-image";
import { isPlausiblePriceChange } from "../utils/price-sanity";
import { isUsableCompetitor } from "../utils/competitor-quality";
import { isOnCooldown, markCooldown } from "../utils/alert-cooldown";
import { getAlertConditionState, setAlertConditionState } from "../utils/alert-state";
import { recoverOwnPriceViaSerper } from "../utils/recover-own-price";
import {
  clearScrapeFailures,
  incrementScrapeFailure,
  SCRAPE_FAILURE_THRESHOLD,
} from "../utils/scrape-failures";
import { captureError } from "../sentry";
import { PLAN_EXPIRY_GRACE_MS } from "../shared";
import { evaluateAlertRule, resolveApplicableRules } from "./alert-rules";

const prisma = new PrismaClient();

function toPrismaJsonObject(value?: Record<string, unknown>) {
  if (value === undefined) {
    return undefined;
  }

  // Prisma JSON alanına yalnızca JSON-uyumlu değer gönder.
  return JSON.parse(JSON.stringify(value));
}

const connection = {
  url: process.env.REDIS_URL || "redis://localhost:6379",
  maxRetriesPerRequest: null,
};

// ============================================
// QUEUES
// ============================================

export const scrapeQueue = new Queue("scrape", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    // Remove finished jobs immediately so the stable per-product jobId is freed
    // the moment a scrape ends — only waiting/active jobs dedup (in-flight), so
    // the next scheduled scan and manual refresh are never blocked.
    removeOnComplete: true,
    removeOnFail: true,
  },
});

export const alertQueue = new Queue("alerts", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
});

// ============================================
// SHARED ALERT TRIGGER
// ============================================

/**
 * Detect a price/stock change for a product and enqueue an alert check.
 *
 * Single source of truth shared by every price-update path — the scheduled
 * scrape (below), the manual "Yenile" refresh, and the 6-hour URL refresh — so
 * an alert fires no matter which path refreshed the price.
 *
 * `previousPrice`/`previousInStock` must be the values read from the product row
 * *before* the caller overwrote them with the freshly-fetched values, and the
 * stored price must be updated in the same operation as the fetch. That way
 * whichever path fetches first detects the change and enqueues; a later path
 * reads the already-updated price as its `previousPrice`, sees no delta, and
 * does not re-enqueue. Rule-level cooldowns (alertWorker) are the final backstop
 * against duplicate notifications.
 */
export async function maybeEnqueueAlerts(params: {
  productId: string;
  previousPrice: number | null;
  currentPrice: number;
  previousInStock: boolean | null;
  inStock: boolean;
}): Promise<void> {
  const { productId, previousPrice, currentPrice, previousInStock, inStock } = params;

  const priceChange = previousPrice ? currentPrice - previousPrice : null;
  const priceChangePct =
    previousPrice && previousPrice > 0
      ? ((currentPrice - previousPrice) / previousPrice) * 100
      : null;
  const priceChanged = priceChange !== null && priceChange !== 0;
  const stockChanged = previousInStock !== null && previousInStock !== inStock;

  if (!priceChanged && !stockChanged) {
    return;
  }

  const eventTypes = [
    ...(priceChanged ? ["price-change"] : []),
    ...(stockChanged ? ["stock-change"] : []),
  ];

  await alertQueue.add("check-alerts", {
    productId,
    eventTypes,
    currentPrice,
    previousPrice,
    priceChange,
    priceChangePct,
    inStock,
    previousInStock,
  });
}

// ============================================
// SAME-LISTING SELLERS → COMPETITORS
// ============================================

// Aynı ilanı satan diğer satıcıları (Trendyol otherMerchants) otomatik rakip
// olarak senkronla. Keşif hattı bunları bulamaz: Google satıcı varyantı
// URL'lerini ayrı indekslemez ve urlMatchKey aynı ilanın tüm varyantlarını
// "kendi ürün" sayıp eler. Ürün birebir aynı olduğundan matchScore=100 —
// kalite politikasından geçer ve COMPETITOR_CHEAPER (buybox kaybı) sinyali
// aynı tarama döngüsünde tetiklenebilir. Satmayı bırakan satıcı güncellenmez
// ve 72 saat sonra bayatlayarak karar hesaplarından kendiliğinden düşer.
async function syncSameListingCompetitors(
  productId: string,
  productUrl: string,
  scraped: ScrapedProduct,
): Promise<void> {
  const sellers = scraped.otherSellers ?? [];
  if (sellers.length === 0) return;

  try {
    const parsed = new URL(productUrl);
    const listingBase = `${parsed.origin}${parsed.pathname}`;
    // En ucuz 10 satıcı yeterli — kalabalık ilanlarda satır patlamasını önle.
    const top = [...sellers].sort((a, b) => a.price - b.price).slice(0, 10);
    const now = new Date();

    for (const [index, seller] of top.entries()) {
      const competitorUrl = `${listingBase}?merchantId=${seller.merchantId}`;
      const competitor = await prisma.competitor.upsert({
        where: {
          trackedProductId_competitorUrl: { trackedProductId: productId, competitorUrl },
        },
        update: {
          currentPrice: seller.price,
          lastScrapedAt: now,
          ...(seller.sellerName ? { competitorName: seller.sellerName } : {}),
          matchScore: 100,
          matchReason: "Aynı ilanın diğer satıcısı",
        },
        create: {
          trackedProductId: productId,
          competitorUrl,
          competitorName: seller.sellerName ?? "Trendyol satıcısı",
          marketplace: "TRENDYOL",
          currentPrice: seller.price,
          lastScrapedAt: now,
          matchScore: 100,
          matchReason: "Aynı ilanın diğer satıcısı",
        },
      });

      await prisma.competitorPrice.create({
        data: {
          competitorId: competitor.id,
          price: seller.price,
          currency: scraped.currency || "TRY",
          inStock: true,
          scrapedAt: now,
        },
      });

      // Grafik tutarlılığı: keşif hattı gibi priceHistory'ye de yaz ki
      // "En Düşük Rakip" çizgisi buybox satıcılarını da görsün. Kalabalığı
      // önlemek için yalnızca en ucuz 5 satıcı grafiğe girer. sellerName
      // olarak MAĞAZA adı yazılır — "Trendyol" yazılsaydı grafikteki
      // kendi-fiyat sezgisi (marketplace adı ipucu) bu satırları
      // kullanıcının kendi fiyatı sanırdı.
      if (index < 5) {
        await prisma.priceHistory.create({
          data: {
            trackedProductId: productId,
            price: seller.price,
            currency: scraped.currency || "TRY",
            inStock: true,
            sellerName: seller.sellerName ?? `Satıcı ${seller.merchantId}`,
            scrapedAt: now,
          },
        });
      }
    }

    logger.info({ productId, count: top.length }, "Same-listing sellers synced as competitors");
  } catch (error) {
    // Rakip senkronu ana taramayı asla düşürmesin — fiyat/stok güncellemesi kritik.
    logger.error({ productId, error }, "Same-listing competitor sync failed (non-fatal)");
  }
}

// ============================================
// SCRAPE WORKER
// ============================================

export const scrapeWorker = new Worker(
  "scrape",
  async (job: Job) => {
    const { productId, marketplace, productUrl } = job.data;

    logger.info({ productId, marketplace }, "Scrape job started");

    try {
      // Scraper'ı al ve çalıştır
      const scraper = getScraper(marketplace);
      const result: ScrapedProduct = await scraper(productUrl);

      // Mevcut fiyatı al
      const product = await prisma.trackedProduct.findUnique({
        where: { id: productId },
        select: {
          currentPrice: true,
          status: true,
        },
      });

      const previousPrice = product?.currentPrice ? Number(product.currentPrice) : null;
      const previousInStock = product ? product.status !== "OUT_OF_STOCK" : null;

      // Price sanity check: reject changes > 90% unless price was null/0 before
      if (!isPlausiblePriceChange(previousPrice, result.price)) {
        const changePct = Math.abs((result.price - previousPrice!) / previousPrice!) * 100;
        logger.warn(
          {
            productId,
            oldPrice: previousPrice,
            newPrice: result.price,
            changePct: changePct.toFixed(1),
          },
          "Price change > 90% — likely parsing error, skipping update",
        );
        await prisma.trackedProduct.update({
          where: { id: productId },
          data: { lastScrapedAt: new Date() },
        });
        return { success: false, softFailed: true, code: "PRICE_SANITY_CHECK" };
      }

      const priceChange = previousPrice ? result.price - previousPrice : null;
      const priceChangePct =
        previousPrice && previousPrice > 0
          ? ((result.price - previousPrice) / previousPrice) * 100
          : null;

      // Fiyat geçmişine kaydet
      await prisma.priceHistory.create({
        data: {
          trackedProductId: productId,
          price: result.price,
          previousPrice: previousPrice,
          currency: result.currency,
          priceChange: priceChange,
          priceChangePct: priceChangePct,
          inStock: result.inStock,
          sellerName: result.sellerName,
        },
      });

      // Ürünü güncelle. status ataması ERROR'daki bir ürünü de otomatik
      // iyileştirir (başarılı tarama = ürün tekrar sağlıklı).
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: {
          currentPrice: result.price,
          productName: result.name || undefined,
          productImage: normalizeProductImage(result.imageUrl),
          sellerName: result.sellerName || undefined,
          category: result.category || undefined,
          lastScrapedAt: new Date(),
          status: result.inStock ? "ACTIVE" : "OUT_OF_STOCK",
          metadata: toPrismaJsonObject(result.metadata) as never,
        },
      });

      // Başarılı tarama ardışık hata sayacını sıfırlar.
      await clearScrapeFailures(productId);

      // Aynı ilandaki diğer satıcıları rakip olarak senkronla — alert
      // kuyruğundan ÖNCE ki COMPETITOR_CHEAPER taze buybox fiyatlarını görsün.
      await syncSameListingCompetitors(productId, productUrl, result);

      // Fiyat/stok değiştiyse alert kontrolünü kuyruğa al — tüm fiyat-güncelleme
      // yollarıyla paylaşılan ortak yardımcı (manuel "Yenile" ve 6 saatlik
      // URL-refresh de aynı yardımcıyı çağırır).
      await maybeEnqueueAlerts({
        productId,
        previousPrice,
        currentPrice: result.price,
        previousInStock,
        inStock: result.inStock,
      });

      logger.info(
        {
          productId,
          name: result.name,
          price: result.price,
          change: priceChange,
          changePct: priceChangePct?.toFixed(2),
        },
        "Scrape completed",
      );

      return { success: true, price: result.price };
    } catch (error) {
      const attemptsMade = job.attemptsMade + 1;
      const maxAttempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
      const scraperError =
        error instanceof ScraperError
          ? error
          : new ScraperError(error instanceof Error ? error.message : "Unknown scrape error", {
              code: "SCRAPE_RUNTIME_ERROR",
              retryable: true,
            });

      const shouldRetry = scraperError.retryable && attemptsMade < maxAttempts;

      logger.error(
        {
          productId,
          attemptsMade,
          maxAttempts,
          code: scraperError.code,
          retryable: scraperError.retryable,
          softFail: scraperError.softFail,
        },
        `Scrape job failed: ${scraperError.message}`,
      );

      if (shouldRetry) {
        throw scraperError;
      }

      // Son çare: kendi fiyatı Serper'dan kurtar (Akamai vb. bot korumalı
      // sitelerde scraper'ın tüm yöntemleri başarısız olabiliyor; Google
      // Shopping feed'i satıcı beslemesinden geldiği için engellenmiyor).
      // Manuel "Yenile" akışı bunu zaten yapıyordu — zamanlanmış tarama da yapar.
      try {
        const failedProduct = await prisma.trackedProduct.findUnique({
          where: { id: productId },
          select: {
            productUrl: true,
            productName: true,
            metadata: true,
            currency: true,
            currentPrice: true,
            status: true,
          },
        });
        if (failedProduct) {
          const recoveredPrice = await recoverOwnPriceViaSerper(failedProduct);
          const previousPrice = failedProduct.currentPrice
            ? Number(failedProduct.currentPrice)
            : null;
          if (recoveredPrice && isPlausiblePriceChange(previousPrice, recoveredPrice)) {
            const previousInStock = failedProduct.status !== "OUT_OF_STOCK";
            // sellerName grafikte "kendi fiyat" ayrımı için kullanılır — boş
            // kalırsa kayıt "Bilinmeyen" satıcıya (rakip) sınıflanır.
            const ownRetailer = extractRetailer(failedProduct.productUrl);
            const ownSellerName = ownRetailer.name !== "Diğer" ? ownRetailer.name : "Benim Ürünüm";
            await prisma.priceHistory.create({
              data: {
                trackedProductId: productId,
                price: recoveredPrice,
                previousPrice,
                currency: failedProduct.currency,
                priceChange: previousPrice !== null ? recoveredPrice - previousPrice : null,
                priceChangePct:
                  previousPrice && previousPrice > 0
                    ? ((recoveredPrice - previousPrice) / previousPrice) * 100
                    : null,
                inStock: true,
                sellerName: ownSellerName,
              },
            });
            await prisma.trackedProduct.update({
              where: { id: productId },
              data: {
                currentPrice: recoveredPrice,
                lastScrapedAt: new Date(),
                status: "ACTIVE",
              },
            });
            // Serper üzerinden kurtarılan fiyat da başarı sayılır.
            await clearScrapeFailures(productId);
            await maybeEnqueueAlerts({
              productId,
              previousPrice,
              currentPrice: recoveredPrice,
              previousInStock,
              inStock: true,
            });

            logger.info(
              { productId, recoveredPrice, scraperCode: scraperError.code },
              "Own price recovered via Serper after scrape failure",
            );
            return { success: true, price: recoveredPrice, recoveredViaSerper: true };
          }
        }
      } catch (recoveryError) {
        logger.warn({ productId, err: recoveryError }, "Own-price Serper recovery failed");
      }

      // lastScrapedAt burada "son deneme" anlamındadır ve yalnızca zamanlayıcı
      // temposunu belirler (başarısız ürünü her 60 sn'de yeniden denememek
      // için). Kullanıcıya gösterilen tazelik bilgisi PriceHistory'nin son
      // kaydından (= son BAŞARILI tarama) gelir — başarısız deneme kullanıcıya
      // asla "az önce güncellendi" olarak yansımaz.
      await prisma.trackedProduct.update({
        where: { id: productId },
        data: {
          lastScrapedAt: new Date(),
        },
      });

      // Ardışık hata eşiği: sürekli başarısız olan ürün sessizce bayat fiyat
      // göstermek yerine ERROR durumuna alınır (UI'da hata rozeti + zamanlayıcı
      // 24 saatte bir yeniden dener; ilk başarılı taramada kendini iyileştirir).
      const failureCount = await incrementScrapeFailure(productId);
      if (failureCount !== null && failureCount >= SCRAPE_FAILURE_THRESHOLD) {
        await prisma.trackedProduct.update({
          where: { id: productId },
          data: { status: "ERROR" },
        });
        logger.error(
          { productId, failureCount, code: scraperError.code },
          "Product marked ERROR after consecutive scrape failures",
        );
        captureError(scraperError, {
          productId,
          failureCount,
          code: scraperError.code,
          stage: "scrape-consecutive-failures",
        });
      }

      logger.warn(
        {
          productId,
          attemptsMade,
          code: scraperError.code,
          failureCount,
        },
        "Scrape failed after retries; applying soft-fail policy",
      );

      return {
        success: false,
        softFailed: true,
        code: scraperError.code,
      };
    }
  },
  {
    connection,
    concurrency: 5, // Aynı anda 5 scrape
    limiter: {
      max: 10, // 10 saniyede max 10 istek
      duration: 10000,
    },
  },
);

// ============================================
// ALERT WORKER
// ============================================

// Koşulu "olay" değil "seviye" olan kurallar: koşul haftalarca doğru
// kalabilir (rakip sürekli ucuz, fiyat hedefin altında, marj düşük). Bunlar
// edge detection ile yalnızca koşulun yeni oluştuğu anda bildirir; olay
// tabanlı kurallar (PRICE_DROP, stok geçişleri vb.) zaten doğaları gereği
// yalnızca değişimde tetiklenir.
const LEVEL_TRIGGERED_RULE_TYPES = new Set(["PRICE_THRESHOLD", "COMPETITOR_CHEAPER", "LOW_MARGIN"]);

export const alertWorker = new Worker(
  "alerts",
  async (job: Job) => {
    const {
      productId,
      currentPrice,
      previousPrice,
      priceChange,
      priceChangePct,
      inStock,
      previousInStock,
      eventTypes,
    } = job.data;

    const normalizedEventTypes: string[] = Array.isArray(eventTypes) ? eventTypes : [];
    const isPriceEvent =
      normalizedEventTypes.includes("price-change") || (priceChange !== null && priceChange !== 0);
    const isStockEvent =
      normalizedEventTypes.includes("stock-change") ||
      (typeof previousInStock === "boolean" && previousInStock !== inStock);

    logger.info({ productId, priceChange, isPriceEvent, isStockEvent }, "Checking alerts");

    // Ürünü bir kez çek — genel (hesap geneli) kuralların bildirim içeriği ve
    // kullanıcının kural kümesi için gerekli.
    const product = await prisma.trackedProduct.findUnique({
      where: { id: productId },
      select: { userId: true, productName: true, marketplace: true, productUrl: true, cost: true },
    });
    if (!product) {
      logger.warn({ productId }, "Alert check skipped — product no longer exists");
      return;
    }

    // Kâr marjı (LOW_MARGIN için): maliyet girilmemişse null kalır ve LOW_MARGIN
    // sessiz kalır. Formül packages/shared/src/margin.ts ile senkron tutulmalı
    // (worker Docker context'i shared paketi import edemez).
    const ownCost = product.cost != null ? Number(product.cost) : null;
    const marginPct =
      ownCost !== null && Number.isFinite(ownCost) && ownCost >= 0 && currentPrice > 0
        ? ((currentPrice - ownCost) / currentPrice) * 100
        : null;

    let previousStockState: boolean | null =
      typeof previousInStock === "boolean" ? previousInStock : null;

    if (previousStockState === null && isStockEvent) {
      const recentHistory = await prisma.priceHistory.findMany({
        where: { trackedProductId: productId },
        orderBy: { scrapedAt: "desc" },
        take: 2,
        select: { inStock: true },
      });

      if (recentHistory.length > 1) {
        previousStockState = recentHistory[1].inStock;
      }
    }

    // Ürün kuralları + kullanıcının genel kuralları. Pasif kurallar da çekilir:
    // aynı türde bir ürün kuralı (pasif bile olsa) genel kuralı ezer, böylece
    // kullanıcı genel kural açıkken tek bir ürünü sessize alabilir.
    const candidateRules = await prisma.alertRule.findMany({
      where: {
        OR: [{ trackedProductId: productId }, { trackedProductId: null, userId: product.userId }],
      },
      include: {
        user: true,
        trackedProduct: true,
      },
    });
    const rules = resolveApplicableRules(candidateRules, productId);

    // COMPETITOR_CHEAPER kuralları için en ucuz GEÇERLİ rakip fiyatını yükle.
    // Kalite politikası (skor, fiyat bandı, bayatlık) uygulanır — yoksa ₺11'lik
    // bir koli kaydı ₺2.500'lük ürüne sürekli sahte "rakip daha ucuz" alarmı üretir.
    let minCompetitorPrice: number | null = null;
    let cheapestCompetitorName: string | null = null;
    let cheaperCompetitorCount = 0;
    if (rules.some((r) => r.ruleType === "COMPETITOR_CHEAPER")) {
      const competitors = await prisma.competitor.findMany({
        where: { trackedProductId: productId, currentPrice: { gt: 0 } },
        select: { competitorName: true, currentPrice: true, matchScore: true, lastScrapedAt: true },
      });
      const ownPrice = Number(currentPrice);
      const usable = competitors
        .map((c) => ({
          name: c.competitorName,
          price: Number(c.currentPrice),
          matchScore: c.matchScore,
          lastScrapedAt: c.lastScrapedAt,
        }))
        .filter((c) => isUsableCompetitor(c, { ownPrice }));
      if (usable.length > 0) {
        // En ucuz geçerli rakip + bizden ucuz olanların sayısı — bildirimi
        // "kim, ne kadar ucuz" diyecek kadar aksiyon alınabilir yapar.
        const cheapest = usable.reduce((min, c) => (c.price < min.price ? c : min));
        minCompetitorPrice = cheapest.price;
        cheapestCompetitorName = cheapest.name;
        cheaperCompetitorCount = usable.filter((c) => c.price < ownPrice).length;
      }
    }

    for (const rule of rules) {
      const conditionMet = evaluateAlertRule(rule.ruleType, {
        currentPrice,
        priceChange,
        priceChangePct,
        isPriceEvent,
        isStockEvent,
        inStock,
        previousStockState,
        thresholdValue: rule.thresholdValue != null ? Number(rule.thresholdValue) : null,
        direction: rule.direction,
        minCompetitorPrice,
        marginPct,
        userThresholdPct: rule.user.alertThresholdPct,
      });

      // Seviye-tetiklemeli kurallarda edge detection: koşul sürekli doğruysa
      // (ör. rakip haftalardır bizden ucuz) her fiyat olayında aynı uyarıyı
      // tekrar gönderme — yalnızca false→true geçişinde bildir. Durum,
      // cooldown'dan BAĞIMSIZ olarak her değerlendirmede güncellenir ki koşul
      // düşüp yeniden oluştuğunda uyarı tekrar kurulabilsin.
      let shouldAlert = conditionMet;
      if (LEVEL_TRIGGERED_RULE_TYPES.has(rule.ruleType)) {
        const wasActive = await getAlertConditionState(rule.id, productId);
        await setAlertConditionState(rule.id, productId, conditionMet);
        if (conditionMet && wasActive === true) {
          shouldAlert = false; // koşul zaten aktifti — yeni geçiş yok
        }
      }

      if (!shouldAlert) continue;

      // Cooldown (kural, ürün) bazlıdır: genel bir kuralın A ürünündeki
      // tetiklenmesi B ürününün bildirimini bastırmamalı. Redis erişilemezse
      // kural bazlı lastTriggered'a geri düşülür.
      const onCooldown = await isOnCooldown(rule.id, productId);
      if (onCooldown === true) continue;
      if (onCooldown === null && rule.lastTriggered) {
        const cooldownMs = rule.cooldownMinutes * 60 * 1000;
        if (Date.now() - rule.lastTriggered.getTime() < cooldownMs) {
          continue;
        }
      }

      {
        await sendAlerts(rule, {
          productId,
          productName: product.productName,
          currentPrice,
          previousPrice,
          priceChange,
          priceChangePct,
          marketplace: product.marketplace,
          productUrl: product.productUrl,
          cost: ownCost,
          marginPct,
          competitorPrice: minCompetitorPrice,
          cheapestCompetitorName,
          cheaperCompetitorCount,
        });

        await markCooldown(rule.id, productId, rule.cooldownMinutes);

        // Last triggered güncelle (UI'da "Son Tetiklenme" + Redis yokken fallback)
        await prisma.alertRule.update({
          where: { id: rule.id },
          data: { lastTriggered: new Date() },
        });

        logger.info(
          { ruleId: rule.id, ruleType: rule.ruleType, global: rule.trackedProductId === null },
          "Alert triggered",
        );
      }
    }
  },
  { connection, concurrency: 10 },
);

// ============================================
// SCHEDULER - Periyodik tarama
// ============================================

// Guards against overlapping scheduleScans runs (the 60s interval can fire
// again before a slow run finishes). In-process lock (single-worker deploy);
// the stable per-product jobId is the Redis-level dedup that also covers
// multiple processes.
let isScheduling = false;

export async function scheduleScans() {
  if (isScheduling) {
    logger.warn("scheduleScans still running — skipping this tick");
    return;
  }
  isScheduling = true;
  try {
    await runScheduleScans();
  } catch (error) {
    logger.error({ error }, "scheduleScans failed");
  } finally {
    isScheduling = false;
  }
}

async function runScheduleScans() {
  logger.info("Scheduling product scans...");

  // Taranması gereken ürünleri bul. ERROR ürünler de dahil edilir ki blok
  // kalkınca kendiliğinden iyileşsinler — ama günde 1 denemeyle (aşağıdaki
  // interval kontrolü) kaynak yakmadan.
  const now = new Date();
  const products = await prisma.trackedProduct.findMany({
    where: {
      status: { in: ["ACTIVE", "OUT_OF_STOCK", "ERROR"] },
      OR: [
        { lastScrapedAt: null },
        {
          lastScrapedAt: {
            lt: new Date(now.getTime() - 5 * 60 * 1000), // En az 5 dk önce taranmış
          },
        },
      ],
      // Plan kapısı (B1): süresi zamanla dolmuş ücretli planların ürünlerini
      // tarama. FREE/aktif kullanıcılarda planExpiresAt null veya gelecekte
      // olur; iptal edilen abonelikler webhook tarafında FREE'ye düşürülüp
      // kapasite üstü ürünleri PAUSED yapıldığı için zaten elenir.
      // 3 günlük tolerans: yenileme webhook'u gecikirse ödeyen müşterinin
      // taraması anında durmasın (web tarafındaki PLAN_EXPIRY_GRACE_MS aynası).
      user: {
        OR: [
          { planExpiresAt: null },
          { planExpiresAt: { gte: new Date(now.getTime() - PLAN_EXPIRY_GRACE_MS) } },
        ],
      },
    },
    select: {
      id: true,
      marketplace: true,
      productUrl: true,
      scrapeInterval: true,
      lastScrapedAt: true,
      status: true,
    },
  });

  let scheduled = 0;

  for (const product of products) {
    // Scrape interval kontrolü. ERROR ürünlerde plan aralığı yerine 24 saatlik
    // iyileşme denemesi uygulanır — sürekli bloklanan bir ürünü plan
    // frekansında yeniden denemek kota/limitleri boşa harcar.
    if (product.lastScrapedAt) {
      const intervalMinutes =
        product.status === "ERROR"
          ? Math.max(product.scrapeInterval, 1440)
          : product.scrapeInterval;
      const intervalMs = intervalMinutes * 60 * 1000;
      const elapsed = now.getTime() - product.lastScrapedAt.getTime();
      if (elapsed < intervalMs) continue;
    }

    await scrapeQueue.add(
      `scrape-${product.id}`,
      {
        productId: product.id,
        marketplace: product.marketplace,
        productUrl: product.productUrl,
      },
      {
        jobId: `scrape-${product.id}`, // stable id dedups a product still queued from a prior tick
        priority: product.lastScrapedAt ? 2 : 1, // Hiç taranmamışlar öncelikli
      },
    );

    scheduled++;
  }

  logger.info(`Scheduled ${scheduled} scrape jobs`);
}

// Worker event listeners
scrapeWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id }, `Scrape worker event - job failed: ${err.message}`);
  // Retry'ları tüketmiş job'lar Sentry'ye gider — tek tek retry gürültüsü değil.
  if (job && job.attemptsMade >= (typeof job.opts.attempts === "number" ? job.opts.attempts : 1)) {
    captureError(err, { jobId: job.id, queue: "scrape", data: job.data });
  }
});

alertWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id }, `Alert worker event - job failed: ${err.message}`);
  if (job && job.attemptsMade >= (typeof job.opts.attempts === "number" ? job.opts.attempts : 1)) {
    captureError(err, { jobId: job.id, queue: "alerts", data: job.data });
  }
});
