import { describe, expect, it } from "vitest";

import { shouldPurgeCompetitor } from "../jobs/competitor-cleanup";
import {
  extractOtherMerchantsFromHtml,
  findOtherMerchantsContainer,
  isOtherSellerUrl,
  isSameListingSellerRow,
  resolveRequestedSeller,
  sameListingAttributes,
  sellersFromProductDetail,
} from "../utils/same-listing";
import { countFreshDirectCompetitors, shouldSearchMarketplacePages } from "../utils/second-source";
import { pickStaleCompetitorsForDirectScrape } from "../utils/stale-competitors";

const detail = {
  result: {
    name: "Philips HD9650/90",
    merchant: { id: 100, name: "Buybox Mağaza" },
    price: { discountedPrice: { value: 8999 } },
    otherMerchants: [
      { merchant: { id: 200, name: "Ucuz Mağaza" }, price: { sellingPrice: { value: 8799 } } },
      { merchantId: 300, price: { discountedPrice: { value: 9100 } } },
      { merchant: { id: 400, name: "Fiyatsız" }, price: {} },
    ],
  },
};

describe("findOtherMerchantsContainer", () => {
  it("finds the productDetail object at any depth", () => {
    expect(findOtherMerchantsContainer(detail)?.name).toBe("Philips HD9650/90");
    expect(findOtherMerchantsContainer({ a: [{ b: { c: detail } }] })?.name).toBe(
      "Philips HD9650/90",
    );
  });

  it("returns null when there is no non-empty list", () => {
    expect(findOtherMerchantsContainer({ result: { otherMerchants: [] } })).toBeNull();
    expect(findOtherMerchantsContainer("text")).toBeNull();
    expect(findOtherMerchantsContainer(null)).toBeNull();
  });
});

describe("sellersFromProductDetail", () => {
  it("drops the own listing (buybox winner) when the URL names no merchant", () => {
    const sellers = sellersFromProductDetail(detail.result, null);
    expect(sellers.map((s) => s.merchantId)).toEqual(["200", "300"]);
    expect(sellers[0]).toEqual({ merchantId: "200", sellerName: "Ucuz Mağaza", price: 8799 });
    expect(sellers[1].sellerName).toBeNull();
  });

  it("adds the buybox winner as a rival when our merchant is not the winner", () => {
    const sellers = sellersFromProductDetail(detail.result, "200");
    expect(sellers.map((s) => s.merchantId)).toEqual(["100", "300"]);
    expect(sellers[0].price).toBe(8999);
  });
});

describe("same-listing rows", () => {
  const ownUrl = "https://www.trendyol.com/philips/airfryer-hd9650-90-p-831352478";
  const sellerUrl = `${ownUrl}?merchantId=200`;
  const attrs = sameListingAttributes({ merchantId: "200", sellerName: "Ucuz", price: 1 });

  it("marks the row and never treats it as our own listing", () => {
    expect(isSameListingSellerRow(attrs)).toBe(true);
    expect(isSameListingSellerRow({ seller: "x" })).toBe(false);
    expect(isOtherSellerUrl(sellerUrl, ownUrl)).toBe(true);
    expect(isOtherSellerUrl(sellerUrl, `${ownUrl}?merchantId=200`)).toBe(false);
    expect(isOtherSellerUrl(ownUrl, ownUrl)).toBe(false);
    expect(
      shouldPurgeCompetitor(
        {
          competitorName: "Ucuz Mağaza",
          competitorPrice: 8799,
          matchScore: 100,
          competitorUrl: sellerUrl,
          matchAttributes: attrs,
        },
        { productName: "Philips HD9650/90 Airfryer", ownPrice: 8999, productUrl: ownUrl },
      ),
    ).toBeNull();
  });

  it("is never picked for a separate direct scrape", () => {
    const now = new Date("2026-11-17T06:00:00Z");
    const old = new Date("2026-11-15T06:00:00Z");
    const picked = pickStaleCompetitorsForDirectScrape(
      [
        {
          id: "a",
          competitorName: "Ucuz Mağaza",
          competitorUrl: sellerUrl,
          marketplace: "TRENDYOL",
          matchScore: 100,
          matchAttributes: attrs,
          lastScrapedAt: old,
          currentPrice: null,
        },
        {
          id: "b",
          competitorName: "Philips",
          competitorUrl: "https://www.trendyol.com/philips/x-p-1",
          marketplace: "TRENDYOL",
          matchScore: 90,
          matchAttributes: {},
          lastScrapedAt: old,
          currentPrice: null,
        },
      ],
      new Set(),
      now,
    );
    expect(picked.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("countFreshDirectCompetitors (prod 17 Kasım: EP3347 29/34 bayat Google kartı)", () => {
  const now = new Date("2026-11-17T06:00:00Z");
  const fresh = new Date("2026-11-17T01:00:00Z");
  const stale = new Date("2026-11-13T01:00:00Z");
  const google = "https://www.google.com/search?ibp=oshop&prds=catalogid:1";

  it("counts only fresh, trusted, scrapable rows", () => {
    const rows = [
      { competitorUrl: google, matchScore: 90, matchAttributes: {}, lastScrapedAt: fresh },
      { competitorUrl: google, matchScore: 90, matchAttributes: {}, lastScrapedAt: stale },
      {
        competitorUrl: "https://a.com/p-1",
        matchScore: 90,
        matchAttributes: {},
        lastScrapedAt: fresh,
      },
      {
        competitorUrl: "https://a.com/p-2",
        matchScore: 90,
        matchAttributes: {},
        lastScrapedAt: stale,
      },
      {
        competitorUrl: "https://a.com/p-3",
        matchScore: 60,
        matchAttributes: { review: "pending" },
        lastScrapedAt: fresh,
      },
      {
        competitorUrl: "https://a.com/p-4",
        matchScore: 90,
        matchAttributes: { deadAt: "2026-11-16T00:00:00Z" },
        lastScrapedAt: fresh,
      },
      {
        competitorUrl: "https://a.com/p-5",
        matchScore: 40,
        matchAttributes: {},
        lastScrapedAt: fresh,
      },
      {
        competitorUrl: "https://a.com/p-6",
        matchScore: null,
        matchAttributes: null,
        lastScrapedAt: fresh,
      },
    ];
    expect(countFreshDirectCompetitors(rows, now)).toBe(2);
  });

  it("many stale Google cards no longer block the second source", () => {
    const rows = Array.from({ length: 29 }, () => ({
      competitorUrl: google,
      matchScore: 90,
      matchAttributes: {},
      lastScrapedAt: stale,
    }));
    expect(shouldSearchMarketplacePages(0, countFreshDirectCompetitors(rows, now))).toBe(true);
  });
});

describe("extractOtherMerchantsFromHtml", () => {
  it("reads an embedded list with nested brackets and strings", () => {
    const html =
      '<script>window.x={"product":{"name":"A [b]","otherMerchants":[{"merchant":{"id":5,"name":"M \\"q\\" ]"},"price":{"sellingPrice":{"value":10}}}],"z":1}}</script>';
    const container = extractOtherMerchantsFromHtml(html);
    expect(container).not.toBeNull();
    expect(sellersFromProductDetail(container!, null)).toEqual([
      { merchantId: "5", sellerName: 'M "q" ]', price: 10 },
    ]);
  });

  it("returns null without a list", () => {
    expect(extractOtherMerchantsFromHtml("<html></html>")).toBeNull();
    expect(extractOtherMerchantsFromHtml('{"otherMerchants":[]}')).toBeNull();
  });
});

describe("otherMerchants entry shapes", () => {
  it("reads top-level ids, names and plain or text prices", () => {
    const sellers = sellersFromProductDetail(
      {
        otherMerchants: [
          { merchantId: 7, merchantName: "Yedi", price: { discountedPrice: 450.5 } },
          { sellerId: "8", sellerName: "Sekiz", sellingPrice: { value: 470 } },
          { id: 9, name: "Dokuz", price: { value: 480 } },
          { seller: { id: 10, name: "On" }, price: "1.299,90 TL" },
        ],
      },
      null,
    );
    expect(sellers).toEqual([
      { merchantId: "7", sellerName: "Yedi", price: 450.5 },
      { merchantId: "8", sellerName: "Sekiz", price: 470 },
      { merchantId: "9", sellerName: "Dokuz", price: 480 },
      { merchantId: "10", sellerName: "On", price: 1299.9 },
    ]);
  });

  it("reads an escaped list inside a JS string", () => {
    const html =
      '<script>window.s="{\\"otherMerchants\\":[{\\"merchantId\\":5,\\"price\\":{\\"sellingPrice\\":{\\"value\\":10}}}]}"</script>';
    const container = extractOtherMerchantsFromHtml(html);
    expect(sellersFromProductDetail(container!, null)).toEqual([
      { merchantId: "5", sellerName: null, price: 10 },
    ]);
  });

  it("skips an empty list and uses the next one", () => {
    const html = '{"otherMerchants":[]} {"otherMerchants":[{"merchantId":3,"price":5}]}';
    expect(sellersFromProductDetail(extractOtherMerchantsFromHtml(html)!, null)).toHaveLength(1);
  });
});

describe("resolveRequestedSeller (prod 17 Kasım: kendi ürünü 3 kez reddedildi)", () => {
  it("keeps the page price when the list cannot prove the seller left", () => {
    expect(resolveRequestedSeller({ otherMerchants: [{ foo: 1 }] }, "1206503").kind).toBe(
      "unknown",
    );
    expect(
      resolveRequestedSeller({ otherMerchants: [{ merchantId: 2, price: 9 }] }, "1206503").kind,
    ).toBe("unknown");
    expect(
      resolveRequestedSeller(
        { merchant: { id: 1206503 }, otherMerchants: [{ merchantId: 2, price: 9 }] },
        "1206503",
      ).kind,
    ).toBe("unknown");
  });

  it("uses the seller's own price or rejects a seller that left", () => {
    const container = {
      merchant: { id: 100 },
      price: { discountedPrice: { value: 50 } },
      otherMerchants: [{ merchantId: 2, price: 9 }],
    };
    expect(resolveRequestedSeller(container, "2")).toEqual({
      kind: "price",
      price: 9,
      sellerName: null,
    });
    expect(resolveRequestedSeller(container, "100")).toMatchObject({ kind: "price", price: 50 });
    expect(resolveRequestedSeller(container, "77").kind).toBe("reject");
  });
});
