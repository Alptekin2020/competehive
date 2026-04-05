import OpenAI from "openai";
import * as cheerio from "cheerio";

export interface MarketplaceResult {
  marketplace: string;
  storeName: string;
  productName: string;
  price: number | null;
  url: string;
  image: string | null;
  inStock: boolean;
}

function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^\d.,]/g, "").trim();
  if (!cleaned) return null;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      const num = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
      return isNaN(num) ? null : num;
    } else {
      const num = parseFloat(cleaned.replace(/,/g, ""));
      return isNaN(num) ? null : num;
    }
  } else if (hasComma && !hasDot) {
    const num = parseFloat(cleaned.replace(",", "."));
    return isNaN(num) ? null : num;
  } else if (hasDot && !hasComma) {
    const parts = cleaned.split(".");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    } else {
      const num = parseFloat(cleaned.replace(/\./g, ""));
      return isNaN(num) ? null : num;
    }
  } else {
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
}

// Valid DB enum values for Marketplace
const VALID_MARKETPLACES = new Set([
  "TRENDYOL",
  "HEPSIBURADA",
  "AMAZON_TR",
  "N11",
  "CICEKSEPETI",
  "PTTAVM",
  "AKAKCE",
  "CIMRI",
  "EPEY",
  "BOYNER",
  "GRATIS",
  "WATSONS",
  "KITAPYURDU",
  "DECATHLON",
  "TEKNOSA",
  "MEDIAMARKT",
  "SEPHORA",
  "KOCTAS",
  "VATAN",
  "ITOPYA",
  "SHOPIFY",
  "CUSTOM",
]);

type InvalidMarketplacePolicy = "fallback-custom" | "skip";

export function normalizeMarketplaceResult(
  result: MarketplaceResult,
  invalidPolicy: InvalidMarketplacePolicy = "fallback-custom",
): MarketplaceResult | null {
  if (VALID_MARKETPLACES.has(result.marketplace)) {
    return result;
  }

  if (invalidPolicy === "skip") {
    return null;
  }

  return {
    ...result,
    marketplace: "CUSTOM",
  };
}

export function normalizeMarketplaceResults(
  results: MarketplaceResult[],
  invalidPolicy: InvalidMarketplacePolicy = "fallback-custom",
): MarketplaceResult[] {
  return results
    .map((result) => normalizeMarketplaceResult(result, invalidPolicy))
    .filter((result): result is MarketplaceResult => result !== null);
}

// Mağaza eşleştirme kuralları: [keyword, marketplace_enum, display_name]
const STORE_RULES: [string, string, string][] = [
  ["trendyol", "TRENDYOL", "Trendyol"],
  ["hepsiburada", "HEPSIBURADA", "Hepsiburada"],
  ["amazon.com.tr", "AMAZON_TR", "Amazon TR"],
  ["amazon tr", "AMAZON_TR", "Amazon TR"],
  ["n11.com", "N11", "N11"],
  ["n11", "N11", "N11"],
  ["ciceksepeti", "CICEKSEPETI", "Çiçeksepeti"],
  ["pttavm", "PTTAVM", "PTT AVM"],
  ["ptt avm", "PTTAVM", "PTT AVM"],
  ["teknosa", "TEKNOSA", "Teknosa"],
  ["mediamarkt", "MEDIAMARKT", "MediaMarkt"],
  ["media markt", "MEDIAMARKT", "MediaMarkt"],
  ["koctas", "KOCTAS", "Koçtaş"],
  ["koçtaş", "KOCTAS", "Koçtaş"],
  ["sephora", "SEPHORA", "Sephora"],
  ["boyner", "BOYNER", "Boyner"],
  ["gratis", "GRATIS", "Gratis"],
  ["watsons", "WATSONS", "Watsons"],
  ["kitapyurdu", "KITAPYURDU", "Kitapyurdu"],
  ["decathlon", "DECATHLON", "Decathlon"],
  ["vatanbilgisayar", "VATAN", "Vatan"],
  ["vatan bilgisayar", "VATAN", "Vatan"],
  ["itopya", "ITOPYA", "İtopya"],
  ["akakce", "AKAKCE", "Akakçe"],
  ["akakçe", "AKAKCE", "Akakçe"],
  ["cimri", "CIMRI", "Cimri"],
  ["epey", "EPEY", "Epey"],
  ["migros", "CUSTOM", "Migros"],
  ["carrefour", "CUSTOM", "CarrefourSA"],
  ["lcwaikiki", "CUSTOM", "LC Waikiki"],
  ["lc waikiki", "CUSTOM", "LC Waikiki"],
  ["flo.com", "CUSTOM", "FLO"],
  ["nike.com", "CUSTOM", "Nike"],
  ["adidas.com", "CUSTOM", "Adidas"],
  ["ikea", "CUSTOM", "IKEA"],
  ["karaca", "CUSTOM", "Karaca"],
  ["dr.com.tr", "CUSTOM", "D&R"],
  ["d&r", "CUSTOM", "D&R"],
  ["bkmkitap", "CUSTOM", "BKM Kitap"],
  ["idefix", "CUSTOM", "İdefix"],
  ["rossmann", "CUSTOM", "Rossmann"],
  ["a101", "CUSTOM", "A101"],
  ["sok.com", "CUSTOM", "ŞOK"],
  ["şok market", "CUSTOM", "ŞOK"],
  ["mavi.com", "CUSTOM", "Mavi"],
  ["koton", "CUSTOM", "Koton"],
  ["defacto", "CUSTOM", "DeFacto"],
  ["superstep", "CUSTOM", "SuperStep"],
  ["vivense", "CUSTOM", "Vivense"],
  ["bellona", "CUSTOM", "Bellona"],
  ["madamecoco", "CUSTOM", "Madame Coco"],
  ["morhipo", "CUSTOM", "Morhipo"],
  ["evidea", "CUSTOM", "Evidea"],
  ["electroworld", "CUSTOM", "Electro World"],
];

function detectStore(url: string, title: string): { marketplace: string; storeName: string } {
  const lower = (url + " " + title).toLowerCase();
  for (const [keyword, mp, name] of STORE_RULES) {
    if (lower.includes(keyword)) return { marketplace: mp, storeName: name };
  }
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    const name = domain.split(".")[0];
    return { marketplace: "CUSTOM", storeName: name.charAt(0).toUpperCase() + name.slice(1) };
  } catch {
    return { marketplace: "CUSTOM", storeName: "Diğer" };
  }
}

// ============================================
// DIRECT MARKETPLACE SEARCH (no API key needed)
// ============================================

const SEARCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
};

async function fetchSearchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(url, {
      headers: SEARCH_HEADERS,
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Trendyol arama sonuçları sayfasını scrape et
async function searchTrendyolDirect(query: string): Promise<MarketplaceResult[]> {
  const results: MarketplaceResult[] = [];
  const url = `https://www.trendyol.com/sr?q=${encodeURIComponent(query)}&qt=${encodeURIComponent(query)}&st=${encodeURIComponent(query)}`;
  const html = await fetchSearchPage(url);
  if (!html) return results;

  const $ = cheerio.load(html);

  // Trendyol arama sonuçları: __SEARCH_APP_INITIAL_STATE__ JSON verisi
  $("script").each((_, el) => {
    const content = $(el).html() || "";
    if (content.includes("__SEARCH_APP_INITIAL_STATE__")) {
      try {
        const match = content.match(/__SEARCH_APP_INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/);
        if (match) {
          const state = JSON.parse(match[1]);
          const products = state?.products || [];
          for (const p of products) {
            if (p.name && p.price) {
              const productUrl = p.url
                ? `https://www.trendyol.com${p.url.startsWith("/") ? "" : "/"}${p.url}`
                : "";
              const imageUrl = p.images?.[0]
                ? p.images[0].startsWith("http")
                  ? p.images[0]
                  : `https://cdn.dsmcdn.com${p.images[0]}`
                : null;
              results.push({
                marketplace: "TRENDYOL",
                storeName: "Trendyol",
                productName: p.name,
                price:
                  typeof p.price === "number"
                    ? p.price
                    : (p.price?.sellingPrice?.value ?? p.price?.discountedPrice?.value ?? null),
                url: productUrl,
                image: imageUrl,
                inStock: p.hasStock !== false,
              });
            }
          }
        }
      } catch {
        // JSON parse error
      }
    }
  });

  // HTML fallback: ürün kartlarını parse et
  if (results.length === 0) {
    $(".p-card-wrppr").each((_, el) => {
      const $card = $(el);
      const link = $card.find("a").first().attr("href");
      const name =
        $card.find(".prdct-desc-cntnr-name").text().trim() || $card.find("img").attr("alt") || "";
      const priceText =
        $card.find(".prc-box-dscntd").first().text().trim() ||
        $card.find(".prc-box-sllng").first().text().trim();
      const image = $card.find("img").attr("src") || null;

      const price = parsePrice(priceText);
      const fullUrl = link
        ? link.startsWith("http")
          ? link
          : `https://www.trendyol.com${link}`
        : "";

      if (name && fullUrl) {
        results.push({
          marketplace: "TRENDYOL",
          storeName: "Trendyol",
          productName: name,
          price,
          url: fullUrl,
          image,
          inStock: true,
        });
      }
    });
  }

  return results.slice(0, 10);
}

// Hepsiburada arama sonuçları sayfasını scrape et
async function searchHepsiburadaDirect(query: string): Promise<MarketplaceResult[]> {
  const results: MarketplaceResult[] = [];
  const url = `https://www.hepsiburada.com/ara?q=${encodeURIComponent(query)}`;
  const html = await fetchSearchPage(url);
  if (!html) return results;

  const $ = cheerio.load(html);

  // Hepsiburada JSON-LD arama sonuçları
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || "");
      if (json["@type"] === "ItemList" && Array.isArray(json.itemListElement)) {
        for (const item of json.itemListElement) {
          const product = item.item || item;
          if (product?.name) {
            const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
            results.push({
              marketplace: "HEPSIBURADA",
              storeName: "Hepsiburada",
              productName: product.name,
              price: offers?.price ? parseFloat(offers.price) : null,
              url: product.url || product["@id"] || "",
              image: typeof product.image === "string" ? product.image : product.image?.[0] || null,
              inStock: offers?.availability !== "https://schema.org/OutOfStock",
            });
          }
        }
      }
    } catch {
      // Invalid JSON-LD
    }
  });

  // HTML fallback: ürün kartları
  if (results.length === 0) {
    $(
      "[data-test-id='product-card-item'], .productListContent-item, li[class*='productListContent']",
    ).each((_, el) => {
      const $card = $(el);
      const link =
        $card.find("a[href*='/p-']").first().attr("href") || $card.find("a").first().attr("href");
      const name =
        $card.find("[data-test-id='product-card-name']").text().trim() ||
        $card.find("h3").text().trim() ||
        $card.find("img").attr("alt") ||
        "";
      const priceText =
        $card.find("[data-test-id='price-current-price']").text().trim() ||
        $card.find("[class*='price']").first().text().trim();
      const image = $card.find("img").attr("src") || null;

      const price = parsePrice(priceText);
      const fullUrl = link
        ? link.startsWith("http")
          ? link
          : `https://www.hepsiburada.com${link}`
        : "";

      if (name && fullUrl) {
        results.push({
          marketplace: "HEPSIBURADA",
          storeName: "Hepsiburada",
          productName: name,
          price,
          url: fullUrl,
          image,
          inStock: true,
        });
      }
    });
  }

  return results.slice(0, 10);
}

// Amazon TR arama sonuçları sayfasını scrape et
async function searchAmazonTRDirect(query: string): Promise<MarketplaceResult[]> {
  const results: MarketplaceResult[] = [];
  const url = `https://www.amazon.com.tr/s?k=${encodeURIComponent(query)}`;
  const html = await fetchSearchPage(url);
  if (!html) return results;

  const $ = cheerio.load(html);

  // Amazon arama sonuçları: div[data-component-type="s-search-result"]
  $('div[data-component-type="s-search-result"]').each((_, el) => {
    const $card = $(el);
    const asin = $card.attr("data-asin");
    if (!asin) return;

    const linkEl = $card.find("h2 a, .a-link-normal.s-line-clamp-2").first();
    const link = linkEl.attr("href");
    const name =
      linkEl.find("span").text().trim() ||
      $card.find("h2 span").text().trim() ||
      $card.find("img.s-image").attr("alt") ||
      "";
    const priceWhole = $card.find(".a-price .a-price-whole").first().text().trim();
    const priceFraction = $card.find(".a-price .a-price-fraction").first().text().trim();
    const priceText = priceWhole ? `${priceWhole}${priceFraction}` : "";
    const image = $card.find("img.s-image").attr("src") || null;

    const price = parsePrice(priceText);
    const fullUrl = link
      ? link.startsWith("http")
        ? link
        : `https://www.amazon.com.tr${link}`
      : `https://www.amazon.com.tr/dp/${asin}`;

    if (name) {
      results.push({
        marketplace: "AMAZON_TR",
        storeName: "Amazon TR",
        productName: name,
        price,
        url: fullUrl,
        image,
        inStock: !$card.find(".a-color-error").text().includes("stok"),
      });
    }
  });

  return results.slice(0, 10);
}

// N11 arama sonuçları sayfasını scrape et
async function searchN11Direct(query: string): Promise<MarketplaceResult[]> {
  const results: MarketplaceResult[] = [];
  const url = `https://www.n11.com/arama?q=${encodeURIComponent(query)}`;
  const html = await fetchSearchPage(url);
  if (!html) return results;

  const $ = cheerio.load(html);

  // N11 JSON-LD arama sonuçları
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || "");
      if (json["@type"] === "ItemList" && Array.isArray(json.itemListElement)) {
        for (const item of json.itemListElement) {
          const product = item.item || item;
          if (product?.name) {
            const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
            results.push({
              marketplace: "N11",
              storeName: "N11",
              productName: product.name,
              price: offers?.price ? parseFloat(offers.price) : null,
              url: product.url || "",
              image: typeof product.image === "string" ? product.image : product.image?.[0] || null,
              inStock: true,
            });
          }
        }
      }
    } catch {
      // Invalid JSON-LD
    }
  });

  // HTML fallback: ürün kartları
  if (results.length === 0) {
    $(".columnContent .pro, .listView li.clone, .product-list-item").each((_, el) => {
      const $card = $(el);
      const link = $card.find("a").first().attr("href");
      const name =
        $card.find(".proName, h3.productName").text().trim() || $card.find("img").attr("alt") || "";
      const priceText =
        $card.find(".newPrice ins, .price ins").first().text().trim() ||
        $card.find(".newPrice, .price").first().text().trim();
      const image =
        $card.find("img").attr("data-original") || $card.find("img").attr("src") || null;

      const price = parsePrice(priceText);
      const fullUrl = link ? (link.startsWith("http") ? link : `https://www.n11.com${link}`) : "";

      if (name && fullUrl) {
        results.push({
          marketplace: "N11",
          storeName: "N11",
          productName: name,
          price,
          url: fullUrl,
          image,
          inStock: true,
        });
      }
    });
  }

  return results.slice(0, 10);
}

// Tüm marketplace'lerde doğrudan arama yap (API key gerekmez)
async function searchMarketplacesDirect(
  query: string,
  excludeMarketplace: string,
): Promise<MarketplaceResult[]> {
  console.log(
    `[CompeteHive] Direct marketplace search: "${query}" (excluding ${excludeMarketplace})`,
  );

  const searches: Promise<MarketplaceResult[]>[] = [];
  if (excludeMarketplace !== "TRENDYOL") searches.push(searchTrendyolDirect(query));
  if (excludeMarketplace !== "HEPSIBURADA") searches.push(searchHepsiburadaDirect(query));
  if (excludeMarketplace !== "AMAZON_TR") searches.push(searchAmazonTRDirect(query));
  if (excludeMarketplace !== "N11") searches.push(searchN11Direct(query));

  const settled = await Promise.allSettled(searches);
  const results: MarketplaceResult[] = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    } else {
      console.error("[CompeteHive] Direct search error:", result.reason);
    }
  }

  console.log(`[CompeteHive] Direct search found ${results.length} results`);
  return results;
}

// Birden fazla arama varyasyonu ile doğrudan marketplace araması
async function searchDirectWithKeywords(
  keywords: string[],
  excludeMarketplace: string,
): Promise<MarketplaceResult[]> {
  const primaryQuery = keywords[0];
  const allResults = await searchMarketplacesDirect(primaryQuery, excludeMarketplace);

  // Az sonuç geldiyse diğer keyword'leri de dene
  if (allResults.length < 5 && keywords.length > 1) {
    const seenUrls = new Set(allResults.map((r) => r.url.replace(/\/$/, "").toLowerCase()));
    for (let i = 1; i < Math.min(keywords.length, 3); i++) {
      console.log(`[CompeteHive] Direct additional search: "${keywords[i]}"`);
      const moreResults = await searchMarketplacesDirect(keywords[i], excludeMarketplace);
      for (const result of moreResults) {
        const normalizedUrl = result.url.replace(/\/$/, "").toLowerCase();
        if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl);
          allResults.push(result);
        }
      }
      if (allResults.length >= 15) break;
    }
  }

  return allResults;
}

// ============================================
// SERPER API SEARCH (requires SERPER_API_KEY)
// ============================================

// Serper.dev ile tek bir sorgu için Google arama + Google Shopping arama
async function searchSerperSingle(query: string, apiKey: string): Promise<MarketplaceResult[]> {
  const results: MarketplaceResult[] = [];

  // 1. Google Shopping araması
  try {
    const shoppingRes = await fetch("https://google.serper.dev/shopping", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "tr", hl: "tr", num: 20 }),
      cache: "no-store",
    });

    if (shoppingRes.ok) {
      const data = await shoppingRes.json();
      const items = data.shopping || [];
      console.log(`[CompeteHive] Serper Shopping results for "${query}":`, items.length);

      for (const item of items) {
        const { marketplace, storeName } = detectStore(
          item.link || "",
          (item.source || "") + " " + (item.title || ""),
        );
        let price: number | null = null;
        if (item.price) {
          price = parsePrice(String(item.price).replace("TL", "").replace("₺", ""));
        }
        if (!price && item.extractedPrice) {
          price =
            typeof item.extractedPrice === "number"
              ? item.extractedPrice
              : parsePrice(String(item.extractedPrice));
        }
        if (item.title) {
          results.push({
            marketplace,
            storeName: item.source || storeName,
            productName: item.title,
            price,
            url: item.link || "",
            image: item.imageUrl || item.thumbnail || null,
            inStock: true,
          });
        }
      }
    }
  } catch (e) {
    console.error("[CompeteHive] Serper Shopping error:", e);
  }

  // 2. Normal Google arama
  try {
    const searchRes = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query + " fiyat satın al", gl: "tr", hl: "tr", num: 20 }),
      cache: "no-store",
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      const items = data.organic || [];
      console.log(`[CompeteHive] Serper Organic results for "${query}":`, items.length);

      for (const item of items) {
        const { marketplace, storeName } = detectStore(item.link || "", item.title || "");

        let price: number | null = null;
        const snippet = (item.snippet || "") + " " + (item.title || "");
        const priceMatch = snippet.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:TL|₺)/);
        if (priceMatch) price = parsePrice(priceMatch[1]);

        if (!price && item.priceRange) price = parsePrice(item.priceRange);
        if (!price && item.attributes?.price) price = parsePrice(String(item.attributes.price));

        if (item.title) {
          results.push({
            marketplace,
            storeName,
            productName: item.title,
            price,
            url: item.link || "",
            image: item.thumbnail || null,
            inStock: true,
          });
        }
      }
    }
  } catch (e) {
    console.error("[CompeteHive] Serper Search error:", e);
  }

  return results;
}

// Birden fazla arama varyasyonu ile arama yaparak sonuçları birleştir
async function searchSerper(query: string): Promise<MarketplaceResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return [];
  }

  const queries = generateSearchVariations(query);
  console.log(`[CompeteHive] Serper search variations:`, queries);

  const allResultArrays = await Promise.all(queries.map((q) => searchSerperSingle(q, apiKey)));

  const seenUrls = new Set<string>();
  const results: MarketplaceResult[] = [];

  for (const arr of allResultArrays) {
    for (const result of arr) {
      const normalizedUrl = result.url.replace(/\/$/, "").toLowerCase();
      if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        results.push(result);
      }
    }
  }

  console.log(
    `[CompeteHive] Total unique Serper results after ${queries.length} queries: ${results.length}`,
  );
  return results;
}

// Arama sorgusundan birden fazla arama varyasyonu oluştur
function generateSearchVariations(query: string): string[] {
  const variations: string[] = [query];

  const modelPattern = /\b[A-Z0-9](?:[A-Z0-9-/]){4,}[A-Z0-9]\b/i;
  const modelMatch = query.match(modelPattern);

  if (modelMatch) {
    const withoutModel = query
      .replace(modelPattern, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (withoutModel.length >= 5 && withoutModel !== query) {
      variations.push(withoutModel);
    }

    const modelQuery = modelMatch[0];
    if (modelQuery.length >= 5) {
      variations.push(modelQuery);
    }
  }

  const words = query.split(/\s+/).filter((w) => w.length > 1);
  if (words.length >= 4) {
    const brandPlusType = [words[0], ...words.slice(-2)].join(" ");
    if (!variations.includes(brandPlusType) && brandPlusType !== query) {
      variations.push(brandPlusType);
    }
  }

  return variations.slice(0, 4);
}

// ============================================
// AI MATCHING
// ============================================

// GPT ile en iyi eşleşmeleri seç
async function selectBestMatches(
  results: MarketplaceResult[],
  originalProduct: string,
): Promise<MarketplaceResult[]> {
  if (results.length === 0) return [];

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return results.filter((r) => r.price && r.price > 0).slice(0, 12);
  }

  try {
    const openai = new OpenAI({ apiKey: openaiKey });
    const productList = results
      .map((r, i) => `${i}: [${r.storeName}] ${r.productName}${r.price ? ` — ${r.price} TL` : ""}`)
      .join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            "E-ticaret ürün eşleştirme asistanısın. Orijinal ürünle AYNI veya ÇOK BENZER ürünlerin indekslerini seç. Sadece JSON array döndür.",
        },
        {
          role: "user",
          content: `Orijinal: "${originalProduct}"\n\nSonuçlar:\n${productList}\n\nAynı/benzer ürün indeksleri (JSON array):`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content || "[]";
    const indices: number[] = JSON.parse(text.replace(/```json|```/g, "").trim());
    return indices.filter((i) => i >= 0 && i < results.length).map((i) => results[i]);
  } catch (e) {
    console.error("[CompeteHive] GPT matching error:", e);
    return results.filter((r) => r.price && r.price > 0).slice(0, 12);
  }
}

export function findBestMatch(
  results: MarketplaceResult[],
  _originalProduct: string,
): MarketplaceResult | null {
  return results.length > 0 ? results[0] : null;
}

// ============================================
// COMBINED SEARCH (Serper + Direct fallback)
// ============================================

// Birden fazla keyword dizisini tek bir sonuç havuzunda birleştirerek ara
async function searchWithMultipleKeywords(
  keywords: string[],
  excludeMarketplace: string,
): Promise<MarketplaceResult[]> {
  const primaryQuery = keywords[0];
  console.log(`[CompeteHive] Primary search query: "${primaryQuery}"`);
  console.log(`[CompeteHive] All keywords: ${JSON.stringify(keywords)}`);

  const hasSerperKey = !!process.env.SERPER_API_KEY;

  // Serper varsa: Serper + Direct paralel çalışsın
  // Serper yoksa: sadece Direct search
  if (hasSerperKey) {
    console.log("[CompeteHive] Using Serper + Direct search");
    const [serperResults, directResults] = await Promise.all([
      searchSerper(primaryQuery),
      searchDirectWithKeywords(keywords, excludeMarketplace),
    ]);

    // Birleştir, URL bazında tekrarlananları kaldır
    const seenUrls = new Set<string>();
    const allResults: MarketplaceResult[] = [];

    for (const result of [...serperResults, ...directResults]) {
      const normalizedUrl = result.url.replace(/\/$/, "").toLowerCase();
      if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        allResults.push(result);
      }
    }

    // Eğer ana sorgudan az sonuç geldiyse, diğer keyword'lerle Serper'da da dene
    if (allResults.length < 5 && keywords.length > 1) {
      for (let i = 1; i < Math.min(keywords.length, 3); i++) {
        console.log(`[CompeteHive] Additional Serper search: "${keywords[i]}"`);
        const moreResults = await searchSerper(keywords[i]);
        for (const result of moreResults) {
          const normalizedUrl = result.url.replace(/\/$/, "").toLowerCase();
          if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl);
            allResults.push(result);
          }
        }
        if (allResults.length >= 15) break;
      }
    }

    return allResults;
  } else {
    console.log("[CompeteHive] No SERPER_API_KEY — using direct marketplace search only");
    return searchDirectWithKeywords(keywords, excludeMarketplace);
  }
}

// Return all matched results as a flat array, sorted by price ascending
export async function searchAllResults(
  keywords: string[],
  sourceMarketplace: string,
): Promise<MarketplaceResult[]> {
  console.log(
    `[CompeteHive] Searching with ${keywords.length} keywords (source: ${sourceMarketplace})`,
  );

  const allResults = await searchWithMultipleKeywords(keywords, sourceMarketplace);
  console.log(`[CompeteHive] Total: ${allResults.length} results`);

  const normalizedResults = normalizeMarketplaceResults(allResults, "fallback-custom");
  console.log(`[CompeteHive] Normalized: ${normalizedResults.length} results`);

  const primaryQuery = keywords[0];
  const bestMatches = await selectBestMatches(normalizedResults, primaryQuery);
  console.log(`[CompeteHive] AI matched: ${bestMatches.length}`);

  // Filter out source marketplace, keep all others (no domain whitelist)
  const filtered = bestMatches.filter((r) => r.marketplace !== sourceMarketplace);

  // Sort by price ascending (null prices at end)
  filtered.sort((a, b) => {
    if (a.price === null && b.price === null) return 0;
    if (a.price === null) return 1;
    if (b.price === null) return -1;
    return a.price - b.price;
  });

  console.log(`[CompeteHive] Final: ${filtered.length} results from all sources`);
  return filtered;
}

// ANA FONKSİYON (legacy, grouped by marketplace)
export async function searchAllMarketplaces(
  keywords: string[],
  sourceMarketplace: string,
): Promise<Record<string, MarketplaceResult[]>> {
  console.log(
    `[CompeteHive] Searching with ${keywords.length} keywords (source: ${sourceMarketplace})`,
  );

  const allResults = await searchWithMultipleKeywords(keywords, sourceMarketplace);
  console.log(`[CompeteHive] Total: ${allResults.length} results`);

  const normalizedResults = normalizeMarketplaceResults(allResults, "fallback-custom");
  console.log(`[CompeteHive] Normalized: ${normalizedResults.length} results`);

  const primaryQuery = keywords[0];
  const bestMatches = await selectBestMatches(normalizedResults, primaryQuery);
  console.log(`[CompeteHive] AI matched: ${bestMatches.length}`);

  const grouped: Record<string, MarketplaceResult[]> = {};
  for (const result of bestMatches) {
    if (result.marketplace === sourceMarketplace) continue;
    if (!grouped[result.marketplace]) grouped[result.marketplace] = [];
    grouped[result.marketplace].push(result);
  }

  console.log(`[CompeteHive] Final: ${Object.keys(grouped).length} stores:`, Object.keys(grouped));
  return grouped;
}
