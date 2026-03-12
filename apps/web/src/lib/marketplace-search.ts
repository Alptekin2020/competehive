import OpenAI from "openai";

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
  const cleaned = priceStr
    .replace(/[^\d.,]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
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

function detectStore(url: string, title: string): { marketplace: string; storeName: string } {
  const lower = (url + " " + title).toLowerCase();
  const stores: [string, string, string][] = [
    ["trendyol", "TRENDYOL", "Trendyol"],
    ["hepsiburada", "HEPSIBURADA", "Hepsiburada"],
    ["amazon.com.tr", "AMAZON_TR", "Amazon TR"],
    ["n11.com", "N11", "N11"],
    ["ciceksepeti", "CICEKSEPETI", "Çiçeksepeti"],
    ["pttavm", "PTTAVM", "PTT AVM"],
    ["teknosa", "TEKNOSA", "Teknosa"],
    ["mediamarkt", "MEDIAMARKT", "MediaMarkt"],
    ["koctas", "KOCTAS", "Koçtaş"],
    ["sephora", "SEPHORA", "Sephora"],
    ["boyner", "BOYNER", "Boyner"],
    ["gratis.com", "GRATIS", "Gratis"],
    ["watsons", "WATSONS", "Watsons"],
    ["kitapyurdu", "KITAPYURDU", "Kitapyurdu"],
    ["decathlon", "DECATHLON", "Decathlon"],
    ["vatanbilgisayar", "VATAN", "Vatan"],
    ["itopya", "ITOPYA", "İtopya"],
    ["akakce", "AKAKCE", "Akakçe"],
    ["cimri.com", "CIMRI", "Cimri"],
    ["epey.com", "EPEY", "Epey"],
    ["migros", "CUSTOM", "Migros"],
    ["carrefour", "CUSTOM", "CarrefourSA"],
    ["lcwaikiki", "CUSTOM", "LC Waikiki"],
    ["flo.com", "CUSTOM", "FLO"],
    ["nike.com", "CUSTOM", "Nike"],
    ["adidas.com", "CUSTOM", "Adidas"],
    ["ikea.com", "CUSTOM", "IKEA"],
    ["karaca.com", "CUSTOM", "Karaca"],
    ["dr.com.tr", "CUSTOM", "D&R"],
    ["bkmkitap", "CUSTOM", "BKM Kitap"],
    ["idefix", "CUSTOM", "İdefix"],
    ["rossmann", "CUSTOM", "Rossmann"],
    ["a101", "CUSTOM", "A101"],
    ["sok.com", "CUSTOM", "ŞOK"],
    ["mavi.com", "CUSTOM", "Mavi"],
    ["koton.com", "CUSTOM", "Koton"],
    ["defacto", "CUSTOM", "DeFacto"],
    ["superstep", "CUSTOM", "SuperStep"],
    ["vivense", "CUSTOM", "Vivense"],
    ["bellona", "CUSTOM", "Bellona"],
    ["madamecoco", "CUSTOM", "Madame Coco"],
    ["morhipo", "CUSTOM", "Morhipo"],
    ["evidea", "CUSTOM", "Evidea"],
    ["electroworld", "CUSTOM", "Electro World"],
  ];
  for (const [keyword, mp, name] of stores) {
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

// Serper.dev ile Google arama + Google Shopping arama
async function searchSerper(query: string): Promise<MarketplaceResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.error("[CompeteHive] SERPER_API_KEY missing");
    return [];
  }

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
      console.log("[CompeteHive] Serper Shopping results:", items.length);

      for (const item of items) {
        const { marketplace, storeName } = detectStore(
          item.link || item.source || "",
          item.title || "",
        );
        let price: number | null = null;
        if (item.price) {
          price = parsePrice(String(item.price).replace("TL", "").replace("₺", ""));
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

  // 2. Normal Google arama (shopping bulamazsa ek sonuçlar)
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
      console.log("[CompeteHive] Serper Organic results:", items.length);

      for (const item of items) {
        const { marketplace, storeName } = detectStore(item.link || "", item.title || "");

        let price: number | null = null;
        const snippet = (item.snippet || "") + " " + (item.title || "");
        const priceMatch = snippet.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*(?:TL|₺)/);
        if (priceMatch) price = parsePrice(priceMatch[1]);

        // Siteinfo'dan fiyat
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

// GPT ile en iyi eşleşmeleri seç
async function selectBestMatches(
  results: MarketplaceResult[],
  originalProduct: string,
): Promise<MarketplaceResult[]> {
  if (results.length === 0) return [];

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    return results.filter((r) => r.price && r.price > 0).slice(0, 8);
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
    return results.filter((r) => r.price && r.price > 0).slice(0, 8);
  }
}

export function findBestMatch(
  results: MarketplaceResult[],
  _originalProduct: string,
): MarketplaceResult | null {
  return results.length > 0 ? results[0] : null;
}

// Return all matched results as a flat array, sorted by price ascending
export async function searchAllResults(
  keywords: string[],
  sourceMarketplace: string,
): Promise<MarketplaceResult[]> {
  const query = keywords.join(" ");
  console.log(`[CompeteHive] Searching: "${query}" (source: ${sourceMarketplace})`);

  const allResults = await searchSerper(query);
  console.log(`[CompeteHive] Total: ${allResults.length} results`);

  const normalizedResults = normalizeMarketplaceResults(allResults, "fallback-custom");
  console.log(`[CompeteHive] Normalized: ${normalizedResults.length} results`);

  const bestMatches = await selectBestMatches(normalizedResults, query);
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
  const query = keywords.join(" ");
  console.log(`[CompeteHive] Searching: "${query}" (source: ${sourceMarketplace})`);

  const allResults = await searchSerper(query);
  console.log(`[CompeteHive] Total: ${allResults.length} results`);

  const normalizedResults = normalizeMarketplaceResults(allResults, "fallback-custom");
  console.log(`[CompeteHive] Normalized: ${normalizedResults.length} results`);

  const bestMatches = await selectBestMatches(normalizedResults, query);
  console.log(`[CompeteHive] AI matched: ${bestMatches.length}`);

  // Kaynak marketplace filtrele + grupla
  const grouped: Record<string, MarketplaceResult[]> = {};
  for (const result of bestMatches) {
    if (result.marketplace === sourceMarketplace) continue;
    if (!grouped[result.marketplace]) grouped[result.marketplace] = [];
    grouped[result.marketplace].push(result);
  }

  console.log(`[CompeteHive] Final: ${Object.keys(grouped).length} stores:`, Object.keys(grouped));
  return grouped;
}
