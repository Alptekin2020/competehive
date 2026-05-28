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
    { ruleType: RuleType.BACK_IN_STOCK, cooldownMinutes: 15 },
    { ruleType: RuleType.OUT_OF_STOCK, cooldownMinutes: 120 },
    { ruleType: RuleType.PRICE_INCREASE, cooldownMinutes: 60 },
    {
      ruleType: RuleType.PERCENTAGE_CHANGE,
      thresholdValue: alertThresholdPct,
      cooldownMinutes: 60,
    },
  ];
}

export interface CreateDefaultAlertsParams {
  userId: string;
  trackedProductId: string;
  plan: string;
  alertThresholdPct?: number;
}

export interface CreateDefaultAlertsResult {
  created: number;
  skipped: number;
}

export async function createDefaultAlertRules(
  params: CreateDefaultAlertsParams,
): Promise<CreateDefaultAlertsResult> {
  const { userId, trackedProductId, plan, alertThresholdPct = 5 } = params;
  const candidates = buildDefaultRules(alertThresholdPct);

  try {
    const features = getPlanFeatures(plan);
    const channels = features.allowedChannels as NotifyChannel[];

    if (channels.length === 0) {
      return { created: 0, skipped: candidates.length };
    }

    const currentCount = await prisma.alertRule.count({
      where: { userId, isActive: true },
    });

    const availableSlots = Math.max(0, features.maxAlertRules - currentCount);
    if (availableSlots === 0) {
      return { created: 0, skipped: candidates.length };
    }

    const toInsert = candidates.slice(0, availableSlots);

    const result = await prisma.alertRule.createMany({
      data: toInsert.map((r) => ({
        userId,
        trackedProductId,
        ruleType: r.ruleType,
        thresholdValue: r.thresholdValue,
        notifyVia: channels,
        cooldownMinutes: r.cooldownMinutes,
        isActive: true,
      })),
    });

    return { created: result.count, skipped: candidates.length - result.count };
  } catch (error) {
    logger.error(
      { err: error, userId, trackedProductId, plan },
      "Failed to create default alert rules",
    );
    return { created: 0, skipped: candidates.length };
  }
}
