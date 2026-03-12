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
        // Shopping sonuçlarında item.source mağaza adını içerir (ör: "Trendyol", "Hepsiburada")
        // Önce source'dan marketplace tespiti yap, URL'den daha güvenilir
        const { marketplace, storeName } = detectStore(
          item.link || "",
          (item.source || "") + " " + (item.title || ""),
        );
        let price: number | null = null;
        if (item.price) {
          price = parsePrice(String(item.price).replace("TL", "").replace("₺", ""));
        }
        // extractedPrice da kontrol et (Serper bazen bu alanda veriyor)
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

// Birden fazla arama varyasyonu ile arama yaparak sonuçları birleştir
async function searchSerper(query: string): Promise<MarketplaceResult[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    console.error("[CompeteHive] SERPER_API_KEY missing");
    return [];
  }

  // Arama varyasyonları oluştur
  const queries = generateSearchVariations(query);
  console.log(`[CompeteHive] Search variations:`, queries);

  // Tüm aramaları paralel olarak yap
  const allResultArrays = await Promise.all(queries.map((q) => searchSerperSingle(q, apiKey)));

  // Sonuçları birleştir, URL bazında tekrarlananları kaldır
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
    `[CompeteHive] Total unique results after ${queries.length} queries: ${results.length}`,
  );
  return results;
}

// Arama sorgusundan birden fazla arama varyasyonu oluştur
function generateSearchVariations(query: string): string[] {
  const variations: string[] = [query];

  // Model numarasını tespit et ve kaldırılmış versiyonunu ekle
  // Model numarası: 2+ harf+rakış karışık, 5+ karakter (ör: F0752AX25WN, SM-G998B, MUF82TU)
  const modelPattern = /\b[A-Z0-9](?:[A-Z0-9-/]){4,}[A-Z0-9]\b/i;
  const modelMatch = query.match(modelPattern);

  if (modelMatch) {
    // Model numarası olmadan arama — daha genel sonuçlar verir
    const withoutModel = query
      .replace(modelPattern, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (withoutModel.length >= 5 && withoutModel !== query) {
      variations.push(withoutModel);
    }

    // Sadece model numarası ile arama — diğer mağazalarda ürün kodu ile arama
    const modelQuery = modelMatch[0];
    if (modelQuery.length >= 5) {
      variations.push(modelQuery);
    }
  }

  // Marka + ürün tipi varyasyonu (ilk kelime marka olabilir, son 2-3 kelime ürün tipi)
  const words = query.split(/\s+/).filter((w) => w.length > 1);
  if (words.length >= 4) {
    // İlk kelime (marka) + son 2 kelime (ürün tipi)
    const brandPlusType = [words[0], ...words.slice(-2)].join(" ");
    if (!variations.includes(brandPlusType) && brandPlusType !== query) {
      variations.push(brandPlusType);
    }
  }

  // Maksimum 4 arama varyasyonu (API limitlerini aşmamak için)
  return variations.slice(0, 4);
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

// Birden fazla keyword dizisini tek bir sonuç havuzunda birleştirerek ara
async function searchWithMultipleKeywords(keywords: string[]): Promise<MarketplaceResult[]> {
  // Her keyword ayrı bir arama sorgusu olarak kullanılır
  // searchSerper zaten her sorgu için birden fazla varyasyon oluşturur,
  // bu yüzden burada sadece ilk (en iyi) keyword'ü gönderiyoruz
  // Birden fazla keyword varsa ilkini ana sorgu olarak kullan
  const primaryQuery = keywords[0];
  console.log(`[CompeteHive] Primary search query: "${primaryQuery}"`);
  console.log(`[CompeteHive] All keywords: ${JSON.stringify(keywords)}`);

  const allResults = await searchSerper(primaryQuery);

  // Eğer ana sorgudan az sonuç geldiyse, diğer keyword'leri de dene
  if (allResults.length < 5 && keywords.length > 1) {
    const seenUrls = new Set(allResults.map((r) => r.url.replace(/\/$/, "").toLowerCase()));
    for (let i = 1; i < Math.min(keywords.length, 3); i++) {
      console.log(`[CompeteHive] Additional search: "${keywords[i]}"`);
      const moreResults = await searchSerper(keywords[i]);
      for (const result of moreResults) {
        const normalizedUrl = result.url.replace(/\/$/, "").toLowerCase();
        if (normalizedUrl && !seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl);
          allResults.push(result);
        }
      }
      // Yeterli sonuç bulunursa daha fazla arama yapma
      if (allResults.length >= 15) break;
    }
  }

  return allResults;
}

// Return all matched results as a flat array, sorted by price ascending
export async function searchAllResults(
  keywords: string[],
  sourceMarketplace: string,
): Promise<MarketplaceResult[]> {
  console.log(
    `[CompeteHive] Searching with ${keywords.length} keywords (source: ${sourceMarketplace})`,
  );

  const allResults = await searchWithMultipleKeywords(keywords);
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

  const allResults = await searchWithMultipleKeywords(keywords);
  console.log(`[CompeteHive] Total: ${allResults.length} results`);

  const normalizedResults = normalizeMarketplaceResults(allResults, "fallback-custom");
  console.log(`[CompeteHive] Normalized: ${normalizedResults.length} results`);

  const primaryQuery = keywords[0];
  const bestMatches = await selectBestMatches(normalizedResults, primaryQuery);
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
