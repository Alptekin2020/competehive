import { describe, it, expect } from "vitest";
import { parseStorePageHtml } from "../scrapers";
import { parseAvailability } from "../utils/availability";

// apps/web/src/lib/__tests__/store-scraper.test.ts ile aynı fikstür türleri:
// worker, web önizlemesinin kabul ettiği her sayfayı okuyabilmeli.
const page = (head: string, body = "") => `<html><head>${head}</head><body>${body}</body></html>`;
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe("parseStorePageHtml (worker mirror of web parseStorePage)", () => {
  it("reads a schema.org Product offer", () => {
    expect(
      parseStorePageHtml(
        page(
          ld({
            "@type": "Product",
            name: "Cam Tabak",
            image: ["https://cdn.example.com/a.webp"],
            offers: { price: "3640.00", priceCurrency: "TRY", availability: "InStock" },
          }),
        ),
      ),
    ).toEqual({
      name: "Cam Tabak",
      price: 3640,
      currency: "TRY",
      inStock: true,
      imageUrl: "https://cdn.example.com/a.webp",
      sellerName: undefined,
    });
  });

  it("finds ProductGroup variants inside @graph", () => {
    const result = parseStorePageHtml(
      page(
        ld({
          "@graph": [
            {
              "@type": "ProductGroup",
              name: "Tişört",
              hasVariant: [{ offers: { price: 499.9, availability: "OutOfStock" } }],
            },
          ],
        }),
      ),
    );
    expect(result?.price).toBe(499.9);
    expect(result?.inStock).toBe(false);
  });

  it("falls back to microdata price (Loft/Modanisa shape) — the old generic parser missed it", () => {
    const result = parseStorePageHtml(
      page(
        "<title>Pantolon</title>",
        `<h1>Simon Pantolon</h1><span itemprop="price" content="1599.95"></span>
         <link itemprop="availability" href="in_stock" />`,
      ),
    );
    expect(result).toMatchObject({ name: "Simon Pantolon", price: 1599.95, inStock: true });
  });

  it("reads og:availability (Evidea shape)", () => {
    const result = parseStorePageHtml(
      page(
        `<meta property="og:title" content="Yapay Çiçek" />
         <meta property="og:price:amount" content="319.90" />
         <meta property="og:availability" content="out of stock" />`,
      ),
    );
    expect(result).toMatchObject({ price: 319.9, inStock: false });
  });

  it("returns null when no price is readable", () => {
    expect(parseStorePageHtml(page('<meta property="og:title" content="X" />'))).toBeNull();
  });
});

describe("worker parseAvailability mirror", () => {
  it("matches the shared normalization", () => {
    expect(parseAvailability("in_stock")).toBe(true);
    expect(parseAvailability("out of stock")).toBe(false);
    expect(parseAvailability("Gelince Haber Ver")).toBeNull();
  });
});
