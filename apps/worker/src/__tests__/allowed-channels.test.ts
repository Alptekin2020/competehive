import { describe, it, expect } from "vitest";
import { PLAN_EXPIRY_GRACE_MS, resolveAllowedChannels } from "../shared";

const NOW = new Date("2026-06-01T00:00:00Z");
const FUTURE = new Date("2026-12-01T00:00:00Z");

describe("resolveAllowedChannels (send-time plan kapısı)", () => {
  it("FREE kullanıcı yalnızca EMAIL alır", () => {
    expect(
      resolveAllowedChannels({ plan: "FREE", planStatus: null, planExpiresAt: null }, NOW),
    ).toEqual(["EMAIL"]);
    expect(
      resolveAllowedChannels({ plan: null, planStatus: null, planExpiresAt: null }, NOW),
    ).toEqual(["EMAIL"]);
  });

  it("aktif STARTER EMAIL+TELEGRAM, aktif PRO/ENTERPRISE tüm kanalları alır", () => {
    expect(
      resolveAllowedChannels({ plan: "STARTER", planStatus: "ACTIVE", planExpiresAt: FUTURE }, NOW),
    ).toEqual(["EMAIL", "TELEGRAM"]);
    expect(
      resolveAllowedChannels({ plan: "PRO", planStatus: "ACTIVE", planExpiresAt: FUTURE }, NOW),
    ).toEqual(["EMAIL", "TELEGRAM", "WEBHOOK"]);
    expect(
      resolveAllowedChannels(
        { plan: "ENTERPRISE", planStatus: "ACTIVE", planExpiresAt: null },
        NOW,
      ),
    ).toEqual(["EMAIL", "TELEGRAM", "WEBHOOK"]);
  });

  it("iptal edilmiş (EXPIRED) plan anında EMAIL'e düşer", () => {
    expect(
      resolveAllowedChannels({ plan: "PRO", planStatus: "EXPIRED", planExpiresAt: FUTURE }, NOW),
    ).toEqual(["EMAIL"]);
  });

  it("süresi yeni geçmiş plan tolerans penceresinde kanalları korur", () => {
    const justExpired = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(
      resolveAllowedChannels(
        { plan: "PRO", planStatus: "ACTIVE", planExpiresAt: justExpired },
        NOW,
      ),
    ).toEqual(["EMAIL", "TELEGRAM", "WEBHOOK"]);
  });

  it("tolerans penceresi geçince EMAIL'e düşer", () => {
    const pastGrace = new Date(NOW.getTime() - PLAN_EXPIRY_GRACE_MS - 60 * 60 * 1000);
    expect(
      resolveAllowedChannels({ plan: "PRO", planStatus: "ACTIVE", planExpiresAt: pastGrace }, NOW),
    ).toEqual(["EMAIL"]);
  });
});
