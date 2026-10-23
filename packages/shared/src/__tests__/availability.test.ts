import { describe, it, expect } from "vitest";

import { parseAvailability } from "../availability";

describe("parseAvailability", () => {
  it.each([
    "https://schema.org/InStock",
    "http://schema.org/InStock",
    "InStock",
    "in stock",
    "in_stock",
    "LimitedAvailability",
    "PreOrder",
    "BackOrder",
  ])("reads %s as in stock", (value) => {
    expect(parseAvailability(value)).toBe(true);
  });

  it.each([
    "https://schema.org/OutOfStock",
    "out of stock",
    "out_of_stock",
    "SoldOut",
    "Discontinued",
  ])("reads %s as out of stock", (value) => {
    expect(parseAvailability(value)).toBe(false);
  });

  it("returns null for missing or unknown values", () => {
    expect(parseAvailability(null)).toBeNull();
    expect(parseAvailability("")).toBeNull();
    expect(parseAvailability("Gelince Haber Ver")).toBeNull();
  });
});
