import { createHash } from "node:crypto";

import { MARKETPLACES, isGenericStoreMarketplace, storeHostFromUrl } from "@competehive/shared";
import { detectMarketplaceFromUrl, isTrackableMarketplace } from "@/lib/marketplaces";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";
import { scrapeStorePage, type StoreSupportLevel } from "@/lib/store-scraper";

// Herkese açık "Siteniz uyumlu mu?" kontrolü. Giriş gerektirmez; bu yüzden
// IP başına istek sınırı (route'ta), sonuç önbelleği ve yalnızca teşhis
// döndürme (ham HTML asla dönmez) ile bedava bir "sayfa çekme servisi"ne
// dönüşmesi engellenir.

export type StoreCheckKind = "marketplace" | "own-store" | "unsupported-marketplace";

export interface StoreCheckResult {
  kind: StoreCheckKind;
  domain: string;
  storeName: string;
  support: StoreSupportLevel;
  issues: string[];
  product: {
    name: string;
    price: number | null;
    currency: string;
    image: string | null;
    inStock: boolean;
  } | null;
}

const CACHE_TTL_SECONDS = 6 * 60 * 60;

function cacheKey(url: string): string {
  const parsed = new URL(url);
  const normalized = `${parsed.host.toLowerCase().replace(/^www\./, "")}${parsed.pathname}${parsed.search}`;
  return `store-check:cache:${createHash("sha1").update(normalized).digest("hex")}`;
}

async function readCache(key: string): Promise<StoreCheckResult | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as StoreCheckResult) : null;
  } catch (err) {
    logger.warn({ err }, "Store check cache read failed");
    return null;
  }
}

async function writeCache(key: string, result: StoreCheckResult): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
  } catch (err) {
    logger.warn({ err }, "Store check cache write failed");
  }
}

async function evaluate(url: string): Promise<StoreCheckResult> {
  const marketplace = detectMarketplaceFromUrl(url);
  const domain = storeHostFromUrl(url) ?? url;

  if (!isTrackableMarketplace(marketplace)) {
    return {
      kind: "unsupported-marketplace",
      domain,
      storeName: MARKETPLACES[marketplace]?.name ?? domain,
      support: "unsupported",
      issues: [
        "Bu site bir fiyat karşılaştırma sitesi ya da şu an desteklemediğimiz bir pazaryeri.",
      ],
      product: null,
    };
  }

  // Bilinen pazaryerleri için sayfa çekilmez: özel scraper'ları zaten var ve
  // Vercel IP'lerinden yapılan istekler (Trendyol 403) yanıltıcı sonuç verirdi.
  if (!isGenericStoreMarketplace(marketplace)) {
    return {
      kind: "marketplace",
      domain,
      storeName: MARKETPLACES[marketplace]?.name ?? domain,
      support: "full",
      issues: [],
      product: null,
    };
  }

  const page = await scrapeStorePage(url);
  return {
    kind: "own-store",
    domain,
    storeName: domain,
    support: page.support,
    issues: page.issues,
    product:
      page.support === "unsupported"
        ? null
        : {
            name: page.product.name,
            price: page.product.price,
            currency: page.product.currency,
            image: page.product.image,
            inStock: page.product.inStock,
          },
  };
}

/**
 * Check a product URL for trackability (cached), and record the check so the
 * team can see which domains are requested/unsupported. Returns the record id
 * (null when the table isn't available yet) for a later "notify me" email.
 */
export async function runStoreCheck(
  url: string,
): Promise<{ checkId: string | null; result: StoreCheckResult }> {
  const key = cacheKey(url);
  const cached = await readCache(key);
  const result = cached ?? (await evaluate(url));
  if (!cached) await writeCache(key, result);

  let checkId: string | null = null;
  try {
    const row = await prisma.storeCheck.create({
      data: {
        domain: result.domain,
        url,
        support: result.support,
        issues: result.issues,
      },
      select: { id: true },
    });
    checkId = row.id;
  } catch (err) {
    // Tablo henüz oluşmamış olabilir (worker migration'ı web deploy'undan sonra
    // çalışır) — kontrol sonucu yine de kullanıcıya döner.
    logger.error({ err, domain: result.domain }, "Store check record failed");
  }

  return { checkId, result };
}
