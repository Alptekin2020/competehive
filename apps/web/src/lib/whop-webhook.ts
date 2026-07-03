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
