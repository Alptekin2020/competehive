import { describe, it, expect } from "vitest";
import { parseTrendyolHtml } from "../scrapers";

// Prod vakası: Trendyol "envoy" vitrin yenilemesiyle (2026-07) bazı ürün
// sayfaları eski __PRODUCT_DETAIL_APP_INITIAL_STATE__ global'ini tamamen
// kaldırdı ve JSON-LD şemasını düz "Product"tan varyant grubunu temsil eden
// "ProductGroup"a taşıdı (Philips HD9650/90 canlı vakası). Eski kod yalnızca
// "Product" tipini tanıyordu; bu sayfalarda hiçbir yöntem fiyat bulamayıp
// SCRAPE_ALL_METHODS_FAILED atıyordu — Puppeteer 200 + gerçek 600KB+ içerik
// getirse bile.
describe("parseTrendyolHtml — ProductGroup JSON-LD (Trendyol envoy prod vakası)", () => {
  const philipsProductGroupPage = `<html><body>
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ProductGroup",
        productGroupID: "14262809",
        name: "Philips Premium Airfryer XXL, Rapid Air teknolojisi, 7,2 Lt (1,4 kg), Fat Removal teknolojisi, HD9650/90",
        manufacturer: "Philips",
        image: {
          "@type": "ImageObject",
          contentUrl: ["https://cdn.dsmcdn.com/ty1530/product/media/images/prod/1_org_zoom.jpg"],
        },
        brand: { "@type": "Brand", name: "Philips" },
        offers: {
          "@type": "Offer",
          priceCurrency: "TRY",
          price: "9475.00",
          availability: "https://schema.org/InStock",
        },
        hasVariant: [
          {
            "@type": "Product",
            offers: { "@type": "Offer", priceCurrency: "TRY", price: "10989.00" },
          },
        ],
        aggregateRating: { "@type": "AggregateRating", ratingValue: "4.6", reviewCount: "6847" },
      })}
    </script>
    <script type="application/ld+json">
      ${JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: "irrelevant" })}
    </script>
  </body></html>`;

  it("extracts name/price/currency from group-level offers", () => {
    const result = parseTrendyolHtml(philipsProductGroupPage);
    expect(result).not.toBeNull();
    expect(result?.name).toBe(
      "Philips Premium Airfryer XXL, Rapid Air teknolojisi, 7,2 Lt (1,4 kg), Fat Removal teknolojisi, HD9650/90",
    );
    expect(result?.price).toBe(9475);
    expect(result?.currency).toBe("TRY");
    expect(result?.inStock).toBe(true);
  });

  it("extracts the image from the ImageObject.contentUrl shape", () => {
    const result = parseTrendyolHtml(philipsProductGroupPage);
    expect(result?.imageUrl).toBe(
      "https://cdn.dsmcdn.com/ty1530/product/media/images/prod/1_org_zoom.jpg",
    );
  });

  it("extracts rating/reviewCount from aggregateRating", () => {
    const result = parseTrendyolHtml(philipsProductGroupPage);
    expect(result?.rating).toBe(4.6);
    expect(result?.reviewCount).toBe(6847);
  });

  it("does not crash on an unrelated WebPage JSON-LD block alongside ProductGroup", () => {
    // İkinci script tag'i @type=WebPage — Method 1'in onu atlayıp asıl
    // ProductGroup verisini bulması gerekiyor (regresyon: her iki script de
    // parse edilmeye çalışılıyor, sondaki geçersiz olan öncekini ezmemeli).
    const result = parseTrendyolHtml(philipsProductGroupPage);
    expect(result?.price).toBe(9475);
  });

  it("falls back to the first hasVariant offer when the group-level price is missing", () => {
    const page = `<html><body><script type="application/ld+json">${JSON.stringify({
      "@type": "ProductGroup",
      name: "Örnek Ürün Grubu",
      hasVariant: [{ "@type": "Product", offers: { priceCurrency: "TRY", price: "1099.90" } }],
    })}</script></body></html>`;

    const result = parseTrendyolHtml(page);
    expect(result?.price).toBe(1099.9);
    expect(result?.currency).toBe("TRY");
  });

  it("falls back to the first hasVariant offer when the group-level price is zero", () => {
    const page = `<html><body><script type="application/ld+json">${JSON.stringify({
      "@type": "ProductGroup",
      name: "Örnek Ürün Grubu",
      offers: { priceCurrency: "TRY", price: "0.00" },
      hasVariant: [{ "@type": "Product", offers: { priceCurrency: "TRY", price: "2499.00" } }],
    })}</script></body></html>`;

    const result = parseTrendyolHtml(page);
    expect(result?.price).toBe(2499);
  });

  it("marks out-of-stock offers correctly", () => {
    const page = `<html><body><script type="application/ld+json">${JSON.stringify({
      "@type": "ProductGroup",
      name: "Stok Dışı Ürün",
      offers: {
        priceCurrency: "TRY",
        price: "500.00",
        availability: "https://schema.org/OutOfStock",
      },
    })}</script></body></html>`;

    const result = parseTrendyolHtml(page);
    expect(result?.inStock).toBe(false);
  });
});

describe("parseTrendyolHtml — düz Product tipi (regresyon koruması)", () => {
  it("still parses the legacy flat Product JSON-LD shape", () => {
    const page = `<html><body><script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Arzum OK004 Okka Minio",
      image: ["https://cdn.dsmcdn.com/example.jpg"],
      offers: [{ priceCurrency: "TRY", price: "1899.00", seller: { name: "Arzum Resmi Mağaza" } }],
    })}</script></body></html>`;

    const result = parseTrendyolHtml(page);
    expect(result?.name).toBe("Arzum OK004 Okka Minio");
    expect(result?.price).toBe(1899);
    expect(result?.sellerName).toBe("Arzum Resmi Mağaza");
    expect(result?.imageUrl).toBe("https://cdn.dsmcdn.com/example.jpg");
  });

  it("returns null when no recognizable product data exists anywhere", () => {
    const page = `<html><body><p>Sayfa bulunamadı</p></body></html>`;
    expect(parseTrendyolHtml(page)).toBeNull();
  });
});
