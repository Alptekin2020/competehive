// Kullanıcının elle yazdığı / kamerayla okuttuğu barkod yanlış olabilir (başka
// bir ürünün barkodu). İlandan okunan barkod (başlık, mağaza sayfası) ürünün
// kendisidir; kullanıcı barkodu ise yalnızca ilan da aynı markayı taşıyor ve
// başlıklar arasında deterministik bir çelişki yoksa "aynı ürün" kanıtı sayılır.
// Uyuşmayan barkod isabetleri sayılır ve ürün sayfasında uyarı gösterilir.

import { cleanProductTitle } from "./search-queries";
import { withListingBrand } from "./listing-identity";
import {
  canonicalBrandToken,
  hasTitleConflict,
  titleTokens,
  urlSlugText,
} from "./title-similarity";

/** metadata.gtinSource === "user" ve başlıktaki barkoddan farklıysa true. */
export function isUserEnteredGtin(
  metadata: unknown,
  gtin: string | null,
  ownTitles: (string | null | undefined)[],
): boolean {
  if (!gtin || !metadata || typeof metadata !== "object") return false;
  if ((metadata as Record<string, unknown>).gtinSource !== "user") return false;
  // Barkod kendi ilan başlığında da yazıyorsa ilanın kendisinden gelmiş sayılır.
  return !ownTitles.some(
    (t) => typeof t === "string" && new RegExp(`(?<!\\d)${gtin}(?!\\d)`).test(t),
  );
}

export interface GtinCandidate {
  title: string;
  url?: string | null;
  snippet?: string | null;
}

/**
 * Kullanıcı barkodunu taşıyan aday gerçekten aynı ürün mü? Kaynağın markası
 * (ilk sözcük, marka eş adlarıyla) adayın başlığında, adres yolunda ya da arama
 * özetinde geçmeli ve başlıklar arasında çelişki (farklı model kodu, miktar,
 * paket, aksesuar…) olmamalı.
 */
export function userGtinCorroborated(sourceTitle: string, candidate: GtinCandidate): boolean {
  const source = cleanProductTitle(sourceTitle);
  const brand = titleTokens(source)[0];
  if (!brand) return false;
  const candidateTitle = cleanProductTitle(
    withListingBrand(sourceTitle, candidate.title, candidate.url ?? undefined),
  );
  const brandText = [candidateTitle, urlSlugText(candidate.url), candidate.snippet ?? ""].join(" ");
  const canonical = canonicalBrandToken(brand);
  const brandShared = titleTokens(brandText).some((t) => canonicalBrandToken(t) === canonical);
  if (!brandShared) return false;
  return !hasTitleConflict(source, candidateTitle);
}

export interface UserGtinWarning {
  at: string;
  mismatches: number;
  samples: string[];
}

/** Bir keşif turunda uyuşmayan barkod isabeti bu sayıya ulaşırsa uyarı yazılır. */
export const USER_GTIN_WARNING_MIN_MISMATCHES = 2;

/**
 * Turun sonunda metadata'daki uyarıyı günceller: uyuşan isabet varsa uyarı
 * kalkar; uyuşan yokken en az 2 uyuşmayan varsa uyarı yazılır; isabet yoksa
 * dokunulmaz. Değişiklik yoksa null.
 */
export function nextUserGtinWarning(
  current: unknown,
  round: { corroborated: number; mismatched: string[] },
  now: Date,
): { warning: UserGtinWarning | null } | null {
  const has = Boolean(current && typeof current === "object");
  if (round.corroborated > 0) return has ? { warning: null } : null;
  if (round.mismatched.length >= USER_GTIN_WARNING_MIN_MISMATCHES) {
    return {
      warning: {
        at: now.toISOString(),
        mismatches: round.mismatched.length,
        samples: round.mismatched.slice(0, 3).map((t) => t.slice(0, 120)),
      },
    };
  }
  return null;
}
