import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Sahte Chromium: launch/newPage/close çağrılarını sayar.
const { launch, browserClose, newPage } = vi.hoisted(() => {
  const browserClose = vi.fn(async () => {});
  const newPage = vi.fn(async () => ({ close: vi.fn(async () => {}) }));
  const launch = vi.fn(async () => ({
    connected: true,
    newPage,
    close: browserClose,
    on: vi.fn(),
  }));
  return { launch, browserClose, newPage };
});

vi.mock("puppeteer", () => ({ default: { launch } }));

import { closeBrowser, openPage, releasePage } from "../scrapers";

describe("Puppeteer browser lifecycle", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await closeBrowser();
    launch.mockClear();
    browserClose.mockClear();
    newPage.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares a single launch between concurrent page requests", async () => {
    const [a, b] = await Promise.all([openPage(), openPage()]);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(newPage).toHaveBeenCalledTimes(2);
    await releasePage(a);
    await releasePage(b);
  });

  it("closes the browser after two idle minutes", async () => {
    const page = await openPage();
    await releasePage(page);

    await vi.advanceTimersByTimeAsync(119_000);
    expect(browserClose).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(browserClose).toHaveBeenCalledTimes(1);

    // Sonraki ihtiyaçta yeniden açılır.
    await releasePage(await openPage());
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("does not close while a page is still open, and a new page cancels the timer", async () => {
    const first = await openPage();
    const second = await openPage();
    await releasePage(first);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(browserClose).not.toHaveBeenCalled();

    await releasePage(second);
    await vi.advanceTimersByTimeAsync(60_000);
    await releasePage(await openPage()); // timer reset by new activity
    await vi.advanceTimersByTimeAsync(90_000);
    expect(browserClose).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(31_000);
    expect(browserClose).toHaveBeenCalledTimes(1);
  });
});
