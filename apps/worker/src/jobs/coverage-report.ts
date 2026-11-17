// Rakip bulma kapsamını ölçüp loglar (bkz. utils/coverage-report.ts).
// Saf okuma: hiçbir satırı değiştirmez.

import { prisma } from "../db";
import { COVERAGE_TARGET, summarizeCoverage } from "../utils/coverage-report";
import { logger } from "../utils/logger";

/** Kapsam raporu aralığı: 3 saat (6 saatlik turun ortası ve sonu). */
export const COVERAGE_REPORT_INTERVAL_MS = 3 * 60 * 60 * 1000;

export async function logCompetitorCoverage(now = new Date()): Promise<void> {
  try {
    const products = await prisma.trackedProduct.findMany({
      where: { status: { in: ["ACTIVE", "OUT_OF_STOCK"] } },
      select: {
        id: true,
        productName: true,
        marketplace: true,
        currentPrice: true,
        competitors: {
          select: {
            competitorUrl: true,
            currentPrice: true,
            matchScore: true,
            lastScrapedAt: true,
            matchAttributes: true,
          },
        },
      },
    });
    const summary = summarizeCoverage(
      products.map((p) => ({
        id: p.id,
        productName: p.productName,
        marketplace: String(p.marketplace),
        ownPrice: p.currentPrice === null ? null : Number(p.currentPrice),
        competitors: p.competitors.map((c) => ({
          competitorUrl: c.competitorUrl,
          price: c.currentPrice === null ? null : Number(c.currentPrice),
          matchScore: c.matchScore,
          lastScrapedAt: c.lastScrapedAt,
          matchAttributes: c.matchAttributes,
        })),
      })),
      now,
    );
    logger.info(
      {
        products: summary.products,
        covered: summary.covered,
        coveragePct: summary.coveragePct,
        zero: summary.zero,
        target: COVERAGE_TARGET,
        byMarketplace: summary.byMarketplace,
        weakest: summary.weakest,
      },
      `📊 Rakip kapsamı: ${summary.covered}/${summary.products} ürün (%${summary.coveragePct}) en az ${COVERAGE_TARGET} güvenilir taze rakiple, ${summary.zero} üründe hiç yok`,
    );
  } catch (err) {
    logger.warn({ err }, "Competitor coverage report failed");
  }
}
