import { getMarketplaceInfo } from "@competehive/shared";

// ============================================
// Ürün sayfası okunmadan önceki geçici ürün adı
// ============================================
//
// Toplu eklemede ürün sayfaları istek içinde okunmaz (20 sayfa süreye sığmaz);
// ad, worker'ın ilk taramasıyla dolar. Eskiden geçici ad sabit "Yükleniyor..."
// idi: ilk tarama başarısız olursa (pazaryerinin IP engeli) ürün kalıcı olarak
// bu adla kalıyor, worker da rakip aramasını "Yükleniyor..." sorgusuyla
// yapıyordu. URL slug'ından türetilen ad hem kullanıcıya anlamlı görünür hem
// de rakip araması için sağlam bir başlangıçtır.

const LETTER_RE = /\p{L}/u;

function capitalizeWord(word: string): string {
  // Sayılar ve büyük/küçük harfi olmayan parçalar ("200", "5g") olduğu gibi kalır.
  if (/^\d+$/.test(word) || word.toLowerCase() === word.toUpperCase()) return word;
  return word[0].toUpperCase() + word.slice(1);
}

function slugWords(segment: string): string[] {
  return segment
    .split("-p-")[0]
    .replace(/\.html?$/i, "")
    .replace(/[-_+]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * Ürün URL'sindeki slug'dan okunabilir bir başlık üretir.
 * Örn: ".../philips/airfryer-xxl-hd9650-p-14262809" → "Philips Airfryer Xxl Hd9650".
 * Slug yoksa (ör. "/dp/B0CHX1W1XY") null döner.
 */
export function titleFromProductUrl(url: string): string | null {
  let hostname: string;
  let segments: string[];
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname.toLowerCase();
    segments = decodeURIComponent(parsed.pathname).split("/").filter(Boolean);
  } catch {
    // Geçersiz URL ya da bozuk yüzde-kodlama: slug çıkarılamaz.
    return null;
  }

  // Pazaryerlerinin çoğunda ürün slug'ı "-p-<id>" ile biter; yoksa en çok
  // sözcük içeren path parçası slug kabul edilir.
  let slugIndex = segments.findIndex((segment) => segment.includes("-p-"));
  if (slugIndex === -1) {
    let bestWordCount = 1;
    segments.forEach((segment, index) => {
      const wordCount = slugWords(segment).filter((word) => LETTER_RE.test(word)).length;
      if (wordCount > bestWordCount) {
        bestWordCount = wordCount;
        slugIndex = index;
      }
    });
  }
  if (slugIndex === -1) return null;

  const words = slugWords(segments[slugIndex]);
  // Sondaki uzun sayısal kimlikler ("...-kulaklik-482913345") başlığa ait değildir.
  while (words.length > 0 && /^\d{5,}$/.test(words[words.length - 1])) words.pop();
  if (words.filter((word) => LETTER_RE.test(word)).length < 2) return null;

  // Trendyol'da marka ayrı bir path parçasıdır: /philips/airfryer-... → başa ekle.
  const isTrendyol = hostname === "trendyol.com" || hostname.endsWith(".trendyol.com");
  if (isTrendyol && slugIndex > 0) words.unshift(...slugWords(segments[slugIndex - 1]));

  return words.map(capitalizeWord).join(" ");
}

/** Sayfa okunana kadar gösterilecek ad: slug başlığı, yoksa "<Pazaryeri> ürünü". */
export function provisionalProductName(url: string, marketplace: string): string {
  return titleFromProductUrl(url) ?? `${getMarketplaceInfo(marketplace).name} ürünü`;
}
