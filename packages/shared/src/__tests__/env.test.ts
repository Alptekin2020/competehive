import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { validateWebEnv, validateWorkerEnv } from "../env";

describe("validateWebEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    process.env.CLERK_SECRET_KEY = "sk_test_123";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_123";

    expect(() => validateWebEnv()).toThrow("DATABASE_URL");
  });

  it("should throw when CLERK_SECRET_KEY is missing", () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    delete process.env.CLERK_SECRET_KEY;
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_123";

    expect(() => validateWebEnv()).toThrow("CLERK_SECRET_KEY");
  });

  it("should pass with all required vars", () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.CLERK_SECRET_KEY = "sk_test_123";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_123";

    const env = validateWebEnv();
    expect(env.DATABASE_URL).toBe("postgresql://localhost/test");
    expect(["development", "production", "test"]).toContain(env.NODE_ENV);
  });

  it("should accept optional SMTP vars", () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.CLERK_SECRET_KEY = "sk_test_123";
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_123";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";

    const env = validateWebEnv();
    expect(env.SMTP_HOST).toBe("smtp.example.com");
    expect(env.SMTP_PORT).toBe(587);
  });
});

describe("validateWorkerEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should throw when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    expect(() => validateWorkerEnv()).toThrow("DATABASE_URL");
  });

  it("should pass with just DATABASE_URL", () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    const env = validateWorkerEnv();
    expect(env.DATABASE_URL).toBe("postgresql://localhost/test");
    expect(env.LOG_LEVEL).toBe("info"); // default
  });

  it("should accept custom LOG_LEVEL", () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.LOG_LEVEL = "debug";
    const env = validateWorkerEnv();
    expect(env.LOG_LEVEL).toBe("debug");
  });

  it("should reject invalid LOG_LEVEL", () => {
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.LOG_LEVEL = "verbose";
    expect(() => validateWorkerEnv()).toThrow();
  });
});
