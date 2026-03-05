import * as cheerio from "cheerio";

export interface ScrapedProduct {
  name: string;
  price: number | null;
  currency: string;
  image: string | null;
  seller: string | null;
  inStock: boolean;
}

const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
};

const API_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "tr-TR,tr;q=0.9",
  "Origin": "https://www.trendyol.com",
  "Referer": "https://www.trendyol.com/",
};

function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

// === TRENDYOL ===
// Trendyol dahili JSON API kullanır — çok güvenilir
export async function scrapeTrendyol(url: string): Promise<ScrapedProduct> {
  // URL'den contentId çıkar (ör: -p-123456 → 123456)
  const contentIdMatch = url.match(/-p-(\d+)/);

  if (contentIdMatch) {
    // Yöntem 1: Trendyol widget API ile ürün detayı çek
    try {
      const contentId = contentIdMatch[1];
      const apiUrl = `https://public.trendyol.com/discovery-web-productgw-service/api/productDetail/${contentId}?storefrontId=1&culture=tr-TR&linearVariants=true&channelId=1`;
      const res = await fetch(apiUrl, { headers: API_HEADERS, cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const product = data?.result;
        if (product) {
          return {
            name: product.name || product.productName || "Ürün",
            price: product.price?.sellingPrice?.value || product.price?.discountedPrice?.value || product.price?.originalPrice?.value || null,
            currency: "TRY",
            image: product.images?.[0]?.url ? `https://cdn.dsmcdn.com${product.images[0].url}` : null,
            seller: product.merchant?.name || product.seller?.name || null,
            inStock: product.inStock !== false,
          };
        }
      }
    } catch (e) {
      console.error("Trendyol API error:", e);
    }
  }

  // Yöntem 2: Sayfadaki __NEXT_DATA__ veya window.__PRODUCT_DETAIL_APP_INITIAL_STATE__ JSON'ı parse et
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    const html = await res.text();
    const $ = cheerio.load(html);

    // __NEXT_DATA__ veya inline JSON bul
    let productData: any = null;
    $("script").each((_, el) => {
      const text = $(el).html() || "";
      if (text.includes("window.__PRODUCT_DETAIL_APP_INITIAL_STATE__")) {
        const match = text.match(/window\.__PRODUCT_DETAIL_APP_INITIAL_STATE__\s*=\s*({[\s\S]*?});/);
        if (match) {
          try { productData = JSON.parse(match[1]); } catch {}
        }
      }
    });

    if (productData?.product) {
      const p = productData.product;
      return {
        name: p.name || p.nameWithProductContent || "Ürün",
        price: p.price?.sellingPrice?.value || p.price?.discountedPrice?.value || null,
        currency: "TRY",
        image: p.images?.[0]?.url ? `https://cdn.dsmcdn.com${p.images[0].url}` : null,
        seller: p.merchant?.name || null,
        inStock: p.hasStock !== false,
      };
    }

    // Yöntem 3: JSON-LD fallback
    let jsonLdPrice: number | null = null;
    let jsonLdName = "";
    let jsonLdImage = "";
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || "");
        if (json["@type"] === "Product") {
          jsonLdName = json.name || "";
          jsonLdImage = json.image || "";
          const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
          if (offers?.price) jsonLdPrice = parseFloat(offers.price);
        }
      } catch {}
    });

    if (jsonLdName) {
      return {
        name: jsonLdName,
        price: jsonLdPrice,
        currency: "TRY",
        image: jsonLdImage || null,
        seller: null,
        inStock: true,
      };
    }

    // Yöntem 4: HTML fallback
    const name = $("h1.pr-new-br span").first().text().trim() || $("h1").first().text().trim() || "Ürün adı alınamadı";
    const priceText = $("span.prc-dsc").first().text().trim() || "";
    return {
      name,
      price: parsePrice(priceText),
      currency: "TRY",
      image: null,
      seller: null,
      inStock: true,
    };
  } catch (e) {
    console.error("Trendyol scrape error:", e);
    return { name: "Trendyol ürünü", price: null, currency: "TRY", image: null, seller: null, inStock: true };
  }
}

// === HEPSIBURADA ===
export async function scrapeHepsiburada(url: string): Promise<ScrapedProduct> {
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    const html = await res.text();
    const $ = cheerio.load(html);

    // Hepsiburada sayfasındaki JSON-LD verisini kullan
    let name = "";
    let price: number | null = null;
    let image: string | null = null;
    let seller: string | null = null;

    // JSON-LD'den çek
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || "");
        if (json["@type"] === "Product") {
          name = json.name || "";
          image = json.image || null;
          const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
          if (offers?.price) price = parseFloat(offers.price);
          if (offers?.seller?.name) seller = offers.seller.name;
        }
      } catch {}
    });

    // __NEXT_DATA__ varsa ondan da çek
    $("script#__NEXT_DATA__").each((_, el) => {
      try {
        const nextData = JSON.parse($(el).html() || "");
        const pageProps = nextData?.props?.pageProps;
        if (pageProps?.product) {
          const p = pageProps.product;
          if (!name) name = p.name || p.productName || "";
          if (!price && p.listing?.priceInfo?.price) price = p.listing.priceInfo.price;
          if (!price && p.priceInfo?.price) price = p.priceInfo.price;
          if (!image && p.images?.[0]) image = p.images[0].url || p.images[0];
          if (!seller && p.merchant?.name) seller = p.merchant.name;
        }
      } catch {}
    });

    // Meta tag fallback
    if (!name) name = $("meta[property='og:title']").attr("content") || $("h1").first().text().trim() || "Hepsiburada ürünü";
    if (!image) image = $("meta[property='og:image']").attr("content") || null;

    return {
      name,
      price,
      currency: "TRY",
      image,
      seller,
      inStock: !html.includes("out-of-stock") && !html.includes("tükendi"),
    };
  } catch (e) {
    console.error("Hepsiburada scrape error:", e);
    return { name: "Hepsiburada ürünü", price: null, currency: "TRY", image: null, seller: null, inStock: true };
  }
}

// === AMAZON TR ===
export async function scrapeAmazonTR(url: string): Promise<ScrapedProduct> {
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    const html = await res.text();
    const $ = cheerio.load(html);

    const name = $("#productTitle").text().trim() || $("h1").first().text().trim() || "Amazon ürünü";
    const priceText = $(".a-price .a-offscreen").first().text().trim() || "";
    const price = parsePrice(priceText);
    const image = $("#landingImage").attr("src") || null;
    const seller = $("#sellerProfileTriggerId").text().trim() || null;

    return { name, price, currency: "TRY", image, seller, inStock: !$("#outOfStock").length };
  } catch {
    return { name: "Amazon ürünü", price: null, currency: "TRY", image: null, seller: null, inStock: true };
  }
}

// === N11 ===
export async function scrapeN11(url: string): Promise<ScrapedProduct> {
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    const html = await res.text();
    const $ = cheerio.load(html);

    let name = "";
    let price: number | null = null;
    let image: string | null = null;

    // JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || "");
        if (json["@type"] === "Product") {
          name = json.name || "";
          image = json.image || null;
          const offers = Array.isArray(json.offers) ? json.offers[0] : json.offers;
          if (offers?.price) price = parseFloat(offers.price);
        }
      } catch {}
    });

    if (!name) name = $("h1.proName").text().trim() || $("h1").first().text().trim() || "N11 ürünü";
    if (!price) { const pt = $(".newPrice ins").text().trim(); price = parsePrice(pt); }
    if (!image) image = $(".imgObj img").attr("src") || null;

    return { name, price, currency: "TRY", image, seller: null, inStock: true };
  } catch {
    return { name: "N11 ürünü", price: null, currency: "TRY", image: null, seller: null, inStock: true };
  }
}

// === DİĞERLERİ (fallback: JSON-LD + meta tags) ===
export async function scrapeGeneric(url: string, marketplace: string): Promise<ScrapedProduct> {
  try {
    const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
    const html = await res.text();
    const $ = cheerio.load(html);

    let name = "";
    let price: number | null = null;
    let image: string | null = null;

    // JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html() || "");
        const product = json["@type"] === "Product" ? json : null;
        if (product) {
          name = product.name || "";
          image = product.image || null;
          const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
          if (offers?.price) price = parseFloat(offers.price);
        }
      } catch {}
    });

    if (!name) name = $("meta[property='og:title']").attr("content") || $("h1").first().text().trim() || `${marketplace} ürünü`;
    if (!image) image = $("meta[property='og:image']").attr("content") || null;

    return { name, price, currency: "TRY", image, seller: null, inStock: true };
  } catch {
    return { name: `${marketplace} ürünü`, price: null, currency: "TRY", image: null, seller: null, inStock: true };
  }
}

// === ANA SCRAPE FONKSİYONU ===
export async function scrapeProduct(url: string, marketplace: string): Promise<ScrapedProduct> {
  switch (marketplace) {
    case "TRENDYOL": return scrapeTrendyol(url);
    case "HEPSIBURADA": return scrapeHepsiburada(url);
    case "AMAZON_TR": return scrapeAmazonTR(url);
    case "N11": return scrapeN11(url);
    default: return scrapeGeneric(url, marketplace);
  }
}
