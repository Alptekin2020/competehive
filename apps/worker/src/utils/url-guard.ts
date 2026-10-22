import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { isPrivateIp } from "./webhook-guard";

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];

export class UnsafeUrlError extends Error {}

/**
 * Throws UnsafeUrlError unless the URL is http(s) and its host resolves only
 * to public addresses. Used before fetching user-supplied independent-store
 * URLs (CUSTOM/SHOPIFY): unlike marketplace URLs these can point anywhere,
 * including localhost or the cloud metadata service. Called again on every
 * redirect hop. Mirrors apps/web/src/lib/ssrf-guard.ts (the worker's Docker
 * build cannot import web code).
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http(s) URLs are allowed");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || BLOCKED_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeUrlError("Host not allowed");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("Host resolves to a private address");
    return url;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError("Host could not be resolved");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new UnsafeUrlError("Host resolves to a private address");
  }
  return url;
}
