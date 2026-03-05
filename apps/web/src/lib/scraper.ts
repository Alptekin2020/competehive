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
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
};

function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

async function fetchPage(url: string): Promise<cheerio.CheerioAPI> {
  const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`Sayfa yuklenemedi: ${res.status}`);
  const html = await res.text();
  return cheerio.load(html);
}

// Ortak: JSON-LD'den fiyat cekme
function extractJsonLdPrice($: cheerio.CheerioAPI): number | null {
  let price: number | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html() || "");
      const product = json["@type"] === "Product" ? json : json["@graph"]?.find((x: any) => x["@type"] === "Product");
      if (product?.offers) {
        const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
        if (offers?.price) price = parseFloat(offers.price);
        else if (offers?.lowPrice) price = parseFloat(offers.lowPrice);
      }
    } catch {}
  });
  return price;
}

// 1. TRENDYOL
export async function scrapeTrendyol(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("h1.pr-new-br span").first().text().trim() || $("h1.pr-new-br").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  const priceText = $("span.prc-dsc").first().text().trim() || $("span.prc-slg").first().text().trim() || "";
  let price = parsePrice(priceText);
  if (!price) price = extractJsonLdPrice($);
  const image = $(".base-product-image img").attr("src") || $("img.detail-section-img").attr("src") || null;
  const seller = $("a.merchant-text").text().trim() || $(".seller-name-text").text().trim() || null;
  const inStock = !$(".pr-out-of-stock").length;
  return { name, price, currency: "TRY", image, seller, inStock };
}

// 2. HEPSIBURADA
export async function scrapeHepsiburada(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("h1#product-name").text().trim() || $("h1[data-test-id='product-name']").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  let price = extractJsonLdPrice($);
  if (!price) {
    const priceText = $("[data-test-id='price-current-price']").text().trim() || $(".product-price").text().trim() || "";
    price = parsePrice(priceText);
  }
  const image = $("img.product-image").attr("src") || $("meta[property='og:image']").attr("content") || null;
  const seller = $("[data-test-id='merchant-name']").text().trim() || null;
  const inStock = !$(".out-of-stock-container").length;
  return { name, price, currency: "TRY", image, seller, inStock };
}

// 3. AMAZON TR
export async function scrapeAmazonTR(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("#productTitle").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  const priceText = $(".a-price .a-offscreen").first().text().trim() || $("span.a-price-whole").first().text().trim() || "";
  let price = parsePrice(priceText);
  if (!price) price = extractJsonLdPrice($);
  const image = $("#landingImage").attr("src") || $("#imgBlkFront").attr("src") || null;
  const seller = $("#sellerProfileTriggerId").text().trim() || null;
  const inStock = !$("#outOfStock").length;
  return { name, price, currency: "TRY", image, seller, inStock };
}

// 4. N11
export async function scrapeN11(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("h1.proName").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  const priceText = $(".newPrice ins").text().trim() || $(".newPrice").text().trim() || "";
  let price = parsePrice(priceText);
  if (!price) price = extractJsonLdPrice($);
  const image = $(".imgObj img").attr("src") || $(".sliderMain img").attr("src") || null;
  const seller = $(".sallerName a").text().trim() || null;
  const inStock = !$(".unStock").length;
  return { name, price, currency: "TRY", image, seller, inStock };
}

// 5. CICEKSEPETI
export async function scrapeCiceksepeti(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("h1.product__title").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  let price = extractJsonLdPrice($);
  if (!price) {
    const priceText = $(".product__price").text().trim() || $("[data-test-id='price']").text().trim() || "";
    price = parsePrice(priceText);
  }
  const image = $(".product-image img").attr("src") || $("meta[property='og:image']").attr("content") || null;
  const seller = $(".seller-name").text().trim() || null;
  const inStock = !$(".out-of-stock").length;
  return { name, price, currency: "TRY", image, seller, inStock };
}

// 6. PTT AVM
export async function scrapePttavm(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("h1.product-name").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  let price = extractJsonLdPrice($);
  if (!price) {
    const priceText = $(".product-price .current-price").text().trim() || $(".price").text().trim() || "";
    price = parsePrice(priceText);
  }
  const image = $(".product-image img").attr("src") || $("meta[property='og:image']").attr("content") || null;
  const seller = $(".seller-name").text().trim() || "PTT AVM";
  const inStock = !$(".out-of-stock").length;
  return { name, price, currency: "TRY", image, seller, inStock };
}

// 7. AKAKCE (fiyat karsilastirma sitesi)
export async function scrapeAkakce(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("h1.pn_t").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  const priceText = $(".pt_v8").first().text().trim() || $(".fiyat_k").first().text().trim() || "";
  const price = parsePrice(priceText);
  const image = $(".img_w img").attr("src") || $("meta[property='og:image']").attr("content") || null;
  return { name, price, currency: "TRY", image, seller: "Akakce (en dusuk)", inStock: true };
}

// 8. CIMRI
export async function scrapeCimri(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("h1.product-name").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  let price = extractJsonLdPrice($);
  if (!price) {
    const priceText = $(".price-value").first().text().trim() || $(".best-price").text().trim() || "";
    price = parsePrice(priceText);
  }
  const image = $(".product-image img").attr("src") || $("meta[property='og:image']").attr("content") || null;
  return { name, price, currency: "TRY", image, seller: "Cimri (en dusuk)", inStock: true };
}

// 9. EPEY
export async function scrapeEpey(url: string): Promise<ScrapedProduct> {
  const $ = await fetchPage(url);
  const name = $("h1.product_name").text().trim() || $("h1").first().text().trim() || "Urun adi alinamadi";
  const priceText = $(".min_price").first().text().trim() || $(".fiyat").first().text().trim() || "";
  const price = parsePrice(priceText);
  const image = $(".product_img img").attr("src") || $("meta[property='og:image']").attr("content") || null;
  return { name, price, currency: "TRY", image, seller: "Epey (en dusuk)", inStock: true };
}

// Ana scrape fonksiyonu
export async function scrapeProduct(url: string, marketplace: string): Promise<ScrapedProduct> {
  switch (marketplace) {
    case "TRENDYOL": return scrapeTrendyol(url);
    case "HEPSIBURADA": return scrapeHepsiburada(url);
    case "AMAZON_TR": return scrapeAmazonTR(url);
    case "N11": return scrapeN11(url);
    case "CICEKSEPETI": return scrapeCiceksepeti(url);
    case "PTTAVM": return scrapePttavm(url);
    case "AKAKCE": return scrapeAkakce(url);
    case "CIMRI": return scrapeCimri(url);
    case "EPEY": return scrapeEpey(url);
    default: throw new Error(`Desteklenmeyen marketplace: ${marketplace}`);
  }
}
