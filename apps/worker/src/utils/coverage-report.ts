// ============================================
// Rakip bulma kapsamı ölçümü
// ============================================
//
// "Rakip bulma 68 puan" gibi tahminler yerine ölçülen bir sayı: kaç ürünün
// karar hesaplarına giren (kalite politikasını geçen: onaylı/skorlu, bekleyen
// değil, ölü değil, 72 saat içinde fiyatlı, bandın içinde) en az
// COVERAGE_TARGET rakibi var. Hedef: bu oran %80'in üstünde olsun.

import { assessCompetitorList, readCompetitorDeadAt } from "./competitor-quality";
import { isGoogleHostedUrl } from "./stale-competitors";

/** Bir ürünün "kapsanmış" sayılması için gereken güvenilir taze rakip sayısı. */
export const COVERAGE_TARGET = 3;

export interface CoverageCompetitorInput {
  competitorUrl: string;
  price: number | null;
  matchScore: number | null;
  lastScrapedAt: Date | null;
  matchAttributes: unknown;
}

export interface CoverageProductInput {
  id: string;
  productName: string;
  marketplace: string;
  ownPrice: number | null;
  competitors: CoverageCompetitorInput[];
}

export interface CoverageProductRow {
  id: string;
  name: string;
  marketplace: string;
  /** Karar hesaplarına giren rakip sayısı. */
  usable: number;
  /** Bunların Google kartı olmayanları (gerçek satıcı sayfası). */
  usableDirect: number;
  /** Satırdaki tüm rakipler (bekleyen, bayat, ölü dahil). */
  total: number;
}

export interface CoverageSummary {
  products: number;
  covered: number;
  /** covered / products, yüzde, tam sayı. */
  coveragePct: number;
  /** Hiç güvenilir taze rakibi olmayan ürün sayısı. */
  zero: number;
  byMarketplace: Record<string, { products: number; covered: number }>;
  /** En az rakibi olanlar önce. */
  weakest: CoverageProductRow[];
}

export function summarizeCoverage(
  products: CoverageProductInput[],
  now: Date,
  target = COVERAGE_TARGET,
  weakestLimit = 15,
): CoverageSummary {
  const rows: CoverageProductRow[] = products.map((product) => {
    const assessments = assessCompetitorList(
      product.competitors.map((c) => ({
        price: c.price,
        matchScore: c.matchScore,
        lastScrapedAt: c.lastScrapedAt,
        deadAt: readCompetitorDeadAt(c.matchAttributes),
        matchAttributes: c.matchAttributes,
      })),
      { ownPrice: product.ownPrice, now },
    );
    const usable = product.competitors.filter((_, i) => assessments[i].usable);
    return {
      id: product.id,
      name: product.productName.slice(0, 60),
      marketplace: product.marketplace,
      usable: usable.length,
      usableDirect: usable.filter((c) => !isGoogleHostedUrl(c.competitorUrl)).length,
      total: product.competitors.length,
    };
  });

  const byMarketplace: CoverageSummary["byMarketplace"] = {};
  for (const row of rows) {
    const bucket = (byMarketplace[row.marketplace] ??= { products: 0, covered: 0 });
    bucket.products++;
    if (row.usable >= target) bucket.covered++;
  }
  const covered = rows.filter((r) => r.usable >= target).length;
  return {
    products: rows.length,
    covered,
    coveragePct: rows.length > 0 ? Math.round((covered / rows.length) * 100) : 0,
    zero: rows.filter((r) => r.usable === 0).length,
    byMarketplace,
    weakest: rows
      .filter((r) => r.usable < target)
      .sort((a, b) => a.usable - b.usable || a.total - b.total)
      .slice(0, weakestLimit),
  };
}
