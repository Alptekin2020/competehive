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

  describe("Whop half-configuration guard (production)", () => {
    function setProductionBase() {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL = "postgresql://localhost/test";
      process.env.CLERK_SECRET_KEY = "sk_test_123";
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_123";
      for (const key of Object.keys(process.env)) {
        if (key.includes("WHOP")) delete process.env[key];
      }
    }

    it("throws when a plan ID is set but the tier's product ID is missing", () => {
      setProductionBase();
      process.env.NEXT_PUBLIC_WHOP_STARTER_PLAN_ID = "plan_123";
      process.env.WHOP_API_KEY = "key";
      process.env.WHOP_WEBHOOK_SECRET = "ws_secret";

      expect(() => validateWebEnv()).toThrow("WHOP_STARTER_PRODUCT_ID");
    });

    it("throws when plan IDs are set but WHOP_API_KEY / WHOP_WEBHOOK_SECRET are missing", () => {
      setProductionBase();
      process.env.WHOP_PRO_PLAN_ID = "plan_123";
      process.env.WHOP_PRO_PRODUCT_ID = "prod_123";

      expect(() => validateWebEnv()).toThrow("WHOP_API_KEY");
      process.env.WHOP_API_KEY = "key";
      expect(() => validateWebEnv()).toThrow("WHOP_WEBHOOK_SECRET");
    });

    it("also guards yearly-only plan IDs", () => {
      setProductionBase();
      process.env.WHOP_ENTERPRISE_YEARLY_PLAN_ID = "plan_123";
      process.env.WHOP_API_KEY = "key";
      process.env.WHOP_WEBHOOK_SECRET = "ws_secret";

      expect(() => validateWebEnv()).toThrow("WHOP_ENTERPRISE_PRODUCT_ID");
    });

    it("passes with a fully configured tier", () => {
      setProductionBase();
      process.env.WHOP_STARTER_PLAN_ID = "plan_123";
      process.env.WHOP_STARTER_PRODUCT_ID = "prod_123";
      process.env.WHOP_API_KEY = "key";
      process.env.WHOP_WEBHOOK_SECRET = "ws_secret";

      expect(() => validateWebEnv()).not.toThrow();
    });

    it("passes when Whop is entirely unconfigured", () => {
      setProductionBase();
      expect(() => validateWebEnv()).not.toThrow();
    });

    it("does not enforce outside production", () => {
      setProductionBase();
      process.env.NODE_ENV = "development";
      process.env.NEXT_PUBLIC_WHOP_STARTER_PLAN_ID = "plan_123";
      expect(() => validateWebEnv()).not.toThrow();
    });
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
