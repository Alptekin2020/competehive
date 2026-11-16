// ============================================
// Google bağlantılı rakipleri satıcının gerçek ürün sayfasına taşıma
// ============================================
//
// Saf mantık: utils/direct-listing.ts. Bu dosya veritabanı ve Serper tarafıdır.
// Keşif turunun ve 6 saatlik URL turunun sonunda çağrılır; ürün başına tur
// başına sınırlı sayıda arama yapar (her arama bir Serper kredisi).
//
// İki aşamalı: arama yalnızca bir ADAY sayfa bulur (matchAttributes.
// directCandidate). Bağlantı, `scrape-competitor` işi (verifyDirect) sayfanın
// gerçek başlığını kendi ürünümüzle doğruladıktan sonra değişir; doğrulanamayan
// aday directRejected listesine girer ve bir daha önerilmez.

import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { extractRetailer, isGoogleHostedLink, searchMarketplacePages } from "../serper";
import { COMPETITOR_STALE_HOURS, MIN_MATCH_SCORE } from "../utils/competitor-quality";
import {
  MAX_DIRECT_LOOKUPS_PER_ROUND,
  decideDirectMerge,
  isDirectLookupDue,
  isFreshEnoughForLookup,
  pickDirectListing,
  readDirectRejected,
  readGoogleKeys,
  sellerSiteDomain,
  withDirectCandidate,
  withDirectLookup,
  withGoogleKeys,
} from "../utils/direct-listing";
import { logger } from "../utils/logger";
import { readCompetitorSeller, readMatchReview, readRejectedUrlKeys } from "../utils/match-review";
import { cleanProductTitle } from "../utils/search-queries";
import { competitorUrlKey, isSameListing } from "../utils/url-match";
import { competitorQueue } from "./processor";

export interface DirectListingOutcome {
  searched: number;
  /** Doğrulama için kuyruğa alınan aday sayfa sayısı (bağlantı henüz değişmedi). */
  linked: number;
  merged: number;
}

function isTrusted(c: { matchScore: number | null; matchAttributes: unknown }): boolean {
  return (
    (c.matchScore === null || c.matchScore >= MIN_MATCH_SCORE) &&
    readMatchReview(c.matchAttributes) !== "pending"
  );
}

/** Kaydın satıcısı: Google kartının satıcı adı, yoksa bağlantının alan adındaki perakendeci. */
function sellerOf(c: { competitorUrl: string; matchAttributes: unknown }): string | null {
  const stored = readCompetitorSeller(c.matchAttributes);
  if (stored) return stored;
  if (isGoogleHostedLink(c.competitorUrl)) return null;
  const retailer = extractRetailer(c.competitorUrl);
  return retailer.name !== "Diğer" ? retailer.name : null;
}

/**
 * Ürünün Google ürün kartına bağlı, güvenilir ve (en fazla 7 gün önce
 * bayatlamış dahil) güncel rakipleri için satıcının sitesindeki gerçek ürün
 * sayfasını arar. Bulunursa sayfa aday olarak saklanır ve doğrulama işi
 * kuyruğa alınır. Aynı sayfa zaten aynı satıcının ayrı bir rakibiyse Google
 * satırı mükerrer olduğu için silinir. Hata turu bozmaz; yalnızca loglanır.
 */
export async function resolveDirectListings(
  productId: string,
  ownTitle: string,
  now: Date = new Date(),
): Promise<DirectListingOutcome> {
  const outcome: DirectListingOutcome = { searched: 0, linked: 0, merged: 0 };
  const cleanedOwnTitle = cleanProductTitle(ownTitle);
  if (cleanedOwnTitle.length < 3) return outcome;

  const product = await prisma.trackedProduct.findUnique({
    where: { id: productId },
    select: { productUrl: true, metadata: true },
  });
  const ownUrl = product?.productUrl ?? "";
  const userRejected = readRejectedUrlKeys(product?.metadata);

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

  const targets = competitors
    .filter((c) => isGoogleHostedLink(c.competitorUrl))
    .filter((c) => sellerSiteDomain(c.marketplace, readCompetitorSeller(c.matchAttributes)))
    // Yalnızca karar hesaplarına giren kayıtlar: güvenilir skor, onay bekleyen
    // değil. Fiyatı güncel ya da en fazla 7 gün önce bayatlamış olanlar.
    .filter(isTrusted)
    .filter((c) => isFreshEnoughForLookup(c.lastScrapedAt, now, COMPETITOR_STALE_HOURS))
    .filter((c) => isDirectLookupDue(c.matchAttributes, now))
    // En ucuz rakipler önce: fiyat kararını en çok onlar etkiler.
    .sort((a, b) => Number(a.currentPrice ?? Infinity) - Number(b.currentPrice ?? Infinity))
    .slice(0, MAX_DIRECT_LOOKUPS_PER_ROUND);

  if (targets.length === 0) return outcome;

  const urlKeyToId = new Map(competitors.map((c) => [competitorUrlKey(c.competitorUrl), c.id]));
  const hourBucket = Math.floor(now.getTime() / 3_600_000);

  const markLookedUp = (target: (typeof targets)[number]) =>
    prisma.competitor.update({
      where: { id: target.id },
      data: {
        matchAttributes: withDirectLookup(target.matchAttributes, now) as Prisma.JsonObject,
      },
    });

  for (const target of targets) {
    const sellerName = readCompetitorSeller(target.matchAttributes);
    const site = sellerSiteDomain(target.marketplace, sellerName);
    if (!site) continue;
    const competitorTitle = cleanProductTitle(target.competitorName ?? "");
    const query = competitorTitle.length >= 3 ? competitorTitle : cleanedOwnTitle;
    const rejected = new Set(readDirectRejected(target.matchAttributes));

    try {
      outcome.searched++;
      const results = await searchMarketplacePages(query, [site.domain], {
        storeDomains: site.kind === "store" ? [site.domain] : [],
      });
      const picked = pickDirectListing(
        cleanedOwnTitle,
        competitorTitle,
        results
          // Kendi ilanımız rakip olamaz (slug farklı olsa bile aynı ürün id'si).
          .filter((r) => !isSameListing(r.link, ownUrl))
          // Doğrulamada reddedilmiş ya da kullanıcının sildiği sayfalar bir daha önerilmez.
          .filter((r) => !rejected.has(competitorUrlKey(r.link)))
          .filter((r) => !userRejected.has(competitorUrlKey(r.link)))
          .map((r) => ({ title: cleanProductTitle(r.title), link: r.link })),
      );

      if (!picked) {
        await markLookedUp(target);
        continue;
      }

      const pickedKey = competitorUrlKey(picked.link);
      const existingId = urlKeyToId.get(pickedKey);

      if (existingId && existingId !== target.id) {
        const existing = competitors.find((c) => c.id === existingId);
        const decision = decideDirectMerge({
          targetConfirmed: readMatchReview(target.matchAttributes) === "confirmed",
          targetSeller: sellerName,
          existingSeller: existing ? sellerOf(existing) : null,
          existingTrusted: existing ? isTrusted(existing) : false,
        });
        if (decision !== "merge" || !existing) {
          logger.info(
            { productId, competitorId: target.id, existingId, decision },
            "Google-hosted competitor kept: direct page belongs to another row",
          );
          await markLookedUp(target);
          continue;
        }
        // Aynı satıcının aynı sayfası zaten ayrı bir rakip: Google satırı
        // mükerrer. Kartın TÜM anahtarları mevcut satıra eklenir; böylece kart
        // bir sonraki turda yeniden "yeni rakip" diye açılmaz.
        await prisma.competitor.update({
          where: { id: existingId },
          data: {
            matchAttributes: withGoogleKeys(withDirectLookup(existing.matchAttributes, now), [
              ...readGoogleKeys(target.matchAttributes),
              competitorUrlKey(target.competitorUrl),
            ]) as Prisma.JsonObject,
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

      // Aşama 1: adayı sakla, bağlantıyı değiştirme. Doğrulama işi sayfanın
      // gerçek başlığını okur ve ancak o zaman bağlantıyı taşır.
      await prisma.competitor.update({
        where: { id: target.id },
        data: {
          matchAttributes: withDirectCandidate(
            target.matchAttributes,
            picked.link,
            now,
          ) as Prisma.JsonObject,
        },
      });
      outcome.linked++;
      logger.info(
        { productId, competitorId: target.id, site: site.domain, url: picked.link },
        "Direct listing candidate found — queued for verification",
      );
      await competitorQueue.add(
        "scrape-competitor",
        { competitorId: target.id, verifyDirect: true },
        { jobId: `direct-verify-${target.id}-${hourBucket}`, attempts: 1 },
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
