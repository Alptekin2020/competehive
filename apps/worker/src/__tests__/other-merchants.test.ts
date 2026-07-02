import { describe, it, expect } from "vitest";
import { parseTrendyolOtherMerchants } from "../scrapers";

describe("parseTrendyolOtherMerchants", () => {
  it("parses merchant id, name and discounted price", () => {
    const result = {
      otherMerchants: [
        {
          merchant: { id: 123, name: "Hızlı Market" },
          price: { discountedPrice: { value: 899.9 }, sellingPrice: { value: 999.9 } },
        },
      ],
    };

    expect(parseTrendyolOtherMerchants(result, null)).toEqual([
      { merchantId: "123", sellerName: "Hızlı Market", price: 899.9 },
    ]);
  });

  it("falls back to sellingPrice when discountedPrice is missing", () => {
    const result = {
      otherMerchants: [
        { merchant: { id: "77", name: "Depo AŞ" }, price: { sellingPrice: { value: 1058 } } },
      ],
    };

    expect(parseTrendyolOtherMerchants(result, null)).toEqual([
      { merchantId: "77", sellerName: "Depo AŞ", price: 1058 },
    ]);
  });

  it("excludes the own merchant id", () => {
    const result = {
      otherMerchants: [
        {
          merchant: { id: 728779, name: "Benim Mağazam" },
          price: { sellingPrice: { value: 1189.99 } },
        },
        { merchant: { id: 555, name: "Rakip Mağaza" }, price: { sellingPrice: { value: 1058 } } },
      ],
    };

    expect(parseTrendyolOtherMerchants(result, "728779")).toEqual([
      { merchantId: "555", sellerName: "Rakip Mağaza", price: 1058 },
    ]);
  });

  it("skips entries without merchant id or a positive price", () => {
    const result = {
      otherMerchants: [
        { price: { sellingPrice: { value: 100 } } }, // id yok
        { merchant: { id: 1, name: "Sıfır Fiyat" }, price: { sellingPrice: { value: 0 } } },
        { merchant: { id: 2, name: "Fiyatsız" } },
        null,
        "garbage",
      ],
    };

    expect(parseTrendyolOtherMerchants(result, null)).toEqual([]);
  });

  it("returns empty for missing or non-array otherMerchants", () => {
    expect(parseTrendyolOtherMerchants({}, null)).toEqual([]);
    expect(parseTrendyolOtherMerchants({ otherMerchants: "x" }, null)).toEqual([]);
  });

  it("normalizes whitespace-only seller names to null", () => {
    const result = {
      otherMerchants: [
        { merchant: { id: 9, name: "   " }, price: { sellingPrice: { value: 50 } } },
      ],
    };

    expect(parseTrendyolOtherMerchants(result, null)).toEqual([
      { merchantId: "9", sellerName: null, price: 50 },
    ]);
  });
});
