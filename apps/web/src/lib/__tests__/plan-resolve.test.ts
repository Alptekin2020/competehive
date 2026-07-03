import { describe, it, expect } from "vitest";
import { resolveEffectivePlan, FREE_PLAN_LIMITS } from "../plan-resolve";

const NOW = new Date("2026-06-01T00:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");

describe("resolveEffectivePlan", () => {
  it("treats a brand-new FREE user as a real, usable tier (5 products)", () => {
    const info = resolveEffectivePlan({ plan: "FREE", planStatus: null, planExpiresAt: null }, NOW);
    expect(info.plan).toBe("FREE");
    expect(info.isPaid).toBe(false);
    expect(info.hasActivePlan).toBe(true);
    expect(info.maxProducts).toBe(FREE_PLAN_LIMITS.maxProducts);
    expect(info.maxProducts).toBe(5);
  });

  it("falls back to FREE when there is no user row", () => {
    const info = resolveEffectivePlan(null, NOW);
    expect(info.plan).toBe("FREE");
    expect(info.maxProducts).toBe(5);
    expect(info.isPaid).toBe(false);
  });

  it("grants paid limits for an active, non-expired paid tier", () => {
    const info = resolveEffectivePlan(
      { plan: "PRO", planStatus: "ACTIVE", planExpiresAt: FUTURE },
      NOW,
    );
    expect(info.plan).toBe("PRO");
    expect(info.isPaid).toBe(true);
    expect(info.maxProducts).toBe(500);
  });

  it("downgrades an expired paid tier to FREE limits", () => {
    const info = resolveEffectivePlan(
      { plan: "PRO", planStatus: "ACTIVE", planExpiresAt: PAST },
      NOW,
    );
    expect(info.plan).toBe("FREE");
    expect(info.isPaid).toBe(false);
    expect(info.maxProducts).toBe(5);
  });

  it("downgrades a non-ACTIVE paid tier to FREE limits", () => {
    const info = resolveEffectivePlan(
      { plan: "STARTER", planStatus: "EXPIRED", planExpiresAt: FUTURE },
      NOW,
    );
    expect(info.plan).toBe("FREE");
    expect(info.isPaid).toBe(false);
    expect(info.maxProducts).toBe(5);
  });

  it("does not require an expiry date for an active paid tier", () => {
    const info = resolveEffectivePlan(
      { plan: "ENTERPRISE", planStatus: "ACTIVE", planExpiresAt: null },
      NOW,
    );
    expect(info.isPaid).toBe(true);
    expect(info.maxProducts).toBe(99999);
  });

  it("keeps paid limits within the expiry grace window (late renewal webhook)", () => {
    const justExpired = new Date(NOW.getTime() - 24 * 60 * 60 * 1000); // 1 gün önce
    const info = resolveEffectivePlan(
      { plan: "PRO", planStatus: "ACTIVE", planExpiresAt: justExpired },
      NOW,
    );
    expect(info.plan).toBe("PRO");
    expect(info.isPaid).toBe(true);
  });

  it("downgrades once the expiry grace window has passed", () => {
    const wellPastGrace = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000); // 4 gün önce
    const info = resolveEffectivePlan(
      { plan: "PRO", planStatus: "ACTIVE", planExpiresAt: wellPastGrace },
      NOW,
    );
    expect(info.plan).toBe("FREE");
    expect(info.isPaid).toBe(false);
  });

  it("ignores the grace window for explicit terminations (non-ACTIVE status)", () => {
    const info = resolveEffectivePlan(
      { plan: "PRO", planStatus: "EXPIRED", planExpiresAt: FUTURE },
      NOW,
    );
    expect(info.plan).toBe("FREE");
  });
});
