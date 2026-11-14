import { describe, expect, it } from "vitest";

import { isTransientStatus, withRetry } from "../utils/direct-fetch";
import { competitorUrlKey, urlMatchKey } from "../utils/url-match";
import {
  buildSearchQueries,
  cleanProductTitle,
  truncateRawTitleForSearch,
} from "../utils/search-queries";
import { isRefreshCycleDue, REFRESH_CYCLE_INTERVAL_MS } from "../utils/refresh-cycle";
import { isNavigationRaceError, parseAmazonTRHtml, readPageHtml } from "../scrapers";

const noSleep = () => Promise.resolve();

describe("withRetry", () => {
  it("retries a thrown network error and returns the later success", async () => {
    let calls = 0;
    const value = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new TypeError("fetch failed");
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(value).toBe("ok");
    expect(calls).toBe(3);
  });

  it("retries transient statuses but not client errors", async () => {
    const statuses = [502, 200];
    let calls = 0;
    const res = await withRetry(async () => ({ status: statuses[calls++] }), {
      sleep: noSleep,
      shouldRetry: (r) => isTransientStatus(r.status),
    });
    expect(res.status).toBe(200);

    calls = 0;
    const denied = await withRetry(async () => ({ status: (calls++, 403) }), {
      sleep: noSleep,
      shouldRetry: (r) => isTransientStatus(r.status),
    });
    expect(denied.status).toBe(403);
    expect(calls).toBe(1);
  });

  it("gives up after the last attempt and rethrows", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error("terminated");
        },
        { attempts: 3, sleep: noSleep },
      ),
    ).rejects.toThrow("terminated");
    expect(calls).toBe(3);
  });
});

describe("URL keys", () => {
  it("urlMatchKey tolerates a missing link instead of throwing", () => {
    expect(urlMatchKey(undefined)).toBe("");
    expect(urlMatchKey(null)).toBe("");
    expect(urlMatchKey("https://www.Trendyol.com/a/b-p-1/?x=1")).toBe("trendyol.com/a/b-p-1");
  });

  it("competitorUrlKey ignores tracking params but keeps the seller", () => {
    const stored = "https://www.trendyol.com/marka/urun-p-123?merchantId=42&boutiqueId=61";
    const fromSearch =
      "https://www.trendyol.com/marka/urun-p-123?srsltid=AfmBOoq123&utm_source=google&merchantId=42";
    expect(competitorUrlKey(fromSearch)).toBe(competitorUrlKey(stored));
    expect(competitorUrlKey(stored)).not.toBe(
      competitorUrlKey("https://www.trendyol.com/marka/urun-p-123?merchantId=99"),
    );
    expect(competitorUrlKey(undefined)).toBe("");
  });
});

describe("product title cleanup and queries", () => {
  it("strips marketplace SEO suffixes", () => {
    expect(
      cleanProductTitle(
        "Oral-B Şarjlı Vitality Pro Koruma ve Temizlik Elektrikli Diş Fırçası Lila Fiyatları ve Özellikleri",
      ),
    ).toBe("Oral-B Şarjlı Vitality Pro Koruma ve Temizlik Elektrikli Diş Fırçası Lila");
    expect(cleanProductTitle("Samsung Galaxy S24 Fiyatı, Yorumları - Trendyol")).toBe(
      "Samsung Galaxy S24",
    );
    expect(cleanProductTitle("Philips Airfryer XXL | Hepsiburada")).toBe("Philips Airfryer XXL");
  });

  it("keeps titles where 'fiyat' is part of the product", () => {
    expect(cleanProductTitle("Fiyat Etiketi Makinesi Motex 5500")).toBe(
      "Fiyat Etiketi Makinesi Motex 5500",
    );
    expect(cleanProductTitle("Fiyatları ve Özellikleri")).toBe("Fiyatları ve Özellikleri");
  });

  it("does not leave a dangling conjunction or comma on a truncated query", () => {
    expect(
      truncateRawTitleForSearch(
        "Oral-B Şarjlı Vitality Pro Koruma ve Temizlik Elektrikli Diş Fırçası",
      ),
    ).toBe("Oral-B Şarjlı Vitality Pro Koruma");
    expect(
      truncateRawTitleForSearch("Artema Maestro A42146 Pull-Out Eviye Bataryası, 24 cm Yükseklik"),
    ).toBe("Artema Maestro A42146 Pull-Out Eviye Bataryası");
  });

  it("adds a broader fallback query when there is no model code or keyword", () => {
    const queries = buildSearchQueries(
      "Siveno Sivrisinek ve Kene Kovucu Losyon Bitkisel 50 ml",
      "",
      null,
    );
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries[1]).toBe("Siveno Sivrisinek ve Kene");
  });
});

describe("refresh cycle", () => {
  const now = 1_800_000_000_000;
  it("is due on first run, after the interval, and on clock skew", () => {
    expect(isRefreshCycleDue(null, now)).toBe(true);
    expect(isRefreshCycleDue(now - REFRESH_CYCLE_INTERVAL_MS, now)).toBe(true);
    expect(isRefreshCycleDue(now + 60_000, now)).toBe(true);
  });
  it("is not due when the last run is recent (survives a redeploy)", () => {
    expect(isRefreshCycleDue(now - 60 * 60 * 1000, now)).toBe(false);
  });
});

describe("readPageHtml", () => {
  it("retries when the page navigates mid-read", async () => {
    let calls = 0;
    const page = {
      content: async () => {
        calls++;
        if (calls < 3) {
          throw new Error("Execution context was destroyed, most likely because of a navigation.");
        }
        return "<html>ok</html>";
      },
    };
    expect(await readPageHtml(page, { waitMs: 0 })).toBe("<html>ok</html>");
    expect(calls).toBe(3);
  });

  it("does not swallow unrelated errors", async () => {
    const page = {
      content: async () => {
        throw new Error("Protocol error: Target closed");
      },
    };
    await expect(readPageHtml(page, { waitMs: 0 })).rejects.toThrow("Target closed");
    expect(isNavigationRaceError(new Error("Target closed"))).toBe(false);
  });
});

describe("Amazon TR no-offer pages", () => {
  const page = (body: string) =>
    `<html><body><span id="productTitle"> Philips Premium Airfryer XXL HD9650/90 </span>${body}</body></html>`;

  it("flags a page without a buybox offer as unavailable, not as a parse failure", () => {
    const product = parseAmazonTRHtml(
      page('<div id="buybox-see-all-buying-choices"><a>Tüm satın alma seçeneklerini gör</a></div>'),
    );
    expect(product?.unavailable).toBe(true);
    expect(product?.inStock).toBe(false);
    expect(product?.price).toBe(0);
  });

  it("flags 'Şu anda mevcut değil' as unavailable", () => {
    const product = parseAmazonTRHtml(
      page('<div id="availability"><span>Şu anda mevcut değil.</span></div>'),
    );
    expect(product?.unavailable).toBe(true);
  });

  it("does not guess when there is no positive signal (template change stays a failure)", () => {
    const product = parseAmazonTRHtml(page("<div>başka içerik</div>"));
    expect(product?.unavailable).toBeUndefined();
  });

  it("keeps normal in-stock parsing untouched", () => {
    const product = parseAmazonTRHtml(
      page(
        '<div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">9.499,00 TL</span></span></div>',
      ),
    );
    expect(product?.price).toBe(9499);
    expect(product?.unavailable).toBeUndefined();
    expect(product?.inStock).toBe(true);
  });
});
