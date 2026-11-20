import { describe, expect, it } from "vitest";

import type { ScrapedProduct } from "../scrapers";
import {
  applyOwnStore,
  hasAnyOwnStore,
  isOwnStoreName,
  normalizeStoreName,
  ownStoreNamesFor,
  parseOwnStores,
  shouldRetireOwnStoreRow,
} from "../utils/own-store";

const base: ScrapedProduct = {
  name: "Kumtel LX-6331 Fanlı Isıtıcı",
  price: 1043.33,
  currency: "TRY",
  inStock: true,
  sellerName: "Kumtel",
  pageSeller: { merchantId: "959ab87e", sellerName: "Kumtel Türkiye" },
  otherSellers: [
    { merchantId: "1d59", sellerName: "PORGATECH", price: 989.9 },
    { merchantId: "aa11", sellerName: "Benim Mağazam A.Ş.", price: 1010 },
  ],
};

describe("normalizeStoreName", () => {
  it("folds Turkish case, spaces and punctuation", () => {
    expect(normalizeStoreName("KUMTEL TÜRKİYE")).toBe(normalizeStoreName("kumtel türkiye"));
    expect(normalizeStoreName("Benim  Mağazam A.Ş.")).toBe("benimmağazamaş");
    expect(isOwnStoreName("benim mağazam aş", ["Benim Mağazam A.Ş."])).toBe(true);
    // Tam eşleşme: kısmi ad başka mağazayı kapsamaz.
    expect(isOwnStoreName("Kumtel Türkiye", ["Kumtel"])).toBe(false);
    expect(isOwnStoreName("", ["Kumtel"])).toBe(false);
  });
});

describe("applyOwnStore", () => {
  it("does nothing without store names", () => {
    const r = applyOwnStore(base, []);
    expect(r.outcome).toBe("none");
    expect(r.product).toBe(base);
  });

  it("reads the own price from the listing and makes the shown seller a rival", () => {
    const r = applyOwnStore(base, ["benim mağazam a.ş."]);
    expect(r.outcome).toBe("own-from-list");
    expect(r.product.price).toBe(1010);
    expect(r.product.sellerName).toBe("Benim Mağazam A.Ş.");
    expect(r.product.otherSellers).toEqual([
      { merchantId: "959ab87e", sellerName: "Kumtel Türkiye", price: 1043.33 },
      { merchantId: "1d59", sellerName: "PORGATECH", price: 989.9 },
    ]);
  });

  it("keeps the page price when the shown seller is the user", () => {
    const r = applyOwnStore(base, ["KUMTEL TÜRKİYE", "Benim Mağazam A.Ş."]);
    expect(r.outcome).toBe("page-is-own");
    expect(r.product.price).toBe(1043.33);
    // İkinci mağazası da rakip sayılmaz.
    expect(r.product.otherSellers?.map((s) => s.sellerName)).toEqual(["PORGATECH"]);
  });

  it("keeps the page price when the user's store is not on the listing", () => {
    const r = applyOwnStore(base, ["Başka Mağaza"]);
    expect(r.outcome).toBe("not-listed");
    expect(r.product.price).toBe(1043.33);
    expect(r.product.otherSellers).toHaveLength(2);
  });

  it("only drops own entries when the page seller is unknown", () => {
    const r = applyOwnStore({ ...base, pageSeller: undefined }, ["Benim Mağazam A.Ş."]);
    expect(r.outcome).toBe("none");
    expect(r.product.price).toBe(1043.33);
    expect(r.product.otherSellers?.map((s) => s.sellerName)).toEqual(["PORGATECH"]);
  });
});

describe("shouldRetireOwnStoreRow", () => {
  const own = ["Benim Mağazam"];
  it("retires automated rows that show the user's store", () => {
    expect(
      shouldRetireOwnStoreRow(
        {
          competitorName: "Benim Mağazam",
          matchScore: 100,
          matchAttributes: { sameListing: true },
        },
        own,
      ),
    ).toBe(true);
    expect(
      shouldRetireOwnStoreRow(
        {
          competitorName: "Google ürünü",
          matchScore: 88,
          matchAttributes: { seller: "benim mağazam" },
        },
        own,
      ),
    ).toBe(true);
  });

  it("never touches manual, confirmed, already dead or other rows", () => {
    expect(
      shouldRetireOwnStoreRow(
        { competitorName: "Benim Mağazam", matchScore: null, matchAttributes: {} },
        own,
      ),
    ).toBe(false);
    expect(
      shouldRetireOwnStoreRow(
        {
          competitorName: "Benim Mağazam",
          matchScore: 100,
          matchAttributes: { review: "confirmed" },
        },
        own,
      ),
    ).toBe(false);
    expect(
      shouldRetireOwnStoreRow(
        {
          competitorName: "Benim Mağazam",
          matchScore: 90,
          matchAttributes: { deadAt: "2026-11-19T00:00:00Z" },
        },
        own,
      ),
    ).toBe(false);
    expect(
      shouldRetireOwnStoreRow(
        { competitorName: "PORGATECH", matchScore: 100, matchAttributes: {} },
        own,
      ),
    ).toBe(false);
  });
});

describe("per-marketplace store names", () => {
  const stores = { TRENDYOL: "Benim Trendyol", hepsiburada: " HB Mağazam ", N11: "", X: 5 };

  it("reads only filled string values, keys upper-cased", () => {
    expect(parseOwnStores(stores)).toEqual({
      TRENDYOL: "Benim Trendyol",
      HEPSIBURADA: "HB Mağazam",
    });
    expect(parseOwnStores(null)).toEqual({});
    expect(parseOwnStores(["a"])).toEqual({});
  });

  it("uses the marketplace's own name, else the all-marketplaces list", () => {
    expect(ownStoreNamesFor("TRENDYOL", stores, ["Genel"])).toEqual(["Benim Trendyol"]);
    expect(ownStoreNamesFor("HEPSIBURADA", stores, [])).toEqual(["HB Mağazam"]);
    expect(ownStoreNamesFor("N11", stores, ["Genel"])).toEqual(["Genel"]);
    expect(ownStoreNamesFor("AMAZON_TR", {}, [])).toEqual([]);
    expect(ownStoreNamesFor(null, stores, ["Genel"])).toEqual(["Genel"]);
  });

  it("a Trendyol name never marks a Hepsiburada seller as own", () => {
    const hb = applyOwnStore(
      { ...base, otherSellers: [{ merchantId: "t1", sellerName: "Benim Trendyol", price: 900 }] },
      ownStoreNamesFor("HEPSIBURADA", { TRENDYOL: "Benim Trendyol" }, []),
    );
    expect(hb.outcome).toBe("none");
    expect(hb.product.price).toBe(1043.33);
  });

  it("knows when the user has any store name", () => {
    expect(hasAnyOwnStore({}, [])).toBe(false);
    expect(hasAnyOwnStore({ N11: "x" }, [])).toBe(true);
    expect(hasAnyOwnStore({}, ["Genel"])).toBe(true);
  });
});
