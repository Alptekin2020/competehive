import { describe, it, expect } from "vitest";
import { summarizeDeliveries } from "../services/notifications";

describe("summarizeDeliveries", () => {
  it("returns SENT with no error when all channels sent", () => {
    expect(
      summarizeDeliveries([
        { channel: "EMAIL", status: "SENT", error: null },
        { channel: "TELEGRAM", status: "SENT", error: null },
      ]),
    ).toEqual({ status: "SENT", error: null });
  });

  it("returns SENT with failing channels summarized when partially delivered", () => {
    expect(
      summarizeDeliveries([
        { channel: "TELEGRAM", status: "SENT", error: null },
        { channel: "WEBHOOK", status: "FAILED", error: "Webhook HTTP 500" },
      ]),
    ).toEqual({ status: "SENT", error: "WEBHOOK: Webhook HTTP 500" });
  });

  it("returns FAILED with all failures summarized when nothing sent", () => {
    expect(
      summarizeDeliveries([
        { channel: "EMAIL", status: "FAILED", error: "Resend hatası" },
        { channel: "TELEGRAM", status: "FAILED", error: null },
      ]),
    ).toEqual({ status: "FAILED", error: "EMAIL: Resend hatası · TELEGRAM: hata" });
  });

  it("returns SKIPPED with reasons when all channels skipped", () => {
    expect(
      summarizeDeliveries([
        { channel: "EMAIL", status: "SKIPPED", error: "E-posta uyarıları kapalı" },
        { channel: "TELEGRAM", status: "SKIPPED", error: "Telegram bağlı değil" },
      ]),
    ).toEqual({
      status: "SKIPPED",
      error: "EMAIL: E-posta uyarıları kapalı · TELEGRAM: Telegram bağlı değil",
    });
  });

  it("prefers FAILED over SKIPPED when mixed without any SENT", () => {
    expect(
      summarizeDeliveries([
        { channel: "EMAIL", status: "SKIPPED", error: "E-posta uyarıları kapalı" },
        { channel: "WEBHOOK", status: "FAILED", error: "Webhook HTTP 500" },
      ]),
    ).toEqual({ status: "FAILED", error: "WEBHOOK: Webhook HTTP 500" });
  });

  it("returns SKIPPED with null error when skips carry no reason", () => {
    expect(summarizeDeliveries([{ channel: "EMAIL", status: "SKIPPED", error: null }])).toEqual({
      status: "SKIPPED",
      error: null,
    });
  });
});
