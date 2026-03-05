export interface MarketplaceResult {
  marketplace: string;
  productName: string;
  price: number | null;
  url: string;
  seller: string | null;
  image: string | null;
  inStock: boolean;
}

const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "tr-TR,tr;q=0.9",
};

// === TRENDYOL ARAMA — Dahili JSON API ===
async function searchTrendyol(query: string): Promise<MarketplaceResult[]> {
  try {
    const apiUrl = `https://public.trendyol.com/discovery-web-searchgw-service/v2/api/infinite-scroll/sr?q=${encodeURIComponent(query)}&pi=1&culture=tr-TR&userGenderId=0&pId=0&scoringAlgorithmId=2&categoryRelevancyEnabled=false&isLegalRequirementConfirmed=false&searchStrategyType=DEFAULT&productStampId=null`;

    const res = await fetch(apiUrl, {
      headers: {
        ...HEADERS,
        "Origin": "https://www.trendyol.com",
        "Referer": "https://www.trendyol.com/",
      },
      cache: "no-store",
    });

    if (!res.ok) return [];
    const data = await res.json();
    const products = data?.result?.products || [];

    return products.slice(0, 3).map((p: any) => ({
      marketplace: "TRENDYOL",
      productName: p.name || p.productName || "",
      price: p.price?.sellingPrice?.value || p.price?.discountedPrice?.value || p.price?.originalPrice?.value || null,
      url: `https://www.trendyol.com${p.url || `/brand/product-p-${p.id}`}`,
      seller: p.merchant?.name || null,
      image: p.images?.[0] ? `https://cdn.dsmcdn.com/ty${p.images[0]}` : null,
      inStock: true,
    })).filter((r: MarketplaceResult) => r.productName && r.price);
  } catch (e) {
    console.error("Trendyol search error:", e);
    return [];
  }
}

// === HEPSIBURADA ARAMA — HTML search + JSON-LD parse ===
async function searchHepsiburada(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.hepsiburada.com/ara?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
      cache: "no-store",
    });

    if (!res.ok) return [];
    const html = await res.text();

    // __NEXT_DATA__ JSON'dan ürünleri çek
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const products = nextData?.props?.pageProps?.products ||
                         nextData?.props?.pageProps?.searchResult?.products || [];

        return products.slice(0, 3).map((p: any) => ({
          marketplace: "HEPSIBURADA",
          productName: p.name || p.productName || "",
          price: p.price || p.priceInfo?.price || p.listing?.priceInfo?.price || null,
          url: p.url ? (p.url.startsWith("http") ? p.url : `https://www.hepsiburada.com${p.url}`) : "",
          seller: p.merchant?.name || null,
          image: p.images?.[0]?.url || p.imageUrl || null,
          inStock: true,
        })).filter((r: MarketplaceResult) => r.productName && r.price);
      } catch {}
    }

    return [];
  } catch (e) {
    console.error("Hepsiburada search error:", e);
    return [];
  }
}

// === N11 ARAMA ===
async function searchN11(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.n11.com/arama?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();

    // JSON-LD'den ürünleri çek
    const results: MarketplaceResult[] = [];
    const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);

    for (const match of jsonLdMatches) {
      try {
        const json = JSON.parse(match[1]);
        if (json["@type"] === "ItemList" && json.itemListElement) {
          for (const item of json.itemListElement.slice(0, 3)) {
            const product = item.item || item;
            if (product.name && product.offers) {
              const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
              results.push({
                marketplace: "N11",
                productName: product.name,
                price: offers?.price ? parseFloat(offers.price) : null,
                url: product.url || product["@id"] || "",
                seller: null,
                image: product.image || null,
                inStock: true,
              });
            }
          }
        }
      } catch {}
    }

    return results.filter(r => r.productName && r.price).slice(0, 3);
  } catch {
    return [];
  }
}

// === AMAZON TR ARAMA ===
async function searchAmazonTR(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.amazon.com.tr/s?k=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $(".s-result-item[data-asin]").slice(0, 3).each((_, el) => {
      const asin = $(el).attr("data-asin");
      if (!asin) return;
      const name = $(el).find("h2 .a-text-normal").text().trim();
      const priceWhole = $(el).find(".a-price-whole").first().text().trim().replace(".", "");
      const priceFraction = $(el).find(".a-price-fraction").first().text().trim();
      let price: number | null = null;
      if (priceWhole) {
        price = parseFloat(`${priceWhole}.${priceFraction || "00"}`);
      }
      const image = $(el).find("img.s-image").attr("src") || null;

      if (name) {
        results.push({
          marketplace: "AMAZON_TR",
          productName: name,
          price,
          url: `https://www.amazon.com.tr/dp/${asin}`,
          seller: null,
          image,
          inStock: true,
        });
      }
    });

    return results;
  } catch {
    return [];
  }
}

// === EN İYİ EŞLEŞMEYİ BUL (string benzerliği) ===
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

  return bestScore > 0.2 ? bestMatch : results[0]; // En az %20 eşleşme
}

// === ÇİÇEKSEPETİ ARAMA ===
async function searchCiceksepeti(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.ciceksepeti.com/ara?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();

    // __NEXT_DATA__ JSON parse
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const products = nextData?.props?.pageProps?.products ||
                         nextData?.props?.pageProps?.searchResult?.products || [];
        return products.slice(0, 3).map((p: any) => ({
          marketplace: "CICEKSEPETI",
          productName: p.name || p.productName || "",
          price: p.price || p.salePrice || null,
          url: p.url ? (p.url.startsWith("http") ? p.url : `https://www.ciceksepeti.com${p.url}`) : "",
          seller: null,
          image: p.image || p.imageUrl || null,
          inStock: true,
        })).filter((r: MarketplaceResult) => r.productName && r.price);
      } catch {}
    }

    // JSON-LD fallback
    const results: MarketplaceResult[] = [];
    const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    for (const match of jsonLdMatches) {
      try {
        const json = JSON.parse(match[1]);
        if (json["@type"] === "ItemList" && json.itemListElement) {
          for (const item of json.itemListElement.slice(0, 3)) {
            const product = item.item || item;
            if (product.name && product.offers) {
              const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
              results.push({
                marketplace: "CICEKSEPETI",
                productName: product.name,
                price: offers?.price ? parseFloat(offers.price) : null,
                url: product.url || "",
                seller: null,
                image: product.image || null,
                inStock: true,
              });
            }
          }
        }
      } catch {}
    }
    return results.filter(r => r.productName && r.price).slice(0, 3);
  } catch {
    return [];
  }
}

// === PTT AVM ARAMA ===
async function searchPttavm(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.pttavm.com/arama?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    // JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || "");
        if (json["@type"] === "ItemList" && json.itemListElement) {
          for (const item of json.itemListElement.slice(0, 3)) {
            const product = item.item || item;
            if (product.name && product.offers) {
              const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
              results.push({
                marketplace: "PTTAVM",
                productName: product.name,
                price: offers?.price ? parseFloat(offers.price) : null,
                url: product.url ? (product.url.startsWith("http") ? product.url : `https://www.pttavm.com${product.url}`) : "",
                seller: "PTT AVM",
                image: product.image || null,
                inStock: true,
              });
            }
          }
        }
      } catch {}
    });

    // HTML fallback
    if (results.length === 0) {
      $(".product-card, .urunKutu, .product-item").slice(0, 3).each((_, el) => {
        const name = $(el).find(".product-name, .urunAdi, h3, .title").text().trim();
        const priceText = $(el).find(".product-price, .fiyat, .price").text().trim();
        const href = $(el).find("a").attr("href");
        const url = href ? (href.startsWith("http") ? href : `https://www.pttavm.com${href}`) : "";
        const image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || null;
        const priceNum = priceText ? parseFloat(priceText.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".")) : null;

        if (name && url) {
          results.push({
            marketplace: "PTTAVM",
            productName: name,
            price: priceNum && !isNaN(priceNum) ? priceNum : null,
            url,
            seller: "PTT AVM",
            image,
            inStock: true,
          });
        }
      });
    }

    return results.filter(r => r.productName && r.price).slice(0, 3);
  } catch {
    return [];
  }
}

// === AKAKÇE ARAMA (Fiyat karşılaştırma sitesi — zaten birçok mağazadan fiyat topluyor) ===
async function searchAkakce(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.akakce.com/arama/?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $(".p_w, .product-widget, li[class*='p_']").slice(0, 3).each((_, el) => {
      const name = $(el).find(".pn_t, .product-name, .p_n").text().trim() || $(el).find("a").attr("title") || "";
      const priceText = $(el).find(".pt_v8, .price, .p_p").first().text().trim();
      const href = $(el).find("a").attr("href");
      const url = href ? (href.startsWith("http") ? href : `https://www.akakce.com${href}`) : "";
      const image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || null;
      const priceNum = priceText ? parseFloat(priceText.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".")) : null;

      if (name && url) {
        results.push({
          marketplace: "AKAKCE", productName: name, price: priceNum && !isNaN(priceNum) ? priceNum : null,
          url, seller: "Akakçe (en düşük)", image, inStock: true,
        });
      }
    });
    return results.filter(r => r.productName).slice(0, 3);
  } catch { return []; }
}

// === CİMRİ ARAMA ===
async function searchCimri(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.cimri.com/arama?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();

    // __NEXT_DATA__ JSON parse
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const products = nextData?.props?.pageProps?.products || nextData?.props?.pageProps?.searchResult?.products || [];
        return products.slice(0, 3).map((p: any) => ({
          marketplace: "CIMRI", productName: p.name || p.title || "",
          price: p.price || p.minPrice || p.lowestPrice || null,
          url: p.url ? (p.url.startsWith("http") ? p.url : `https://www.cimri.com${p.url}`) : "",
          seller: "Cimri (en düşük)", image: p.image || p.imageUrl || null, inStock: true,
        })).filter((r: MarketplaceResult) => r.productName);
      } catch {}
    }

    // JSON-LD fallback
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || "");
        if (json["@type"] === "ItemList" && json.itemListElement) {
          for (const item of json.itemListElement.slice(0, 3)) {
            const product = item.item || item;
            if (product.name) {
              const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
              results.push({
                marketplace: "CIMRI", productName: product.name,
                price: offers?.price ? parseFloat(offers.price) : null,
                url: product.url || "", seller: "Cimri (en düşük)", image: product.image || null, inStock: true,
              });
            }
          }
        }
      } catch {}
    });
    return results.filter(r => r.productName).slice(0, 3);
  } catch { return []; }
}

// === EPEY ARAMA ===
async function searchEpey(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.epey.com/arama/?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $(".product-list .product-item, .listele li, .urun_liste li").slice(0, 3).each((_, el) => {
      const name = $(el).find(".product-name, .urun_adi, h3, a").first().text().trim();
      const priceText = $(el).find(".min_price, .fiyat, .price").first().text().trim();
      const href = $(el).find("a").attr("href");
      const url = href ? (href.startsWith("http") ? href : `https://www.epey.com${href}`) : "";
      const image = $(el).find("img").attr("src") || $(el).find("img").attr("data-src") || null;
      const priceNum = priceText ? parseFloat(priceText.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".")) : null;

      if (name && url) {
        results.push({
          marketplace: "EPEY", productName: name, price: priceNum && !isNaN(priceNum) ? priceNum : null,
          url, seller: "Epey (en düşük)", image, inStock: true,
        });
      }
    });
    return results.filter(r => r.productName).slice(0, 3);
  } catch { return []; }
}

// === BOYNER ARAMA ===
async function searchBoyner(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.boyner.com.tr/arama?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseGenericSearch(html, "BOYNER", "https://www.boyner.com.tr");
  } catch { return []; }
}

// === GRATIS ARAMA ===
async function searchGratis(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.gratis.com/arama?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseGenericSearch(html, "GRATIS", "https://www.gratis.com");
  } catch { return []; }
}

// === WATSONS ARAMA ===
async function searchWatsons(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.watsons.com.tr/search?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseGenericSearch(html, "WATSONS", "https://www.watsons.com.tr");
  } catch { return []; }
}

// === KİTAPYURDU ARAMA ===
async function searchKitapyurdu(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.kitapyurdu.com/index.php?route=product/search&filter_name=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseGenericSearch(html, "KITAPYURDU", "https://www.kitapyurdu.com");
  } catch { return []; }
}

// === DECATHLON ARAMA ===
async function searchDecathlon(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.decathlon.com.tr/search?Ntt=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseGenericSearch(html, "DECATHLON", "https://www.decathlon.com.tr");
  } catch { return []; }
}

// === TEKNOSA ARAMA ===
async function searchTeknosa(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.teknosa.com/arama/?s=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Accept": "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const html = await res.text();
    return parseGenericSearch(html, "TEKNOSA", "https://www.teknosa.com");
  } catch { return []; }
}

// === Genel HTML parser (JSON-LD + __NEXT_DATA__ + meta tags) ===
async function parseGenericSearch(html: string, marketplace: string, baseUrl: string): Promise<MarketplaceResult[]> {
  const results: MarketplaceResult[] = [];

  // 1. __NEXT_DATA__ JSON parse
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextDataMatch) {
    try {
      const nextData = JSON.parse(nextDataMatch[1]);
      const products = nextData?.props?.pageProps?.products ||
                       nextData?.props?.pageProps?.searchResult?.products ||
                       nextData?.props?.pageProps?.data?.products || [];
      for (const p of products.slice(0, 3)) {
        const name = p.name || p.productName || p.title || "";
        const price = p.price || p.salePrice || p.priceInfo?.price || null;
        const pUrl = p.url || p.slug || p.href || "";
        if (name) {
          results.push({
            marketplace, productName: name, price: typeof price === 'number' ? price : null,
            url: pUrl.startsWith("http") ? pUrl : `${baseUrl}${pUrl}`,
            seller: null, image: p.image || p.imageUrl || p.images?.[0] || null, inStock: true,
          });
        }
      }
      if (results.length > 0) return results.filter(r => r.productName).slice(0, 3);
    } catch {}
  }

  // 2. JSON-LD parse
  const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const match of jsonLdMatches) {
    try {
      const json = JSON.parse(match[1]);
      if (json["@type"] === "ItemList" && json.itemListElement) {
        for (const item of json.itemListElement.slice(0, 3)) {
          const product = item.item || item;
          if (product.name) {
            const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
            results.push({
              marketplace, productName: product.name,
              price: offers?.price ? parseFloat(offers.price) : null,
              url: product.url ? (product.url.startsWith("http") ? product.url : `${baseUrl}${product.url}`) : "",
              seller: null, image: product.image || null, inStock: true,
            });
          }
        }
      } else if (json["@type"] === "Product") {
        const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
        results.push({
          marketplace, productName: json.name || "",
          price: offers?.price ? parseFloat(offers.price) : null,
          url: json.url || "", seller: null, image: json.image || null, inStock: true,
        });
      }
    } catch {}
  }

  return results.filter(r => r.productName).slice(0, 3);
}

// === TÜM MARKETPLACE'LERDE ARA (15 marketplace) ===
export async function searchAllMarketplaces(
  keywords: string[],
  sourceMarketplace: string
): Promise<Record<string, MarketplaceResult[]>> {
  const query = keywords.join(" ");
  const allResults: Record<string, MarketplaceResult[]> = {};

  const searchFunctions: Record<string, (q: string) => Promise<MarketplaceResult[]>> = {
    TRENDYOL: searchTrendyol,
    HEPSIBURADA: searchHepsiburada,
    AMAZON_TR: searchAmazonTR,
    N11: searchN11,
    CICEKSEPETI: searchCiceksepeti,
    PTTAVM: searchPttavm,
    AKAKCE: searchAkakce,
    CIMRI: searchCimri,
    EPEY: searchEpey,
    BOYNER: searchBoyner,
    GRATIS: searchGratis,
    WATSONS: searchWatsons,
    KITAPYURDU: searchKitapyurdu,
    DECATHLON: searchDecathlon,
    TEKNOSA: searchTeknosa,
  };

  // Paralel arama — kaynak marketplace hariç
  const promises = Object.entries(searchFunctions)
    .filter(([mp]) => mp !== sourceMarketplace)
    .map(async ([mp, searchFn]) => {
      try {
        const results = await searchFn(query);
        if (results.length > 0) {
          allResults[mp] = results;
        }
      } catch (err) {
        console.error(`Search error for ${mp}:`, err);
      }
    });

  await Promise.all(promises);
  return allResults;
}
