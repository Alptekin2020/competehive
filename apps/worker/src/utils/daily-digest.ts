// ============================================
// Günlük özet e-postasının saf mantığı
// ============================================
//
// Anlık uyarılar tek tek olaylardır; satıcı sabah "bugün neye bakmalıyım?"
// sorusunun cevabını tek yerde görmek ister. Özet yalnızca aksiyon gerektiren
// bir şey varsa gider (rakip daha ucuz ya da son 24 saatte fiyat değiştirmiş);
// "her şey aynı" e-postası gürültüdür ve aboneliği kapattırır.
//
// Buradaki her şey deterministik ve G/Ç'siz: sorgular ve gönderim
// jobs/daily-digest.ts içindedir.

import { assessCompetitor } from "./competitor-quality";

/** Türkiye kalıcı olarak UTC+3'tür (yaz saati uygulaması yok). */
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Özetin gönderilebileceği İstanbul saat aralığı: [başlangıç, bitiş). */
export const DIGEST_START_HOUR = 9;
export const DIGEST_END_HOUR = 12;

/** Bir e-postada en fazla bu kadar ürün satırı listelenir. */
export const MAX_DIGEST_ITEMS = 8;

/** Bu süre içindeki rakip fiyat değişimleri "son hareket" sayılır. */
export const DIGEST_MOVE_WINDOW_HOURS = 24;

/** İstanbul takvim günü (YYYY-MM-DD) — günde bir gönderim anahtarı. */
export function istanbulDateKey(now: Date): string {
  return new Date(now.getTime() + ISTANBUL_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Şu an özet gönderim penceresinde miyiz? Pencere tek bir an değil 3 saattir:
 * tam 09:00'da deploy/yeniden başlatma olsa bile o günün özeti kaçmaz.
 */
export function isDigestWindow(now: Date): boolean {
  const hour = new Date(now.getTime() + ISTANBUL_OFFSET_MS).getUTCHours();
  return hour >= DIGEST_START_HOUR && hour < DIGEST_END_HOUR;
}

export interface DigestCompetitorInput {
  name: string | null;
  marketplace: string;
  price: number | null;
  matchScore: number | null;
  lastScrapedAt: Date | null;
  /** DIGEST_MOVE_WINDOW_HOURS öncesindeki son bilinen fiyat (yoksa null). */
  priceBefore: number | null;
}

export interface DigestProductInput {
  id: string;
  name: string;
  ownPrice: number | null;
  competitors: DigestCompetitorInput[];
}

export interface DigestItem {
  productId: string;
  productName: string;
  ownPrice: number;
  /** Karar hesaplarına giren rakip sayısı. */
  competitorCount: number;
  cheapestPrice: number;
  cheapestName: string | null;
  cheapestMarketplace: string;
  /** En ucuz rakibe göre fark: pozitifse rakip bizden yüzde bu kadar ucuz. */
  gapPct: number;
  /** Bizden ucuz rakip sayısı. */
  cheaperCount: number;
  /** Son 24 saatte fiyat indiren / artıran rakip sayısı. */
  dropCount: number;
  riseCount: number;
}

export interface Digest {
  /** Listelenen ürünler: en büyük fiyat açığı önce, en fazla MAX_DIGEST_ITEMS. */
  items: DigestItem[];
  /** Aksiyon gerektiren toplam ürün (listeye sığmayanlar dahil). */
  actionableProductCount: number;
  /** En az bir rakibi bizden ucuz olan ürün sayısı. */
  undercutProductCount: number;
  /** Değerlendirilen (fiyatı ve güvenilir rakibi olan) ürün sayısı. */
  trackedProductCount: number;
  totalDrops: number;
  totalRises: number;
}

function validPrice(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Ürün listesinden özeti üretir. Rakipler anlık uyarılarla aynı kalite
 * politikasından (assessCompetitor) geçer: onay bekleyen adaylar, bant dışı
 * fiyatlar ve bayat kayıtlar özete girmez. Aksiyon gerektirmeyen ürünler
 * listelenmez; hiç yoksa `actionableProductCount` 0 döner ve e-posta gitmez.
 */
export function buildDigest(products: DigestProductInput[], now: Date): Digest {
  const actionable: DigestItem[] = [];
  let trackedProductCount = 0;
  let undercutProductCount = 0;
  let totalDrops = 0;
  let totalRises = 0;

  for (const product of products) {
    const ownPrice = product.ownPrice;
    if (!validPrice(ownPrice)) continue;

    const usable = product.competitors.filter(
      (c) =>
        assessCompetitor(
          { price: c.price, matchScore: c.matchScore, lastScrapedAt: c.lastScrapedAt },
          { ownPrice, now },
        ).usable,
    );
    if (usable.length === 0) continue;
    trackedProductCount++;

    let cheapest = usable[0];
    let cheaperCount = 0;
    let dropCount = 0;
    let riseCount = 0;
    for (const c of usable) {
      const price = c.price as number;
      if (price < (cheapest.price as number)) cheapest = c;
      if (price < ownPrice) cheaperCount++;
      if (validPrice(c.priceBefore) && c.priceBefore !== price) {
        if (price < c.priceBefore) dropCount++;
        else riseCount++;
      }
    }

    totalDrops += dropCount;
    totalRises += riseCount;
    if (cheaperCount > 0) undercutProductCount++;
    if (cheaperCount === 0 && dropCount === 0 && riseCount === 0) continue;

    const cheapestPrice = cheapest.price as number;
    actionable.push({
      productId: product.id,
      productName: product.name,
      ownPrice,
      competitorCount: usable.length,
      cheapestPrice,
      cheapestName: cheapest.name,
      cheapestMarketplace: cheapest.marketplace,
      gapPct: ((ownPrice - cheapestPrice) / ownPrice) * 100,
      cheaperCount,
      dropCount,
      riseCount,
    });
  }

  actionable.sort((a, b) => b.gapPct - a.gapPct);

  return {
    items: actionable.slice(0, MAX_DIGEST_ITEMS),
    actionableProductCount: actionable.length,
    undercutProductCount,
    trackedProductCount,
    totalDrops,
    totalRises,
  };
}

/** Konu satırı: en önemli sayı önce. */
export function digestSubject(digest: Digest): string {
  if (digest.undercutProductCount > 0) {
    return `Günlük özet: ${digest.undercutProductCount} ürününüzde rakip daha ucuz`;
  }
  const moves = digest.totalDrops + digest.totalRises;
  return `Günlük özet: rakipleriniz ${moves} fiyat değişikliği yaptı`;
}

/** Ürün satırının tek cümlelik durumu (e-posta ve testler ortak kullanır). */
export function digestItemSummary(item: DigestItem, formatPct: (n: number) => string): string {
  const parts: string[] = [];
  if (item.cheaperCount > 0) {
    parts.push(
      `${item.competitorCount} rakipten ${item.cheaperCount} tanesi daha ucuz, en ucuzu sizden %${formatPct(item.gapPct)} aşağıda`,
    );
  } else {
    parts.push(`${item.competitorCount} rakip arasında en ucuz sizsiniz`);
  }
  if (item.dropCount > 0) parts.push(`${item.dropCount} rakip fiyat indirdi`);
  if (item.riseCount > 0) parts.push(`${item.riseCount} rakip fiyat artırdı`);
  return parts.join(" · ");
}
