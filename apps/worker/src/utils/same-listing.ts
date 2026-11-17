// ============================================
// Aynı ilanın diğer satıcıları (Trendyol "Diğer Satıcılar")
// ============================================
//
// Aynı ilan sayfasını satan diğer mağazalar birebir aynı ürünün rakipleridir.
// Trendyol API'si Railway IP'lerinden 403 döndüğü için bu liste uzun süre hiç
// gelmedi (prod 16-17 Kasım: "Same-listing sellers synced" hiç loglanmadı).
// Puppeteer sayfası botu geçtiğinde sayfanın kendi XHR'larındaki ya da sayfa
// içinden yapılan productDetail çağrısındaki `otherMerchants` listesi okunur.

/** Aynı ilanı satan diğer satıcı. */
export interface SameListingSeller {
  merchantId: string;
  sellerName: string | null;
  price: number;
}

/** Bir JSON içinde `otherMerchants` dizisini taşıyan nesneyi bulur (derinlik sınırlı). */
export function findOtherMerchantsContainer(
  json: unknown,
  maxDepth = 6,
): Record<string, unknown> | null {
  if (maxDepth < 0 || !json || typeof json !== "object") return null;
  if (Array.isArray(json)) {
    for (const item of json.slice(0, 50)) {
      const found = findOtherMerchantsContainer(item, maxDepth - 1);
      if (found) return found;
    }
    return null;
  }
  const obj = json as Record<string, unknown>;
  if (Array.isArray(obj.otherMerchants) && obj.otherMerchants.length > 0) return obj;
  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findOtherMerchantsContainer(value, maxDepth - 1);
      if (found) return found;
    }
  }
  return null;
}

function readPriceValue(price: unknown): number {
  if (typeof price === "number") return price;
  if (!price || typeof price !== "object") return 0;
  const p = price as Record<string, unknown>;
  for (const key of ["discountedPrice", "sellingPrice", "originalPrice"]) {
    const node = p[key] as Record<string, unknown> | undefined;
    if (node && typeof node.value === "number" && node.value > 0) return node.value;
  }
  return 0;
}

/**
 * productDetail biçimindeki nesneden satıcı listesi: `otherMerchants` + buybox
 * kazananı (`merchant`). Kendi satıcımız (URL'deki merchantId, yoksa buybox
 * kazananı) listeden çıkarılır.
 */
export function sellersFromProductDetail(
  container: Record<string, unknown>,
  ownMerchantId: string | null,
): SameListingSeller[] {
  const sellers: SameListingSeller[] = [];
  const seen = new Set<string>();
  const push = (merchant: unknown, idFallback: unknown, price: unknown) => {
    const m = merchant && typeof merchant === "object" ? (merchant as Record<string, unknown>) : {};
    const idRaw = m.id ?? idFallback;
    if (idRaw === null || idRaw === undefined || idRaw === "") return;
    const merchantId = String(idRaw);
    if (seen.has(merchantId)) return;
    const value = readPriceValue(price);
    if (!value || value <= 0) return;
    seen.add(merchantId);
    const name = typeof m.name === "string" && m.name.trim() ? m.name.trim() : null;
    sellers.push({ merchantId, sellerName: name, price: value });
  };

  const winner = container.merchant as Record<string, unknown> | undefined;
  const winnerId = winner?.id !== undefined && winner?.id !== null ? String(winner.id) : null;
  const own = ownMerchantId ?? winnerId;
  if (winnerId && winnerId !== own) push(winner, null, container.price);

  const raw = Array.isArray(container.otherMerchants) ? container.otherMerchants : [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    push(entry.merchant, entry.merchantId, entry.price);
  }
  return sellers.filter((s) => s.merchantId !== own);
}

/** Aynı ilanın diğer satıcısı olarak kaydedilen satırın matchAttributes'ı. */
export function sameListingAttributes(seller: SameListingSeller): Record<string, string | boolean> {
  return {
    sameListing: true,
    merchantId: seller.merchantId,
    matchBasis: "model-code",
    ...(seller.sellerName ? { seller: seller.sellerName } : {}),
  };
}

/** Satır aynı ilanın diğer satıcısı mı? (kendi taramamız tazeler, ayrıca taranmaz) */
export function isSameListingSellerRow(matchAttributes: unknown): boolean {
  return (
    !!matchAttributes &&
    typeof matchAttributes === "object" &&
    (matchAttributes as Record<string, unknown>).sameListing === true
  );
}

/** URL'deki Trendyol merchantId'si. */
export function merchantIdFromUrl(url: string | null | undefined): string | null {
  const match = (url ?? "").match(/[?&]merchantId=(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Rakip URL'si kendi ilanımızın BAŞKA bir satıcısını mı gösteriyor? (aynı ilan,
 * farklı merchantId). Bu satır "kendi ilanı" sayılıp silinmemelidir.
 */
export function isOtherSellerUrl(
  competitorUrl: string | null | undefined,
  productUrl: string | null | undefined,
): boolean {
  const theirs = merchantIdFromUrl(competitorUrl);
  if (!theirs) return false;
  return theirs !== merchantIdFromUrl(productUrl);
}
