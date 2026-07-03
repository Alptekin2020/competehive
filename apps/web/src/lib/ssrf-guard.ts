import { lookup } from "node:dns/promises";
import net from "node:net";

// SSRF koruması: kullanıcıdan gelen URL'ler sunucu tarafında fetch edilir
// (ürün/rakip scrape). Koruma olmadan giriş yapmış herhangi bir kullanıcı
// sunucuya iç ağ adreslerini (169.254.169.254 metadata servisi, localhost,
// RFC1918) çektirebilir. Hem doğrudan IP literal'leri hem DNS'in özel IP'ye
// çözülmesi engellenir; yönlendirmeler scraper tarafında her sıçramada
// yeniden doğrulanır.

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true; // this-net, RFC1918, loopback
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 169 && b === 254) return true; // link-local + bulut metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (kind === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true; // loopback
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    // IPv4-mapped (::ffff:a.b.c.d) — gömülü IPv4'ü kontrol et
    const v4 = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4) return isPrivateIp(v4[1]);
    return false;
  }
  return false;
}

/**
 * URL'nin dış ağa açık bir http(s) hedefi olduğunu doğrular; değilse throw.
 * DNS çözümlemesindeki TÜM adresler kontrol edilir (round-robin'de tek bir
 * özel IP bile reddetme sebebidir).
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Geçersiz URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Yalnızca http/https destekleniyor");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("Bu adres erişime kapalı");
  }
  // Köşeli parantezli IPv6 literal'i (URL.hostname "[...]" döndürür)
  const bareHost = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bareHost)) {
    if (isPrivateIp(bareHost)) throw new Error("Bu adres erişime kapalı");
    return url;
  }
  let addresses;
  try {
    addresses = await lookup(bareHost, { all: true });
  } catch {
    throw new Error("Alan adı çözümlenemedi");
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error("Bu adres erişime kapalı");
  }
  return url;
}
