import { addProductSchema } from "../validation";
import { describe, expect, it } from "vitest";

const url = "https://www.trendyol.com/marka/urun-p-123";

describe("addProductSchema gtin", () => {
  it("treats a missing or empty barcode as none", () => {
    expect(addProductSchema.parse({ productUrl: url }).gtin).toBeNull();
    expect(addProductSchema.parse({ productUrl: url, gtin: "" }).gtin).toBeNull();
    expect(addProductSchema.parse({ productUrl: url, gtin: null }).gtin).toBeNull();
  });

  it("normalizes a valid barcode", () => {
    expect(addProductSchema.parse({ productUrl: url, gtin: " 4006381 333931 " }).gtin).toBe(
      "4006381333931",
    );
  });

  it("rejects an invalid barcode with a Turkish message", () => {
    const result = addProductSchema.safeParse({ productUrl: url, gtin: "4006381333932" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe(
        "Barkod geçersiz görünüyor, rakamları kontrol edin.",
      );
    }
  });
});
