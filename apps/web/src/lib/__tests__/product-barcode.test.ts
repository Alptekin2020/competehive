import { describe, expect, it } from "vitest";
import { applyBarcodeToMetadata, readBarcodeWarning } from "../product-barcode";

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

  it("replaces a barcode read from the store page and reports it", () => {
    const result = applyBarcodeToMetadata({ ean: "96385074" }, "4006381333931");
    expect(result.metadata.gtin).toBe("4006381333931");
    expect(result.shouldSearch).toBe(true);
    expect(result.replacedListingGtin).toBe("96385074");
  });

  it("does not report replacing the user's own earlier barcode", () => {
    const result = applyBarcodeToMetadata(
      { gtin: "96385074", gtinSource: "user" },
      "4006381333931",
    );
    expect(result.replacedListingGtin).toBeNull();
  });

  it("drops the old mismatch warning when the barcode changes", () => {
    const result = applyBarcodeToMetadata(
      { gtin: "96385074", gtinSource: "user", gtinWarning: { at: "x", mismatches: 2 } },
      "4006381333931",
    );
    expect(result.metadata.gtinWarning).toBeUndefined();
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
      replacedListingGtin: null,
    });
  });
});

describe("readBarcodeWarning", () => {
  it("reads the worker's warning and ignores broken data", () => {
    expect(
      readBarcodeWarning({ gtinWarning: { at: "2026-11-18", mismatches: 3, samples: ["A", 1] } }),
    ).toEqual({ at: "2026-11-18", mismatches: 3, samples: ["A"] });
    expect(readBarcodeWarning({ gtinWarning: "x" })).toBeNull();
    expect(readBarcodeWarning(null)).toBeNull();
  });
});
