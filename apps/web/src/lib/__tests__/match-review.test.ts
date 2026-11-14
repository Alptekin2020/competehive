import { describe, expect, it } from "vitest";

import {
  addRejectedCompetitorUrl,
  MAX_REJECTED_URLS,
  readMatchReview,
  withMatchReview,
} from "../match-review";

describe("readMatchReview", () => {
  it("reads the review state and ignores anything else", () => {
    expect(readMatchReview({ review: "pending" })).toBe("pending");
    expect(readMatchReview({ review: "confirmed", brandMatch: true })).toBe("confirmed");
    expect(readMatchReview({ review: "other" })).toBeNull();
    expect(readMatchReview(null)).toBeNull();
    expect(readMatchReview("pending")).toBeNull();
  });
});

describe("withMatchReview", () => {
  it("keeps existing attributes", () => {
    expect(withMatchReview({ brandMatch: true, review: "pending" }, "confirmed")).toEqual({
      brandMatch: true,
      review: "confirmed",
    });
    expect(withMatchReview(null, "confirmed")).toEqual({ review: "confirmed" });
  });
});

describe("addRejectedCompetitorUrl", () => {
  it("appends without touching other metadata and without duplicates", () => {
    const first = addRejectedCompetitorUrl({ brand: "X" }, "https://a.com/p/1");
    expect(first).toEqual({ brand: "X", rejectedCompetitorUrls: ["https://a.com/p/1"] });
    const again = addRejectedCompetitorUrl(first, "https://a.com/p/1");
    expect(again.rejectedCompetitorUrls).toEqual(["https://a.com/p/1"]);
  });

  it("tolerates missing or malformed metadata", () => {
    expect(addRejectedCompetitorUrl(null, "u").rejectedCompetitorUrls).toEqual(["u"]);
    expect(
      addRejectedCompetitorUrl({ rejectedCompetitorUrls: "bad" }, "u").rejectedCompetitorUrls,
    ).toEqual(["u"]);
  });

  it("caps the list, dropping the oldest", () => {
    const full = {
      rejectedCompetitorUrls: Array.from({ length: MAX_REJECTED_URLS }, (_, i) => `u${i}`),
    };
    const next = addRejectedCompetitorUrl(full, "new").rejectedCompetitorUrls as string[];
    expect(next).toHaveLength(MAX_REJECTED_URLS);
    expect(next[0]).toBe("u1");
    expect(next.at(-1)).toBe("new");
  });
});
