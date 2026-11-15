// ============================================
// Google bağlantılı rakipleri satıcının gerçek ürün sayfasına taşıma
// ============================================
//
// Saf mantık: utils/direct-listing.ts. Bu dosya veritabanı ve Serper tarafıdır.
// Keşif turunun ve 6 saatlik URL turunun sonunda çağrılır; ürün başına tur
// başına sınırlı sayıda arama yapar (her arama bir Serper kredisi).

import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { isGoogleHostedLink, searchMarketplacePages } from "../serper";
import { COMPETITOR_STALE_HOURS, MIN_MATCH_SCORE } from "../utils/competitor-quality";
import {
  MAX_DIRECT_LOOKUPS_PER_ROUND,
  isDirectLookupDue,
  pickDirectListing,
  siteDomainForMarketplace,
  withDirectLookup,
} from "../utils/direct-listing";
import { logger } from "../utils/logger";
import { readMatchReview } from "../utils/match-review";
import { cleanProductTitle } from "../utils/search-queries";
import { competitorUrlKey } from "../utils/url-match";
import { competitorQueue } from "./processor";

export interface DirectListingOutcome {
  searched: number;
  linked: number;
  merged: number;
}

/**
 * Ürünün Google ürün kartına bağlı, güvenilir ve güncel rakipleri için
 * satıcının sitesindeki gerçek ürün sayfasını arar. Bulunursa bağlantı o sayfa
 * olur ve fiyatı doğrudan oradan okumak üzere `scrape-competitor` işi kuyruğa
 * alınır. Aynı sayfa zaten ayrı bir rakip olarak kayıtlıysa Google satırı
 * mükerrer olduğu için silinir. Hata turu bozmaz; yalnızca loglanır.
 */
export async function resolveDirectListings(
  productId: string,
  ownTitle: string,
  now: Date = new Date(),
): Promise<DirectListingOutcome> {
  const outcome: DirectListingOutcome = { searched: 0, linked: 0, merged: 0 };
  const cleanedOwnTitle = cleanProductTitle(ownTitle);
  if (cleanedOwnTitle.length < 3) return outcome;

  const competitors = await prisma.competitor.findMany({
    where: { trackedProductId: productId },
    select: {
      id: true,
      competitorUrl: true,
      competitorName: true,
      marketplace: true,
      currentPrice: true,
      lastScrapedAt: true,
      matchScore: true,
      matchAttributes: true,
    },
  });

  const freshCutoff = now.getTime() - COMPETITOR_STALE_HOURS * 60 * 60 * 1000;
  const targets = competitors
    .filter((c) => isGoogleHostedLink(c.competitorUrl))
    .filter((c) => siteDomainForMarketplace(c.marketplace) !== null)
    // Yalnızca karar hesaplarına giren kayıtlar: güvenilir skor, onay bekleyen
    // değil, fiyatı güncel. Ölü kayıtlar için kredi harcanmaz.
    .filter((c) => c.matchScore === null || c.matchScore >= MIN_MATCH_SCORE)
    .filter((c) => readMatchReview(c.matchAttributes) !== "pending")
    .filter((c) => c.lastScrapedAt !== null && c.lastScrapedAt.getTime() >= freshCutoff)
    .filter((c) => isDirectLookupDue(c.matchAttributes, now))
    // En ucuz rakipler önce: fiyat kararını en çok onlar etkiler.
    .sort((a, b) => Number(a.currentPrice ?? Infinity) - Number(b.currentPrice ?? Infinity))
    .slice(0, MAX_DIRECT_LOOKUPS_PER_ROUND);

  if (targets.length === 0) return outcome;

  const urlKeyToId = new Map(competitors.map((c) => [competitorUrlKey(c.competitorUrl), c.id]));
  const hourBucket = Math.floor(now.getTime() / 3_600_000);

  for (const target of targets) {
    const domain = siteDomainForMarketplace(target.marketplace);
    if (!domain) continue;
    const competitorTitle = cleanProductTitle(target.competitorName ?? "");
    const query = competitorTitle.length >= 3 ? competitorTitle : cleanedOwnTitle;

    try {
      outcome.searched++;
      const results = await searchMarketplacePages(query, [domain]);
      const picked = pickDirectListing(
        cleanedOwnTitle,
        competitorTitle,
        results.map((r) => ({ title: cleanProductTitle(r.title), link: r.link })),
      );

      if (!picked) {
        await prisma.competitor.update({
          where: { id: target.id },
          data: {
            matchAttributes: withDirectLookup(target.matchAttributes, now) as Prisma.JsonObject,
          },
        });
        continue;
      }

      const googleKey = competitorUrlKey(target.competitorUrl);
      const pickedKey = competitorUrlKey(picked.link);
      const existingId = urlKeyToId.get(pickedKey);

      if (existingId && existingId !== target.id) {
        // Aynı sayfa zaten ayrı bir rakip: Google satırı mükerrer. Kullanıcının
        // onayladığı satır silinmez, yalnızca arandığı işaretlenir.
        if (readMatchReview(target.matchAttributes) === "confirmed") {
          await prisma.competitor.update({
            where: { id: target.id },
            data: {
              matchAttributes: withDirectLookup(target.matchAttributes, now) as Prisma.JsonObject,
            },
          });
          continue;
        }
        const existing = competitors.find((c) => c.id === existingId);
        await prisma.competitor.update({
          where: { id: existingId },
          data: {
            matchAttributes: withDirectLookup(
              existing?.matchAttributes,
              now,
              googleKey,
            ) as Prisma.JsonObject,
          },
        });
        await prisma.competitor.delete({ where: { id: target.id } });
        outcome.merged++;
        logger.info(
          { productId, competitorId: target.id, into: existingId, url: picked.link.slice(0, 120) },
          "Google-hosted competitor merged into existing direct listing",
        );
        continue;
      }

      await prisma.competitor.update({
        where: { id: target.id },
        data: {
          competitorUrl: picked.link,
          matchAttributes: withDirectLookup(
            target.matchAttributes,
            now,
            googleKey,
          ) as Prisma.JsonObject,
        },
      });
      urlKeyToId.set(pickedKey, target.id);
      outcome.linked++;
      logger.info(
        { productId, competitorId: target.id, marketplace: target.marketplace, url: picked.link },
        "Google-hosted competitor linked to the seller's product page",
      );

      // Fiyatı artık gerçek sayfadan oku (bant ve paket denetimleri o işte).
      await competitorQueue.add(
        "scrape-competitor",
        { competitorId: target.id },
        { jobId: `direct-listing-${target.id}-${hourBucket}`, attempts: 1 },
      );
    } catch (err) {
      logger.warn(
        { productId, competitorId: target.id, err: err instanceof Error ? err.message : err },
        "Direct listing lookup failed",
      );
    }
  }

  return outcome;
}
