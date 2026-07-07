import crypto from "crypto";
import { describe, it, expect } from "vitest";
import {
  isFreshWebhookTimestamp,
  isSupersededMembershipEvent,
  parseWhopTimestamp,
  verifyWhopSignature,
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

describe("verifyWhopSignature", () => {
  const SECRET = "ws_test_secret_123";
  const MSG_ID = "msg_abc";
  const TS = String(NOW_SEC);
  const BODY = JSON.stringify({ type: "membership.activated", data: { id: "mem_1" } });

  function sign(secret: string, id: string, ts: string, body: string): string {
    return crypto
      .createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(`${id}.${ts}.${body}`)
      .digest("base64");
  }

  it("accepts a valid v1 signature keyed with the raw secret string", () => {
    const sig = `v1,${sign(SECRET, MSG_ID, TS, BODY)}`;
    const result = verifyWhopSignature(BODY, MSG_ID, TS, sig, SECRET);
    expect(result.verified).toBe(true);
    expect(result.scheme).toBe("raw-utf8");
  });

  it("accepts a bare (unprefixed) signature token", () => {
    const sig = sign(SECRET, MSG_ID, TS, BODY);
    expect(verifyWhopSignature(BODY, MSG_ID, TS, sig, SECRET).verified).toBe(true);
  });

  it("accepts a valid signature among multiple space-separated tokens", () => {
    const good = `v1,${sign(SECRET, MSG_ID, TS, BODY)}`;
    const bad = `v1,${sign("ws_other", MSG_ID, TS, BODY)}`;
    expect(verifyWhopSignature(BODY, MSG_ID, TS, `${bad} ${good}`, SECRET).verified).toBe(true);
  });

  it("accepts the classic Standard Webhooks derivation (whsec_ + base64 key)", () => {
    const rawKey = crypto.randomBytes(24);
    const secret = `whsec_${rawKey.toString("base64")}`;
    const sig = `v1,${crypto
      .createHmac("sha256", rawKey)
      .update(`${MSG_ID}.${TS}.${BODY}`)
      .digest("base64")}`;
    const result = verifyWhopSignature(BODY, MSG_ID, TS, sig, secret);
    expect(result.verified).toBe(true);
    expect(result.scheme).toBe("b64-stripped");
  });

  it("rejects a signature over tampered content", () => {
    const sig = `v1,${sign(SECRET, MSG_ID, TS, BODY)}`;
    expect(verifyWhopSignature(BODY + "x", MSG_ID, TS, sig, SECRET).verified).toBe(false);
    expect(verifyWhopSignature(BODY, "msg_other", TS, sig, SECRET).verified).toBe(false);
    expect(verifyWhopSignature(BODY, MSG_ID, String(NOW_SEC + 1), sig, SECRET).verified).toBe(
      false,
    );
  });

  it("rejects a signature made with the wrong secret", () => {
    const sig = `v1,${sign("ws_wrong", MSG_ID, TS, BODY)}`;
    expect(verifyWhopSignature(BODY, MSG_ID, TS, sig, SECRET).verified).toBe(false);
  });

  it("rejects missing inputs without throwing", () => {
    expect(verifyWhopSignature("", MSG_ID, TS, "v1,abc", SECRET)).toEqual({
      verified: false,
      scheme: "missing-input",
    });
    expect(verifyWhopSignature(BODY, "", TS, "v1,abc", SECRET).verified).toBe(false);
    expect(verifyWhopSignature(BODY, MSG_ID, "", "v1,abc", SECRET).verified).toBe(false);
    expect(verifyWhopSignature(BODY, MSG_ID, TS, "", SECRET).verified).toBe(false);
    expect(verifyWhopSignature(BODY, MSG_ID, TS, "v1,abc", "").verified).toBe(false);
  });

  it("tolerates garbage signature tokens without throwing", () => {
    expect(verifyWhopSignature(BODY, MSG_ID, TS, "v1,!!!not-base64!!!", SECRET).verified).toBe(
      false,
    );
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
