import * as cheerio from "cheerio";

export interface MarketplaceResult {
  marketplace: string;
  storeName: string;
  productName: string;
  price: number | null;
  url: string;
  image: string | null;
  inStock: boolean;
  source: "akakce" | "cimri" | "google";
}

async function fetchWithTimeout(url: string, headers: Record<string, string> = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const defaultHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
      ...headers,
    };
    const res = await fetch(url, { headers: defaultHeaders, signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    return res;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// Mağaza adından marketplace kodu çıkar
function storeToMarketplace(storeName: string): string {
  const lower = storeName.toLowerCase();
  if (lower.includes("trendyol")) return "TRENDYOL";
  if (lower.includes("hepsiburada")) return "HEPSIBURADA";
  if (lower.includes("amazon")) return "AMAZON_TR";
  if (lower.includes("n11")) return "N11";
  if (lower.includes("çiçeksepeti") || lower.includes("ciceksepeti")) return "CICEKSEPETI";
  if (lower.includes("pttavm") || lower.includes("ptt avm")) return "PTTAVM";
  if (lower.includes("teknosa")) return "TEKNOSA";
  if (lower.includes("mediamarkt") || lower.includes("media markt")) return "MEDIAMARKT";
  if (lower.includes("koçtaş") || lower.includes("koctas")) return "KOCTAS";
  if (lower.includes("boyner")) return "BOYNER";
  if (lower.includes("gratis")) return "GRATIS";
  if (lower.includes("watsons")) return "WATSONS";
  if (lower.includes("sephora")) return "SEPHORA";
  if (lower.includes("decathlon")) return "DECATHLON";
  if (lower.includes("kitapyurdu")) return "KITAPYURDU";
  if (lower.includes("vatanbilgisayar") || lower.includes("vatan")) return "VATAN";
  if (lower.includes("itopya")) return "ITOPYA";
  if (lower.includes("letgo") || lower.includes("dolap")) return "DOLAP";
  return storeName.toUpperCase().replace(/[^A-Z0-9]/g, "_").substring(0, 20);
}

// ============================================
// AKAKÇE ARAMA — 430+ mağazadan fiyat toplar
// ============================================
async function searchAkakce(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.akakce.com/arama/?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(searchUrl);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    // Akakçe ürün kartları
    $("li.p_w, div.p_w, ul.products li, .search-result-item").slice(0, 5).each((_, el) => {
      const name = $(el).find(".pn_t, .p_n, .product-name, a").first().text().trim() || $(el).find("a").attr("title") || "";
      const priceText = $(el).find(".pt_v8, .p_p, .price-value, .fiyat").first().text().trim();
      const price = parsePrice(priceText);
      const href = $(el).find("a").attr("href");
      const url = href ? (href.startsWith("http") ? href : `https://www.akakce.com${href}`) : "";
      const image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || null;

      if (name && url) {
        results.push({
          marketplace: "AKAKCE",
          storeName: "Akakçe",
          productName: name,
          price,
          url,
          image,
          inStock: true,
          source: "akakce",
        });
      }
    });

    // Akakçe ürün detay sayfasına gidip mağaza fiyatlarını çekmeye çalış
    if (results.length > 0 && results[0].url) {
      try {
        const detailRes = await fetchWithTimeout(results[0].url);
        if (detailRes.ok) {
          const detailHtml = await detailRes.text();
          const $d = cheerio.load(detailHtml);

          // Mağaza fiyat listesi
          $d(".f_w, .price-list li, .merchant-list li, tr.seller-row, .seller-item").each((_, el) => {
            const storeName = $d(el).find(".v_v, .store-name, .merchant-name, .seller-name, td:first-child a").first().text().trim();
            const storePrice = parsePrice($d(el).find(".pt_v8, .price, .fiyat, td.price").first().text().trim());
            const storeUrl = $d(el).find("a.v_v, a.store-link, a.merchant-link, td a").attr("href");
            const fullUrl = storeUrl ? (storeUrl.startsWith("http") ? storeUrl : `https://www.akakce.com${storeUrl}`) : "";

            if (storeName && storePrice) {
              results.push({
                marketplace: storeToMarketplace(storeName),
                storeName,
                productName: results[0].productName,
                price: storePrice,
                url: fullUrl || results[0].url,
                image: results[0].image,
                inStock: true,
                source: "akakce",
              });
            }
          });
        }
      } catch {}
    }

    return results;
  } catch (e) {
    console.error("Akakce search error:", e);
    return [];
  }
}

// ============================================
// CİMRİ ARAMA — Ek mağazalar
// ============================================
async function searchCimri(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.cimri.com/arama?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(searchUrl);
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    // __NEXT_DATA__ JSON parse — Cimri Next.js kullanıyor
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const products = nextData?.props?.pageProps?.products ||
                         nextData?.props?.pageProps?.initialData?.products ||
                         nextData?.props?.pageProps?.searchResult?.products || [];

        for (const p of products.slice(0, 5)) {
          const name = p.name || p.title || p.productName || "";
          const price = p.price || p.minPrice || p.lowestPrice || p.salePrice || null;
          const pUrl = p.url || p.slug || p.productUrl || "";
          const storeName = p.merchantName || p.sellerName || p.store?.name || "Cimri";

          if (name) {
            results.push({
              marketplace: storeToMarketplace(storeName),
              storeName,
              productName: name,
              price: typeof price === "number" ? price : parsePrice(String(price)),
              url: pUrl.startsWith("http") ? pUrl : `https://www.cimri.com${pUrl}`,
              image: p.image || p.imageUrl || p.images?.[0] || null,
              inStock: true,
              source: "cimri",
            });
          }
        }
      } catch {}
    }

    // JSON-LD fallback
    if (results.length === 0) {
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const json = JSON.parse($(el).html() || "");
          if (json["@type"] === "ItemList" && json.itemListElement) {
            for (const item of json.itemListElement.slice(0, 5)) {
              const product = item.item || item;
              if (product.name) {
                const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
                results.push({
                  marketplace: "CIMRI",
                  storeName: "Cimri",
                  productName: product.name,
                  price: offers?.price ? parseFloat(offers.price) : null,
                  url: product.url || "",
                  image: typeof product.image === "string" ? product.image : null,
                  inStock: true,
                  source: "cimri",
                });
              }
            }
          }
        } catch {}
      });
    }

    return results;
  } catch (e) {
    console.error("Cimri search error:", e);
    return [];
  }
}

// ============================================
// GOOGLE SHOPPING TR — Global kapsam
// ============================================
async function searchGoogleShopping(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.google.com.tr/search?tbm=shop&q=${encodeURIComponent(query)}&hl=tr&gl=tr`;
    const res = await fetchWithTimeout(searchUrl, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    // Google Shopping ürün kartları
    $(".sh-dgr__content, .sh-dlr__list-result, .xcR77").slice(0, 5).each((_, el) => {
      const name = $(el).find("h3, .tAxDx, .EI11Pd").first().text().trim();
      const priceText = $(el).find(".a8Pemb, .HRLxBb, .kHxwFf").first().text().trim();
      const price = parsePrice(priceText);
      const storeName = $(el).find(".aULzUe, .IuHnof, .LsYFnd").first().text().trim();
      const href = $(el).find("a").attr("href");
      const url = href ? (href.startsWith("http") ? href : `https://www.google.com.tr${href}`) : "";
      const image = $(el).find("img").attr("src") || null;

      if (name && price) {
        results.push({
          marketplace: storeToMarketplace(storeName || "Google Shopping"),
          storeName: storeName || "Google Shopping",
          productName: name,
          price,
          url,
          image,
          inStock: true,
          source: "google",
        });
      }
    });

    return results;
  } catch (e) {
    console.error("Google Shopping search error:", e);
    return [];
  }
}

// ============================================
// EN İYİ EŞLEŞMEYİ BUL
// ============================================
export function findBestMatch(
  results: MarketplaceResult[],
  originalProduct: string
): MarketplaceResult | null {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  const originalWords = originalProduct.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  let bestMatch = results[0];
  let bestScore = 0;

  for (const result of results) {
    const resultWords = result.productName.toLowerCase().split(/\s+/);
    const matchCount = originalWords.filter(w =>
      resultWords.some(rw => rw.includes(w) || w.includes(rw))
    ).length;
    const score = matchCount / Math.max(originalWords.length, 1);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  }

  return bestMatch;
}

// ============================================
// ANA FONKSİYON — 3 kaynakta paralel arama
// ============================================
export async function searchAllMarketplaces(
  keywords: string[],
  sourceMarketplace: string
): Promise<Record<string, MarketplaceResult[]>> {
  const query = keywords.join(" ");
  console.log(`[CompeteHive] Searching: "${query}" (excluding ${sourceMarketplace})`);

  // 3 kaynakta paralel arama
  const [akakceResults, cimriResults, googleResults] = await Promise.allSettled([
    searchAkakce(query),
    searchCimri(query),
    searchGoogleShopping(query),
  ]);

  const allResults: MarketplaceResult[] = [];

  if (akakceResults.status === "fulfilled") {
    console.log(`[CompeteHive] Akakçe: ${akakceResults.value.length} results`);
    allResults.push(...akakceResults.value);
  }
  if (cimriResults.status === "fulfilled") {
    console.log(`[CompeteHive] Cimri: ${cimriResults.value.length} results`);
    allResults.push(...cimriResults.value);
  }
  if (googleResults.status === "fulfilled") {
    console.log(`[CompeteHive] Google: ${googleResults.value.length} results`);
    allResults.push(...googleResults.value);
  }

  // Kaynak marketplace'i filtrele ve marketplace'e göre grupla
  const grouped: Record<string, MarketplaceResult[]> = {};
  for (const result of allResults) {
    // Kaynak marketplace'i atla
    if (result.marketplace === sourceMarketplace) continue;
    // "AKAKCE" ve "CIMRI" marketplace'lerini de atla (bunlar kaynak, mağaza değil)
    if (result.marketplace === "AKAKCE" || result.marketplace === "CIMRI") continue;

    if (!grouped[result.marketplace]) {
      grouped[result.marketplace] = [];
    }
    grouped[result.marketplace].push(result);
  }

  console.log(`[CompeteHive] Grouped into ${Object.keys(grouped).length} marketplaces`);
  return grouped;
}
