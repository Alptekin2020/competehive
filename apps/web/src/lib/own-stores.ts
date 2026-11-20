/**
 * Ayarlar → "Mağaza adım": pazaryeri başına kendi mağaza adı
 * (`users.own_stores`, `{"TRENDYOL": "…"}`). Adı girilmemiş pazaryerinde eski
 * tek liste (`users.own_store_names`, tüm pazaryerleri) kullanılır. Worker
 * aynası: `apps/worker/src/utils/own-store.ts` (`parseOwnStores`).
 *
 * Yalnız taramanın ilandaki satıcıları okuduğu pazaryerleri (`pageSeller` /
 * `otherSellers`): başka yerde girilen ad hiçbir şeyi değiştirmez. Vatan,
 * Teknosa, MediaMarkt kendi ürününü satan perakendeciler; Amazon, N11,
 * Pazarama, PttAVM satıcılarını okumaya başlayınca buraya eklenir.
 */
export const OWN_STORE_MARKETPLACES: readonly string[] = ["TRENDYOL", "HEPSIBURADA"];

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
