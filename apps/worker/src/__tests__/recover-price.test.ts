import { describe, expect, it } from "vitest";

import {
  leftProductPage,
  looksLikeListingPage,
  parsePriceFromJsonLd,
} from "../utils/recover-price";

const ld = (data: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

const product = (name: string, price: number) => ({
  "@type": "Product",
  name,
  offers: { "@type": "Offer", price, priceCurrency: "TRY" },
});

describe("leftProductPage", () => {
  it("detects a dead Hepsiburada listing redirected to a category page", () => {
    expect(
      leftProductPage(
        "https://www.hepsiburada.com/frefly-store-note-loose-powder-pm-HBC0000I08MGF",
        "https://www.hepsiburada.com/pudralar-c-32010996",
      ),
    ).toBe(true);
  });

  it("accepts the same page and product-to-product redirects", () => {
    const url = "https://www.trendyol.com/kumtel/fanli-isitici-p-3001714";
    expect(leftProductPage(url, url)).toBe(false);
    expect(leftProductPage(url, "https://www.trendyol.com/kumtel/yeni-ad-p-3001714")).toBe(false);
    expect(leftProductPage(url, "")).toBe(false);
  });

  it("does not judge hosts without a known product URL pattern", () => {
    expect(leftProductPage("https://magaza.example/urun/1", "https://magaza.example/")).toBe(false);
  });
});

describe("looksLikeListingPage", () => {
  it("flags pages listing several different products", () => {
    expect(looksLikeListingPage(ld([product("Pudra A", 126.65), product("Pudra B", 310)]))).toBe(
      true,
    );
    expect(looksLikeListingPage(ld({ "@type": "ItemList", itemListElement: [] }))).toBe(true);
  });

  it("accepts a single product page", () => {
    expect(looksLikeListingPage(ld(product("Note Loose Powder", 299.9)))).toBe(false);
    expect(looksLikeListingPage("<html></html>")).toBe(false);
  });
});

describe("parsePriceFromJsonLd", () => {
  it("reads the offer price of a Product node, including @graph", () => {
    expect(parsePriceFromJsonLd(ld(product("X", 299.9)))).toBe(299.9);
    expect(parsePriceFromJsonLd(ld({ "@graph": [product("X", 939)] }))).toBe(939);
  });

  it("ignores offers on non-product nodes", () => {
    expect(parsePriceFromJsonLd(ld({ "@type": "WebPage", offers: { price: 126.65 } }))).toBeNull();
  });
});
