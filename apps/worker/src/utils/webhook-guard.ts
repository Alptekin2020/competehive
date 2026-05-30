import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * True for loopback / private / link-local / CGNAT / unique-local addresses
 * (and anything that doesn't parse as a public IP). Used to stop user-supplied
 * webhook URLs from reaching internal services (SSRF).
 */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP literal — treat as unsafe
}

/**
 * Reject webhook URLs that aren't http(s) or that resolve to a private/internal
 * address, so a malicious or misconfigured webhook can't be used for SSRF.
 */
export async function assertSafeWebhookUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid webhook URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Webhook URL must use http(s)");
  }
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Webhook host not allowed");
  }
  // If the host is already an IP literal, check it directly; otherwise resolve.
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Webhook resolves to a private address");
    return;
  }
  const results = await lookup(host, { all: true });
  if (results.length === 0) throw new Error("Webhook host did not resolve");
  for (const { address } of results) {
    if (isPrivateIp(address)) throw new Error("Webhook resolves to a private address");
  }
}
