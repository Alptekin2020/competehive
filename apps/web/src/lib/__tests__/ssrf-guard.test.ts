import { describe, it, expect } from "vitest";
import { isPrivateIp, assertPublicHttpUrl } from "../ssrf-guard";

describe("isPrivateIp", () => {
  it("özel/ayrılmış IPv4 aralıklarını yakalar", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("172.31.255.255")).toBe(true);
    expect(isPrivateIp("192.168.1.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true); // bulut metadata
    expect(isPrivateIp("100.64.0.1")).toBe(true); // CGNAT
    expect(isPrivateIp("0.0.0.0")).toBe(true);
    expect(isPrivateIp("224.0.0.1")).toBe(true); // multicast
  });

  it("genel IPv4 adreslerini geçirir", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(isPrivateIp("104.16.0.1")).toBe(false);
    expect(isPrivateIp("172.32.0.1")).toBe(false); // RFC1918 dışı
    expect(isPrivateIp("100.128.0.1")).toBe(false); // CGNAT dışı
  });

  it("özel IPv6 adreslerini tüm gösterimleriyle yakalar", () => {
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("0:0:0:0:0:0:0:1")).toBe(true); // loopback tam yazım
    expect(isPrivateIp("::")).toBe(true); // unspecified
    expect(isPrivateIp("fe80::1")).toBe(true);
    expect(isPrivateIp("fe81::1")).toBe(true); // link-local aralığı içi
    expect(isPrivateIp("febf::1")).toBe(true); // link-local aralığı sınırı
    expect(isPrivateIp("fc00::1")).toBe(true); // unique-local
    expect(isPrivateIp("fd12:3456::1")).toBe(true); // unique-local
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true); // mapped v4 loopback
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true); // mapped v4 metadata
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false); // mapped v4 public
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false); // genel IPv6 (Google DNS)
  });
});

describe("assertPublicHttpUrl", () => {
  it("http dışı protokolleri reddeder", async () => {
    await expect(assertPublicHttpUrl("ftp://example.com/x")).rejects.toThrow();
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow();
  });

  it("localhost ve iç hostname'leri reddeder", async () => {
    await expect(assertPublicHttpUrl("http://localhost:3000/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://foo.internal/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://metadata.google.internal/")).rejects.toThrow();
  });

  it("özel IP literal'lerini reddeder", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://127.0.0.1:6379/")).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://[::1]/")).rejects.toThrow();
  });

  it("geçersiz URL'yi reddeder", async () => {
    await expect(assertPublicHttpUrl("not-a-url")).rejects.toThrow("Geçersiz URL");
  });
});
