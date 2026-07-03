import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

// SSRF koruması: kullanıcıdan gelen URL'ler sunucu tarafında fetch edilir
// (ürün/rakip scrape, bildirim webhook'u). Koruma olmadan giriş yapmış
// herhangi bir kullanıcı sunucuya iç ağ adreslerini (169.254.169.254 metadata
// servisi, localhost, RFC1918) çektirebilir.
//
// İki katmanlı savunma:
//  1) assertPublicHttpUrl — istek ÖNCESİ protokol/hostname/DNS doğrulaması
//     (her yönlendirme sıçramasında yeniden çağrılır).
//  2) ssrfDispatcher — BAĞLANTI anında DNS çözümlemesini yeniden doğrular;
//     düşük TTL'li bir alan adının önce genel, sonra özel IP döndürmesiyle
//     (DNS rebinding / TOCTOU) korumayı atlatmasını engeller.

// Özel/ayrılmış IP aralıkları. net.BlockList, IPv6'nın tüm gösterimlerini
// (tam yazım, sıfır dolgulu, IPv4-mapped hex) normalize ederek kontrol eder —
// elle regex yazmaktan güvenli.
const blockList = new net.BlockList();
// IPv4
blockList.addSubnet("0.0.0.0", 8, "ipv4"); // "this" network
blockList.addSubnet("10.0.0.0", 8, "ipv4"); // RFC1918
blockList.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blockList.addSubnet("169.254.0.0", 16, "ipv4"); // link-local + bulut metadata
blockList.addSubnet("172.16.0.0", 12, "ipv4"); // RFC1918
blockList.addSubnet("192.168.0.0", 16, "ipv4"); // RFC1918
blockList.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
blockList.addSubnet("192.0.0.0", 24, "ipv4"); // IETF protocol assignments
blockList.addSubnet("192.0.2.0", 24, "ipv4"); // TEST-NET-1
blockList.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blockList.addSubnet("240.0.0.0", 4, "ipv4"); // reserved
// IPv6
blockList.addAddress("::", "ipv6"); // unspecified
blockList.addAddress("::1", "ipv6"); // loopback
blockList.addSubnet("fe80::", 10, "ipv6"); // link-local
blockList.addSubnet("fc00::", 7, "ipv6"); // unique-local
// NOT: ::ffff:0:0/96 (IPv4-mapped) bilinçli EKLENMEDİ — net.BlockList bu IPv6
// subnet'ini ham IPv4 kontrolüne de yansıtıp TÜM IPv4'ü bloklardı. Bunun
// yerine IPv4-mapped adresler aşağıda gömülü IPv4 çıkarılıp IPv4 kurallarıyla
// değerlendirilir (yalnızca özel gömülü IPv4 bloklanır).

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return blockList.check(ip, "ipv4");
  if (kind === 6) {
    if (blockList.check(ip, "ipv6")) return true;
    // IPv4-mapped (::ffff:a.b.c.d) — gömülü IPv4'ü ayrıca IPv4 kurallarıyla dene.
    const v4 = ip.toLowerCase().match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4 && net.isIP(v4[1]) === 4) return blockList.check(v4[1], "ipv4");
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

// Bağlantı anında DNS çözümlemesini doğrulayan undici dispatcher. Aynı
// çözümleme hem doğrulamada hem bağlantıda kullanıldığı için DNS rebinding
// (TOCTOU) penceresi kapanır: özel IP'ye çözülen bir host bağlantı anında
// reddedilir. fetch(url, { dispatcher: ssrfDispatcher }) ile kullanılır.
export const ssrfDispatcher = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (err, resolved) => {
        if (err) {
          callback(err, "", 0);
          return;
        }
        const list = Array.isArray(resolved)
          ? resolved
          : [{ address: resolved as unknown as string, family: 4 }];
        for (const entry of list) {
          if (isPrivateIp(entry.address)) {
            callback(new Error("Bu adres erişime kapalı"), "", 0);
            return;
          }
        }
        // options.all=false çağrılarında ilk adresi döndür; true ise listeyi.
        if (options && (options as { all?: boolean }).all) {
          callback(null, list as never, 0 as never);
        } else {
          callback(null, list[0].address, list[0].family);
        }
      });
    },
  },
});
