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
  if (typeof price === "string") {
    const n = Number(
      price
        .replace(/[^\d.,]/g, "")
        .replace(/\.(?=\d{3}(\D|$))/g, "")
        .replace(",", "."),
    );
    return Number.isFinite(n) ? n : 0;
  }
  if (!price || typeof price !== "object") return 0;
  const p = price as Record<string, unknown>;
  if (typeof p.value === "number" && p.value > 0) return p.value;
  for (const key of ["discountedPrice", "sellingPrice", "originalPrice"]) {
    const node = p[key];
    if (typeof node === "number" && node > 0) return node;
    if (node && typeof node === "object") {
      const value = (node as Record<string, unknown>).value;
      if (typeof value === "number" && value > 0) return value;
    }
  }
  return 0;
}

const ID_KEYS = ["merchantId", "sellerId", "id"] as const;
const NAME_KEYS = ["merchantName", "sellerName", "name"] as const;
const PRICE_KEYS = ["price", "prices", "discountedPrice", "sellingPrice"] as const;

/** Bir otherMerchants girdisinden satıcı kimliği, adı ve fiyatı (birden çok biçim). */
function readEntry(entry: Record<string, unknown>): {
  id: unknown;
  name: unknown;
  price: unknown;
} {
  const merchant =
    entry.merchant && typeof entry.merchant === "object"
      ? (entry.merchant as Record<string, unknown>)
      : entry.seller && typeof entry.seller === "object"
        ? (entry.seller as Record<string, unknown>)
        : null;
  const pick = (keys: readonly string[]) => {
    for (const key of keys) {
      if (merchant && merchant[key] !== undefined && merchant[key] !== null) return merchant[key];
    }
    for (const key of keys) {
      if (entry[key] !== undefined && entry[key] !== null) return entry[key];
    }
    return undefined;
  };
  let price: unknown;
  for (const key of PRICE_KEYS) {
    if (readPriceValue(entry[key]) > 0) {
      price = entry[key];
      break;
    }
  }
  return { id: pick(ID_KEYS), name: pick(NAME_KEYS), price };
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
  const push = (idRaw: unknown, nameRaw: unknown, price: unknown) => {
    if (idRaw === null || idRaw === undefined || idRaw === "" || typeof idRaw === "object") return;
    const merchantId = String(idRaw);
    if (seen.has(merchantId)) return;
    const value = readPriceValue(price);
    if (!value || value <= 0) return;
    seen.add(merchantId);
    const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
    sellers.push({ merchantId, sellerName: name, price: value });
  };

  const winner = container.merchant as Record<string, unknown> | undefined;
  const winnerId = winner?.id !== undefined && winner?.id !== null ? String(winner.id) : null;
  const own = ownMerchantId ?? winnerId;
  if (winnerId && winnerId !== own) push(winnerId, winner?.name, container.price);

  const raw = Array.isArray(container.otherMerchants) ? container.otherMerchants : [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = readEntry(item as Record<string, unknown>);
    push(entry.id, entry.name, entry.price);
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

/** `start` konumundaki `[` ile eşleşen `]`'ye kadar olan JSON dizisini okur. */
function readJsonArrayAt(text: string, start: number): unknown[] | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length && i - start < 500_000; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          const arr = JSON.parse(text.slice(start, i + 1)) as unknown;
          return Array.isArray(arr) ? arr : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Sayfa HTML'ine gömülü `"otherMerchants":[...]` dizisini köşeli parantez
 * eşleştirerek çıkarır (SSR durumunda liste XHR'a hiç gitmeyebilir). Durum
 * bir JS dizgisi içinde kaçışlı (`\\"otherMerchants\\":[`) da olabilir.
 */
export function extractOtherMerchantsFromHtml(html: string): Record<string, unknown> | null {
  const plain = /"otherMerchants"\s*:\s*\[/g;
  for (let m = plain.exec(html); m; m = plain.exec(html)) {
    const arr = readJsonArrayAt(html, html.indexOf("[", m.index));
    if (arr && arr.length > 0) return { otherMerchants: arr };
  }
  const escaped = /\\"otherMerchants\\"\s*:\s*\[/g;
  for (let m = escaped.exec(html); m; m = escaped.exec(html)) {
    const start = html.indexOf("[", m.index);
    const unescaped = html
      .slice(start, start + 500_000)
      .split("\\\\")
      .map((part) => part.replace(/\\"/g, '"'))
      .join("\\");
    const arr = readJsonArrayAt(unescaped, 0);
    if (arr && arr.length > 0) return { otherMerchants: arr };
  }
  return null;
}

/** Tanı: HTML'deki ilk `otherMerchants` geçişinin çevresi (tek satır). */
export function otherMerchantsSnippet(html: string, length = 400): string | null {
  const idx = html.indexOf("otherMerchants");
  if (idx === -1) return null;
  return html
    .slice(Math.max(0, idx - 40), idx + length)
    .replace(/\s+/g, " ")
    .trim();
}

export type RequestedSellerResult =
  | { kind: "price"; price: number; sellerName: string | null }
  | { kind: "reject" }
  | { kind: "unknown" };

/**
 * `?merchantId=` URL'sinin istediği satıcının fiyatı. Listede varsa onun fiyatı;
 * satıcı listede yoksa ancak liste okunabildiyse ve buybox kazananı da biliniyor
 * ve başkasıysa red (satıcı ilandan çekilmiş). Kazanan bilinmiyorsa ya da liste
 * çözülemediyse sayfa fiyatı kalır: HTML'den çıkan listede buybox kazananı yoktur
 * ve kendi ilanımız çoğu zaman kazanandır (prod 17 Kasım: kendi ürünün
 * taraması bu yüzden 3 kez reddedildi).
 */
export function resolveRequestedSeller(
  container: Record<string, unknown>,
  merchantId: string,
): RequestedSellerResult {
  const all = sellersFromProductDetail(container, "__none__");
  const requested = all.find((s) => s.merchantId === merchantId);
  if (requested) {
    return { kind: "price", price: requested.price, sellerName: requested.sellerName };
  }
  const winner = container.merchant as Record<string, unknown> | undefined;
  const winnerId = winner?.id !== undefined && winner?.id !== null ? String(winner.id) : null;
  if (!winnerId || winnerId === merchantId || all.length === 0) return { kind: "unknown" };
  return { kind: "reject" };
}
