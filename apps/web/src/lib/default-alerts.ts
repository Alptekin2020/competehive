import { NotifyChannel, RuleType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getPlanFeatures } from "@/lib/plan-gates";
import { logger } from "@/lib/logger";

interface DefaultAlertRuleSpec {
  ruleType: RuleType;
  thresholdValue?: number;
  cooldownMinutes: number;
}

// Priority order: most valuable rules first. When the plan's alert-rule cap
// leaves only a few slots, we keep the top entries and drop the rest.
function buildDefaultRules(alertThresholdPct: number): DefaultAlertRuleSpec[] {
  return [
    { ruleType: RuleType.PRICE_DROP, cooldownMinutes: 60 },
    { ruleType: RuleType.COMPETITOR_CHEAPER, cooldownMinutes: 30 },
    { ruleType: RuleType.OUT_OF_STOCK, cooldownMinutes: 120 },
    { ruleType: RuleType.BACK_IN_STOCK, cooldownMinutes: 15 },
    { ruleType: RuleType.PRICE_INCREASE, cooldownMinutes: 60 },
    {
      ruleType: RuleType.PERCENTAGE_CHANGE,
      thresholdValue: alertThresholdPct,
      cooldownMinutes: 60,
    },
  ];
}

export interface EnsureDefaultAlertsParams {
  userId: string;
  plan: string;
  alertThresholdPct?: number;
}

export interface EnsureDefaultAlertsResult {
  created: number;
  skipped: number;
}

/**
 * Kullanıcı için HESAP GENELİ (trackedProductId = null) varsayılan uyarı
 * kurallarını bir kez oluşturur. Genel kurallar kullanıcının TÜM ürünlerine
 * uygulanır; aynı türde ürün bazlı bir kural varsa o üründe genel kuralı ezer.
 *
 * Eski davranış ürün başına 6 kural oluşturuyordu; plan kotaları toplam
 * sayıldığı için (FREE: 3, STARTER: 20) ilk birkaç üründen sonrası SESSİZCE
 * kuralsız kalıyordu. Genel kurallar bu sorunu kökten çözer: 6 slot, sınırsız
 * ürünü kapsar.
 *
 * Idempotent: kullanıcının halihazırda HERHANGİ bir kuralı varsa (genel veya
 * ürün bazlı) hiçbir şey oluşturmaz — mevcut kullanıcıların bildirim hacmini
 * habersiz değiştirmemek için.
 */
export async function ensureDefaultGlobalAlertRules(
  params: EnsureDefaultAlertsParams,
): Promise<EnsureDefaultAlertsResult> {
  const { userId, plan, alertThresholdPct = 5 } = params;
  const candidates = buildDefaultRules(alertThresholdPct);

  try {
    const features = getPlanFeatures(plan);
    const channels = features.allowedChannels as NotifyChannel[];

    if (channels.length === 0) {
      return { created: 0, skipped: candidates.length };
    }

    const existingCount = await prisma.alertRule.count({ where: { userId } });
    if (existingCount > 0) {
      return { created: 0, skipped: candidates.length };
    }

    const availableSlots = Math.max(0, features.maxAlertRules);
    if (availableSlots === 0) {
      return { created: 0, skipped: candidates.length };
    }

    const toInsert = candidates.slice(0, availableSlots);

    const result = await prisma.alertRule.createMany({
      data: toInsert.map((r) => ({
        userId,
        trackedProductId: null,
        ruleType: r.ruleType,
        thresholdValue: r.thresholdValue,
        notifyVia: channels,
        cooldownMinutes: r.cooldownMinutes,
        isActive: true,
      })),
    });

    return { created: result.count, skipped: candidates.length - result.count };
  } catch (error) {
    logger.error({ err: error, userId, plan }, "Failed to create default global alert rules");
    return { created: 0, skipped: candidates.length };
  }
}
