import { describe, expect, it } from "vitest";

import { cleanOwnStoreNames, updateOwnStoreNamesSchema } from "@/lib/validation";

describe("own store names", () => {
  it("trims, collapses spaces and drops case-insensitive duplicates", () => {
    expect(cleanOwnStoreNames(["  Kumtel   Türkiye ", "KUMTEL TÜRKİYE", "Benim Mağazam"])).toEqual([
      "Kumtel Türkiye",
      "Benim Mağazam",
    ]);
  });

  it("validates length and count", () => {
    expect(updateOwnStoreNamesSchema.safeParse({ storeNames: ["A"] }).success).toBe(false);
    expect(updateOwnStoreNamesSchema.safeParse({ storeNames: ["x".repeat(81)] }).success).toBe(
      false,
    );
    expect(
      updateOwnStoreNamesSchema.safeParse({ storeNames: ["a1", "a2", "a3", "a4", "a5", "a6"] })
        .success,
    ).toBe(false);
    expect(updateOwnStoreNamesSchema.safeParse({ storeNames: [] }).success).toBe(true);
    expect(updateOwnStoreNamesSchema.safeParse({ storeNames: ["Kumtel Türkiye"] }).success).toBe(
      true,
    );
  });
});
