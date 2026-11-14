import { describe, expect, it } from "vitest";

import { DISCOVERY_INTERVAL_MS, pickDueForDiscovery } from "../utils/discovery-schedule";

// Prod (14 Kasım): 6 saatlik fiyat turu refreshCompletedAt'i her üründe
// yenilediği için keşif "vakti gelen ürün yok" diyordu. Keşif artık kendi
// saatine bakar; fiyat turunun ne zaman çalıştığı sonucu etkilemez.
describe("pickDueForDiscovery", () => {
  const now = 1_800_000_000_000;
  const products = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("picks never-discovered products first, then the longest waiting", () => {
    const lastRuns = new Map<string, number | null>([
      ["a", now - 7 * 60 * 60 * 1000],
      ["b", null],
      ["c", now - 9 * 60 * 60 * 1000],
      ["d", now - 60 * 60 * 1000],
    ]);
    expect(pickDueForDiscovery(products, lastRuns, now, 10).map((p) => p.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("respects the batch size and skips recently discovered products", () => {
    const lastRuns = new Map<string, number | null>([
      ["a", null],
      ["b", null],
      ["c", null],
      ["d", now - DISCOVERY_INTERVAL_MS + 1000],
    ]);
    expect(pickDueForDiscovery(products, lastRuns, now, 2)).toHaveLength(2);
    expect(pickDueForDiscovery(products, lastRuns, now, 10).some((p) => p.id === "d")).toBe(false);
  });

  it("treats a timestamp from the future as due", () => {
    const lastRuns = new Map<string, number | null>([["a", now + 60_000]]);
    expect(pickDueForDiscovery([{ id: "a" }], lastRuns, now, 10)).toHaveLength(1);
  });
});
