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
