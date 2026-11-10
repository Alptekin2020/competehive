import { describe, it, expect } from "vitest";
import { classifyOwnPriceHistory, type PriceHistoryRowLike } from "../price-history";

const T1 = new Date("2026-11-01T10:00:00.000Z");
const T2 = new Date("2026-11-01T16:00:00.000Z");

function row(overrides: Partial<PriceHistoryRowLike>): PriceHistoryRowLike {
  return {
    price: 100,
    previousPrice: null,
    priceChange: null,
    sellerName: null,
    scrapedAt: T1,
    ...overrides,
  };
}

describe("classifyOwnPriceHistory", () => {
  it("treats manual entries and explicit own markers as the user's own price", () => {
    const rows = [
      row({ sellerName: "Elle girildi", price: 2499 }),
      row({ sellerName: "Benim Ürünüm", price: 2499 }),
      row({ sellerName: "Kendi Mağazam", price: 2499 }),
    ];
    expect(classifyOwnPriceHistory(rows, { competitorPoints: [], ownSellerNames: [] })).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("treats rows written by the own-price scrape (previousPrice/priceChange set) as own", () => {
    const rows = [
      row({ sellerName: "Bambaşka Mağaza", previousPrice: 90, priceChange: 10 }),
      row({ sellerName: "Bambaşka Mağaza", previousPrice: 0, priceChange: null }),
    ];
    expect(classifyOwnPriceHistory(rows, { competitorPoints: [], ownSellerNames: [] })).toEqual([
      true,
      true,
    ]);
  });

  it("matches the own seller / marketplace display name, not the enum key", () => {
    const rows = [
      row({ sellerName: "Amazon TR" }),
      row({ sellerName: "QA Satıcı" }),
      row({ sellerName: null }),
      row({ sellerName: "Hepsiburada" }),
    ];
    const result = classifyOwnPriceHistory(rows, {
      competitorPoints: [],
      ownSellerNames: ["QA Satıcı", "Amazon TR"],
    });
    expect(result).toEqual([true, true, true, false]);
  });

  it("compares seller names case-insensitively with Turkish casing rules", () => {
    const rows = [row({ sellerName: "İTOPYA" }), row({ sellerName: "KIRTASİYE DÜNYASI" })];
    const result = classifyOwnPriceHistory(rows, {
      competitorPoints: [],
      ownSellerNames: ["İtopya", "Kırtasiye Dünyası"],
    });
    expect(result).toEqual([true, true]);
  });

  it("classifies a same-marketplace competitor as a competitor via its competitor_prices twin", () => {
    const rows = [
      // Trendyol'daki başka satıcı — sellerName pazaryeri adı olarak yazılır.
      row({ sellerName: "Trendyol", price: 5299, scrapedAt: T1 }),
      // Kendi fiyat (Serper kurtarma yolu) — aynı ad, ikizi yok.
      row({ sellerName: "Trendyol", price: 5499, scrapedAt: T2 }),
    ];
    const result = classifyOwnPriceHistory(rows, {
      competitorPoints: [{ price: "5299.00", scrapedAt: T1 }],
      ownSellerNames: ["Trendyol"],
    });
    expect(result).toEqual([false, true]);
  });

  it("keeps the own row when a competitor has the same price at the same moment", () => {
    const rows = [
      row({ sellerName: "Trendyol", price: 5499, scrapedAt: T1 }),
      row({ sellerName: "Hepsiburada", price: 5499, scrapedAt: T1 }),
    ];
    const result = classifyOwnPriceHistory(rows, {
      competitorPoints: [{ price: 5499, scrapedAt: T1 }],
      ownSellerNames: ["Trendyol"],
    });
    expect(result).toEqual([true, false]);
  });

  it("leaves orphan rows of deleted competitors as competitors", () => {
    const rows = [row({ sellerName: "N11", price: 11 }), row({ sellerName: "Rakip", price: 12 })];
    const result = classifyOwnPriceHistory(rows, {
      competitorPoints: [],
      ownSellerNames: ["Trendyol", "Philips Türkiye"],
    });
    expect(result).toEqual([false, false]);
  });

  it("does not let one twin mark several rows as competitors", () => {
    const rows = [
      row({ sellerName: "Trendyol", price: 100, scrapedAt: T1 }),
      row({ sellerName: "Trendyol", price: 100, scrapedAt: T1 }),
    ];
    const result = classifyOwnPriceHistory(rows, {
      competitorPoints: [{ price: 100, scrapedAt: T1 }],
      ownSellerNames: ["Trendyol"],
    });
    expect(result.filter((own) => own)).toHaveLength(1);
    expect(result.filter((own) => !own)).toHaveLength(1);
  });
});
