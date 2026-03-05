import * as cheerio from "cheerio";

const HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
};

function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export interface MarketplaceResult {
  marketplace: string;
  productName: string;
  price: number | null;
  url: string;
  seller: string | null;
  image: string | null;
  inStock: boolean;
}

async function searchTrendyol(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.trendyol.com/sr?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $(".p-card-wrppr").slice(0, 3).each((_, el) => {
      const name = $(el).find(".prdct-desc-cntnr-name").text().trim();
      const priceText = $(el).find(".prc-box-dscntd").first().text().trim() || $(el).find(".prc-box-sllng").first().text().trim();
      const price = parsePrice(priceText);
      const href = $(el).find("a").attr("href");
      const url = href ? (href.startsWith("http") ? href : `https://www.trendyol.com${href}`) : "";
      const image = $(el).find("img.p-card-img").attr("src") || null;

      if (name && url) {
        results.push({ marketplace: "TRENDYOL", productName: name, price, url, seller: null, image, inStock: true });
      }
    });
    return results;
  } catch { return []; }
}

async function searchHepsiburada(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.hepsiburada.com/ara?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $("[data-test-id='product-card-item']").slice(0, 3).each((_, el) => {
      const name = $(el).find("[data-test-id='product-card-name']").text().trim() || $(el).find("h3").text().trim();
      const priceText = $(el).find("[data-test-id='price-current-price']").text().trim() || $(el).find(".product-price").text().trim();
      const price = parsePrice(priceText);
      const href = $(el).find("a").attr("href");
      const url = href ? (href.startsWith("http") ? href : `https://www.hepsiburada.com${href}`) : "";
      const image = $(el).find("img").attr("src") || null;

      if (name && url) {
        results.push({ marketplace: "HEPSIBURADA", productName: name, price, url, seller: null, image, inStock: true });
      }
    });
    return results;
  } catch { return []; }
}

async function searchAmazonTR(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.amazon.com.tr/s?k=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $(".s-result-item[data-asin]").slice(0, 3).each((_, el) => {
      const asin = $(el).attr("data-asin");
      if (!asin) return;
      const name = $(el).find("h2 .a-text-normal").text().trim();
      const priceText = $(el).find(".a-price .a-offscreen").first().text().trim();
      const price = parsePrice(priceText);
      const url = `https://www.amazon.com.tr/dp/${asin}`;
      const image = $(el).find("img.s-image").attr("src") || null;

      if (name) {
        results.push({ marketplace: "AMAZON_TR", productName: name, price, url, seller: null, image, inStock: true });
      }
    });
    return results;
  } catch { return []; }
}

async function searchN11(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.n11.com/arama?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $(".columnContent .pro").slice(0, 3).each((_, el) => {
      const name = $(el).find(".productName").text().trim();
      const priceText = $(el).find(".newPrice ins").text().trim() || $(el).find(".newPrice").text().trim();
      const price = parsePrice(priceText);
      const href = $(el).find("a").attr("href") || "";
      const image = $(el).find("img").attr("src") || null;

      if (name && href) {
        results.push({ marketplace: "N11", productName: name, price, url: href, seller: null, image, inStock: true });
      }
    });
    return results;
  } catch { return []; }
}

async function searchCiceksepeti(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.ciceksepeti.com/ara?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $(".product-item, .product__item").slice(0, 3).each((_, el) => {
      const name = $(el).find(".product__title, .product-name").text().trim();
      const priceText = $(el).find(".product__price, .price").text().trim();
      const price = parsePrice(priceText);
      const href = $(el).find("a").attr("href");
      const url = href ? (href.startsWith("http") ? href : `https://www.ciceksepeti.com${href}`) : "";
      const image = $(el).find("img").attr("src") || null;

      if (name && url) {
        results.push({ marketplace: "CICEKSEPETI", productName: name, price, url, seller: null, image, inStock: true });
      }
    });
    return results;
  } catch { return []; }
}

async function searchPttavm(query: string): Promise<MarketplaceResult[]> {
  try {
    const searchUrl = `https://www.pttavm.com/arama?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, { headers: HEADERS, cache: "no-store" });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const results: MarketplaceResult[] = [];

    $(".product-card, .urunKutu").slice(0, 3).each((_, el) => {
      const name = $(el).find(".product-name, .urunAdi").text().trim();
      const priceText = $(el).find(".product-price, .fiyat").text().trim();
      const price = parsePrice(priceText);
      const href = $(el).find("a").attr("href");
      const url = href ? (href.startsWith("http") ? href : `https://www.pttavm.com${href}`) : "";
      const image = $(el).find("img").attr("src") || null;

      if (name && url) {
        results.push({ marketplace: "PTTAVM", productName: name, price, url, seller: "PTT AVM", image, inStock: true });
      }
    });
    return results;
  } catch { return []; }
}

export function findBestMatch(
  results: MarketplaceResult[],
  originalProduct: string
): MarketplaceResult | null {
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];

  const originalWords = originalProduct.toLowerCase().split(/\s+/);
  let bestMatch = results[0];
  let bestScore = 0;

  for (const result of results) {
    const resultWords = result.productName.toLowerCase().split(/\s+/);
    const commonWords = originalWords.filter(w => resultWords.some(rw => rw.includes(w) || w.includes(rw)));
    const score = commonWords.length / Math.max(originalWords.length, 1);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = result;
    }
  }

  return bestMatch;
}

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
  };

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
