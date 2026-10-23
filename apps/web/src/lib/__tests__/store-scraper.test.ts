import { describe, it, expect } from "vitest";
import { parseShopifyProductJson, parseStorePage, shopifyJsonUrl } from "../store-scraper";

function page(head: string, body = ""): string {
  return `<html><head>${head}</head><body>${body}</body></html>`;
}

function ld(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

describe("parseStorePage", () => {
  it("reads a schema.org Product with an Offer (seninev.com shape) as full support", () => {
    const result = parseStorePage(
      page(
        ld({
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Cornella Ginger Ayaklı Dekoratif Cam Tabak",
          image: ["https://cdn.example.com/a.webp", "https://cdn.example.com/b.webp"],
          sku: "CR-1693",
          offers: {
            "@type": "Offer",
            priceCurrency: "TRY",
            price: "3640.00",
            availability: "https://schema.org/InStock",
          },
        }),
      ),
    );

    expect(result.support).toBe("full");
    expect(result.issues).toEqual([]);
    expect(result.product).toMatchObject({
      name: "Cornella Ginger Ayaklı Dekoratif Cam Tabak",
      price: 3640,
      currency: "TRY",
      image: "https://cdn.example.com/a.webp",
      inStock: true,
      sku: "CR-1693",
    });
  });

  it("finds the Product inside @graph and reads AggregateOffer.lowPrice", () => {
    const result = parseStorePage(
      page(
        ld({
          "@graph": [
            { "@type": "WebPage", name: "Sayfa" },
            {
              "@type": ["Product"],
              name: "Tencere Seti",
              brand: { "@type": "Brand", name: "Taç" },
              gtin13: "8690000000001",
              offers: {
                "@type": "AggregateOffer",
                lowPrice: 2799,
                priceCurrency: "TRY",
                availability: "InStock",
              },
            },
          ],
        }),
      ),
    );

    expect(result.support).toBe("full");
    expect(result.product.price).toBe(2799);
    expect(result.product.brand).toBe("Taç");
    expect(result.product.gtin).toBe("8690000000001");
  });

  it("reads the first variant's offer for a ProductGroup", () => {
    const result = parseStorePage(
      page(
        ld({
          "@type": "ProductGroup",
          name: "Tişört",
          hasVariant: [
            {
              "@type": "Product",
              offers: { price: "499.90", priceCurrency: "TRY", availability: "OutOfStock" },
            },
          ],
        }),
      ),
    );

    expect(result.product.price).toBe(499.9);
    expect(result.product.inStock).toBe(false);
  });

  it("falls back to Open Graph product meta tags", () => {
    const result = parseStorePage(
      page(
        `<meta property="og:title" content="Kahve Makinesi" />
         <meta property="og:image" content="https://cdn.example.com/k.jpg" />
         <meta property="product:price:amount" content="1.299,00" />
         <meta property="product:price:currency" content="TRY" />
         <meta property="product:availability" content="in stock" />`,
      ),
    );

    expect(result.support).toBe("full");
    expect(result.product).toMatchObject({
      name: "Kahve Makinesi",
      price: 1299,
      image: "https://cdn.example.com/k.jpg",
      inStock: true,
    });
  });

  it("falls back to microdata and reports unknown stock as partial support", () => {
    const result = parseStorePage(
      page(
        "<title>Lamba | Mağaza</title>",
        `<div itemscope itemtype="https://schema.org/Product">
           <h1 itemprop="name">Masa Lambası</h1>
           <span itemprop="price" content="349.50">349,50 TL</span>
           <meta itemprop="priceCurrency" content="TRY" />
         </div>`,
      ),
    );

    expect(result.support).toBe("partial");
    expect(result.product.price).toBe(349.5);
    expect(result.product.name).toBe("Masa Lambası");
    expect(result.product.inStock).toBe(true);
    expect(result.issues.join(" ")).toContain("Stok durumu okunamadı");
  });

  it("flags a non-TRY currency as partial support", () => {
    const result = parseStorePage(
      page(
        ld({
          "@type": "Product",
          name: "Item",
          offers: { price: "10.00", priceCurrency: "EUR", availability: "InStock" },
        }),
      ),
    );

    expect(result.support).toBe("partial");
    expect(result.product.currency).toBe("EUR");
  });

  it("is unsupported when no price can be found", () => {
    const result = parseStorePage(page('<meta property="og:title" content="Ürün" />'));

    expect(result.support).toBe("unsupported");
    expect(result.product.price).toBeNull();
    expect(result.issues[0]).toContain("fiyat bilgisi bulunamadı");
  });

  it("explains bot-protection pages", () => {
    const result = parseStorePage(page("<title>Just a moment...</title>", "cf-chl"));

    expect(result.support).toBe("unsupported");
    expect(result.issues[0]).toContain("bot koruması");
  });

  it("skips broken JSON-LD blocks and keeps reading the next one", () => {
    const result = parseStorePage(
      page(
        `<script type="application/ld+json">{ broken</script>` +
          ld({
            "@type": "Product",
            name: "Vazo",
            offers: { price: 150, availability: "InStock" },
          }),
      ),
    );

    expect(result.product.price).toBe(150);
    expect(result.support).toBe("full");
  });
});

describe("shopifyJsonUrl", () => {
  it("maps Shopify product paths to the .js endpoint", () => {
    expect(shopifyJsonUrl("https://www.jumbo.com.tr/products/kesme-tahtasi?variant=1")).toBe(
      "https://www.jumbo.com.tr/products/kesme-tahtasi.js",
    );
    expect(shopifyJsonUrl("https://magaza.com/collections/yeni/products/vazo")).toBe(
      "https://magaza.com/products/vazo.js",
    );
    expect(shopifyJsonUrl("https://magaza.com/en/products/vazo")).toBe(
      "https://magaza.com/products/vazo.js",
    );
  });

  it("returns null for non-Shopify paths", () => {
    expect(shopifyJsonUrl("https://seninev.com/urun/CR-1693")).toBeNull();
    expect(shopifyJsonUrl("not a url")).toBeNull();
  });
});

describe("parseShopifyProductJson", () => {
  it("converts minor-unit prices and reads stock, image and identifiers", () => {
    const result = parseShopifyProductJson({
      title: "Victorinox Kesme Tahtası",
      price: 390900,
      available: false,
      vendor: "Victorinox",
      featured_image: "//cdn.shopify.com/s/files/a.jpg",
      variants: [{ sku: "7.4123", barcode: "7611160000000" }],
    });

    expect(result?.support).toBe("full");
    expect(result?.product).toMatchObject({
      name: "Victorinox Kesme Tahtası",
      price: 3909,
      currency: "TRY",
      inStock: false,
      image: "https://cdn.shopify.com/s/files/a.jpg",
      sku: "7.4123",
      gtin: "7611160000000",
      brand: "Victorinox",
    });
  });

  it("rejects payloads without a positive price", () => {
    expect(parseShopifyProductJson({ title: "X", price: 0 })).toBeNull();
    expect(parseShopifyProductJson("<html>")).toBeNull();
  });
});

describe("parseStorePage stock signals", () => {
  it("reads og:availability (Evidea shape)", () => {
    const result = parseStorePage(
      page(
        `<meta property="og:title" content="Yapay Çiçek" />
         <meta property="og:price:amount" content="319.90" />
         <meta property="og:availability" content="out of stock" />`,
      ),
    );
    expect(result.support).toBe("full");
    expect(result.product.inStock).toBe(false);
  });

  it("reads underscore spellings like in_stock (Modanisa shape)", () => {
    const result = parseStorePage(
      page(
        "<title>Eşarp</title>",
        `<h1>Eşarp</h1><span itemprop="price" content="29.99"></span>
         <meta itemprop="availability" content="in_stock" />`,
      ),
    );
    expect(result.support).toBe("full");
    expect(result.product.inStock).toBe(true);
  });
});
