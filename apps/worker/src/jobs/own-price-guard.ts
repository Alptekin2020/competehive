// ============================================
// Kendi fiyat güncellemesi için DB'li sarmalayıcı
// ============================================
//
// resolveOwnPriceUpdate (utils/price-sanity.ts) saf karardır; burada yalnızca
// gerektiğinde güvenilir rakip medyanı okunur ve metadata.pendingOwnPrice
// yazılır/temizlenir. Tüm kendi-fiyat yazım yolları (zamanlanmış tarama,
// manuel yenileme, URL turu, Serper kurtarma) bunu kullanır.

import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { trustedPeerMedian } from "../utils/competitor-quality";
import { needsPeerMedian, resolveOwnPriceUpdate } from "../utils/price-sanity";
import type { OwnPriceDecision } from "../utils/price-sanity";

export async function loadTrustedPeerMedian(productId: string, now: Date): Promise<number | null> {
  const competitors = await prisma.competitor.findMany({
    where: { trackedProductId: productId, currentPrice: { gt: 0 } },
    select: { currentPrice: true, matchScore: true, lastScrapedAt: true, matchAttributes: true },
  });
  return trustedPeerMedian(
    competitors.map((c) => ({
      price: c.currentPrice !== null ? Number(c.currentPrice) : null,
      matchScore: c.matchScore,
      lastScrapedAt: c.lastScrapedAt,
      matchAttributes: c.matchAttributes,
    })),
    { now },
  ).median;
}

export interface OwnPriceGuardTarget {
  id: string;
  metadata: Prisma.JsonValue | null;
}

/**
 * Kendi fiyat okumasına karar verir ve metadata değişikliğini tüm hedeflere
 * (URL turunda aynı URL'i izleyen sibling'ler) yazar. Karar ilk hedefin
 * metadata'sı ve rakipleriyle verilir; fiyat yazımı çağırana kalır.
 */
export async function guardOwnPriceUpdate(params: {
  targets: OwnPriceGuardTarget[];
  previousPrice: number | null | undefined;
  newPrice: number | null | undefined;
  now: Date;
  source: string;
}): Promise<OwnPriceDecision> {
  const { targets, previousPrice, newPrice, now, source } = params;
  const primary = targets[0];
  if (!primary) {
    return resolveOwnPriceUpdate({ previousPrice, newPrice, metadata: null, now });
  }

  let peerMedian: number | null = null;
  if (needsPeerMedian(previousPrice, newPrice)) {
    try {
      peerMedian = await loadTrustedPeerMedian(primary.id, now);
    } catch (err) {
      console.error(`Own-price peer median read failed (${primary.id}):`, err);
    }
  }

  const decision = resolveOwnPriceUpdate({
    previousPrice,
    newPrice,
    metadata: primary.metadata,
    peerMedian,
    now,
  });

  if (decision.metadata !== null || decision.reason !== "plausible") {
    console.log(
      `Own-price decision (${source}): product=${primary.id} prev=${previousPrice ?? "-"} new=${newPrice ?? "-"} peerMedian=${peerMedian ?? "-"} → ${decision.reason}`,
    );
  }

  if (decision.metadata !== null) {
    for (const target of targets) {
      // Her hedefin kendi metadata'sı korunur; yalnızca pendingOwnPrice değişir.
      const base =
        target === primary
          ? decision.metadata
          : withPending(target.metadata, decision.pending ?? undefined);
      try {
        await prisma.trackedProduct.update({
          where: { id: target.id },
          data: { metadata: base as Prisma.InputJsonValue },
        });
      } catch (err) {
        console.error(`Own-price pending metadata write failed (${target.id}):`, err);
      }
    }
  }

  return decision;
}

function withPending(metadata: unknown, pending: object | undefined): Record<string, unknown> {
  const next =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  if (pending) next.pendingOwnPrice = pending;
  else delete next.pendingOwnPrice;
  return next;
}
