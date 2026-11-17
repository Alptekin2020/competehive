// ============================================
// Legacy junk-competitor cleanup
// ============================================
//
// Kalite filtreleri (fiyat bandı + AI matcher + ambalaj kara listesi) sonradan
// eklendiği için eski keşif turlarından kalan alakasız rakipler DB'de duruyor
// (ör. ₺2.500'lük terliğe bağlanmış ₺11'lik koliler). Hiçbir akış bu kayıtları
// geriye dönük temizlemediği için piyasa pozisyonu ve COMPETITOR_CHEAPER
// alarmı kalıcı olarak kirleniyordu.
//
// Bu job worker açılışında bir kez çalışır ve YALNIZCA bariz çöpü siler:
//   1) Ambalaj/koli/lojistik ürünü adları (kaynak ürün ambalaj değilken)
//   2) Skoru olmayan/zayıf kayıtlarda aşırı fiyat sapması (0.2x–5x dışı) —
//      görüntüleme bandından (0.3x–3x) bilerek daha geniş; silme geri alınamaz,
//      bu yüzden sadece kesin vakaları kapsar.
//   3) Ürünün KENDİ ilanına bağlanmış otomatik rakipler (aynı pazaryeri ürün
//      id'si, slug farklı olabilir). Kullanıcının elle eklediği (skorsuz) veya
//      onayladığı satırlar silinmez.
//   4) Model kodu/numarası ürünle çelişen otomatik rakipler (başlık + URL
//      slug'ı: EP3347/90 ↔ EP3341/50, HD9650/90 ↔ /99) ve kodu hiçbir zaman
//      doğrulanamayacak onay bekleyen Google kartları.
// Güçlü AI skoru (>= MIN_MATCH_SCORE) olan kayıtlar fiyat sapsa bile silinmez —
// fiyat meşru şekilde değişmiş olabilir; onları görüntüleme katmanı zaten
// karar dışı bırakıyor.

import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../utils/logger";
import { MIN_MATCH_SCORE, isPackagingListing } from "../utils/competitor-quality";
import { readMatchReview } from "../utils/match-review";
import { hasPackOrSpecConflict, urlSlugText } from "../utils/title-similarity";
import {
  analyzeModelIdentity,
  hasColourOrShadeConflict,
  isModelIdentityMismatch,
} from "../utils/model-identity";
import { isGoogleHostedUrl } from "../utils/stale-competitors";
import { isSameListing } from "../utils/url-match";
import { ownColourText } from "../utils/direct-listing";

// Silme bandı — görüntüleme bandından bilinçli olarak daha geniş.
export const PURGE_BAND_MIN_RATIO = 0.2;
export const PURGE_BAND_MAX_RATIO = 5.0;

export type PurgeReason =
  | "packaging"
  | "price-out-of-band"
  | "own-listing"
  | "model-code-conflict"
  | "unverifiable-model"
  | null;

export interface PurgeCandidate {
  competitorName: string | null;
  competitorPrice: number | null;
  matchScore: number | null;
  competitorUrl?: string | null;
  matchAttributes?: unknown;
}

export interface PurgeContext {
  productName: string;
  ownPrice: number | null;
  productUrl?: string | null;
}

/**
 * Saf karar fonksiyonu: bu rakip kaydı kesin çöp mü?
 * null → tut; aksi halde silme nedeni döner.
 */
export function shouldPurgeCompetitor(
  candidate: PurgeCandidate,
  context: PurgeContext,
): PurgeReason {
  if (
    candidate.competitorName &&
    isPackagingListing(candidate.competitorName, context.productName)
  ) {
    return "packaging";
  }

  // Otomatik bir satır ürünün kendi ilanını gösteriyorsa "rakip" kendi
  // fiyatımızdır: pozisyon ve alarmları bozar.
  if (
    candidate.matchScore !== null &&
    candidate.matchScore !== undefined &&
    readMatchReview(candidate.matchAttributes) !== "confirmed" &&
    isSameListing(candidate.competitorUrl, context.productUrl)
  ) {
    return "own-listing";
  }

  // Otomatik satır (skorlu, kullanıcı onaysız) ürünle çelişen bir model
  // kimliği taşıyorsa farklı üründür. Elle eklenen/onaylı satıra dokunulmaz.
  if (
    candidate.matchScore !== null &&
    candidate.matchScore !== undefined &&
    readMatchReview(candidate.matchAttributes) !== "confirmed" &&
    candidate.competitorName
  ) {
    const identity = analyzeModelIdentity(
      { title: context.productName, url: context.productUrl },
      { title: candidate.competitorName, url: candidate.competitorUrl },
    );
    // Silme geri alınamaz: yalnızca açık model KODU çelişkisi/varyantı silinir.
    // Model numarası ve ekran boyutu eksenleri karar dışı bırakır ama silmez
    // (yazım farkları — "247/248 Ekran" — 16 Kasım'da doğru satırları sildirdi).
    if (
      isModelIdentityMismatch(identity.relation) &&
      (identity.relation === "config-variant" || identity.reason.startsWith("Model kodu farklı"))
    ) {
      return "model-code-conflict";
    }
    // Kodu doğrulanamayan Google kartı onay bekliyorsa: kart taranamaz ve
    // slug taşımaz, kullanıcıya hiçbir zaman doğrulanabilir bir aday olamaz.
    if (
      identity.relation === "unknown" &&
      readMatchReview(candidate.matchAttributes) === "pending" &&
      isGoogleHostedUrl(candidate.competitorUrl)
    ) {
      return "unverifiable-model";
    }
  }

  const strongScore =
    candidate.matchScore !== null &&
    candidate.matchScore !== undefined &&
    candidate.matchScore >= MIN_MATCH_SCORE;

  if (
    !strongScore &&
    context.ownPrice !== null &&
    context.ownPrice > 0 &&
    candidate.competitorPrice !== null &&
    candidate.competitorPrice > 0
  ) {
    const min = context.ownPrice * PURGE_BAND_MIN_RATIO;
    const max = context.ownPrice * PURGE_BAND_MAX_RATIO;
    if (candidate.competitorPrice < min || candidate.competitorPrice > max) {
      return "price-out-of-band";
    }
  }

  return null;
}

const PAGE_SIZE = 500;

/**
 * Tüm rakip kayıtlarını sayfalayarak tarar ve kesin çöpleri siler
 * (CompetitorPrice satırları cascade ile temizlenir). Idempotent ve ucuz —
 * her worker açılışında güvenle çalıştırılabilir.
 */
export async function cleanupJunkCompetitors(): Promise<{
  scanned: number;
  purged: number;
  byReason: Record<string, number>;
}> {
  let scanned = 0;
  let purged = 0;
  const byReason: Record<string, number> = {};
  let cursor: string | null = null;

  for (;;) {
    const batch: Array<{
      id: string;
      competitorName: string | null;
      competitorUrl: string;
      currentPrice: unknown;
      matchScore: number | null;
      matchAttributes: unknown;
      trackedProductId: string;
      trackedProduct: { productName: string; currentPrice: unknown; productUrl: string } | null;
      competitorPrices: Array<{ price: Prisma.Decimal; scrapedAt: Date }>;
    }> = await prisma.competitor.findMany({
      take: PAGE_SIZE,
      // Keyset sayfalama (id > cursor): Prisma `cursor` sayfalaması cursor
      // kaydının var olmasını gerektirir — sayfanın son kaydı bu döngüde
      // silinmiş olabileceği için cursor tabanlı sayfalama çöker/yarım kalır.
      where: cursor ? { id: { gt: cursor } } : {},
      orderBy: { id: "asc" },
      select: {
        id: true,
        trackedProductId: true,
        competitorName: true,
        competitorUrl: true,
        currentPrice: true,
        matchScore: true,
        matchAttributes: true,
        trackedProduct: {
          select: { productName: true, currentPrice: true, productUrl: true },
        },
        competitorPrices: { select: { price: true, scrapedAt: true } },
      },
    });

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    scanned += batch.length;

    const toDelete: string[] = [];
    const twins: Prisma.PriceHistoryWhereInput[] = [];
    for (const row of batch) {
      if (!row.trackedProduct) continue;
      const reason = shouldPurgeCompetitor(
        {
          competitorName: row.competitorName,
          competitorPrice: row.currentPrice != null ? Number(row.currentPrice) : null,
          matchScore: row.matchScore,
          competitorUrl: row.competitorUrl,
          matchAttributes: row.matchAttributes,
        },
        {
          productName: row.trackedProduct.productName,
          productUrl: row.trackedProduct.productUrl,
          ownPrice:
            row.trackedProduct.currentPrice != null
              ? Number(row.trackedProduct.currentPrice)
              : null,
        },
      );
      if (reason) {
        toDelete.push(row.id);
        // Grafikteki ikiz satırlar (price_history) cascade ile silinmez; kalırsa
        // ikizsiz rakip satırı ürünün kendi fiyatı sanılabilir.
        for (const cp of row.competitorPrices) {
          twins.push({
            trackedProductId: row.trackedProductId,
            scrapedAt: cp.scrapedAt,
            price: cp.price,
            previousPrice: null,
          });
        }
        byReason[reason] = (byReason[reason] ?? 0) + 1;
        logger.info(
          {
            competitorId: row.id,
            name: row.competitorName?.slice(0, 160),
            url: row.competitorUrl.slice(0, 160),
            reason,
          },
          "Junk competitor purged",
        );
      }
    }

    if (toDelete.length > 0) {
      if (twins.length > 0) {
        await prisma.priceHistory.deleteMany({ where: { OR: twins } });
      }
      await prisma.competitor.deleteMany({ where: { id: { in: toDelete } } });
      purged += toDelete.length;
    }

    if (batch.length < PAGE_SIZE) break;
  }

  logger.info({ scanned, purged, byReason }, "Junk-competitor cleanup completed");
  return { scanned, purged, byReason };
}

// ============================================
// Tek seferlik onarım: 14 Kasım 2026 hatalı fiyat kurtarma penceresi
// ============================================
//
// İkinci rakip kaynağı (#206) 14 Kasım 15:55 UTC'de yayına girdi. Hafif fiyat
// kurtarma, kategori sayfasına yönlenen Hepsiburada `-pm-` ilanlarından yanlış
// fiyat okuyordu ve başarısız doğrudan taramalar fiyatsız satır bırakıyordu
// (düzeltme: utils/recover-price.ts, jobs/competitor-scrape.ts). O pencerede
// oluşan otomatik, onaysız satırlardan şüpheli olanlar silinir; ilan gerçekten
// yayındaysa bir sonraki keşif turu doğru fiyatla yeniden bulur. Pencere sabit
// olduğu için idempotenttir ve sonraki kayıtları etkilemez.
const RECOVERY_BUG_WINDOW_START = new Date("2026-11-14T15:55:00Z");
const RECOVERY_BUG_WINDOW_END = new Date("2026-11-15T06:00:00Z");

export async function purgeRecoveryBugCompetitors(): Promise<number> {
  const rows = await prisma.competitor.findMany({
    where: {
      createdAt: { gte: RECOVERY_BUG_WINDOW_START, lt: RECOVERY_BUG_WINDOW_END },
      matchScore: { not: null },
      OR: [
        { currentPrice: null },
        { marketplace: "HEPSIBURADA", competitorUrl: { contains: "-pm-" } },
        { marketplace: "PTTAVM" },
      ],
    },
    select: {
      id: true,
      trackedProductId: true,
      matchAttributes: true,
      competitorPrices: { select: { price: true, scrapedAt: true } },
    },
  });
  const doomed = rows.filter((r) => {
    const review = (r.matchAttributes as Record<string, unknown> | null)?.review;
    // Onay bekleyen adaylar ve kullanıcının onayladıkları korunur.
    return review !== "pending" && review !== "confirmed";
  });
  const ids = doomed.map((r) => r.id);
  if (ids.length === 0) return 0;

  // Grafikteki ikiz satırlar (price_history) cascade ile silinmez: aynı ürün,
  // aynı an ve aynı fiyatla yazılmış rakip satırlarını da kaldır.
  const twins = doomed.flatMap((r) =>
    r.competitorPrices.map((cp) => ({
      trackedProductId: r.trackedProductId,
      scrapedAt: cp.scrapedAt,
      price: cp.price,
      previousPrice: null,
    })),
  );
  if (twins.length > 0) {
    await prisma.priceHistory.deleteMany({ where: { OR: twins } });
  }
  await prisma.competitor.deleteMany({ where: { id: { in: ids } } });
  logger.info({ purged: ids.length }, "Recovery-bug competitors purged (one-off)");
  return ids.length;
}

// ============================================
// Deterministik başlık kabulünün yanlış pozitifleri
// ============================================
//
// 15 Kasım 2026: "neredeyse aynı başlık" kabulü, arama sonucundaki kısaltılmış
// başlık yüzünden çoklu paket ilanlarını (N11 "…100 Gr X 6 Adet") tekli ürünün
// rakibi olarak kaydetti. Bu kabulle yazılmış satırlar URL yolu ve kayıtlı
// adla yeniden denetlenir; paket/ölçü çelişkisi olanlar grafik ikizleriyle
// birlikte silinir. Idempotent: çelişkisiz satırlara dokunmaz.

const TITLE_ACCEPT_REASON_PREFIXES = [
  "Başlıklar neredeyse aynı",
  "Başlıklar büyük oranda aynı",
  // Kural 14 backstop'u da URL yolundaki paketi görmüyordu (Tambol "x 2 adet").
  "Marka+model aynı; eksik bilgi",
];

export async function purgeTitleAcceptMismatches(): Promise<number> {
  const rows = await prisma.competitor.findMany({
    where: { OR: TITLE_ACCEPT_REASON_PREFIXES.map((p) => ({ matchReason: { startsWith: p } })) },
    select: {
      id: true,
      trackedProductId: true,
      competitorName: true,
      competitorUrl: true,
      matchAttributes: true,
      trackedProduct: { select: { productName: true } },
      competitorPrices: { select: { price: true, scrapedAt: true } },
    },
  });
  const doomed = rows.filter((r) => {
    const review = (r.matchAttributes as Record<string, unknown> | null)?.review;
    if (review === "confirmed") return false;
    const own = r.trackedProduct?.productName ?? "";
    if (!own) return false;
    return (
      hasPackOrSpecConflict(own, r.competitorName ?? "") ||
      hasPackOrSpecConflict(own, urlSlugText(r.competitorUrl))
    );
  });
  const ids = doomed.map((r) => r.id);
  if (ids.length === 0) return 0;

  const twins = doomed.flatMap((r) =>
    r.competitorPrices.map((cp) => ({
      trackedProductId: r.trackedProductId,
      scrapedAt: cp.scrapedAt,
      price: cp.price,
      previousPrice: null,
    })),
  );
  if (twins.length > 0) {
    await prisma.priceHistory.deleteMany({ where: { OR: twins } });
  }
  await prisma.competitor.deleteMany({ where: { id: { in: ids } } });
  logger.info({ purged: ids.length }, "Title-accept pack/size mismatches purged");
  return ids.length;
}

// ============================================
// Legacy marketplace backfill (CUSTOM → gerçek pazaryeri)
// ============================================
//
// Retailer çıkarımı sonradan geldiği için eski rakip kayıtları marketplace=CUSTOM
// ile duruyor; UI rozetlerinde "Diğer", Analitik'te "27 rakibin 22'si Diğer"
// olarak görünüyordu. URL'den pazaryerini türetip düzeltir. Idempotent.

const URL_MARKETPLACE_MAP: Array<{ domain: string; marketplace: string }> = [
  { domain: "trendyol.com", marketplace: "TRENDYOL" },
  { domain: "hepsiburada.com", marketplace: "HEPSIBURADA" },
  { domain: "amazon.com.tr", marketplace: "AMAZON_TR" },
  { domain: "n11.com", marketplace: "N11" },
  { domain: "pazarama.com", marketplace: "PAZARAMA" },
  { domain: "mediamarkt.com.tr", marketplace: "MEDIAMARKT" },
  { domain: "teknosa.com", marketplace: "TEKNOSA" },
  { domain: "vatanbilgisayar.com", marketplace: "VATAN" },
  { domain: "decathlon.com.tr", marketplace: "DECATHLON" },
  { domain: "pttavm.com", marketplace: "PTTAVM" },
  { domain: "ciceksepeti.com", marketplace: "CICEKSEPETI" },
  { domain: "akakce.com", marketplace: "AKAKCE" },
  { domain: "cimri.com", marketplace: "CIMRI" },
  { domain: "epey.com", marketplace: "EPEY" },
  { domain: "boyner.com.tr", marketplace: "BOYNER" },
  { domain: "watsons.com.tr", marketplace: "WATSONS" },
  { domain: "kitapyurdu.com", marketplace: "KITAPYURDU" },
  { domain: "sephora.com.tr", marketplace: "SEPHORA" },
  { domain: "koctas.com.tr", marketplace: "KOCTAS" },
  { domain: "itopya.com", marketplace: "ITOPYA" },
  { domain: "gratis.com", marketplace: "GRATIS" },
];

export function marketplaceFromUrl(url: string): string | null {
  const lower = (url || "").toLowerCase();
  for (const entry of URL_MARKETPLACE_MAP) {
    if (lower.includes(entry.domain)) return entry.marketplace;
  }
  return null;
}

export async function backfillCompetitorMarketplaces(): Promise<{ updated: number }> {
  const rows = await prisma.competitor.findMany({
    where: { marketplace: "CUSTOM" },
    select: { id: true, competitorUrl: true },
  });
  let updated = 0;
  for (const row of rows) {
    const marketplace = marketplaceFromUrl(row.competitorUrl);
    if (!marketplace) continue;
    try {
      await prisma.competitor.update({
        where: { id: row.id },
        // Prisma enum tipine string ataması: değerler enum sabitleriyle birebir.
        data: { marketplace: marketplace as never },
      });
      updated++;
    } catch (err) {
      logger.error({ err, competitorId: row.id }, "Marketplace backfill failed for row");
    }
  }
  if (updated > 0)
    logger.info({ updated, scanned: rows.length }, "Competitor marketplace backfill completed");
  return { updated };
}

// ============================================
// Yanlış renk ilanına bağlanmış Google kartları (prod 17 Kasım)
// ============================================
//
// Renk listesinde "bakır"/"nar" olmadığı için Arzum OK004 "Bakır" ürününe
// "Nar" renkli Trendyol ilanı doğrulanıp bağlandı. Gerçek sayfaya taşınmış
// (directVerifiedAt) ve kullanıcının onaylamadığı satırlar kendi başlıkla renk
// açısından yeniden denetlenir; çelişen satır SİLİNMEZ, skoru 30'a indirilir
// (karar hesaplarından çıkar, "Diğer rakipler"de görünür). Idempotent.

export const WRONG_COLOUR_DOWNGRADE_SCORE = 30;
export const WRONG_COLOUR_REASON = "Gerçek ürün sayfası farklı renk";

/** Gerçek sayfaya taşınmış, onaylanmamış satır kendi ürünle renk açısından çelişiyor mu? */
export function isWrongColourDirectLink(
  ownTitle: string,
  ownUrl: string | null | undefined,
  row: { competitorName: string | null; competitorUrl: string; matchAttributes: unknown },
): boolean {
  const attrs = row.matchAttributes as Record<string, unknown> | null;
  if (typeof attrs?.directVerifiedAt !== "string") return false;
  if (readMatchReview(row.matchAttributes) === "confirmed") return false;
  if (!ownTitle) return false;
  // Kendi rengi başlıkta yazmayabilir; kendi ilan URL'sinin slug'ı da sayılır.
  const own = ownColourText(ownTitle, ownUrl);
  return (
    hasColourOrShadeConflict(own, row.competitorName ?? "") ||
    hasColourOrShadeConflict(own, urlSlugText(row.competitorUrl))
  );
}

export async function downgradeWrongColourDirectLinks(): Promise<number> {
  const rows = await prisma.competitor.findMany({
    where: { matchScore: { gte: MIN_MATCH_SCORE } },
    select: {
      id: true,
      competitorName: true,
      competitorUrl: true,
      matchAttributes: true,
      trackedProduct: { select: { productName: true, productUrl: true } },
    },
  });
  const wrong = rows.filter((r) =>
    isWrongColourDirectLink(r.trackedProduct?.productName ?? "", r.trackedProduct?.productUrl, r),
  );
  for (const r of wrong) {
    await prisma.competitor.update({
      where: { id: r.id },
      data: { matchScore: WRONG_COLOUR_DOWNGRADE_SCORE, matchReason: WRONG_COLOUR_REASON },
    });
    logger.info(
      { competitorId: r.id, name: (r.competitorName ?? "").slice(0, 80) },
      "Direct-linked competitor downgraded: different colour",
    );
  }
  if (wrong.length > 0) {
    logger.info({ downgraded: wrong.length }, "Wrong-colour direct links downgraded");
  }
  return wrong.length;
}
