import { describe, expect, it } from "vitest";

import { cleanOwnStores, parseOwnStores } from "@/lib/own-stores";
import { cleanOwnStoreNames, updateOwnStoresSchema } from "@/lib/validation";

describe("own store names", () => {
  it("trims, collapses spaces and drops case-insensitive duplicates", () => {
    expect(cleanOwnStoreNames(["  Kumtel   Türkiye ", "KUMTEL TÜRKİYE", "Benim Mağazam"])).toEqual([
      "Kumtel Türkiye",
      "Benim Mağazam",
    ]);
  });

  it("validates length and count", () => {
    expect(updateOwnStoresSchema.safeParse({ storeNames: ["A"] }).success).toBe(false);
    expect(updateOwnStoresSchema.safeParse({ storeNames: ["x".repeat(81)] }).success).toBe(false);
    expect(
      updateOwnStoresSchema.safeParse({ storeNames: ["a1", "a2", "a3", "a4", "a5", "a6"] }).success,
    ).toBe(false);
    expect(updateOwnStoresSchema.safeParse({ storeNames: [] }).success).toBe(true);
    expect(updateOwnStoresSchema.safeParse({}).success).toBe(false);
    expect(updateOwnStoresSchema.safeParse({ storeNames: ["Kumtel Türkiye"] }).success).toBe(true);
  });

  it("validates per-marketplace names (empty clears, 1 char rejected)", () => {
    expect(
      updateOwnStoresSchema.safeParse({ stores: { TRENDYOL: "Benim Mağazam", N11: "" } }).success,
    ).toBe(true);
    expect(updateOwnStoresSchema.safeParse({ stores: { TRENDYOL: "A" } }).success).toBe(false);
    expect(updateOwnStoresSchema.safeParse({ stores: { TRENDYOL: "x".repeat(81) } }).success).toBe(
      false,
    );
  });

  it("keeps only supported marketplaces and filled names", () => {
    expect(
      cleanOwnStores({ TRENDYOL: "  Benim   Mağazam ", N11: "", FOO: "Bar", HEPSIBURADA: "HB" }),
    ).toEqual({ TRENDYOL: "Benim Mağazam", HEPSIBURADA: "HB" });
    expect(parseOwnStores({ trendyol: " A ", x: 1 })).toEqual({ TRENDYOL: "A" });
  });
});
