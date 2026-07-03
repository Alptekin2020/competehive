import { describe, it, expect } from "vitest";
import {
  isFreshWebhookTimestamp,
  isSupersededMembershipEvent,
  parseWhopTimestamp,
} from "../whop-webhook";

const NOW_SEC = 1_700_000_000;
const NOW_MS = NOW_SEC * 1000;

describe("isFreshWebhookTimestamp", () => {
  it("accepts a current timestamp", () => {
    expect(isFreshWebhookTimestamp(String(NOW_SEC), NOW_MS)).toBe(true);
  });

  it("accepts timestamps within the tolerance window", () => {
    expect(isFreshWebhookTimestamp(String(NOW_SEC - 299), NOW_MS)).toBe(true);
    expect(isFreshWebhookTimestamp(String(NOW_SEC + 299), NOW_MS)).toBe(true);
  });

  it("rejects timestamps older than the tolerance (replayed)", () => {
    expect(isFreshWebhookTimestamp(String(NOW_SEC - 301), NOW_MS)).toBe(false);
    expect(isFreshWebhookTimestamp(String(NOW_SEC - 3600), NOW_MS)).toBe(false);
  });

  it("rejects timestamps too far in the future", () => {
    expect(isFreshWebhookTimestamp(String(NOW_SEC + 3600), NOW_MS)).toBe(false);
  });

  it("rejects invalid / empty / non-numeric timestamps", () => {
    expect(isFreshWebhookTimestamp("", NOW_MS)).toBe(false);
    expect(isFreshWebhookTimestamp("not-a-number", NOW_MS)).toBe(false);
    expect(isFreshWebhookTimestamp("0", NOW_MS)).toBe(false);
    expect(isFreshWebhookTimestamp("-5", NOW_MS)).toBe(false);
  });

  it("honors a custom tolerance", () => {
    expect(isFreshWebhookTimestamp(String(NOW_SEC - 30), NOW_MS, 10)).toBe(false);
    expect(isFreshWebhookTimestamp(String(NOW_SEC - 5), NOW_MS, 10)).toBe(true);
  });
});

describe("parseWhopTimestamp", () => {
  it("parses ISO 8601 strings", () => {
    expect(parseWhopTimestamp("2026-07-01T00:00:00Z")?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
  });

  it("parses Unix seconds (number and numeric string)", () => {
    const expected = new Date(NOW_SEC * 1000).toISOString();
    expect(parseWhopTimestamp(NOW_SEC)?.toISOString()).toBe(expected);
    expect(parseWhopTimestamp(String(NOW_SEC))?.toISOString()).toBe(expected);
  });

  it("parses Unix milliseconds", () => {
    expect(parseWhopTimestamp(NOW_MS)?.toISOString()).toBe(new Date(NOW_MS).toISOString());
  });

  it("returns null for empty/invalid values", () => {
    expect(parseWhopTimestamp(null)).toBeNull();
    expect(parseWhopTimestamp(undefined)).toBeNull();
    expect(parseWhopTimestamp("")).toBeNull();
    expect(parseWhopTimestamp("not-a-date")).toBeNull();
    expect(parseWhopTimestamp(0)).toBeNull();
    expect(parseWhopTimestamp(-5)).toBeNull();
  });
});

describe("isSupersededMembershipEvent", () => {
  it("flags an event for a different membership than the user's current one", () => {
    expect(isSupersededMembershipEvent("mem_new", "mem_old")).toBe(true);
  });

  it("does not flag the user's current membership", () => {
    expect(isSupersededMembershipEvent("mem_a", "mem_a")).toBe(false);
  });

  it("does not flag when either side is unknown (fail open to legacy behavior)", () => {
    expect(isSupersededMembershipEvent(null, "mem_a")).toBe(false);
    expect(isSupersededMembershipEvent("mem_a", null)).toBe(false);
    expect(isSupersededMembershipEvent(undefined, undefined)).toBe(false);
  });
});
