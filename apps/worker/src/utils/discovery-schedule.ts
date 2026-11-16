// ============================================
// Rakip keşfi zamanlaması (saf, test edilebilir)
// ============================================
//
// Prod hatası (15 Kasım 2026): keşif döngüsü "vakti geldi mi?" kararını
// trackedProduct.refreshCompletedAt'e göre veriyordu; ama 6 saatlik URL
// tazeleme turu da aynı alanı her turda "şimdi" yapıyor. Ücretli ürünlerde
// alan hiçbir zaman 6 saatten eskiye düşmediği için keşif bir daha hiç
// çalışmadı (loglarda yüzlerce "Competitor refresh: no products due").
//
// Keşif artık kendi zaman damgasını tutar: metadata.discoveredAt (ISO dizgi).
// Kolon yerine JSON: şema/migrasyon gerektirmez ve scraper metadata'ya
// dokunmaz (processor yalnızca scraper metadata döndürürse yazar).

import { FREE_REFRESH_AFTER_HOURS, isEffectivelyPaid } from "./plan-cadence";

export interface DiscoveryCandidate {
  id: string;
  metadata: unknown;
  refreshCompletedAt: Date | null;
  user: { plan: string | null; planStatus: string | null; planExpiresAt: Date | null };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** metadata.discoveredAt → Date (yoksa/bozuksa null). */
export function readDiscoveredAt(metadata: unknown): Date | null {
  const raw = asObject(metadata).discoveredAt;
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Mevcut metadata'yı koruyarak discoveredAt yazar. */
export function withDiscoveredAt(metadata: unknown, at: Date): Record<string, unknown> {
  return { ...asObject(metadata), discoveredAt: at.toISOString() };
}

/** Plana göre keşif aralığı (saat): ücretli 6 saat (paidHours), diğerleri günde bir. */
export function discoveryIntervalHours(
  user: DiscoveryCandidate["user"],
  now: Date,
  paidHours: number,
): number {
  return isEffectivelyPaid(user, now) ? paidHours : Math.max(paidHours, FREE_REFRESH_AFTER_HOURS);
}

/**
 * Keşif vakti geldi mi? Yalnızca metadata.discoveredAt'e bakar — 6 saatlik URL
 * turunun yazdığı refreshCompletedAt keşfi ERTELEMEZ. Hiç discoveredAt'i
 * olmayan (eski) ürünler vadesi gelmiş sayılır; sıralamada eski alan kullanılır
 * ve tur başına sınır (batchSize) deploy sonrası yığılmayı yayar.
 */
export function isDiscoveryDue(product: DiscoveryCandidate, now: Date, paidHours: number): boolean {
  const last = readDiscoveredAt(product.metadata);
  if (!last) return true;
  const hours = discoveryIntervalHours(product.user, now, paidHours);
  return now.getTime() - last.getTime() >= hours * 60 * 60 * 1000;
}

/** Sıralama anahtarı: discoveredAt, yoksa eski alan (refreshCompletedAt), o da yoksa en önce. */
function lastDiscoveryMs(product: DiscoveryCandidate): number {
  const at = readDiscoveredAt(product.metadata) ?? product.refreshCompletedAt;
  return at ? at.getTime() : Number.NEGATIVE_INFINITY;
}

/** Vadesi gelenleri en uzun süredir keşfedilmeyenden başlayarak batchSize kadar seçer. */
export function selectDueForDiscovery<T extends DiscoveryCandidate>(
  products: T[],
  now: Date,
  paidHours: number,
  batchSize: number,
): T[] {
  return products
    .filter((p) => isDiscoveryDue(p, now, paidHours))
    .sort((a, b) => lastDiscoveryMs(a) - lastDiscoveryMs(b))
    .slice(0, batchSize);
}
