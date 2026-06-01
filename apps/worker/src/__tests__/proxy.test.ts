import { describe, it, expect } from "vitest";
import { getProxyConfig } from "../utils/proxy";

describe("getProxyConfig", () => {
  it("returns null when host or port is missing", () => {
    expect(getProxyConfig({})).toBeNull();
    expect(getProxyConfig({ PROXY_HOST: "p.example.com" })).toBeNull();
    expect(getProxyConfig({ PROXY_PORT: "8080" })).toBeNull();
  });

  it("returns null for a non-numeric / invalid port", () => {
    expect(getProxyConfig({ PROXY_HOST: "p.example.com", PROXY_PORT: "abc" })).toBeNull();
    expect(getProxyConfig({ PROXY_HOST: "p.example.com", PROXY_PORT: "0" })).toBeNull();
  });

  it("builds server + url without credentials", () => {
    const cfg = getProxyConfig({ PROXY_HOST: "p.example.com", PROXY_PORT: "8080" });
    expect(cfg).toEqual({
      server: "p.example.com:8080",
      url: "http://p.example.com:8080",
      username: undefined,
      password: undefined,
    });
  });

  it("includes URL-encoded credentials when provided", () => {
    const cfg = getProxyConfig({
      PROXY_HOST: "p.example.com",
      PROXY_PORT: "8080",
      PROXY_USER: "user@corp",
      PROXY_PASS: "p@ss:word",
    });
    expect(cfg?.server).toBe("p.example.com:8080");
    expect(cfg?.url).toBe("http://user%40corp:p%40ss%3Aword@p.example.com:8080");
    expect(cfg?.username).toBe("user@corp");
    expect(cfg?.password).toBe("p@ss:word");
  });
});
