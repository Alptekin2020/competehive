import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl, UnsafeUrlError } from "../utils/url-guard";

describe("assertPublicHttpUrl", () => {
  it.each([
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://localhost:3000/",
    "http://redis.railway.internal/",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "not a url",
  ])("rejects %s", async (url) => {
    await expect(assertPublicHttpUrl(url)).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it("accepts a public IP literal without a DNS lookup", async () => {
    await expect(assertPublicHttpUrl("https://1.1.1.1/")).resolves.toBeInstanceOf(URL);
  });
});
