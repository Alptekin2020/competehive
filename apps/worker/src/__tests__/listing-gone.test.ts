import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Sahte Chromium: çağrılırsa hata verir — testler Puppeteer'a hiç düşülmediğini
// (ya da düşüldüğünü) launch sayacıyla doğrular.
const { launch, cacheGet, cacheSet } = vi.hoisted(() => ({
  launch: vi.fn(async () => {
    throw new Error("puppeteer unavailable in tests");
  }),
  cacheGet: vi.fn(async (_key: string): Promise<unknown> => null),
  cacheSet: vi.fn(async () => {}),
}));

vi.mock("puppeteer", () => ({ default: { launch } }));
vi.mock("../utils/cache", () => ({
  cacheGet,
  cacheSet,
  getCachedScrapeResult: vi.fn(async () => null),
  setCachedScrapeResult: vi.fn(async () => {}),
}));

import {
  LISTING_GONE_CODE,
  ScraperError,
  TRENDYOL_DIRECT_BLOCKED_KEY,
  closeBrowser,
  isListingGoneError,
  listingGoneReason,
  scrapeAmazonTR,
  scrapeHepsiburada,
  scrapeTrendyol,
} from "../scrapers";

const DEAD_HB = "https://www.hepsiburada.com/grohe-eurosmart-lavabo-bataryasi-pm-HBC00009O3GJA";
const HB_CATEGORY = "https://www.hepsiburada.com/mutfak-evye-bataryalari-c-18021949";
const TRENDYOL = "https://www.trendyol.com/philips/ep3347-90-tam-otomatik-espresso-p-123456789";

function htmlResponse(body: string, status: number, url: string): Response {
  const res = new Response(body, { status, headers: { "content-type": "text/html" } });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a rejection");
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  await closeBrowser();
  launch.mockClear();
  cacheGet.mockReset();
  cacheGet.mockResolvedValue(null);
  cacheSet.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listingGoneReason", () => {
  it("treats 404/410 and same-site redirects to a category page as gone", () => {
    expect(listingGoneReason(DEAD_HB, 404, DEAD_HB)).toBe("http-404");
    expect(listingGoneReason(DEAD_HB, 410, DEAD_HB)).toBe("http-410");
    expect(listingGoneReason(DEAD_HB, 200, HB_CATEGORY)).toMatch(/^redirected:/);
  });

  it("does not call a bot check, an off-site hop or a product-to-product redirect gone", () => {
    expect(listingGoneReason(DEAD_HB, 200, "https://captcha.example.com/check")).toBeNull();
    expect(
      listingGoneReason(DEAD_HB, 404, DEAD_HB, "<html>api-services-support@amazon.com</html>"),
    ).toBeNull();
    expect(
      listingGoneReason(TRENDYOL, 200, "https://www.trendyol.com/en/philips/ep3347-p-123456789"),
    ).toBeNull();
    expect(listingGoneReason(TRENDYOL, 200, TRENDYOL)).toBeNull();
  });
});

describe("scrapeHepsiburada dead -pm- listing", () => {
  it("throws non-retryable LISTING_GONE from the HTML redirect without opening Puppeteer", async () => {
    fetchMock.mockResolvedValue(
      htmlResponse("<html><title>Mutfak Evye Bataryaları</title></html>", 200, HB_CATEGORY),
    );
    const err = await caught(scrapeHepsiburada(DEAD_HB));
    expect(isListingGoneError(err)).toBe(true);
    expect((err as ScraperError).code).toBe(LISTING_GONE_CODE);
    expect((err as ScraperError).retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("scrapeWithFallback (Amazon TR)", () => {
  it("throws LISTING_GONE on 404 without retrying or opening Puppeteer", async () => {
    fetchMock.mockResolvedValue(htmlResponse("<html>Sayfa bulunamadı</html>", 404, ""));
    const err = await caught(scrapeAmazonTR("https://www.amazon.com.tr/dp/B0CXYZ1234"));
    expect(isListingGoneError(err)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled();
  });
});

describe("scrapeTrendyol 403 circuit breaker", () => {
  it("sets the breaker when API and HTML both return 403, stopping HTML at the first 403", async () => {
    fetchMock.mockImplementation(async () => htmlResponse("Forbidden", 403, TRENDYOL));
    const err = await caught(scrapeTrendyol(TRENDYOL));
    expect((err as ScraperError).code).toBe("SCRAPE_ALL_METHODS_FAILED");
    // 1 API + 1 HTML denemesi (ilk 403'te kesilir).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(cacheSet).toHaveBeenCalledWith(TRENDYOL_DIRECT_BLOCKED_KEY, expect.anything(), 3600);
    expect(launch).toHaveBeenCalled();
  });

  it("goes straight to Puppeteer while the breaker is set (no API or HTML request)", async () => {
    cacheGet.mockImplementation(async (key: string) =>
      key === TRENDYOL_DIRECT_BLOCKED_KEY ? { at: "2026-11-16T05:00:00Z" } : null,
    );
    const err = await caught(scrapeTrendyol(TRENDYOL));
    expect(err).toBeInstanceOf(ScraperError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalled();
    expect(cacheSet).not.toHaveBeenCalled();
  });

  it("fails open when Redis is unreachable (cacheGet returns null)", async () => {
    fetchMock.mockImplementation(async () => htmlResponse("Forbidden", 403, TRENDYOL));
    await caught(scrapeTrendyol(TRENDYOL));
    expect(fetchMock).toHaveBeenCalled();
  });
});
