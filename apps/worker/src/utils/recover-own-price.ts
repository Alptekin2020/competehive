// ============================================
// Own-price recovery via Serper
// ============================================
//
// Hepsiburada (Akamai) gibi bot korumalı sitelerde scraper'ın TÜM yöntemleri
// başarısız olabiliyor; ürün "Tamamlandı" görünürken kendi fiyatı boş kalıyor
// ve piyasa pozisyonu hesaplanamıyordu. Rakip fiyatları Serper'dan geldiği
// için doluydu — aynı kaynak kendi ürünümüz için de kullanılabilir: Google
// Shopping feed'i satıcı beslemesinden gelir, Akamai engeline takılmaz.
//
// Manuel "Yenile" akışı (refresh-product.ts) bu kurtarmayı zaten yapıyordu;
// bu util aynı stratejiyi ZAMANLANMIŞ tarama yoluna da kazandırır. Maliyet
// kontrolü: yalnızca scraper başarısız olduğunda çağrılır ve Serper sonuçları
// 30 dk cache'lidir.

import { searchProduct, parsePrice } from "../serper";
import { urlMatchKey } from "./url-match";
import { logger } from "./logger";

interface OwnPriceProduct {
  productUrl: string;
  productName: string;
  metadata: unknown;
}

/** Ürünün arama sorgusunu metadata'dan (AI keywords/shortTitle) ya da adından üretir. */
export function buildOwnPriceQuery(product: OwnPriceProduct): string {
  const metadata = product.metadata as Record<string, unknown> | null;
  if (metadata) {
    const analysis = (metadata.analysis || metadata) as Record<string, unknown>;
    if (
      Array.isArray(analysis.searchKeywords) &&
      analysis.searchKeywords.length > 0 &&
      typeof analysis.searchKeywords[0] === "string"
    ) {
      return analysis.searchKeywords[0];
    }
    if (typeof analysis.shortTitle === "string" && analysis.shortTitle.trim()) {
      return analysis.shortTitle;
    }
  }
  return product.productName;
}

/**
 * Serper Shopping sonuçlarında ürünün KENDİ URL'sini arar ve fiyatını döner.
 * Eşleşme yoksa veya fiyat parse edilemezse null.
 */
export async function recoverOwnPriceViaSerper(product: OwnPriceProduct): Promise<number | null> {
  // Satıcıya özel URL'de (?merchantId=...) Google Shopping fiyatı buybox
  // fiyatıdır, bu satıcının değil — urlMatchKey query'yi attığından ikisi
  // aynı anahtara düşer. Yanlış fiyat yazmaktansa kurtarmayı atla.
  if (/[?&]merchantId=\d+/i.test(product.productUrl)) {
    logger.info(
      { productUrl: product.productUrl.slice(0, 80) },
      "Own-price recovery skipped: merchant-specific URL (Serper price would be buybox)",
    );
    return null;
  }

  const query = buildOwnPriceQuery(product);
  let results;
  try {
    results = await searchProduct(query);
  } catch (err) {
    logger.warn({ err, query }, "Own-price Serper search failed");
    return null;
  }

  const ownKey = urlMatchKey(product.productUrl);
  for (const result of results) {
    if (urlMatchKey(result.link) !== ownKey) continue;
    const price = parsePrice(result.price);
    if (price && price > 0) return price;
  }
  return null;
}
