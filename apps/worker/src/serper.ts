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

export function extractRetailer(link: string): Retailer {
  if (link.includes("trendyol.com")) return { name: "Trendyol", color: "#F27A1A" };
  if (link.includes("hepsiburada.com")) return { name: "Hepsiburada", color: "#FF6000" };
  if (link.includes("amazon.com.tr")) return { name: "Amazon TR", color: "#FF9900" };
  if (link.includes("n11.com")) return { name: "N11", color: "#6F3FAB" };
  if (link.includes("mediamarkt.com.tr")) return { name: "MediaMarkt", color: "#CC071E" };
  if (link.includes("teknosa.com")) return { name: "Teknosa", color: "#005CA9" };
  if (link.includes("vatanbilgisayar.com")) return { name: "Vatan", color: "#E30613" };
  if (link.includes("decathlon.com.tr")) return { name: "Decathlon", color: "#0082C3" };
  return { name: "Diğer", color: "#6B7280" };
}

export function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr
    .replace(/[₺$€£\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export async function searchProduct(query: string): Promise<SerperShoppingResult[]> {
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
  return data.shopping ?? [];
}
