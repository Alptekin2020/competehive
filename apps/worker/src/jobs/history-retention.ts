import { PrismaClient, type Plan } from "@prisma/client";

import { logger } from "../utils/logger";

const prisma = new PrismaClient();

// Plan bazlı fiyat geçmişi saklama süresi (gün). Satış sayfasındaki vaadin
// aynası: FREE 7 / STARTER 30 / PRO 365; ENTERPRISE sınırsız (silinmez).
// apps/web/src/lib/plans.ts priceHistoryDays ile senkron tutulmalı.
// Uygulanmazsa hem FREE kullanıcı ücretli özelliği bedava alır hem de
// PriceHistory tablosu sınırsız büyür.
const RETENTION_DAYS_BY_PLAN: Record<string, number> = {
  FREE: 7,
  STARTER: 30,
  PRO: 365,
};

export async function pruneOldPriceHistory(): Promise<void> {
  for (const [plan, days] of Object.entries(RETENTION_DAYS_BY_PLAN)) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const result = await prisma.priceHistory.deleteMany({
        where: {
          scrapedAt: { lt: cutoff },
          trackedProduct: { user: { plan: plan as Plan } },
        },
      });
      if (result.count > 0) {
        logger.info({ plan, days, deleted: result.count }, "Price history pruned");
      }
    } catch (err) {
      logger.error({ err, plan }, "Price history pruning failed");
    }
  }
}
