import { describe, expect, it } from "vitest";

import { readMatchReview, readRejectedUrlKeys, shouldKeepAsCandidate } from "../utils/match-review";

describe("shouldKeepAsCandidate", () => {
  it("keeps only AI-scored near misses", () => {
    expect(shouldKeepAsCandidate({ isMatch: false, score: 60 })).toBe(true);
    expect(shouldKeepAsCandidate({ isMatch: false, score: 50 })).toBe(true);
    expect(shouldKeepAsCandidate({ isMatch: false, score: 49 })).toBe(false);
    expect(shouldKeepAsCandidate({ isMatch: false, score: 30 })).toBe(false);
    expect(shouldKeepAsCandidate({ isMatch: true, score: 85 })).toBe(false);
  });

  it("does not keep guesses made while the AI was unavailable", () => {
    expect(shouldKeepAsCandidate({ isMatch: false, score: 55, aiUnavailable: true })).toBe(false);
  });
});

describe("readRejectedUrlKeys", () => {
  it("normalizes stored URLs to competitor keys (tracking params ignored)", () => {
    const keys = readRejectedUrlKeys({
      rejectedCompetitorUrls: ["https://www.Trendyol.com/x/y-p-1?srsltid=abc&merchantId=5", 7, ""],
    });
    expect(keys).toEqual(new Set(["trendyol.com/x/y-p-1?merchantid=5"]));
  });

  it("returns an empty set for missing or malformed metadata", () => {
    expect(readRejectedUrlKeys(null).size).toBe(0);
    expect(readRejectedUrlKeys({ rejectedCompetitorUrls: "nope" }).size).toBe(0);
  });
});

describe("readMatchReview", () => {
  it("reads pending/confirmed only", () => {
    expect(readMatchReview({ review: "pending" })).toBe("pending");
    expect(readMatchReview({ review: "confirmed" })).toBe("confirmed");
    expect(readMatchReview({ brandMatch: true })).toBeNull();
    expect(readMatchReview(undefined)).toBeNull();
  });
});
