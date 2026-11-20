import { describe, expect, it } from "vitest";

import type { ScrapedProduct } from "../scrapers";
import {
  amazonAsinFromUrl,
  n11ShownSellerSlug,
  parseN11OtherSellers,
  amazonOffersUrl,
  amazonShownMerchant,
  parseAmazonOffers,
  sellerMarketplaceForUrl,
  urlPinsSeller,
  withoutShownSeller,
} from "../utils/marketplace-sellers";
import { applyOwnStore, isOwnStoreName } from "../utils/own-store";
import { isOtherSellerUrl, sameListingSellerUrl } from "../utils/same-listing";

const AMAZON_URL = "https://www.amazon.com.tr/Philips-EP3347-90/dp/B0B5TQ2X4K?ref=sr_1_1";

// Amazon "Tüm teklifler" (AOD) parçasının yapısı: sabitlenmiş buybox teklifi
// ve her diğer teklif için tekrar eden `id="aod-offer"` blokları.
const AOD_HTML = `
<div id="aod-pinned-offer">
  <span class="a-price"><span class="a-offscreen">12.499,00 TL</span></span>
  <div id="aod-offer-soldBy"><a class="a-link-normal" href="/gp/aag/main?seller=A2BUYBOX01&isAmazonFulfilled=0">Teknoloji Dünyası</a></div>
</div>
<div id="aod-offer">
  <div id="aod-price-1"><span class="a-price"><span class="a-offscreen">12.799,00 TL</span></span></div>
  <div id="aod-offer-soldBy"><div class="a-col-right"><a class="a-link-normal" href="/gp/aag/main?ie=UTF8&seller=A3MYSTORE9&isAmazonFulfilled=1">Benim Mağazam</a></div></div>
</div>
<div id="aod-offer">
  <div id="aod-price-2"><span class="a-price"><span class="a-offscreen">13.100,50 TL</span></span></div>
  <div id="aod-offer-soldBy"><div class="a-col-right"><span class="a-size-small a-color-base">Amazon.com.tr</span></div></div>
</div>
<div id="aod-offer">
  <div id="aod-offer-soldBy"><div class="a-col-right"><a href="/gp/aag/main?seller=A4NOPRICE1">Fiyatsız Satıcı</a></div></div>
</div>`;

describe("marketplace sellers", () => {
  it("maps hosts to multi-seller marketplaces only", () => {
    expect(sellerMarketplaceForUrl(AMAZON_URL)).toBe("AMAZON_TR");
    expect(sellerMarketplaceForUrl("https://www.n11.com/urun/x-123")).toBe("N11");
    expect(sellerMarketplaceForUrl("https://www.pazarama.com/x-p-1")).toBe("PAZARAMA");
    expect(sellerMarketplaceForUrl("https://www.pttavm.com/x-p-1")).toBe("PTTAVM");
    expect(sellerMarketplaceForUrl("https://www.vatanbilgisayar.com/x.html")).toBeNull();
    expect(sellerMarketplaceForUrl("https://www.teknosa.com/x-p-1")).toBeNull();
  });

  it("knows when a URL selects a seller", () => {
    expect(urlPinsSeller(AMAZON_URL)).toBe(false);
    expect(urlPinsSeller(`${AMAZON_URL}&smid=A3MYSTORE9`)).toBe(true);
    expect(urlPinsSeller("https://www.n11.com/urun/x-123?magaza=benim")).toBe(true);
    expect(urlPinsSeller("https://www.trendyol.com/a/b-p-1?merchantId=5")).toBe(true);
    // `m` yalnız Amazon'da satıcı seçer.
    expect(urlPinsSeller("https://www.pttavm.com/x-p-1?m=1")).toBe(false);
  });

  it("builds the Amazon offers URL from the ASIN", () => {
    expect(amazonAsinFromUrl(AMAZON_URL)).toBe("B0B5TQ2X4K");
    expect(amazonOffersUrl(AMAZON_URL)).toBe(
      "https://www.amazon.com.tr/gp/product/ajax/aodAjaxMain/?asin=B0B5TQ2X4K&pc=dp&experienceId=aodAjaxMain",
    );
    expect(amazonOffersUrl("https://www.amazon.com.tr/s?k=kahve")).toBeNull();
  });

  it("reads the other Amazon offers but not the pinned buybox", () => {
    expect(parseAmazonOffers(AOD_HTML)).toEqual([
      { merchantId: "A3MYSTORE9", sellerName: "Benim Mağazam", price: 12799 },
      { merchantId: "A1UNQM1SR2CHM", sellerName: "Amazon.com.tr", price: 13100.5 },
    ]);
  });

  it("reads the shown Amazon merchant", () => {
    const html = `<input type="hidden" id="merchantID" name="merchantID" value="A2BUYBOX01">
      <a id="sellerProfileTriggerId" href="/gp/help/seller/at-a-glance.html?seller=A2BUYBOX01">Teknoloji  Dünyası</a>`;
    expect(amazonShownMerchant(html)).toEqual({
      merchantId: "A2BUYBOX01",
      sellerName: "Teknoloji Dünyası",
    });
    expect(amazonShownMerchant("<div></div>")).toBeNull();
  });

  it("drops the shown seller by id or name", () => {
    const sellers = parseAmazonOffers(AOD_HTML);
    expect(
      withoutShownSeller(sellers, { merchantId: "A3MYSTORE9", sellerName: null }).map(
        (s) => s.sellerName,
      ),
    ).toEqual(["Amazon.com.tr"]);
    expect(
      withoutShownSeller(sellers, { merchantId: null, sellerName: "AMAZON.COM.TR" }).length,
    ).toBe(1);
  });

  it("writes Amazon and N11 same-listing seller URLs", () => {
    expect(
      sameListingSellerUrl(AMAZON_URL, {
        merchantId: "A3MYSTORE9",
        sellerName: "Benim Mağazam",
        price: 1,
      }),
    ).toBe("https://www.amazon.com.tr/dp/B0B5TQ2X4K?smid=A3MYSTORE9");
    // Kimliksiz satıcı için seçilebilir URL yok.
    expect(
      sameListingSellerUrl(AMAZON_URL, {
        merchantId: "name:baskasatici",
        sellerName: "Başka Satıcı",
        price: 1,
      }),
    ).toBeNull();
    expect(
      sameListingSellerUrl("https://www.n11.com/urun/kahve-makinesi-123", {
        merchantId: "kahvedukkani",
        sellerName: "Kahve Dükkanı",
        price: 1,
      }),
    ).toBe("https://www.n11.com/urun/kahve-makinesi-123?magaza=kahvedukkani");
  });

  it("treats another Amazon seller of the own listing as a rival, not the own listing", () => {
    expect(isOtherSellerUrl("https://www.amazon.com.tr/dp/B0B5TQ2X4K?smid=A3", AMAZON_URL)).toBe(
      true,
    );
    expect(
      isOtherSellerUrl(
        "https://www.amazon.com.tr/dp/B0B5TQ2X4K?smid=A3",
        "https://www.amazon.com.tr/dp/B0B5TQ2X4K?smid=A3",
      ),
    ).toBe(false);
  });

  it("takes the own price from the user's Amazon offer", () => {
    const scraped: ScrapedProduct = {
      name: "Philips EP3347/90",
      price: 12499,
      currency: "TRY",
      inStock: true,
      sellerName: "Teknoloji Dünyası",
      pageSeller: { merchantId: "A2BUYBOX01", sellerName: "Teknoloji Dünyası" },
      otherSellers: parseAmazonOffers(AOD_HTML),
    };
    const resolved = applyOwnStore(scraped, ["Benim Mağazam"]);
    expect(resolved.outcome).toBe("own-from-list");
    expect(resolved.product.price).toBe(12799);
    expect(resolved.product.otherSellers?.map((s) => s.sellerName)).toEqual([
      "Teknoloji Dünyası",
      "Amazon.com.tr",
    ]);
  });

  // Prod 20 Kasım "Marketplace seller diagnostics" (N11): kaçışlı durumda
  // gösterilen satıcının adresi `productUrlWithoutSellerShop` alanından önce;
  // "Diğer Mağazalar" kartları `?magaza=<kısa ad>` + `.name` taşır.
  it("reads the shown N11 seller from the page state", () => {
    const html =
      '{"title":"Kustar","productUrl":"https:\\u002F\\u002Fwww.n11.com\\u002Furun\\u002Fkustar-64270488?magaza=kustarsuarmaturleri","productUrlWithoutSellerShop":"https:\\u002F\\u002Fwww.n11.com\\u002Furun\\u002Fkustar-64270488"}';
    expect(n11ShownSellerSlug(html)).toBe("kustarsuarmaturleri");
    expect(n11ShownSellerSlug("<html></html>")).toBeNull();
    expect(isOwnStoreName("kustarsuarmaturleri", ["Kustar Su Armatürleri"])).toBe(true);
  });

  it("reads N11 other stores with their prices", () => {
    const html = `<div class="otherSellers"><div class="otherSellers-top"><h3>Diğer Mağazalar</h3></div>
      <div class="swiper-wrapper">
        <div data-index="0" class="swiper-slide"><a href="/urun/icollagen-133827429?magaza=semizticaret" class="titleAndPointWrapper"><div class="title"><span class="name">Semizticaret</span></div></a>
          <div class="priceContainer"><ins>1.249,90 TL</ins></div></div>
        <div data-index="1" class="swiper-slide"><a href="/urun/icollagen-133827429?magaza=teknosa"><span class="name">Teknosa</span></a></div>
      </div></div>`;
    expect(parseN11OtherSellers(html)).toEqual([
      { merchantId: "semizticaret", sellerName: "Semizticaret", price: 1249.9 },
    ]);
  });
});
