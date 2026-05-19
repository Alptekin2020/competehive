// Audit P2-5: parsePrice ve extractRetailer için regression testleri.
// Hepsiburada/Trendyol/Amazon TR'nin Serper'da gönderdiği gerçek formatlar dahil edildi.
import { describe, it, expect } from "vitest";
import { parsePrice, extractRetailer, isScraperBackedRetailer } from "../serper";

describe("parsePrice (Audit P2-5)", () => {
  describe("simple Turkish formats", () => {
    it("parses ₺1.299,00", () => {
      expect(parsePrice("₺1.299,00")).toBe(1299);
    });
    it("parses ₺1.299 (Turkish thousands)", () => {
      expect(parsePrice("₺1.299")).toBe(1299);
    });
    it("parses 99,99 (Turkish decimal)", () => {
      expect(parsePrice("99,99")).toBe(99.99);
    });
    it("parses 1.290 TL", () => {
      expect(parsePrice("1.290 TL")).toBe(1290);
    });
    it("parses ₺1290 (no separator)", () => {
      expect(parsePrice("₺1290")).toBe(1290);
    });
    it("parses 9.999,99 (3-digit thousands + decimal)", () => {
      expect(parsePrice("9.999,99")).toBe(9999.99);
    });
    it("parses 99.999,90", () => {
      expect(parsePrice("99.999,90")).toBe(99999.9);
    });
  });

  describe("en-US formats (Serper sometimes returns these)", () => {
    it("parses From ₺1,299.00", () => {
      expect(parsePrice("From ₺1,299.00")).toBe(1299);
    });
    it("parses 1,299.50", () => {
      expect(parsePrice("1,299.50")).toBe(1299.5);
    });
  });

  describe("prefixed / marketing copy (regression — audit found)", () => {
    it("parses İndirimde: ₺99,99 (Turkish prefix)", () => {
      expect(parsePrice("İndirimde: ₺99,99")).toBe(99.99);
    });
    it("extracts first numeric block from price range", () => {
      // "₺1.290 - ₺1.890" — eski parsePrice 12901890 üretiyordu
      const v = parsePrice("₺1.290 - ₺1.890");
      expect(v).toBe(1290);
    });
    it("extracts price from 'Fiyat: 1.290 TL'", () => {
      expect(parsePrice("Fiyat: 1.290 TL")).toBe(1290);
    });
    it("parses '8 ay 99 TL'den başlayan' as 99 (currency-adjacent priority)", () => {
      // Gemini review fix: currency-adjacent rakam tercih edilir, "8" değil "99".
      expect(parsePrice("8 ay 99 TL'den başlayan")).toBe(99);
    });
    it("parses '8 ay 1.290 TL'den başlayan' as 1290", () => {
      expect(parsePrice("8 ay 1.290 TL'den başlayan")).toBe(1290);
    });
    it("rejects single-digit marketing numbers without currency", () => {
      // "8 ay" tek başına → null (currency yok, 2+ digit yok)
      expect(parsePrice("8 ay")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("returns null for empty string", () => {
      expect(parsePrice("")).toBeNull();
    });
    it("returns null for null", () => {
      expect(parsePrice(null as unknown as string)).toBeNull();
    });
    it("returns null for text-only", () => {
      expect(parsePrice("Stokta yok")).toBeNull();
    });
    it("handles NBSP whitespace", () => {
      expect(parsePrice("₺ 1.290,00")).toBe(1290);
    });
  });
});

describe("extractRetailer (Audit P1-4)", () => {
  it("identifies Trendyol", () => {
    expect(extractRetailer("https://www.trendyol.com/p/123")).toEqual({
      name: "Trendyol",
      color: "#F27A1A",
    });
  });
  it("identifies Hepsiburada", () => {
    expect(extractRetailer("https://www.hepsiburada.com/abc-p-HBV001")).toEqual({
      name: "Hepsiburada",
      color: "#FF6000",
    });
  });
  it("identifies Amazon TR", () => {
    expect(extractRetailer("https://www.amazon.com.tr/dp/B0XXXX")).toEqual({
      name: "Amazon TR",
      color: "#FF9900",
    });
  });
  it("identifies expanded retailers (Çiçeksepeti, Boyner, Watsons)", () => {
    expect(extractRetailer("https://www.ciceksepeti.com/p/1").name).toBe("Çiçeksepeti");
    expect(extractRetailer("https://www.boyner.com.tr/p/1").name).toBe("Boyner");
    expect(extractRetailer("https://www.watsons.com.tr/p/1").name).toBe("Watsons");
  });
  it("falls back to Diğer for unknown domains", () => {
    expect(extractRetailer("https://www.unknown-store.com/x").name).toBe("Diğer");
  });
  it("is case-insensitive", () => {
    expect(extractRetailer("HTTPS://WWW.HEPSIBURADA.COM/X").name).toBe("Hepsiburada");
  });
});

describe("isScraperBackedRetailer", () => {
  it("returns true for Hepsiburada/Trendyol/Amazon TR/N11", () => {
    expect(isScraperBackedRetailer("Hepsiburada")).toBe(true);
    expect(isScraperBackedRetailer("Trendyol")).toBe(true);
    expect(isScraperBackedRetailer("Amazon TR")).toBe(true);
    expect(isScraperBackedRetailer("N11")).toBe(true);
  });
  it("returns false for non-scraper retailers", () => {
    expect(isScraperBackedRetailer("Çiçeksepeti")).toBe(false);
    expect(isScraperBackedRetailer("Diğer")).toBe(false);
  });
});
