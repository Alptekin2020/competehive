import { describe, expect, it } from "vitest";

import { buildMarketplaceSearchQuery, isMarketplaceProductUrl } from "../serper";
import {
  DIRECT_LOOKUP_RETRY_DAYS,
  isDirectLookupDue,
  pickDirectListing,
  readGoogleKey,
  siteDomainForMarketplace,
  withDirectLookup,
} from "../utils/direct-listing";
import { isNearIdenticalTitle, isStrongTitleOverlap } from "../utils/title-similarity";

const OWN = "Philips Airfryer XXL HD9650/90 Avance Collection Fritöz";

describe("pickDirectListing", () => {
  it("aynı model kodlu ve aynı markalı ürün sayfasını seçer", () => {
    const picked = pickDirectListing(OWN, "Philips Hd9650/90 2225 W Avance Collection Airfryer", [
      {
        title: "Philips HD9650/90 Airfryer XXL Yağsız Fritöz",
        link: "https://www.teknosa.com/philips-hd965090-airfryer-xxl-p-125078524",
      },
    ]);
    expect(picked?.link).toContain("teknosa.com");
  });

  it("aksesuarı, farklı modeli ve çoklu paketi seçmez", () => {
    expect(
      pickDirectListing(OWN, "Philips Airfryer XXL HD9650/90", [
        {
          title: "Philips HD9650/90 Airfryer İçin Yedek Sepet",
          link: "https://www.trendyol.com/x/yedek-sepet-p-1",
        },
        {
          title: "Philips HD9252/90 Airfryer Essential Fritöz",
          link: "https://www.trendyol.com/x/hd9252-p-2",
        },
      ]),
    ).toBeNull();

    expect(
      pickDirectListing(
        "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr",
        "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 Gr",
        [
          {
            title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 Gr",
            link: "https://www.pttavm.com/kahve-dunyasi-tambol-cilekli-100-g-7-li-paket-p-123",
          },
        ],
      ),
    ).toBeNull();
  });

  it("model kodu olmayan üründe neredeyse aynı başlığı kabul eder, ilk uygun sonucu döner", () => {
    const picked = pickDirectListing(
      "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr",
      "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 Gr",
      [
        {
          title: "Kahve Dünyası Tambol Fıstıklı Milföy Dolgulu 100 gr",
          link: "https://www.n11.com/urun/tambol-fistikli-1",
        },
        {
          title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr",
          link: "https://www.n11.com/urun/tambol-cilekli-2",
        },
      ],
    );
    expect(picked?.link).toBe("https://www.n11.com/urun/tambol-cilekli-2");
  });

  it("sonuç yoksa null döner", () => {
    expect(pickDirectListing(OWN, "", [])).toBeNull();
  });
});

describe("gerçek sayfa araması durumu", () => {
  const now = new Date("2026-11-15T18:00:00Z");

  it("denenmemiş kayıt aranır; yeni denenmiş kayıt beklenir; süresi dolan yeniden aranır", () => {
    expect(isDirectLookupDue({ brandMatch: true }, now)).toBe(true);
    const attempted = withDirectLookup({ brandMatch: true, seller: "Trendyol" }, now);
    expect(attempted).toMatchObject({ brandMatch: true, seller: "Trendyol" });
    expect(isDirectLookupDue(attempted, now)).toBe(false);
    const later = new Date(now.getTime() + (DIRECT_LOOKUP_RETRY_DAYS + 1) * 86_400_000);
    expect(isDirectLookupDue(attempted, later)).toBe(true);
  });

  it("bulunan kayıtta eski Google anahtarı saklanır", () => {
    const linked = withDirectLookup({}, now, "google.com/shopping?catalogid=123");
    expect(readGoogleKey(linked)).toBe("google.com/shopping?catalogid=123");
    expect(readGoogleKey(withDirectLookup({}, now))).toBeNull();
  });
});

describe("aranabilir pazaryerleri", () => {
  it("scraper'ı olan pazaryerlerinin alan adını verir, diğerlerinde null", () => {
    expect(siteDomainForMarketplace("TEKNOSA")).toBe("teknosa.com");
    expect(siteDomainForMarketplace("TRENDYOL")).toBe("trendyol.com");
    expect(siteDomainForMarketplace("CUSTOM")).toBeNull();
    expect(siteDomainForMarketplace("CICEKSEPETI")).toBeNull();
  });

  it("tek alan adlı arama sorgusu parantezsiz kurulur", () => {
    expect(buildMarketplaceSearchQuery("Philips HD9650", ["teknosa.com"])).toBe(
      "Philips HD9650 site:teknosa.com",
    );
  });

  it("Teknosa, Vatan ve MediaMarkt ürün sayfalarını tanır", () => {
    expect(isMarketplaceProductUrl("https://www.teknosa.com/philips-hd9650-p-125078524")).toBe(
      true,
    );
    expect(isMarketplaceProductUrl("https://www.teknosa.com/airfryer-c-117003")).toBe(false);
    expect(
      isMarketplaceProductUrl("https://www.vatanbilgisayar.com/philips-hd9650-90-airfryer.html"),
    ).toBe(true);
    expect(isMarketplaceProductUrl("https://www.vatanbilgisayar.com/fritoz/")).toBe(false);
    expect(
      isMarketplaceProductUrl("https://www.mediamarkt.com.tr/tr/product/_philips-hd9650-1.html"),
    ).toBe(true);
    expect(isMarketplaceProductUrl("https://www.mediamarkt.com.tr/tr/category/_fritoz.html")).toBe(
      false,
    );
  });
});

describe("aroma/çeşit varyantı deterministik kabul edilmez", () => {
  it("tek sözcüğü farklı başlık neredeyse aynı ya da güçlü örtüşme sayılmaz", () => {
    const a = "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr";
    const b = "Kahve Dünyası Tambol Fıstıklı Milföy Dolgulu 100 gr";
    expect(isNearIdenticalTitle(a, b)).toBe(false);
    expect(isStrongTitleOverlap(a, b)).toBe(false);
    // Yalnızca yazım farkı olan aynı başlık kabul edilmeye devam eder.
    expect(isNearIdenticalTitle(a, "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 Gr")).toBe(
      true,
    );
  });
});
