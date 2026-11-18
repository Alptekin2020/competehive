import { describe, expect, it } from "vitest";

import { checkGtinInput, isValidGtin, normalizeGtinInput } from "../gtin";

describe("isValidGtin", () => {
  it("accepts valid EAN-13, EAN-8, UPC-A and GTIN-14", () => {
    expect(isValidGtin("4006381333931")).toBe(true);
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("036000291452")).toBe(true);
    expect(isValidGtin("10012345678902")).toBe(true);
  });

  it("rejects a wrong check digit or length", () => {
    expect(isValidGtin("4006381333932")).toBe(false);
    expect(isValidGtin("123456789")).toBe(false);
    expect(isValidGtin("")).toBe(false);
  });
});

describe("normalizeGtinInput", () => {
  it("strips spaces and dashes from digit groups", () => {
    expect(normalizeGtinInput(" 400 6381-333931 ")).toBe("4006381333931");
  });

  it("keeps non-digit input so validation rejects it", () => {
    expect(normalizeGtinInput("abc123")).toBe("abc123");
  });
});

describe("checkGtinInput", () => {
  it("treats empty input as no barcode", () => {
    expect(checkGtinInput("")).toBeNull();
    expect(checkGtinInput("   ")).toBeNull();
    expect(checkGtinInput(undefined)).toBeNull();
  });

  it("returns the normalized barcode when valid", () => {
    expect(checkGtinInput("4006381 333931")).toEqual({ ok: true, gtin: "4006381333931" });
  });

  it("explains why a barcode is rejected", () => {
    expect(checkGtinInput("12ab")).toMatchObject({ ok: false });
    expect(checkGtinInput("123456789")).toEqual({
      ok: false,
      error: "Barkod 8, 12, 13 ya da 14 haneli olmalı.",
    });
    expect(checkGtinInput("4006381333932")).toEqual({
      ok: false,
      error: "Barkod geçersiz görünüyor, rakamları kontrol edin.",
    });
  });
});
