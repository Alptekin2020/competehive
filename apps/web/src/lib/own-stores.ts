/**
 * Ayarlar → "Mağaza adım": pazaryeri başına kendi mağaza adı
 * (`users.own_stores`, `{"TRENDYOL": "…"}`). Adı girilmemiş pazaryerinde eski
 * tek liste (`users.own_store_names`, tüm pazaryerleri) kullanılır. Worker
 * aynası: `apps/worker/src/utils/own-store.ts` (`parseOwnStores`).
 *
 * Yalnız aynı ilanı birden çok satıcının sattığı pazaryerleri. Vatan, Teknosa
 * ve MediaMarkt kendi stoğunu satan perakendecilerdir; mağaza adı alanı yoktur.
 * Worker aynası: `apps/worker/src/utils/marketplace-sellers.ts`.
 */
export const OWN_STORE_MARKETPLACES: readonly string[] = [
  "TRENDYOL",
  "HEPSIBURADA",
  "AMAZON_TR",
  "N11",
  "PAZARAMA",
  "PTTAVM",
];

export function parseOwnStores(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key.toUpperCase()] = value.trim();
  }
  return out;
}

/** Kaydedilecek harita: yalnız desteklenen pazaryerleri, boşluklar sadeleşir, boş ad = sil. */
export function cleanOwnStores(stores: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const marketplace of OWN_STORE_MARKETPLACES) {
    const name = (stores[marketplace] ?? "").replace(/\s+/g, " ").trim();
    if (name) out[marketplace] = name;
  }
  return out;
}
