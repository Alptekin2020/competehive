// ============================================
// Günlük özet e-postası (İstanbul sabahı, günde bir)
// ============================================
//
// Saf mantık utils/daily-digest.ts içindedir; burası sorgu + kilit + gönderim.
// Kilit kullanıcı başına Redis'te tutulur (SET NX): deploy/yeniden başlatma ya
// da 10 dakikalık tekrar kontrolü aynı gün ikinci bir e-posta gönderemez.
// Redis'e ulaşılamıyorsa tur atlanır — kilitsiz gönderim tekrar riski taşır.

import { prisma } from "../db";
import { sendDailyDigestEmail } from "../services/notifications";
import { cacheClaim } from "../utils/cache";
import {
  buildDigest,
  DIGEST_MOVE_WINDOW_HOURS,
  isDigestWindow,
  istanbulDateKey,
  type DigestProductInput,
} from "../utils/daily-digest";
import { logger } from "../utils/logger";

export const DAILY_DIGEST_CHECK_MS = 10 * 60 * 1000;

const CLAIM_TTL_SECONDS = 36 * 60 * 60;

// Kimseye gönderim denenmeyen turlar eskiden hiç iz bırakmıyordu; "özet neden
// gelmedi?" sorusu loglardan cevaplanamıyordu. Sebep günde bir kez yazılır
// (10 dakikalık kontrol her turda aynı satırı basmasın).
let lastIdleLogDateKey: string | null = null;

// 15 Kasım 2026: dört kullanıcının günlük kilidi alındı ama ne gönderim ne
// hata logu oluştu — tur bir await'te asılı kalmış, 10 dakikalık her kontrol
// sıradaki kullanıcının kilidini alıp aynı yerde takılmıştı. Her adım süre
// sınırına bağlanır; aşılırsa hangi adımın takıldığı loglanır ve tur devam eder.
const STEP_TIMEOUT_MS = 90_000;

async function withStepTimeout<T>(step: string, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Daily digest step timed out: ${step}`)),
      STEP_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadDigestProducts(userId: string, now: Date): Promise<DigestProductInput[]> {
  const products = await prisma.trackedProduct.findMany({
    where: { userId, status: "ACTIVE" },
    select: {
      id: true,
      productName: true,
      currentPrice: true,
      competitors: {
        select: {
          id: true,
          competitorName: true,
          marketplace: true,
          currentPrice: true,
          matchScore: true,
          lastScrapedAt: true,
        },
      },
    },
  });

  const competitorIds = products.flatMap((p) => p.competitors.map((c) => c.id));
  const priceBefore = new Map<string, number>();
  if (competitorIds.length > 0) {
    // Her rakibin pencere öncesindeki son fiyatı: bugünkü fiyatla farklıysa
    // rakip son 24 saatte fiyat değiştirmiş demektir.
    // Alt sınır (7 gün) sorguyu sınırlar: Prisma `distinct`i bellekte uygular,
    // sınırsız geçmiş çekmek büyük hesaplarda worker belleğini şişirir.
    const cutoff = new Date(now.getTime() - DIGEST_MOVE_WINDOW_HOURS * 60 * 60 * 1000);
    const floor = new Date(cutoff.getTime() - 7 * 24 * 60 * 60 * 1000);
    const rows = await prisma.competitorPrice.findMany({
      where: { competitorId: { in: competitorIds }, scrapedAt: { lt: cutoff, gte: floor } },
      orderBy: [{ competitorId: "asc" }, { scrapedAt: "desc" }],
      distinct: ["competitorId"],
      select: { competitorId: true, price: true },
    });
    for (const row of rows) priceBefore.set(row.competitorId, Number(row.price));
  }

  return products.map((p) => ({
    id: p.id,
    name: p.productName,
    ownPrice: p.currentPrice === null ? null : Number(p.currentPrice),
    competitors: p.competitors.map((c) => ({
      name: c.competitorName,
      marketplace: c.marketplace,
      price: c.currentPrice === null ? null : Number(c.currentPrice),
      matchScore: c.matchScore,
      lastScrapedAt: c.lastScrapedAt,
      priceBefore: priceBefore.get(c.id) ?? null,
    })),
  }));
}

export async function runDailyDigestIfDue(now: Date = new Date()): Promise<void> {
  if (!isDigestWindow(now)) return;

  const dateKey = istanbulDateKey(now);
  if (!process.env.RESEND_API_KEY) {
    if (lastIdleLogDateKey !== dateKey) {
      lastIdleLogDateKey = dateKey;
      logger.warn({ dateKey }, "Daily digest skipped — RESEND_API_KEY not set");
    }
    return;
  }
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      emailAlertsEnabled: true,
      dailyDigestEnabled: true,
      trackedProducts: { some: { status: "ACTIVE" } },
    },
    select: { id: true, email: true },
  });

  let sent = 0;
  let quiet = 0;
  let failed = 0;
  let noEmail = 0;
  let alreadyClaimed = 0;
  for (const user of users) {
    if (!user.email) {
      noEmail++;
      continue;
    }
    try {
      const claimed = await cacheClaim(`daily-digest:${dateKey}:${user.id}`, CLAIM_TTL_SECONDS);
      if (claimed === null) {
        logger.warn("Daily digest skipped — Redis unavailable, cannot guarantee once-per-day");
        return;
      }
      if (!claimed) {
        alreadyClaimed++;
        continue;
      }

      logger.info({ dateKey, userId: user.id }, "Daily digest building for user");
      const digest = buildDigest(
        await withStepTimeout("load-products", loadDigestProducts(user.id, now)),
        now,
      );
      if (digest.actionableProductCount === 0) {
        quiet++;
        continue;
      }
      const outcome = await withStepTimeout("send-email", sendDailyDigestEmail(user, digest));
      if (outcome.status === "SENT") sent++;
      else failed++;
    } catch (err) {
      failed++;
      logger.error({ err, userId: user.id }, "Daily digest failed for user");
    }
  }

  if (sent > 0 || failed > 0 || quiet > 0) {
    logger.info({ dateKey, sent, quiet, failed }, "Daily digest round finished");
    return;
  }
  if (lastIdleLogDateKey !== dateKey) {
    lastIdleLogDateKey = dateKey;
    logger.info(
      { dateKey, eligibleUsers: users.length, noEmail, alreadyClaimed },
      "Daily digest round had nobody to send to",
    );
  }
}
