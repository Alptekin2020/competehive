import { afterEach, describe, expect, it, vi } from "vitest";

import {
  leftProductPage,
  looksLikeListingPage,
  parsePriceFromJsonLd,
  recoverPriceLightweight,
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

// Amazon TR'nin hafif isteğe döndürdüğü ~4 KB robot kontrolü sayfasının iskeleti.
const AMAZON_CHALLENGE = `<!doctype html><html lang="tr"><head><title>Amazon.com.tr</title></head>
<body><div class="a-container"><form method="get" action="/errors/validateCaptcha" name="">
<h4>Robot olmadığınızı doğrulamak için aşağıdaki karakterleri girin</h4>
<img src="https://images-na.ssl-images-amazon.com/captcha/abc/Captcha_xyz.jpg">
</form><p>Otomatik erişim için lütfen api-services-support@amazon.com adresiyle iletişime geçin.</p>
${"<!-- padding -->".repeat(200)}</div></body></html>`;

describe("recoverPriceLightweight bot challenge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("labels the Amazon robot-check page bot-challenge instead of none", async () => {
    expect(AMAZON_CHALLENGE.length).toBeGreaterThan(3000);
    const url = "https://www.amazon.com.tr/Philips-EP3347-90-Espresso/dp/B0C1234567";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const res = new Response(AMAZON_CHALLENGE, { status: 200 });
        Object.defineProperty(res, "url", { value: url });
        return res;
      }),
    );
    await expect(recoverPriceLightweight(url)).resolves.toEqual({
      price: null,
      source: "bot-challenge",
    });
  });
});
