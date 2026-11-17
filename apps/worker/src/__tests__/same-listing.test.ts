import { describe, expect, it } from "vitest";

import { shouldPurgeCompetitor } from "../jobs/competitor-cleanup";
import {
  extractMerchantListingFromHtml,
  extractHepsiburadaListingsFromHtml,
  extractOtherMerchantsFromHtml,
  findOtherMerchantsContainer,
  hepsiburadaMagazaFromUrl,
  hepsiburadaSellersFromListings,
  isOtherSellerUrl,
  sameListingSellerUrl,
  isSameListingSellerRow,
  resolveRequestedSeller,
  sameListingAttributes,
  sellerDataSnippets,
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

describe("sellerDataSnippets", () => {
  it("returns the context around each key", () => {
    const html = `${"x".repeat(200)}"merchantListing":{"a":1} ... Diğer Satıcılar (3)`;
    const out = sellerDataSnippets(html, ["merchantListing", "Diğer Satıcılar", "yok"], 2, 30);
    expect(Object.keys(out)).toEqual(["merchantListing", "Diğer Satıcılar"]);
    expect(out.merchantListing[0]).toContain('"merchantListing":{"a":1}');
  });

  it("ignores the empty otherMerchantsVariants flag", () => {
    expect(extractOtherMerchantsFromHtml('{\\"otherMerchantsVariants\\":[]}')).toBeNull();
  });
});

describe("extractMerchantListingFromHtml (prod 17 Kasım: kaçışlı merchantListing)", () => {
  const state = {
    product: {
      merchantListing: {
        merchant: { id: 616844, name: "KUSTAR", officialName: "KUSTAR LTD" },
        otherMerchantsVariants: [
          {
            merchant: { id: 777, name: "Rakip Yapı" },
            price: { discountedPrice: { value: 949.5, text: "949,50 TL" } },
          },
        ],
      },
    },
    variants: {
      merchantListing: { winnerVariant: { price: { discountedPrice: { value: 975.09 } } } },
    },
  };
  const escaped = JSON.stringify(JSON.stringify(state).replace(/\//g, "\\u002F"));
  const html = `<script>window.__envoy_x=${escaped};</script><p>Ürünün Diğer Satıcıları</p>`;

  it("merges the page merchant, winner price and other sellers", () => {
    const container = extractMerchantListingFromHtml(html);
    expect(container).toEqual({
      merchant: { id: 616844, name: "KUSTAR" },
      price: { discountedPrice: { value: 975.09 } },
      otherMerchants: state.product.merchantListing.otherMerchantsVariants,
    });
    expect(sellersFromProductDetail(container!, null)).toEqual([
      { merchantId: "777", sellerName: "Rakip Yapı", price: 949.5 },
    ]);
    expect(sellersFromProductDetail(container!, "1206503").map((s) => s.merchantId)).toEqual([
      "616844",
      "777",
    ]);
  });

  it("single-seller listing: no rivals, own price kept, gone seller rejected", () => {
    const single = JSON.stringify(
      JSON.stringify({
        merchantListing: {
          merchant: { id: 335599, name: "pharmanice" },
          winnerVariant: { price: { discountedPrice: { value: 248.9 } } },
          otherMerchantsVariants: [],
        },
      }),
    );
    const container = extractMerchantListingFromHtml(`<script>x=${single}</script>`)!;
    expect(sellersFromProductDetail(container, null)).toEqual([]);
    expect(resolveRequestedSeller(container, "335599")).toMatchObject({
      kind: "price",
      price: 248.9,
    });
    expect(resolveRequestedSeller(container, "42").kind).toBe("reject");
  });

  it("returns null without a merchant", () => {
    expect(extractMerchantListingFromHtml("<html></html>")).toBeNull();
    expect(extractMerchantListingFromHtml('{"merchantListing":{"winnerVariant":{}}}')).toBeNull();
  });
});

// Prod 17 Kasım "Hepsiburada seller diagnostics": satıcılar kaçışlı durum
// dizgisindeki "listings" dizisinde (merchantId uuid, merchantName, prices).
describe("Hepsiburada same-listing sellers", () => {
  const state = JSON.stringify({
    hasMoreListings: true,
    listings: [
      {
        merchantId: "1d59f362-fd41-4bcc-a67c-d14576a64062",
        listingId: "1db8f2b0",
        merchantName: "PORGATECH",
        isSalable: true,
        prices: [{ currency: "TRY", value: 989.9 }],
      },
      {
        merchantId: "959ab87e-8f7d-4480-92fd-4f8a1d8424e6",
        merchantName: "Kumtel Türkiye",
        isSalable: true,
        prices: [{ currency: "TRY", value: 1043.33 }],
      },
      {
        merchantId: "aa",
        merchantName: "Stoksuz Mağaza",
        isSalable: false,
        prices: [{ value: 900 }],
      },
      { merchantId: "bb", merchantName: "Fiyatsız", prices: [] },
    ],
  });
  const html = `<script>window.__STATE__ = "${state.replace(/"/g, '\\"')}";</script>`;
  const url =
    "https://www.hepsiburada.com/kumtel-lx-6331-2000-w-fanli-isitici-p-EVKUMTELLX6331?magaza=Kumtel%20T%C3%BCrkiye";

  it("reads the escaped listings array", () => {
    const listings = extractHepsiburadaListingsFromHtml(html);
    expect(listings).toHaveLength(4);
    expect(listings[0].merchantName).toBe("PORGATECH");
  });

  it("drops the own store, unsellable and priceless entries", () => {
    const own = hepsiburadaMagazaFromUrl(url);
    expect(own).toBe("Kumtel Türkiye");
    const sellers = hepsiburadaSellersFromListings(extractHepsiburadaListingsFromHtml(html), own);
    expect(sellers).toEqual([
      { merchantId: "1d59f362-fd41-4bcc-a67c-d14576a64062", sellerName: "PORGATECH", price: 989.9 },
    ]);
  });

  it("reads other price shapes", () => {
    const sellers = hepsiburadaSellersFromListings(
      [
        { merchantId: "x", merchantName: "A", price: { amount: 120 } },
        { merchantId: "y", merchantName: "B", prices: [{ finalPrice: 130 }] },
        { merchantId: "z", merchantName: "C", price: "1.299,90 TL" },
      ],
      null,
    );
    expect(sellers.map((s) => s.price)).toEqual([120, 130, 1299.9]);
  });

  it("builds a magaza URL and treats it as another seller of the own listing", () => {
    const sellerUrl = sameListingSellerUrl(url, {
      merchantId: "1d59",
      sellerName: "PORGATECH",
      price: 989.9,
    });
    expect(sellerUrl).toBe(
      "https://www.hepsiburada.com/kumtel-lx-6331-2000-w-fanli-isitici-p-EVKUMTELLX6331?magaza=PORGATECH",
    );
    expect(isOtherSellerUrl(sellerUrl, url)).toBe(true);
    expect(isOtherSellerUrl(url, url)).toBe(false);
    // Kendi mağaza adını bilmiyorsak koruma yok (kendi ilanımız olabilir).
    expect(isOtherSellerUrl(sellerUrl, url.split("?")[0])).toBe(false);
  });

  it("keeps Trendyol merchantId URLs", () => {
    expect(
      sameListingSellerUrl("https://www.trendyol.com/x/y-p-123?boutiqueId=61", {
        merchantId: "555",
        sellerName: "S",
        price: 1,
      }),
    ).toBe("https://www.trendyol.com/x/y-p-123?merchantId=555");
  });
});
