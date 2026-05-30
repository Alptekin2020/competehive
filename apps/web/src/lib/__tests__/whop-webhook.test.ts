import { describe, it, expect } from "vitest";
import { isFreshWebhookTimestamp } from "../whop-webhook";

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
