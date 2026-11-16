// ============================================
// Yayından kalkmış rakip ilanları (matchAttributes işaretleri)
// ============================================
//
// Prod (15–16 Kasım): Hepsiburada'nın kategori sayfasına yönlendirdiği ölü bir
// `-pm-` ilanı 6 turun 6'sında doğrudan taramaya gitti ve her seferinde ~12 sn
// Puppeteer harcadı; satır hiçbir işaret almadığı için "en bayat" olarak hep
// ilk sıradaydı. `scrape-competitor` işi artık sonucu satıra yazar:
//
// - `deadAt` / `deadReason`: ilan kalktı (LISTING_GONE) ya da üst üste
//   DEAD_AFTER_FAILURES tarama başarısız oldu. Karar hesapları bu satırı
//   kullanmaz, web otomatik satırı uykuda gösterir, bayat seçimi
//   DEAD_REPROBE_DAYS boyunca atlar.
// - `scrapeFailures`: art arda başarısız tarama sayısı.
// - `lastAttemptAt`: son doğrudan tarama denemesi (başarılı ya da değil).
//
// Taze bir fiyat (doğrudan tarama ya da Google) işaretleri temizler.

import { readCompetitorDeadAt } from "./competitor-quality";

export const DEAD_AFTER_FAILURES = 3;
export const DEAD_REPROBE_DAYS = 7;

export interface ScrapeHealth {
  deadAt: string | null;
  deadReason: string | null;
  scrapeFailures: number;
  lastAttemptAt: string | null;
}

type Attributes = Record<string, unknown>;

function baseOf(matchAttributes: unknown): Attributes {
  return matchAttributes && typeof matchAttributes === "object" && !Array.isArray(matchAttributes)
    ? { ...(matchAttributes as Attributes) }
    : {};
}

export function readScrapeHealth(matchAttributes: unknown): ScrapeHealth {
  const base = baseOf(matchAttributes);
  const failures = base.scrapeFailures;
  const lastAttemptAt = base.lastAttemptAt;
  return {
    deadAt: readCompetitorDeadAt(base),
    deadReason: typeof base.deadReason === "string" ? base.deadReason : null,
    scrapeFailures:
      typeof failures === "number" && Number.isFinite(failures) && failures > 0
        ? Math.floor(failures)
        : 0,
    lastAttemptAt:
      typeof lastAttemptAt === "string" && Number.isFinite(new Date(lastAttemptAt).getTime())
        ? lastAttemptAt
        : null,
  };
}

/**
 * Başarısız doğrudan taramayı işler. `gone` (LISTING_GONE) ilanı hemen ölü
 * işaretler; diğer hatalar sayacı artırır ve sayaç DEAD_AFTER_FAILURES'a
 * ulaşınca ölü işaretler. Mevcut `deadAt` korunur (ilk tespit zamanı).
 */
export function withScrapeFailure(
  matchAttributes: unknown,
  failure: { gone: boolean; reason: string },
  now: Date,
): Attributes {
  const base = baseOf(matchAttributes);
  const health = readScrapeHealth(base);
  const scrapeFailures = health.scrapeFailures + 1;
  const next: Attributes = {
    ...base,
    scrapeFailures,
    lastAttemptAt: now.toISOString(),
  };
  if (failure.gone || scrapeFailures >= DEAD_AFTER_FAILURES) {
    next.deadAt = health.deadAt ?? now.toISOString();
    next.deadReason = failure.gone ? failure.reason : `failed-${scrapeFailures}x:${failure.reason}`;
  }
  return next;
}

/** Sayfa yüklendi ama fiyat yok/stok yok gibi "hata değil" denemeler: yalnızca zaman. */
export function withScrapeAttempt(matchAttributes: unknown, now: Date): Attributes {
  return { ...baseOf(matchAttributes), lastAttemptAt: now.toISOString() };
}

/** Taze fiyat alındı: ölü işareti ve hata sayacı temizlenir. */
export function withScrapeSuccess(matchAttributes: unknown, now?: Date): Attributes {
  const next = baseOf(matchAttributes);
  delete next.deadAt;
  delete next.deadReason;
  delete next.scrapeFailures;
  if (now) next.lastAttemptAt = now.toISOString();
  return next;
}

/** Temizlenecek bir ölü/hata işareti var mı (gereksiz yazımı önlemek için)? */
export function hasScrapeFailureMarks(matchAttributes: unknown): boolean {
  const health = readScrapeHealth(matchAttributes);
  return health.deadAt !== null || health.scrapeFailures > 0;
}
