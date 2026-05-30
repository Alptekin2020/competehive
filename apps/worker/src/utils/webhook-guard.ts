import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { isIP, type LookupFunction } from "node:net";

/**
 * True for loopback / private / link-local / CGNAT / unique-local / multicast /
 * reserved addresses (and anything that doesn't parse as a public IP). Used to
 * stop user-supplied webhook URLs from reaching internal/invalid targets (SSRF).
 */
export function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    // a >= 224 covers multicast (224.0.0.0/4) + reserved/broadcast (240.0.0.0/4).
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("ff")) return true; // multicast ff00::/8
    const firstGroup = lower.split(":")[0];
    // fe80::/10 (link-local) spans fe80–febf.
    if (firstGroup.startsWith("fe") && ["8", "9", "a", "b"].includes(firstGroup[2])) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true; // not a valid IP literal — treat as unsafe
}

// DNS lookup that rejects any resolved private/internal address. Used as the
// http(s) `lookup` option so the IP actually connected to is the one we
// validated — closing the DNS-rebinding (TOCTOU) gap a resolve-then-fetch
// check would otherwise leave open.
function validatingLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family: number,
  ) => void,
): void {
  dnsLookup(hostname, options, (err, address, family) => {
    if (err) return callback(err, address, family);
    const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (list.some((addr) => isPrivateIp(addr))) {
      const blocked = new Error("Webhook resolves to a private address") as NodeJS.ErrnoException;
      return callback(blocked, address, family);
    }
    callback(null, address, family);
  });
}

/**
 * POST a JSON body to a user-supplied webhook URL with SSRF protection
 * (http(s) only, no private/internal targets — validated at connection time)
 * and an inactivity timeout. Resolves with the HTTP status code. Redirects are
 * not followed (3xx is returned as-is), so they can't bounce to an internal host.
 */
export function postWebhookSafe(
  rawUrl: string,
  jsonBody: string,
  timeoutMs = 8000,
): Promise<number> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.reject(new Error("Invalid webhook URL"));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Promise.reject(new Error("Webhook URL must use http(s)"));
  }
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    return Promise.reject(new Error("Webhook host not allowed"));
  }
  if (isIP(host) && isPrivateIp(host)) {
    return Promise.reject(new Error("Webhook resolves to a private address"));
  }

  const mod = url.protocol === "https:" ? https : http;
  return new Promise<number>((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(jsonBody),
        },
        lookup: validatingLookup as unknown as LookupFunction,
        timeout: timeoutMs,
      },
      (res) => {
        res.resume(); // drain so the socket is freed
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Webhook request timed out")));
    req.on("error", reject);
    req.write(jsonBody);
    req.end();
  });
}
