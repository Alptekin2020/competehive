import { describe, expect, it } from "vitest";

import { isEffectivelyPaid, refreshAfterHoursFor } from "../utils/plan-cadence";

const now = new Date("2026-11-14T15:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe("plan cadence", () => {
  it("free users refresh daily", () => {
    const user = { plan: "FREE", planStatus: "ACTIVE", planExpiresAt: null };
    expect(isEffectivelyPaid(user, now)).toBe(false);
    expect(refreshAfterHoursFor(user, now)).toBe(24);
  });

  it("active paid users refresh every 6 hours", () => {
    for (const plan of ["STARTER", "PRO", "ENTERPRISE"]) {
      expect(
        refreshAfterHoursFor({ plan, planStatus: "ACTIVE", planExpiresAt: days(10) }, now),
      ).toBe(6);
    }
  });

  it("keeps paid cadence inside the 3-day renewal grace, drops it after", () => {
    const base = { plan: "PRO", planStatus: "ACTIVE" };
    expect(isEffectivelyPaid({ ...base, planExpiresAt: days(-2) }, now)).toBe(true);
    expect(isEffectivelyPaid({ ...base, planExpiresAt: days(-4) }, now)).toBe(false);
  });

  it("treats canceled or unknown plans as free", () => {
    expect(
      isEffectivelyPaid({ plan: "PRO", planStatus: "CANCELED", planExpiresAt: null }, now),
    ).toBe(false);
    expect(isEffectivelyPaid({ plan: null, planStatus: null, planExpiresAt: null }, now)).toBe(
      false,
    );
  });
});
