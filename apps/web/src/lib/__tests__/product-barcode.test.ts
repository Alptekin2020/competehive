import { describe, expect, it } from "vitest";
import { applyBarcodeToMetadata } from "../product-barcode";

describe("applyBarcodeToMetadata", () => {
  it("adds a new barcode, keeps other metadata and asks for a search", () => {
    const result = applyBarcodeToMetadata({ brand: "Philips" }, "4006381333931");
    expect(result.metadata).toEqual({
      brand: "Philips",
      gtin: "4006381333931",
      gtinSource: "user",
    });
    expect(result.changed).toBe(true);
    expect(result.shouldSearch).toBe(true);
  });

  it("does not search again when the same barcode is saved", () => {
    const result = applyBarcodeToMetadata({ gtin: "4006381333931" }, "4006381333931");
    expect(result.changed).toBe(false);
    expect(result.shouldSearch).toBe(false);
  });

  it("replaces a barcode read from the store page", () => {
    const result = applyBarcodeToMetadata({ ean: "96385074" }, "4006381333931");
    expect(result.metadata.gtin).toBe("4006381333931");
    expect(result.shouldSearch).toBe(true);
  });

  it("clears every barcode key so no stale value stays active", () => {
    const result = applyBarcodeToMetadata(
      { gtin: "4006381333931", ean: "96385074", gtinSource: "user", brand: "X" },
      null,
    );
    expect(result.metadata).toEqual({ brand: "X" });
    expect(result.changed).toBe(true);
    expect(result.shouldSearch).toBe(false);
  });

  it("handles missing metadata", () => {
    expect(applyBarcodeToMetadata(null, null)).toEqual({
      metadata: {},
      changed: false,
      shouldSearch: false,
    });
  });
});
