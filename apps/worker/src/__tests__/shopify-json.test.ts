import { describe, it, expect } from "vitest";
import { parseShopifyProductJson, shopifyJsonUrl } from "../scrapers";

describe("worker Shopify product JSON", () => {
  it("builds the .js endpoint for product URLs only", () => {
    expect(shopifyJsonUrl("https://www.kigili.com/products/smokin?variant=9")).toBe(
      "https://www.kigili.com/products/smokin.js",
    );
    expect(shopifyJsonUrl("https://karaca.com/urun/tava")).toBeNull();
  });

  it("parses minor-unit prices", () => {
    expect(
      parseShopifyProductJson({
        title: "Smokin",
        price: 1099000,
        available: true,
        featured_image: "//cdn.shopify.com/x.jpg",
      }),
    ).toEqual({
      name: "Smokin",
      price: 10990,
      currency: "TRY",
      inStock: true,
      imageUrl: "https://cdn.shopify.com/x.jpg",
    });
    expect(parseShopifyProductJson({ title: "X" })).toBeNull();
  });
});
