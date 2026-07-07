import crypto from "crypto";

// ---- Standard Webhooks signature verification (Whop V1) ----
// Whop signs `${webhook-id}.${webhook-timestamp}.${rawBody}` with HMAC-SHA256
// and sends the signature in the `webhook-signature` header as a
// space-separated list of `v1,<base64>` tokens. The webhook secret looks like
// `ws_...`; the Whop docs hand that raw string to the SDK (wrapped in btoa),
// so the HMAC key is the raw secret string bytes. We also try the classic
// Standard Webhooks key derivations as a safety net and log which one matched.
function candidateKeys(secret: string): { name: string; key: Buffer }[] {
  const keys: { name: string; key: Buffer }[] = [];
  keys.push({ name: "raw-utf8", key: Buffer.from(secret, "utf8") });
  const stripped = secret.replace(/^ws_/, "").replace(/^whsec_/, "");
  try {
    keys.push({ name: "b64-stripped", key: Buffer.from(stripped, "base64") });
  } catch {
    // ignore non-base64 secret
  }
  try {
    keys.push({ name: "b64-full", key: Buffer.from(secret, "base64") });
  } catch {
    // ignore non-base64 secret
  }
  return keys;
}

export function verifyWhopSignature(
  rawBody: string,
  msgId: string,
  msgTimestamp: string,
  sigHeader: string,
  secret: string,
): { verified: boolean; scheme: string } {
  if (!rawBody || !msgId || !msgTimestamp || !sigHeader || !secret) {
    return { verified: false, scheme: "missing-input" };
  }
  const signedContent = msgId + "." + msgTimestamp + "." + rawBody;
  const passedSigs = sigHeader
    .split(" ")
    .map((token) => (token.includes(",") ? token.split(",")[1] : token))
    .filter(Boolean);

  for (const { name, key } of candidateKeys(secret)) {
    if (key.length === 0) continue;
    const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
    const expectedBuf = Buffer.from(expected, "base64");
    for (const sig of passedSigs) {
      let sigBuf: Buffer;
      try {
        sigBuf = Buffer.from(sig, "base64");
      } catch {
        continue;
      }
      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return { verified: true, scheme: name };
      }
    }
  }
  return { verified: false, scheme: "no-match" };
}

// Standard Webhooks replay protection for the Whop webhook. The signed
// `webhook-timestamp` header is Unix seconds; we reject messages whose
// timestamp is too far from now so a captured (validly signed) request can't
// be replayed indefinitely. Pure + injectable clock so it can be unit-tested.
export function isFreshWebhookTimestamp(
  timestampHeader: string,
  nowMs: number = Date.now(),
  toleranceSec: number = 300,
): boolean {
  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  const ageSec = Math.abs(nowMs / 1000 - ts);
  return ageSec <= toleranceSec;
}

// Whop timestamps arrive in mixed formats depending on the payload type: the
// SDK docs describe `renewal_period_end` as a Unix timestamp while webhook
// payloads have been observed with ISO 8601 strings. Accept both (plus Unix
// milliseconds) so a format drift on Whop's side can't silently break renewal
// expiry extension for paying customers.
export function parseWhopTimestamp(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Heuristic: values past ~year 33658 in seconds are really milliseconds.
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

// A termination event for a membership the user has already replaced (e.g.
// the canceled STARTER subscription after an upgrade to PRO) must not demote
// the user's current, still-paying plan.
export function isSupersededMembershipEvent(
  currentMembershipId: string | null | undefined,
  eventMembershipId: string | null | undefined,
): boolean {
  return Boolean(
    currentMembershipId && eventMembershipId && currentMembershipId !== eventMembershipId,
  );
}
