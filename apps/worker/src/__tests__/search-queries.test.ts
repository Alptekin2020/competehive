import { describe, it, expect } from "vitest";
import {
  buildSearchQueries,
  isGenericQuery,
  extractSearchKeywords,
  stripSearchNoise,
} from "../utils/search-queries";

describe("isGenericQuery", () => {
  it("flags marketplace placeholder names", () => {
    expect(isGenericQuery("Trendyol ürünü")).toBe(true);
    expect(isGenericQuery("Hepsiburada")).toBe(true);
    expect(isGenericQuery("Amazon TR ürünü")).toBe(true);
    expect(isGenericQuery("Diğer")).toBe(true);
    expect(isGenericQuery("PTT AVM ürünü")).toBe(true);
  });

  it("flags too-short queries", () => {
    expect(isGenericQuery("ab")).toBe(true);
  });

  it("accepts real product names", () => {
    expect(isGenericQuery("Erbatab Vitamin D3 K2")).toBe(false);
    expect(isGenericQuery("Lenovo LOQ i5-13450HX")).toBe(false);
  });
});

describe("extractSearchKeywords", () => {
  it("reads metadata.searchKeywords", () => {
    expect(extractSearchKeywords({ searchKeywords: ["a", "bb"] })).toEqual(["a", "bb"]);
  });
  it("reads nested metadata.analysis.searchKeywords", () => {
    expect(extractSearchKeywords({ analysis: { searchKeywords: ["x"] } })).toEqual(["x"]);
  });
  it("returns [] for missing/invalid", () => {
    expect(extractSearchKeywords(null)).toEqual([]);
    expect(extractSearchKeywords({})).toEqual([]);
    expect(extractSearchKeywords({ searchKeywords: "nope" })).toEqual([]);
  });
});

describe("stripSearchNoise", () => {
  it("removes marketing/logistics noise but keeps brand/model", () => {
    expect(
      stripSearchNoise("Oral-B Pro 3 Şarjlı Diş Fırçası Hediyeli Ücretsiz Kargo Orijinal"),
    ).toBe("Oral-B Pro 3 Şarjlı Diş Fırçası");
  });

  it("keeps size/volume/quantity tokens (product identity must survive)", () => {
    expect(stripSearchNoise("Erbatab D3 K2 Damla 20ml 2'li")).toBe("Erbatab D3 K2 Damla 20ml 2'li");
  });

  it("matches noise regardless of Turkish casing/diacritics", () => {
    expect(stripSearchNoise("Philips Tıraş Makinesi FIRSAT GARANTİLİ FATURALI")).toBe(
      "Philips Tıraş Makinesi",
    );
  });

  it("returns the original when stripping would empty it", () => {
    expect(stripSearchNoise("Hediyeli Kargo")).toBe("Hediyeli Kargo");
  });
});

describe("buildSearchQueries", () => {
  it("strips marketing noise from the primary query (recall fix)", () => {
    const queries = buildSearchQueries("Oral-B Pro 3 Diş Fırçası Hediyeli Ücretsiz Kargo", "", {});
    expect(queries[0].toLowerCase()).toContain("oral");
    expect(queries[0].toLowerCase()).not.toContain("hediyeli");
    expect(queries[0].toLowerCase()).not.toContain("kargo");
  });

  it("uses the live product name, NOT the stale generic keyword (the bug)", () => {
    // Gerçek vaka: ad düzelmiş ama metadata'da "Trendyol ürünü" donmuş.
    const queries = buildSearchQueries(
      "Erbatab Vitamin D3 K2 2'si 1 Arada Damla",
      "Erbatab Vitamin D3 K2 2'si 1 Arada Damla",
      {
        searchKeywords: ["Trendyol ürünü"],
      },
    );
    expect(queries.length).toBeGreaterThan(0);
    expect(queries[0].toLowerCase()).toContain("erbatab");
    // Jenerik keyword asla sorgu olmamalı.
    expect(queries.some((q) => q.toLowerCase().includes("trendyol ürünü"))).toBe(false);
  });

  it("keeps AI keywords that share a token with the live name", () => {
    const queries = buildSearchQueries("Lenovo LOQ i5-13450HX 16GB RTX 5050", "Lenovo LOQ", {
      searchKeywords: ["Lenovo LOQ RTX 5050", "Trendyol ürünü"],
    });
    expect(queries.some((q) => q.toLowerCase().includes("lenovo"))).toBe(true);
    expect(queries.some((q) => q.toLowerCase().includes("trendyol ürünü"))).toBe(false);
  });

  it("truncates long names to a shopping-friendly length", () => {
    const queries = buildSearchQueries(
      "Doğanay Mutfak Bataryası Uzun Kuğu Aç Kapa Özellikli Pirinç Malzeme Sıcak Soğuk Çift",
      "",
      {},
    );
    expect(queries[0].split(/\s+/).length).toBeLessThanOrEqual(6);
  });

  it("falls back to keywords when the live name is itself generic", () => {
    const queries = buildSearchQueries("Trendyol ürünü", "Trendyol ürünü", {
      searchKeywords: ["Karaca Çelik Tencere Seti"],
    });
    expect(queries.some((q) => q.toLowerCase().includes("karaca"))).toBe(true);
  });

  it("returns empty when there is nothing usable", () => {
    expect(buildSearchQueries("Trendyol ürünü", "", { searchKeywords: ["Hepsiburada"] })).toEqual(
      [],
    );
    expect(buildSearchQueries("", "", null)).toEqual([]);
  });

  it("dedups case-insensitively", () => {
    const queries = buildSearchQueries("Nike Air Max", "Nike Air Max", {
      searchKeywords: ["nike air max", "NIKE AIR MAX"],
    });
    expect(queries).toHaveLength(1);
  });
});
