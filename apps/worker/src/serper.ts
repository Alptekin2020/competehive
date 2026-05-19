import { getCachedSerperResults, setCachedSerperResults } from "./utils/cache";

export interface SerperShoppingResult {
  title: string;
  source: string; // KULLANMA — her zaman "google.com" döner
  link: string; // retailer buradan parse edilir
  price: string; // "₺1.299,00" formatında
  imageUrl?: string;
  position: number;
}

export interface Retailer {
  name: string;
  color: string;
}

// ============================================
// Retailer Domain Map
// ============================================
// Worker'ın Docker build context'i sadece apps/worker/ olduğu için
// @competehive/shared paketini import edemiyoruz. Bu liste packages/shared/src/index.ts
// içindeki MARKETPLACES ile aynı tutulmalı. (Audit P1-4)
const RETAILER_DOMAINS: Array<{ domain: string; name: string; color: string }> = [
  { domain: "trendyol.com", name: "Trendyol", color: "#F27A1A" },
  { domain: "hepsiburada.com", name: "Hepsiburada", color: "#FF6000" },
  { domain: "amazon.com.tr", name: "Amazon TR", color: "#FF9900" },
  { domain: "n11.com", name: "N11", color: "#6F3FAB" },
  { domain: "mediamarkt.com.tr", name: "MediaMarkt", color: "#DF0000" },
  { domain: "teknosa.com", name: "Teknosa", color: "#005CA9" },
  { domain: "vatanbilgisayar.com", name: "Vatan", color: "#E30613" },
  { domain: "decathlon.com.tr", name: "Decathlon", color: "#0082C3" },
  { domain: "pttavm.com", name: "PTT AVM", color: "#FFD600" },
  { domain: "ciceksepeti.com", name: "Çiçeksepeti", color: "#E91E63" },
  { domain: "akakce.com", name: "Akakçe", color: "#00BCD4" },
  { domain: "cimri.com", name: "Cimri", color: "#4CAF50" },
  { domain: "epey.com", name: "Epey", color: "#2196F3" },
  { domain: "boyner.com.tr", name: "Boyner", color: "#1A1A1A" },
  { domain: "watsons.com.tr", name: "Watsons", color: "#00A19A" },
  { domain: "kitapyurdu.com", name: "Kitapyurdu", color: "#FF5722" },
  { domain: "sephora.com.tr", name: "Sephora", color: "#000000" },
  { domain: "koctas.com.tr", name: "Koçtaş", color: "#FF6F00" },
  { domain: "itopya.com", name: "İtopya", color: "#00C853" },
  // Gratis domain'i yanlış set'lenmiş olabilir — shared'de "grfratis" var.
  // Hem doğru hem yanlış varyantı kapsa.
  { domain: "gratis.com", name: "Gratis", color: "#FF4081" },
  { domain: "grfratis.com", name: "Gratis", color: "#FF4081" },
];

export function extractRetailer(link: string): Retailer {
  const lower = link.toLowerCase();
  for (const r of RETAILER_DOMAINS) {
    if (lower.includes(r.domain)) {
      return { name: r.name, color: r.color };
    }
  }
  return { name: "Diğer", color: "#6B7280" };
}

// Marketplace adı → scraper'lı destek var mı (puppeteer fallback'i için kullanılabilir mi)
const SCRAPER_BACKED_RETAILERS = new Set([
  "Trendyol",
  "Hepsiburada",
  "Amazon TR",
  "N11",
  "Teknosa",
  "Vatan",
  "Decathlon",
  "MediaMarkt",
  "PTT AVM",
]);

export function isScraperBackedRetailer(retailerName: string): boolean {
  return SCRAPER_BACKED_RETAILERS.has(retailerName);
}

// ============================================
// Price Parsing (Audit P2-5)
// ============================================
// Serper sometimes returns prices with prefixes ("İndirimde: ₺99,99"),
// ranges ("₺1.290 - ₺1.890"), or marketing text ("8 ay 99 TL'den başlayan").
// We extract the FIRST plausible numeric block and parse it as Turkish-format
// when possible, falling back to en-US format.
export function parsePrice(priceStr: string): number | null {
  if (!priceStr || typeof priceStr !== "string") return null;

  // Turkish-aware numeric pattern. Tries thousands+decimal first, then bare numbers.
  // Examples it matches: "1.299,00", "1,299.00", "1.299", "99,99", "1290".
  const numMatch = priceStr.match(/\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
  if (!numMatch) return null;
  const cleaned = numMatch[0];

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let num: number;

  if (hasComma && hasDot) {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      // Turkish: . thousands, , decimal
      num = parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    } else {
      // en-US: , thousands, . decimal
      num = parseFloat(cleaned.replace(/,/g, ""));
    }
  } else if (hasComma) {
    const parts = cleaned.split(",");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      // "99,99" — Turkish decimal
      num = parseFloat(cleaned.replace(",", "."));
    } else {
      // "1,290" or "1,290,000" — en-US thousands
      num = parseFloat(cleaned.replace(/,/g, ""));
    }
  } else if (hasDot) {
    const parts = cleaned.split(".");
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart.length <= 2) {
      // "99.99" — decimal
      num = parseFloat(cleaned);
    } else {
      // "1.290" or "1.290.000" — Turkish thousands
      num = parseFloat(cleaned.replace(/\./g, ""));
    }
  } else {
    num = parseFloat(cleaned);
  }

  return isNaN(num) ? null : num;
}

// ============================================
// Serper Shopping API
// ============================================
export async function searchProduct(query: string): Promise<SerperShoppingResult[]> {
  // Check cache first
  const cached = await getCachedSerperResults(query);
  if (cached) return cached as SerperShoppingResult[];

  // Cache miss — call Serper API
  const res = await fetch("https://google.serper.dev/shopping", {
    method: "POST",
    headers: {
      "X-API-KEY": process.env.SERPER_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: "tr",
      hl: "tr",
      num: 20,
    }),
  });

  if (!res.ok) {
    throw new Error(`Serper API hatası: ${res.status}`);
  }

  const data = (await res.json()) as { shopping?: SerperShoppingResult[] };
  const results = data.shopping ?? [];

  // Cache results
  if (results.length > 0) {
    await setCachedSerperResults(query, results);
  }

  return results;
}
