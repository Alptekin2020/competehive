// ============================================
// Ürün içgörüleri — pazar konumu, veri tazeliği, fırsatlar, grafik olayları
// ============================================
//
// Genel Bakış ve Ürünler sayfası aynı soruları soruyor: "Bu üründe en ucuz
// muyum?", "Verisi taze mi, bir sonraki kontrol ne zaman?", "Hangi üründe para
// kazanma fırsatı var?". Hesaplar burada TEK yerde yapılır; sayfalar yalnızca
// sonucu çizer. Rakip filtrelemesi her zaman merkezi kalite politikasından
// (assessCompetitorList) geçer — detay sayfasıyla aynı rakipler sayılır.

import {
  assessCompetitorList,
  computeMargin,
  priceForMargin,
  THIN_MARGIN_PCT,
} from "@competehive/shared";
import type { MarginResult } from "@competehive/shared";

/** Taze sayılma süresi (saat). Bunu aşan ürün "Verisi eski" olarak işaretlenir. */
export const STALE_HOURS = 24;

/** ERROR durumundaki ürünlerde worker'ın uyguladığı en kısa yeniden deneme (dk). */
const ERROR_RETRY_MINUTES = 1440;

/** "Fiyatı düşür, en ucuz ol" fırsatı için en fazla fark (%). */
export const UNDERCUT_MAX_GAP_PCT = 5;
/** "Fiyatı artır, yine en ucuz kal" fırsatı için ikinci sıradaki rakiple en az fark (%). */
export const RAISE_MIN_HEADROOM_PCT = 3;

export type MarketPosition = "cheapest" | "middle" | "most-expensive" | "no-data";

export interface InsightCompetitorInput {
  price: number | null;
  matchScore: number | null;
  lastScrapedAt: string | Date | null;
  /** Rakibin son taramadaki stok durumu (bilinmiyorsa null). */
  inStock?: boolean | null;
  name?: string | null;
}

export interface InsightProductInput {
  id: string;
  name: string;
  currentPrice: number | null;
  cost: number | null;
  status?: string | null;
  /** Son BAŞARILI fiyat güncellemesi (price_history). */
  lastSuccessAt: string | Date | null;
  /** Son tarama DENEMESİ (başarısız olsa da ilerler) — sonraki kontrolün tabanı. */
  lastScrapedAt: string | Date | null;
  scrapeInterval?: number | null;
  competitors: InsightCompetitorInput[];
}

export interface ProductInsight {
  position: MarketPosition;
  /** Karara uygun rakip sayısı. */
  validCompetitorCount: number;
  /** Karara uygun rakip fiyatları, artan sırada. */
  validCompetitorPrices: number[];
  /** Fiyatınızdan ucuz olan karara uygun rakip sayısı. */
  cheaperCount: number;
  /** 1 = en ucuz. Fiyat ya da rakip yoksa null. */
  rank: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  /** Fiyatınızın min–max aralığındaki yeri (0–100). Aralık yoksa null. */
  positionPct: number | null;
  cheapestCompetitorPrice: number | null;
  /** En ucuz rakipten pahalılık (%). En ucuzsanız ≤ 0. */
  gapToCheapestPct: number | null;
  margin: MarginResult | null;
  isStale: boolean;
  neverScraped: boolean;
  nextCheckAt: Date | null;
  /** Karara uygun rakiplerden stoğu biten sayısı. */
  outOfStockCompetitors: number;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Worker'ın zamanlama kuralının aynası (apps/worker/src/jobs/processor.ts):
 * son denemeden `scrapeInterval` dakika sonra tekrar taranır; ERROR ürünlerde
 * en az 24 saat beklenir; PAUSED ürün taranmaz. Hiç taranmamış ürün sıradadır.
 */
export function computeNextCheckAt(
  lastScrapedAt: string | Date | null | undefined,
  scrapeInterval: number | null | undefined,
  status: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (status === "PAUSED") return null;
  const last = toDate(lastScrapedAt);
  if (!last) return now;
  const base = scrapeInterval && scrapeInterval > 0 ? scrapeInterval : 60;
  const minutes = status === "ERROR" ? Math.max(base, ERROR_RETRY_MINUTES) : base;
  const next = new Date(last.getTime() + minutes * 60 * 1000);
  // Vadesi geçmişse bir sonraki zamanlama turunda (≤1 dk) kuyruğa girer.
  return next.getTime() < now.getTime() ? now : next;
}

export function computeProductInsight(
  input: InsightProductInput,
  now: Date = new Date(),
): ProductInsight {
  const ownPrice = validNumber(input.currentPrice);
  const assessments = assessCompetitorList(
    input.competitors.map((c) => ({
      price: c.price,
      matchScore: c.matchScore,
      lastScrapedAt: c.lastScrapedAt,
    })),
    { ownPrice, now },
  );
  const valid = input.competitors.filter((_, i) => assessments[i].usable);
  const validPrices = valid
    .map((c) => validNumber(c.price))
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);

  const cheapestCompetitorPrice = validPrices.length > 0 ? validPrices[0] : null;
  const lastSuccess = toDate(input.lastSuccessAt);
  const neverScraped = !lastSuccess;
  const isStale = !lastSuccess || now.getTime() - lastSuccess.getTime() > STALE_HOURS * 3600_000;
  const margin = computeMargin(ownPrice, input.cost);
  const nextCheckAt = computeNextCheckAt(
    input.lastScrapedAt,
    input.scrapeInterval,
    input.status,
    now,
  );
  const outOfStockCompetitors = valid.filter((c) => c.inStock === false).length;

  const base = {
    validCompetitorCount: validPrices.length,
    validCompetitorPrices: validPrices,
    cheapestCompetitorPrice,
    margin,
    isStale,
    neverScraped,
    nextCheckAt,
    outOfStockCompetitors,
  };

  if (ownPrice === null || validPrices.length === 0) {
    return {
      ...base,
      position: "no-data",
      cheaperCount: 0,
      rank: null,
      minPrice: validPrices[0] ?? null,
      maxPrice: validPrices[validPrices.length - 1] ?? null,
      positionPct: null,
      gapToCheapestPct: null,
    };
  }

  const all = [...validPrices, ownPrice];
  const minPrice = Math.min(...all);
  const maxPrice = Math.max(...all);
  const cheaperCount = validPrices.filter((p) => p < ownPrice).length;
  const rank = cheaperCount + 1;
  const positionPct =
    maxPrice > minPrice ? ((ownPrice - minPrice) / (maxPrice - minPrice)) * 100 : 0;
  const position: MarketPosition =
    cheaperCount === 0
      ? "cheapest"
      : validPrices.every((p) => p < ownPrice)
        ? "most-expensive"
        : "middle";
  const gapToCheapestPct =
    cheapestCompetitorPrice !== null
      ? ((ownPrice - cheapestCompetitorPrice) / cheapestCompetitorPrice) * 100
      : null;

  return {
    ...base,
    position,
    cheaperCount,
    rank,
    minPrice,
    maxPrice,
    positionPct,
    gapToCheapestPct,
  };
}

// ============================================
// Fırsatlar
// ============================================

export type OpportunityKind = "undercut" | "raise" | "loss" | "competitor-out-of-stock";

export interface Opportunity {
  productId: string;
  productName: string;
  kind: OpportunityKind;
  title: string;
  detail: string;
  /** Önerilen yeni fiyat (varsa). */
  suggestedPrice: number | null;
  /** Sıralama ağırlığı — büyük olan üstte. */
  weight: number;
}

const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

export function formatTryShort(value: number): string {
  return tryFormatter.format(Math.round(value));
}

/**
 * Bir ürün için en değerli fırsatı döndürür (yoksa null). Öncelik:
 * zarar > rakip stoğu bitti > fiyatı artırma payı > küçük indirimle en ucuz olma.
 * Öneriler maliyet girilmişse %10 marj tabanının altına inmez.
 */
export function findOpportunity(
  input: InsightProductInput,
  insight: ProductInsight,
): Opportunity | null {
  const ownPrice = validNumber(input.currentPrice);
  if (ownPrice === null) return null;
  const common = { productId: input.id, productName: input.name };

  if (insight.margin && insight.margin.band === "loss") {
    return {
      ...common,
      kind: "loss",
      title: "Zararına satıyorsunuz",
      detail: `Her satışta ${formatTryShort(Math.abs(insight.margin.profit))} kaybediyorsunuz.`,
      suggestedPrice: priceForMargin(input.cost, THIN_MARGIN_PCT),
      weight: 400,
    };
  }

  if (insight.outOfStockCompetitors > 0 && insight.position !== "no-data") {
    return {
      ...common,
      kind: "competitor-out-of-stock",
      title:
        insight.outOfStockCompetitors === 1
          ? "Bir rakibin stoğu bitti"
          : `${insight.outOfStockCompetitors} rakibin stoğu bitti`,
      detail: "Talep size kayabilir; fiyatı korumak veya biraz artırmak için iyi bir an.",
      suggestedPrice: null,
      weight: 300,
    };
  }

  if (insight.position === "cheapest") {
    const next = insight.validCompetitorPrices.find((p) => p > ownPrice);
    if (next !== undefined) {
      const headroomPct = ((next - ownPrice) / ownPrice) * 100;
      const target = Math.floor(next - 1);
      if (headroomPct >= RAISE_MIN_HEADROOM_PCT && target > ownPrice) {
        return {
          ...common,
          kind: "raise",
          title: `${formatTryShort(target - ownPrice)} daha pahalı satabilirsiniz`,
          detail: `Fiyatı ${formatTryShort(target)} yapsanız da en ucuz siz kalırsınız.`,
          suggestedPrice: target,
          weight: 200 + headroomPct,
        };
      }
    }
    return null;
  }

  if (
    insight.cheapestCompetitorPrice !== null &&
    insight.gapToCheapestPct !== null &&
    insight.gapToCheapestPct > 0 &&
    insight.gapToCheapestPct <= UNDERCUT_MAX_GAP_PCT
  ) {
    const target = Math.floor(insight.cheapestCompetitorPrice - 1);
    const floor = priceForMargin(input.cost, THIN_MARGIN_PCT);
    if (target <= 0 || (floor !== null && target < floor)) return null;
    return {
      ...common,
      kind: "undercut",
      title: `${formatTryShort(ownPrice - target)} indirimle en ucuz olun`,
      detail: `Fiyatı ${formatTryShort(target)} yaparsanız en ucuz satıcı siz olursunuz.`,
      suggestedPrice: target,
      weight: 100 + (UNDERCUT_MAX_GAP_PCT - insight.gapToCheapestPct),
    };
  }

  return null;
}

// ============================================
// Zaman metinleri
// ============================================

export function formatTimeAgo(value: string | Date | null | undefined, now = new Date()): string {
  const date = toDate(value);
  if (!date) return "henüz yok";
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return "az önce";
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} sa önce`;
  return `${Math.floor(diffHour / 24)} gün önce`;
}

/** "birazdan", "bugün 18:00", "yarın 09:30" veya "21.11 14:00". */
export function formatNextCheck(next: Date | null, now = new Date()): string {
  if (!next) return "duraklatıldı";
  if (next.getTime() - now.getTime() < 2 * 60 * 1000) return "birazdan";
  const time = next.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(next) - startOfDay(now)) / 86_400_000);
  if (dayDiff === 0) return `bugün ${time}`;
  if (dayDiff === 1) return `yarın ${time}`;
  const date = next.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit" });
  return `${date} ${time}`;
}

// ============================================
// Grafik olayları
// ============================================

export type PriceEventKind = "own-price-change" | "competitor-added" | "competitor-out-of-stock";

export interface PriceEvent {
  kind: PriceEventKind;
  at: string;
  label: string;
}

export interface PriceEventInput {
  ownHistory: Array<{
    scrapedAt: string | Date;
    price: number;
    priceChange: number | null;
    priceChangePct: number | null;
  }>;
  competitors: Array<{ id: string; name: string | null; createdAt: string | Date }>;
  competitorStock: Array<{ competitorId: string; scrapedAt: string | Date; inStock: boolean }>;
  windowStart: Date;
}

/**
 * Fiyat grafiğinin üzerinde gösterilecek olayları üretir: kendi fiyat
 * değişiklikleri, yeni rakibin takibe girmesi ve rakip stoğunun bitmesi
 * (stokta → stok yok geçişi). Sonuç zaman sırasındadır.
 */
export function buildPriceEvents(input: PriceEventInput): PriceEvent[] {
  const events: PriceEvent[] = [];
  const inWindow = (d: Date) => d.getTime() >= input.windowStart.getTime();

  for (const row of input.ownHistory) {
    if (!row.priceChange) continue;
    const at = toDate(row.scrapedAt);
    if (!at || !inWindow(at)) continue;
    const direction = row.priceChange > 0 ? "artırıldı" : "düşürüldü";
    const pct =
      row.priceChangePct !== null
        ? ` (%${Math.abs(row.priceChangePct).toLocaleString("tr-TR", { maximumFractionDigits: 1 })})`
        : "";
    events.push({
      kind: "own-price-change",
      at: at.toISOString(),
      label: `Fiyatınız ${formatTryShort(row.price)} olarak ${direction}${pct}`,
    });
  }

  const names = new Map<string, string>();
  for (const c of input.competitors) {
    const name = c.name?.trim() || "Bir rakip";
    names.set(c.id, name);
    const at = toDate(c.createdAt);
    if (!at || !inWindow(at)) continue;
    events.push({ kind: "competitor-added", at: at.toISOString(), label: `Yeni rakip: ${name}` });
  }

  const byCompetitor = new Map<string, Array<{ at: Date; inStock: boolean }>>();
  for (const row of input.competitorStock) {
    const at = toDate(row.scrapedAt);
    if (!at) continue;
    const list = byCompetitor.get(row.competitorId) ?? [];
    list.push({ at, inStock: row.inStock });
    byCompetitor.set(row.competitorId, list);
  }
  for (const [competitorId, rows] of byCompetitor) {
    rows.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1].inStock && !rows[i].inStock && inWindow(rows[i].at)) {
        events.push({
          kind: "competitor-out-of-stock",
          at: rows[i].at.toISOString(),
          label: `${names.get(competitorId) ?? "Bir rakip"}: stok bitti`,
        });
      }
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

// ============================================
// /api/products yanıtından giriş üretimi
// ============================================

/** GET /api/products satırının içgörüler için gereken alt kümesi (snake_case). */
export interface ApiProductLike {
  id: string;
  product_name: string;
  current_price: string | number | null;
  cost?: string | number | null;
  status?: string | null;
  last_scraped_at: string | null;
  last_success_at?: string | null;
  scrape_interval?: number | null;
  competitors?: Array<{
    current_price: string | number | null;
    match_score?: number | null;
    last_scraped_at?: string | null;
    in_stock?: boolean | null;
    competitor_name?: string | null;
  }>;
}

function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toInsightInput(p: ApiProductLike): InsightProductInput {
  return {
    id: p.id,
    name: p.product_name || "İsimsiz ürün",
    currentPrice: toNumberOrNull(p.current_price),
    cost: toNumberOrNull(p.cost),
    status: p.status ?? null,
    lastSuccessAt: p.last_success_at ?? null,
    lastScrapedAt: p.last_scraped_at,
    scrapeInterval: p.scrape_interval ?? null,
    competitors: (p.competitors ?? []).map((c) => ({
      price: toNumberOrNull(c.current_price),
      matchScore: c.match_score ?? null,
      lastScrapedAt: c.last_scraped_at ?? null,
      inStock: c.in_stock ?? null,
      name: c.competitor_name ?? null,
    })),
  };
}
