// ============================================
// Deterministik model kimliği (model kodu + model numarası + ekran boyutu)
// ============================================
//
// Prod vakası (16 Kasım 2026): "Philips EP3347/90" ürününe 47.181 ₺'lik
// "Philips Series 3300 tam otomatik espresso makinesi…" Google kartı (gerçekte
// EP3341/50) AI 60 puanıyla onaya sunuldu. Kodu olmayan aday "eksik bilgi"
// sayılıyor, Kural 14 / başlık örtüşmesi backstop'ları EP3347 ↔ EP3341,
// SM-A556 ↔ A566, UE55 ↔ UE65, iPhone 15 ↔ 16 gibi farklı modelleri
// yükseltebiliyordu.
//
// Bu modül iki ürünün model kimliğini başlık + URL slug'ı + (varsa) taranan
// sayfa başlığından okur ve karşılaştırır:
// - "conflict": aynı türden iki model kodu / model numarası / ekran boyutu
//   farklı (EP3347 ≠ EP3341, A55 ≠ A56, 55" ≠ 65"). AI'a sorulmadan red.
// - "config-variant": aynı temel kod, farklı ek (HD9650/90 ≠ HD9650/99,
//   83SC000QTR ≠ 83SC000QTR-015). Farklı SKU → red.
// - "same": ortak model kodu (renk/bölge harf eki dahil) ya da kodsuz
//   kaynakta tüm model numaraları adayda aynı.
// - "unknown": kaynakta model kodu/numarası var ama aday onu doğrulamıyor
//   (adayda kod yok). Deterministik kabul ve backstop yükseltmesi yapılmaz.
// - "none": kaynakta karşılaştırılacak model kimliği yok (gıda, kozmetik…).

import { extractProductCodes } from "./competitor-quality";

export type ModelIdentity = "same" | "conflict" | "config-variant" | "unknown" | "none";

export interface ModelCode {
  /** Metindeki yazım (EP3347, SM-A556B). */
  raw: string;
  /** Tiresiz, büyük harf temel kod (EP3347, SMA556B). */
  base: string;
  /** Üretici öneki atılmış çekirdek (SM-A556B → A556B); yoksa base. */
  core: string;
  /** Koda bitişik ek: "/90", "-90", " 015" → "90" / "015"; yoksa null. */
  suffix: string | null;
}

export interface IdentitySide {
  title: string;
  url?: string | null;
  /** Taranan gerçek sayfa başlığı (varsa). */
  pageTitle?: string | null;
}

export interface ModelIdentityAnalysis {
  relation: ModelIdentity;
  /** Türkçe kısa gerekçe (red/uyarı mesajlarında kullanılır). */
  reason: string;
  sourceCodes: string[];
  candidateCodes: string[];
}

function fold(s: string): string {
  return s
    .replace(/[İIı]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================
// Model kodları
// ============================================

function readSuffix(text: string, raw: string): string | null {
  // "/90", "/B" (eğik çizgi eki); "-90" (bitişik tireli rakam eki);
  // " 015" (ayrık, sıfır öncüllü alt-SKU). Ekran boyutu ("… 15.6") ek sayılmaz.
  const re = new RegExp(
    `${escapeRe(raw)}(?:\\/\\s*([A-Za-z0-9]{1,4})(?![A-Za-z0-9])|-(\\d{1,3})(?![\\d.,A-Za-z])|\\s+(0\\d{1,3})(?![\\d.,]))`,
    "gi",
  );
  for (const m of text.matchAll(re)) {
    const suffix = (m[1] ?? m[2] ?? m[3] ?? "").toUpperCase();
    if (suffix) return suffix;
  }
  return null;
}

/**
 * Metindeki model kodlarını {temel, ek} olarak okur. Barkodlar (salt rakam)
 * model kodu sayılmaz; donanım/spec kodları (i5-13450HX, RTX5050, 144Hz)
 * extractProductCodes tarafından zaten elenir. "EP3347-90" EP334790 değil,
 * EP3347 + "90" olarak okunur.
 */
export function parseModelCodes(text: string): ModelCode[] {
  if (!text) return [];
  const out: ModelCode[] = [];
  const seen = new Set<string>();
  for (const raw of extractProductCodes(text)) {
    if (!/[A-Za-z]/.test(raw)) continue; // barkod
    const base = raw.replace(/-/g, "").toUpperCase();
    if (seen.has(base)) continue;
    seen.add(base);
    let core = base;
    const prefixed = raw.match(/^([A-Za-z]{1,3})-(.+)$/);
    if (prefixed) {
      const rest = prefixed[2].replace(/-/g, "").toUpperCase();
      if (/[A-Z]/.test(rest) && /\d/.test(rest) && rest.length >= 4) core = rest;
    }
    out.push({ raw, base, core, suffix: readSuffix(text, raw) });
  }
  return out;
}

function letters(s: string): string {
  return s.replace(/[^A-Z]/g, "");
}

function shape(s: string): string {
  return s.replace(/[A-Z]+/g, "L").replace(/\d+/g, "D");
}

// Bölge/renk harf ekini at: "A566B" → "A566" (tür karşılaştırması için).
function kindKey(code: string): string {
  return code.replace(/(\d)[A-Z]{1,2}$/, "$1");
}

/** İki kod aynı "tür" mü (EP3347 ↔ EP3341, UE55DU7000 ↔ UE65DU7000)? */
function sameKind(a: ModelCode, b: ModelCode): boolean {
  const ka = kindKey(a.core);
  const kb = kindKey(b.core);
  return shape(ka) === shape(kb) && letters(ka) === letters(kb);
}

type CodePairRelation = "same" | "config" | "different";

function compareCodePair(a: ModelCode, b: ModelCode): CodePairRelation {
  const keysA = new Set([a.base, a.core]);
  const shared = keysA.has(b.base) || keysA.has(b.core);
  if (shared) {
    if (a.suffix && b.suffix && a.suffix !== b.suffix) return "config";
    // Tek taraflı sıfır öncüllü alt-SKU (83SC000QTR vs "83SC000QTR 001")
    // Lenovo politikasıyla aynı: farklı konfigürasyon.
    const lone = a.suffix && !b.suffix ? a.suffix : !a.suffix && b.suffix ? b.suffix : null;
    if (lone && /^0\d/.test(lone)) return "config";
    return "same";
  }
  for (const x of [a.core, a.base]) {
    for (const y of [b.core, b.base]) {
      const [shortK, longK] = x.length <= y.length ? [x, y] : [y, x];
      if (shortK.length < 4 || !longK.startsWith(shortK)) continue;
      const ext = longK.slice(shortK.length);
      // Slug'da ek koda yapışır ("hd965090"): ek kısa kodun okunan ekine
      // eşitse aynı yazımdır (HD9650/90).
      const shortSuffix = x.length <= y.length ? a.suffix : b.suffix;
      if (shortSuffix && ext === shortSuffix) return "same";
      if (/\d/.test(ext)) return "config"; // 83SC000QTR → 83SC000QTR015
      // OK004 → OK004K, SM-A556 → SM-A556B; uzun kodda bölge eki (UE55DU7000AUXTK).
      if (ext.length <= 2 || shortK.length >= 6) return "same";
    }
  }
  return "different";
}

function displayCode(c: ModelCode): string {
  return c.suffix ? `${c.raw}/${c.suffix}` : c.raw;
}

// ============================================
// Model numarası aileleri (kodsuz modeller)
// ============================================

// Sözcük + numara: "iPhone 15", "Note 13", "Series 3300"; ve numara + seri:
// "3300 Serisi". Rakamın hemen ardından birim gelmez ("iPhone 128GB" değil).
const NAMED_FAMILY_AFTER_RE =
  /\b(iphone|ipad|note|redmi|pixel|galaxy|series|serisi|seri|watch|tab|playstation|xbox|surface|kindle|honor|poco|nova|mate|airpods)\s+(\d{1,4})[a-z]?\b/g;
const NAMED_FAMILY_BEFORE_RE = /\b(\d{2,4})\s+(serisi|series|seri)\b/g;
// Tek harf + numara: "A55", "V15", "S24", "SM-A556B" içindeki "A556".
const LETTER_FAMILY_RE = /\b([a-z])(\d{1,3})[a-z]?\b/g;

function normalizeFamily(word: string): string {
  return word === "serisi" || word === "seri" ? "series" : word;
}

function addTo(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

function namedFamilies(folded: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const m of folded.matchAll(NAMED_FAMILY_AFTER_RE)) {
    addTo(map, normalizeFamily(m[1]), String(parseInt(m[2], 10)));
  }
  for (const m of folded.matchAll(NAMED_FAMILY_BEFORE_RE)) {
    addTo(map, normalizeFamily(m[2]), String(parseInt(m[1], 10)));
  }
  return map;
}

function letterFamilies(folded: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const m of folded.matchAll(LETTER_FAMILY_RE)) {
    addTo(map, m[1], String(parseInt(m[2], 10)));
  }
  return map;
}

// ============================================
// Ekran boyutu ekseni (inç ve "Ekran" cm)
// ============================================

const INCH_RE = /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:"|''|”|″|inc\b|inch\b|inches\b)/g;
const EKRAN_RE = /\b(\d{2,3})\s*(?:cm\s*)?ekran\b/g;

function screenSizes(folded: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const m of folded.matchAll(INCH_RE)) {
    const v = parseFloat(m[1].replace(",", "."));
    if (Number.isFinite(v) && v > 0) addTo(map, "inch", String(v));
  }
  for (const m of folded.matchAll(EKRAN_RE)) addTo(map, "ekran", m[1]);
  return map;
}

// Ekran ölçüleri yuvarlanarak yazılır ("248,92 cm" → "248 Ekran", slug'da
// "247-ekran"): küçük farklar aynı boyuttur.
const AXIS_TOLERANCE: Record<string, number> = { inch: 0.6, ekran: 3 };

function axisValuesMatch(key: string, a: string, b: string): boolean {
  if (a === b) return true;
  const tol = AXIS_TOLERANCE[key];
  if (tol === undefined) return false;
  const x = parseFloat(a);
  const y = parseFloat(b);
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;
}

/** İki tarafta da bulunan bir eksende ortak değer yoksa çelişen ilk ekseni döner. */
function disjointAxis(
  a: Map<string, Set<string>>,
  b: Map<string, Set<string>>,
): { key: string; a: Set<string>; b: Set<string> } | null {
  for (const [key, va] of a) {
    const vb = b.get(key);
    if (!vb) continue;
    let overlap = false;
    for (const v of va) for (const w of vb) if (axisValuesMatch(key, v, w)) overlap = true;
    if (!overlap) return { key, a: va, b: vb };
  }
  return null;
}

// ============================================
// URL slug'ındaki model metni
// ============================================

const UNIT_SEGMENT_RE =
  /^(?:inc|inch|in|ekran|cm|mm|gb|tb|mb|ml|lt|l|kg|gr|g|w|watt|adet|li|lu|x|hz|mah|v)$/;

/**
 * Pazaryeri URL slug'ından model metni çıkarır. İlan numaraları (Trendyol
 * -p-795891055, Hepsiburada -p-/-pm-HBC…, Amazon ASIN, N11 id) atılır ve
 * slug'daki "ep3347-90" yazımı "ep3347/90" olarak geri kazanılır. Google'ın
 * ürün kartı bağlantılarında slug yoktur → "".
 */
export function slugModelText(url: string | null | undefined): string {
  if (typeof url !== "string" || url.length === 0) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const host = parsed.hostname.toLowerCase();
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "";
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    path = parsed.pathname;
  }
  const segments = path
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .filter((seg) => !/^(?:dp|gp|product|urun|p|pm|sr|ref=.*)$/.test(seg))
    .filter((seg) => !/^b0[a-z0-9]{8}$/.test(seg)) // Amazon ASIN
    .map((seg) =>
      seg
        .replace(/\.html?$/, "")
        .replace(/-p(?:m)?-[a-z0-9]+$/, "") // Trendyol / Hepsiburada ilan no
        .replace(/[-_]\d{6,}$/, ""),
    )
    .filter((seg) => seg.length > 0 && !/^\d+$/.test(seg));

  const parts: string[] = [];
  for (const seg of segments) {
    const words = seg.split(/[-_+]+/).filter(Boolean);
    const merged: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = words[i + 1];
      const after = words[i + 2];
      // "ep3347-90" → "ep3347/90" (birim değilse; "ue55du7000-55-inc" hariç).
      if (
        next &&
        /[a-z]/.test(w) &&
        /\d/.test(w) &&
        w.length >= 5 &&
        /^\d{2}$/.test(next) &&
        !(after && UNIT_SEGMENT_RE.test(after))
      ) {
        merged.push(`${w}/${next}`);
        i++;
        continue;
      }
      // "lx-6331" → "lx-6331" (harf öneki + rakam kodu tek kod olarak kalır).
      if (next && /^[a-z]{1,3}$/.test(w) && !UNIT_SEGMENT_RE.test(w) && /^\d{3,6}$/.test(next)) {
        merged.push(`${w}-${next}`);
        i++;
        continue;
      }
      merged.push(w);
    }
    parts.push(merged.join(" "));
  }
  return parts.join(" ").trim();
}

/** Arama sonucu başlığı "..." / "…" ile kesilmiş mi? */
export function isTruncatedTitle(title: string | null | undefined): boolean {
  return typeof title === "string" && /(?:\.{3}|…)\s*$/.test(title.trim());
}

/**
 * Kısaltılmış başlık için ilan adresindeki ürün adı. Web arama sonuçlarının
 * başlığı kesik gelir ("Multi Vitamin Hair Cocktail ... Bakım ..."); adet/hacim
 * bilgisi çoğu zaman yalnızca URL yolunda kalır ("...-2ml-x-10-ampul-111492082").
 * AI bunu görmeyince aynı ürünü "farklı miktar" diye reddediyordu (prod 17 Kasım,
 * N11). Google kartlarında ve başlık kesik değilse null döner.
 */
export function truncatedTitleSlugHint(
  title: string | null | undefined,
  url: string | null | undefined,
): string | null {
  if (!isTruncatedTitle(title)) return null;
  const slug = slugModelText(url);
  return slug.length >= 8 ? slug : null;
}

// ============================================
// Karşılaştırma
// ============================================

function sideText(side: IdentitySide): string {
  return [side.title, slugModelText(side.url), side.pageTitle ?? ""]
    .filter((s) => s && s.trim().length > 0)
    .join(" ");
}

function fmtSet(s: Set<string>): string {
  return [...s].join("/");
}

const FAMILY_LABELS: Record<string, string> = { series: "Seri" };

export function analyzeModelIdentity(
  source: IdentitySide,
  candidate: IdentitySide,
): ModelIdentityAnalysis {
  const srcText = sideText(source);
  const cndText = sideText(candidate);
  const srcCodes = parseModelCodes(srcText);
  const cndCodes = parseModelCodes(cndText);
  const result = (relation: ModelIdentity, reason: string): ModelIdentityAnalysis => ({
    relation,
    reason,
    sourceCodes: srcCodes.map(displayCode),
    candidateCodes: cndCodes.map(displayCode),
  });

  // 1) Model kodları.
  let codeSame = false;
  let codeConfig: [ModelCode, ModelCode] | null = null;
  let codeConflict: [ModelCode, ModelCode] | null = null;
  if (srcCodes.length > 0 && cndCodes.length > 0) {
    for (const a of srcCodes) {
      for (const b of cndCodes) {
        const rel = compareCodePair(a, b);
        if (rel === "same") codeSame = true;
        else if (rel === "config" && !codeConfig) codeConfig = [a, b];
      }
    }
    if (!codeSame && !codeConfig) {
      outer: for (const a of srcCodes) {
        for (const b of cndCodes) {
          if (sameKind(a, b)) {
            codeConflict = [a, b];
            break outer;
          }
        }
      }
    }
  }
  if (codeConflict) {
    return result(
      "conflict",
      `Model kodu farklı: ${displayCode(codeConflict[0])} ≠ ${displayCode(codeConflict[1])}`,
    );
  }

  // 2) Model numarası aileleri ve ekran boyutu.
  const srcFolded = fold(srcText);
  const cndFolded = fold(cndText);
  const srcNamed = namedFamilies(srcFolded);
  const cndNamed = namedFamilies(cndFolded);
  const named = disjointAxis(srcNamed, cndNamed);
  if (named) {
    const label = FAMILY_LABELS[named.key] ?? named.key;
    return result(
      "conflict",
      `Model numarası farklı: ${label} ${fmtSet(named.a)} ≠ ${label} ${fmtSet(named.b)}`,
    );
  }
  const letter = disjointAxis(letterFamilies(srcFolded), letterFamilies(cndFolded));
  if (letter) {
    const k = letter.key.toUpperCase();
    return result(
      "conflict",
      `Model numarası farklı: ${k}${fmtSet(letter.a)} ≠ ${k}${fmtSet(letter.b)}`,
    );
  }
  // Model kodu birebir aynıysa boyut koddan gelir (98DU9000 = 98"): yazım farkı çelişki sayılmaz.
  const size = codeSame ? null : disjointAxis(screenSizes(srcFolded), screenSizes(cndFolded));
  if (size) {
    const unit = size.key === "inch" ? '"' : " Ekran";
    return result(
      "conflict",
      `Ekran boyutu farklı: ${fmtSet(size.a)}${unit} ≠ ${fmtSet(size.b)}${unit}`,
    );
  }

  if (codeConfig) {
    return result(
      "config-variant",
      `Aynı model, farklı varyant: ${displayCode(codeConfig[0])} ≠ ${displayCode(codeConfig[1])}`,
    );
  }
  if (codeSame) return result("same", "Model kodu aynı");

  // "Doğrulanamıyor" yalnızca ürün BAŞLIĞINDA yazan koda bakar: slug'daki
  // gürültü (ölçü, satıcı SKU'su) kodsuz ürünlerin adaylarını engellememeli.
  const srcTitleCodes = parseModelCodes([source.title, source.pageTitle ?? ""].join(" "));
  if (srcTitleCodes.length > 0) {
    return result(
      "unknown",
      `Model kodu adayda doğrulanamıyor (${srcTitleCodes.map(displayCode).join(", ")})`,
    );
  }
  if (srcNamed.size > 0) {
    for (const key of srcNamed.keys()) {
      if (!cndNamed.has(key)) {
        return result("unknown", "Model numarası adayda doğrulanamıyor");
      }
    }
    return result("same", "Model numarası aynı");
  }
  return result("none", "Karşılaştırılacak model kodu yok");
}

/** compareModelIdentity: yalnızca ilişki (bkz. analyzeModelIdentity). */
export function compareModelIdentity(source: IdentitySide, candidate: IdentitySide): ModelIdentity {
  return analyzeModelIdentity(source, candidate).relation;
}

/** Kimlik kesin olarak farklı mı (çelişki ya da farklı konfigürasyon)? */
export function isModelIdentityMismatch(relation: ModelIdentity): boolean {
  return relation === "conflict" || relation === "config-variant";
}

// ============================================
// Renk / ton varyantı (Kural 14 backstop'u için)
// ============================================

const COLOUR_WORDS = new Set([
  "siyah",
  "beyaz",
  "mavi",
  "lacivert",
  "kirmizi",
  "yesil",
  "sari",
  "turuncu",
  "mor",
  "lila",
  "pembe",
  "gri",
  "fume",
  "bej",
  "krem",
  "kahverengi",
  "bordo",
  "turkuaz",
  "altin",
  "gumus",
  "bronz",
  "bakir",
  "krom",
  "antrasit",
  "ekru",
  "haki",
  "somon",
  "fusya",
  "mercan",
  "vizon",
  "taba",
  "rose",
  "gold",
  "silver",
  "black",
  "white",
  "blue",
  "pink",
  "red",
  "green",
  "grey",
  "gray",
  "purple",
  "lilac",
  "mint",
  "nude",
  // Küçük ev aletlerinde renk adı (prod 17 Kasım: Arzum OK004 "Bakır" ürüne
  // "Nar", "Siyah" ve "Sorgul Buğdayı" ilanları bağlandı).
  "nar",
  "sorgul",
  "sampanya",
  "inci",
  "titanyum",
]);

const SHADE_RE = /\b(?:no|ton|shade|renk)\s*[:.]?\s*(\d{1,3})\b/g;

function colourSet(folded: string): Set<string> {
  return new Set(folded.split(/[^a-z0-9]+/).filter((t) => COLOUR_WORDS.has(t)));
}

function shadeSet(folded: string): Set<string> {
  const set = new Set<string>();
  for (const m of folded.matchAll(SHADE_RE)) set.add(String(parseInt(m[1], 10)));
  return set;
}

function disjoint(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  for (const v of a) if (b.has(v)) return false;
  return true;
}

/**
 * İki başlık da renk (Lila ↔ Siyah) ya da ton numarası (No:01 ↔ No:02)
 * yazıyor ve ortak değer yok mu? Tek taraflı bilgi çelişki sayılmaz.
 */
export function hasColourOrShadeConflict(a: string, b: string): boolean {
  const fa = fold(a || "");
  const fb = fold(b || "");
  return disjoint(colourSet(fa), colourSet(fb)) || disjoint(shadeSet(fa), shadeSet(fb));
}
