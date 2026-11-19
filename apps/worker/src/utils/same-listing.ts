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
  if (Array.isArray(price)) {
    for (const item of price.slice(0, 5)) {
      const value = readPriceValue(item);
      if (value > 0) return value;
    }
    return 0;
  }
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
  for (const key of [
    "discountedPrice",
    "finalPrice",
    "salePrice",
    "sellingPrice",
    "amount",
    "price",
    "originalPrice",
  ]) {
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
  if (theirs) return theirs !== merchantIdFromUrl(productUrl);
  const theirMagaza = hepsiburadaMagazaFromUrl(competitorUrl);
  if (!theirMagaza) return false;
  const ownMagaza = hepsiburadaMagazaFromUrl(productUrl);
  // Kendi mağaza adını bilmiyorsak keşfin bulduğu `?magaza=` satırı kendi
  // ilanımız olabilir; korumayı yalnızca senkronun yazdığı satırlar
  // (isSameListingSellerRow) alır.
  return !!ownMagaza && foldSellerName(theirMagaza) !== foldSellerName(ownMagaza);
}

/** `start` konumundaki `[`/`{` ile eşleşen kapanışa kadar olan JSON değerini okur. */
function readJsonValueAt(text: string, start: number): unknown {
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
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** JS dizgisi içindeki kaçışlı JSON'u (`\\"a\\":1`) düz JSON'a çevirir. */
function unescapeJsString(text: string): string {
  return text
    .split("\\\\")
    .map((part) => part.replace(/\\"/g, '"'))
    .join("\\");
}

/** Metindeki her `"key":<açılış>` geçişinden sonraki JSON değerleri. */
function jsonValuesAfterKey(text: string, key: string, open: "[" | "{"): unknown[] {
  const out: unknown[] = [];
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\${open}`, "g");
  for (let m = pattern.exec(text); m && out.length < 10; m = pattern.exec(text)) {
    const value = readJsonValueAt(text, text.indexOf(open, m.index + key.length + 2));
    if (value !== null) out.push(value);
  }
  return out;
}

/** HTML'in kendisi ve (varsa) kaçışlı durum dizgisinin düz hali. */
function htmlTextVariants(html: string): string[] {
  return html.includes('\\"') ? [html, unescapeJsString(html)] : [html];
}

/**
 * Sayfa HTML'ine gömülü `"otherMerchants":[...]` dizisini köşeli parantez
 * eşleştirerek çıkarır (SSR durumunda liste XHR'a hiç gitmeyebilir). Durum
 * bir JS dizgisi içinde kaçışlı (`\\"otherMerchants\\":[`) da olabilir.
 */
export function extractOtherMerchantsFromHtml(html: string): Record<string, unknown> | null {
  for (const text of htmlTextVariants(html)) {
    for (const arr of jsonValuesAfterKey(text, "otherMerchants", "[")) {
      if (Array.isArray(arr) && arr.length > 0) return { otherMerchants: arr };
    }
  }
  return null;
}

/**
 * Trendyol'un yeni ürün sayfası (prod 17 Kasım): satıcı bilgisi kaçışlı durum
 * dizgisindeki `merchantListing` nesnelerinde durur: `merchant` (sayfada
 * gösterilen satıcı), `winnerVariant.price` ve diğer satıcılar
 * `otherMerchantsVariants`. Birden çok `merchantListing` parçası birleştirilir.
 * Dönen nesne `sellersFromProductDetail` biçimindedir; satıcı kimliği yoksa null.
 */
export function extractMerchantListingFromHtml(html: string): Record<string, unknown> | null {
  let merchant: Record<string, unknown> | null = null;
  let price: unknown = null;
  let others: unknown[] = [];
  for (const text of htmlTextVariants(html)) {
    for (const value of jsonValuesAfterKey(text, "merchantListing", "{")) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const listing = value as Record<string, unknown>;
      const m = listing.merchant as Record<string, unknown> | undefined;
      if (!merchant && m && typeof m === "object" && m.id !== undefined && m.id !== null) {
        merchant = { id: m.id, name: m.name };
      }
      const winner = listing.winnerVariant as Record<string, unknown> | undefined;
      if (price === null && winner && readPriceValue(winner.price) > 0) price = winner.price;
      for (const key of ["otherMerchantsVariants", "otherMerchants"]) {
        const list = listing[key];
        if (others.length === 0 && Array.isArray(list) && list.length > 0) others = list;
      }
    }
    if (merchant) break;
  }
  if (!merchant) return null;
  return { merchant, ...(price !== null ? { price } : {}), otherMerchants: others };
}

/**
 * Tanı: satıcı verisinin sayfada nerede durduğunu görmek için anahtar
 * geçişlerinin çevresi (prod 17 Kasım: tek `otherMerchants` geçişi aslında
 * boş `otherMerchantsVariants` bayrağıydı; liste `merchantListing` altında olabilir).
 */
export function sellerDataSnippets(
  html: string,
  keys: readonly string[] = ["merchantListing", "Diğer Satıcılar"],
  perKey = 2,
  length = 500,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of keys) {
    const found: string[] = [];
    let idx = html.indexOf(key);
    while (idx !== -1 && found.length < perKey) {
      found.push(
        html
          .slice(Math.max(0, idx - 80), idx + length)
          .replace(/\s+/g, " ")
          .trim(),
      );
      idx = html.indexOf(key, idx + key.length);
    }
    if (found.length > 0) out[key] = found;
  }
  return out;
}

/**
 * Tanı: Hepsiburada ilk sayfada yalnız 2 diğer satıcı verir
 * (`hasMoreListings: true`). Kalanları getiren adresi bulmak için sayfadaki
 * ilan/satıcı ile ilgili adres benzeri dizgeler (kaçışlı `\u002F` dahil)
 * toplanır. En çok `limit` benzersiz değer.
 */
export function hepsiburadaListingApiHints(html: string, limit = 12): string[] {
  const text = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const out = new Set<string>();
  const re =
    /(?:https?:\/\/[a-z0-9.-]+)?\/[a-z0-9._~\-/{}:]*(?:listing|merchant|seller|satici)[a-z0-9._~\-/{}:?=&]*/gi;
  for (const m of text.matchAll(re)) {
    const value = m[0];
    if (value.length < 8 || value.length > 200) continue;
    // Ürün sayfası slug'ları ve statik dosyalar ipucu değildir.
    if (/\.(?:js|css|png|jpe?g|svg|webp|woff2?)(?:$|\?)/i.test(value)) continue;
    if (/-p[m]?-[A-Z0-9]+/i.test(value)) continue;
    out.add(value);
    if (out.size >= limit) break;
  }
  return [...out];
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

// ============================================
// Hepsiburada "Diğer satıcılar"
// ============================================

/**
 * Hepsiburada ürün sayfası (prod 17 Kasım tanı logu): satıcılar kaçışlı durum
 * dizgisindeki `"listings":[{"merchantId":"<uuid>","listingId":…,
 * "merchantName":"PORGATECH",…,"prices":[…]}]` dizisinde durur
 * (`hasMoreListings` ile birlikte). Satıcı kimliği + adı taşıyan ilk dizi döner.
 */
export function extractHepsiburadaListingsFromHtml(html: string): Record<string, unknown>[] {
  for (const text of htmlTextVariants(html)) {
    for (const arr of jsonValuesAfterKey(text, "listings", "[")) {
      if (!Array.isArray(arr)) continue;
      const entries = arr.filter(
        (item): item is Record<string, unknown> =>
          !!item &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).merchantName === "string",
      );
      if (entries.length > 0) return entries;
    }
  }
  return [];
}

/**
 * Sayfanın gösterdiği (buybox) satıcı: ürünün kendi ilan nesnesi
 * `"listingId":…,"merchantName":"Kumtel Türkiye","merchantId":"<uuid>","merchantCity":…`
 * sırasıyla durur; `listings` girdileri ise `merchantId` ile başlar, karışmaz.
 * JSON-LD'deki satıcı adı çoğu zaman marka olur (prod 19 Kasım: icollagen
 * sayfasının satıcısı "onlineecza"), bu yüzden kendi mağaza buradan okunur.
 */
export function extractHepsiburadaShownMerchant(
  html: string,
): { merchantId: string; merchantName: string } | null {
  const pattern =
    /"merchantName"\s*:\s*"([^"\\]{1,120})"\s*,\s*"merchantId"\s*:\s*"([^"\\]{1,80})"\s*,\s*"merchantCity"/;
  for (const text of htmlTextVariants(html)) {
    const match = pattern.exec(text);
    if (match && match[1].trim()) {
      return { merchantName: match[1].trim(), merchantId: match[2].trim() };
    }
  }
  return null;
}

function foldSellerName(name: string): string {
  return name.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

/** Hepsiburada URL'sindeki `magaza` (satıcı adı) parametresi. */
export function hepsiburadaMagazaFromUrl(url: string | null | undefined): string | null {
  try {
    const value = new URL(url ?? "").searchParams.get("magaza");
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function listingEntryPrice(entry: Record<string, unknown>): number {
  for (const [key, value] of Object.entries(entry)) {
    if (!/^(price|prices|finalPrice|priceInfo)$/i.test(key)) continue;
    const price = readPriceValue(value);
    if (price > 0) return price;
  }
  return 0;
}

/**
 * `listings` girdilerinden satıcılar. Kendi mağazamız (ürün URL'sindeki
 * `magaza` ve sayfanın gösterdiği satıcı; ad ya da `merchantId` ile) listeden
 * çıkarılır; fiyatı okunamayan girdi atlanır.
 */
export function hepsiburadaSellersFromListings(
  listings: Record<string, unknown>[],
  ownSellerName: string | null | Array<string | null | undefined>,
  ownMerchantId?: string | null,
): SameListingSeller[] {
  const ownNames = new Set(
    (Array.isArray(ownSellerName) ? ownSellerName : [ownSellerName])
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map(foldSellerName),
  );
  const sellers: SameListingSeller[] = [];
  const seen = new Set<string>();
  for (const entry of listings) {
    const name = typeof entry.merchantName === "string" ? entry.merchantName.trim() : "";
    if (!name) continue;
    if (ownNames.has(foldSellerName(name))) continue;
    const idRaw = entry.merchantId;
    const merchantId =
      typeof idRaw === "string" || typeof idRaw === "number" ? String(idRaw) : foldSellerName(name);
    if (ownMerchantId && merchantId === ownMerchantId) continue;
    if (seen.has(merchantId)) continue;
    if (entry.isSalable === false) continue;
    const price = listingEntryPrice(entry);
    if (!(price > 0)) continue;
    seen.add(merchantId);
    sellers.push({ merchantId, sellerName: name, price });
  }
  return sellers;
}

/**
 * Aynı ilanın diğer satıcısının rakip URL'si: Trendyol `?merchantId=<id>`,
 * Hepsiburada `?magaza=<satıcı adı>` (Hepsiburada satıcıyı adıyla seçer).
 */
export function sameListingSellerUrl(productUrl: string, seller: SameListingSeller): string | null {
  try {
    const parsed = new URL(productUrl);
    const base = `${parsed.origin}${parsed.pathname}`;
    if (/(^|\.)hepsiburada\.com$/i.test(parsed.hostname)) {
      return seller.sellerName ? `${base}?magaza=${encodeURIComponent(seller.sellerName)}` : null;
    }
    return `${base}?merchantId=${seller.merchantId}`;
  } catch {
    return null;
  }
}
