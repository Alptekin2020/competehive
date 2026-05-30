import { describe, it, expect } from "vitest";
import { parsePrice } from "../scrapers";

// SCRAPE-1: scraper price parsing must handle Turkish number formatting
// (dot = thousands separator, comma = decimal) as well as en-US JSON-LD prices.
describe("parsePrice (scrapers)", () => {
  it("parses Turkish thousands + decimal (1.299,99)", () => {
    expect(parsePrice("1.299,99")).toBeCloseTo(1299.99, 2);
  });

  it("parses Turkish thousands without decimals (1.299)", () => {
    expect(parsePrice("1.299")).toBe(1299);
  });

  it("parses large Turkish amount (1.299.999,50)", () => {
    expect(parsePrice("1.299.999,50")).toBeCloseTo(1299999.5, 2);
  });

  it("parses comma-decimal only (29,99)", () => {
    expect(parsePrice("29,99")).toBeCloseTo(29.99, 2);
  });

  it("parses en-US JSON-LD style (1299.99)", () => {
    expect(parsePrice("1299.99")).toBeCloseTo(1299.99, 2);
  });

  it("parses a plain integer (1299)", () => {
    expect(parsePrice("1299")).toBe(1299);
  });

  it("strips currency symbols and whitespace", () => {
    expect(parsePrice("1.299,99 TL")).toBeCloseTo(1299.99, 2);
    expect(parsePrice("₺2.499,00")).toBeCloseTo(2499, 2);
  });

  it("returns 0 for empty or invalid input", () => {
    expect(parsePrice("")).toBe(0);
    expect(parsePrice(null)).toBe(0);
    expect(parsePrice(undefined)).toBe(0);
    expect(parsePrice("abc")).toBe(0);
  });
});
