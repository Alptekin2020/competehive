import { describe, it, expect } from "vitest";
import { foldForSearch, parseTrNumber } from "../format";

describe("parseTrNumber", () => {
  it("reads a dot as the thousands separator (Turkish convention)", () => {
    expect(parseTrNumber("2.499")).toBe(2499);
    expect(parseTrNumber("1.500")).toBe(1500);
    expect(parseTrNumber("8.599")).toBe(8599);
    expect(parseTrNumber("1.234.567")).toBe(1234567);
  });

  it("reads a comma as the decimal separator", () => {
    expect(parseTrNumber("8.599,00")).toBe(8599);
    expect(parseTrNumber("1.499,90")).toBe(1499.9);
    expect(parseTrNumber("1499,9")).toBe(1499.9);
    expect(parseTrNumber("0,5")).toBe(0.5);
  });

  it("keeps a lone non-grouping dot as a decimal point", () => {
    expect(parseTrNumber("1499.90")).toBe(1499.9);
    expect(parseTrNumber("12.5")).toBe(12.5);
    expect(parseTrNumber("0.500")).toBe(0.5);
    expect(parseTrNumber("2.4990")).toBe(2.499);
  });

  it("accepts plain integers, spaces and currency marks", () => {
    expect(parseTrNumber("850")).toBe(850);
    expect(parseTrNumber("0")).toBe(0);
    expect(parseTrNumber(" 2.499 TL ")).toBe(2499);
    expect(parseTrNumber("₺1.499,90")).toBe(1499.9);
  });

  it("returns null for empty or malformed input", () => {
    expect(parseTrNumber("")).toBeNull();
    expect(parseTrNumber("   ")).toBeNull();
    expect(parseTrNumber(null)).toBeNull();
    expect(parseTrNumber("abc")).toBeNull();
    expect(parseTrNumber("-5")).toBeNull();
    expect(parseTrNumber("1,2,3")).toBeNull();
    expect(parseTrNumber("1.2.3")).toBeNull();
    expect(parseTrNumber("1.2,5")).toBeNull();
    expect(parseTrNumber("1,5.0")).toBeNull();
    expect(parseTrNumber("12e3")).toBeNull();
  });
});

describe("foldForSearch", () => {
  it("makes Turkish and ASCII spellings comparable in any letter case", () => {
    const name = foldForSearch("Nike Sırt Çantası");
    expect(name.includes(foldForSearch("SIRT"))).toBe(true);
    expect(name.includes(foldForSearch("sirt cantasi"))).toBe(true);
    expect(name.includes(foldForSearch("çanta"))).toBe(true);
    expect(foldForSearch("iPhone 15").includes(foldForSearch("IPHONE"))).toBe(true);
    expect(foldForSearch("İtopya Oyuncu Bilgisayarı").includes(foldForSearch("itopya"))).toBe(true);
  });

  it("handles empty values", () => {
    expect(foldForSearch(null)).toBe("");
    expect(foldForSearch(undefined)).toBe("");
  });
});
