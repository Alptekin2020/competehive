import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { REFRESH_STALE_AFTER_MS, isRefreshStale } from "../tracked-product-refresh";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60 * 1000);

describe("isRefreshStale", () => {
  it("is never stale when no refresh is open", () => {
    for (const refreshStatus of [null, "completed", "failed"]) {
      expect(
        isRefreshStale(
          { refreshStatus, refreshRequestedAt: minutesAgo(600), updatedAt: minutesAgo(600) },
          NOW,
        ),
      ).toBe(false);
    }
  });

  it("keeps a recently requested refresh open", () => {
    expect(
      isRefreshStale(
        { refreshStatus: "pending", refreshRequestedAt: minutesAgo(2), updatedAt: minutesAgo(2) },
        NOW,
      ),
    ).toBe(false);
  });

  it("times out a refresh the worker never picked up", () => {
    expect(
      isRefreshStale(
        { refreshStatus: "pending", refreshRequestedAt: minutesAgo(11), updatedAt: minutesAgo(11) },
        NOW,
      ),
    ).toBe(true);
    expect(REFRESH_STALE_AFTER_MS).toBe(10 * 60 * 1000);
  });

  it("uses the row's last update as progress (worker moved it to processing)", () => {
    expect(
      isRefreshStale(
        {
          refreshStatus: "processing",
          refreshRequestedAt: minutesAgo(30),
          updatedAt: minutesAgo(1),
        },
        NOW,
      ),
    ).toBe(false);
    expect(
      isRefreshStale(
        { refreshStatus: "processing", refreshRequestedAt: null, updatedAt: minutesAgo(45) },
        NOW,
      ),
    ).toBe(true);
  });
});
