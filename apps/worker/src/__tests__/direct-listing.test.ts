import { describe, expect, it } from "vitest";

import {
  buildMarketplaceSearchQuery,
  isLikelyStoreProductUrl,
  isMarketplaceProductUrl,
  mapOrganicToShoppingResults,
} from "../serper";
import {
  DIRECT_LOOKUP_RETRY_DAYS,
  DIRECT_TRANSIENT_RETRY_HOURS,
  MAX_DIRECT_REJECTED,
  MAX_DIRECT_TRANSIENT_FAILURES,
  decideDirectMerge,
  isDirectLookupDue,
  isFreshEnoughForLookup,
  needsAliasDirectRefresh,
  partitionAliasHits,
  pickDirectListing,
  readDirectCandidate,
  readDirectRejected,
  readGoogleKeys,
  scraperMarketplaceFor,
  sellerSiteDomain,
  siteDomainForMarketplace,
  verifyDirectPage,
  withDirectCandidate,
  withDirectLookup,
  withDirectRejected,
  withDirectTransientFailure,
  withGoogleKeys,
} from "../utils/direct-listing";
import { competitorUrlKey } from "../utils/url-match";
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

  it("Google anahtarları dizide saklanır; eski tekil alan okunurken taşınır", () => {
    const legacy = { googleKey: "google.com/shopping?catalogid=1", seller: "Trendyol" };
    expect(readGoogleKeys(legacy)).toEqual(["google.com/shopping?catalogid=1"]);
    const merged = withGoogleKeys(legacy, ["google.com/shopping?catalogid=2"]);
    expect(merged.googleKey).toBeUndefined();
    expect(merged.seller).toBe("Trendyol");
    expect(readGoogleKeys(merged)).toEqual([
      "google.com/shopping?catalogid=1",
      "google.com/shopping?catalogid=2",
    ]);
    // Aynı anahtar tekrar eklenince çoğalmaz (birleştirme her turda dönmez).
    const again = withGoogleKeys(merged, ["google.com/shopping?catalogid=1"]);
    expect(readGoogleKeys(again)).toHaveLength(2);
    expect(readGoogleKeys(withDirectLookup({}, now))).toEqual([]);
  });

  it("geçici tarama hatası (Boyner 429) adayı reddetmez, bir gün sonra yeniden dener", () => {
    const url =
      "https://www.boyner.com.tr/note-loose-powder-01-invisible-makyaj-sabitleyici-matlastirici-toz-pudra-p-12345";
    const hour = 3_600_000;
    const pending = withDirectCandidate({ seller: "Boyner" }, url, now);
    const first = withDirectTransientFailure(pending, url, now);
    expect(first.rejected).toBe(false);
    expect(first.failures).toBe(1);
    expect(readDirectCandidate(first.attributes)).toBeNull();
    expect(readDirectRejected(first.attributes)).toEqual([]);
    // 7 günlük bekleme yerine DIRECT_TRANSIENT_RETRY_HOURS sonra yeniden aranır.
    expect(isDirectLookupDue(first.attributes, new Date(now.getTime() + hour))).toBe(false);
    const retryTime = new Date(now.getTime() + (DIRECT_TRANSIENT_RETRY_HOURS + 1) * hour);
    expect(isDirectLookupDue(first.attributes, retryTime)).toBe(true);
    // Yeniden arama yapıldıktan sonra her turda aranmaz.
    const retried = withDirectCandidate(first.attributes, url, retryTime);
    const afterRetry = withDirectTransientFailure(retried, url, retryTime);
    expect(afterRetry.failures).toBe(2);
    const searchedAgain = withDirectLookup(
      afterRetry.attributes,
      new Date(retryTime.getTime() + (DIRECT_TRANSIENT_RETRY_HOURS + 1) * hour),
    );
    expect(
      isDirectLookupDue(
        searchedAgain,
        new Date(retryTime.getTime() + (DIRECT_TRANSIENT_RETRY_HOURS + 2) * hour),
      ),
    ).toBe(false);
  });

  it("aynı sayfa üst üste taranamazsa sonunda reddedilir; farklı sayfa sayacı sıfırlar", () => {
    const url = "https://www.boyner.com.tr/note-loose-powder-p-12345";
    let attrs: Record<string, unknown> = {};
    let result = withDirectTransientFailure(attrs, url, now);
    for (let i = 1; i < MAX_DIRECT_TRANSIENT_FAILURES; i++) {
      attrs = result.attributes;
      result = withDirectTransientFailure(attrs, url, now);
    }
    expect(result.rejected).toBe(true);
    expect(readDirectRejected(result.attributes)).toEqual([competitorUrlKey(url)]);
    expect(result.attributes.directTransient).toBeUndefined();

    const a = withDirectTransientFailure({}, url, now);
    const b = withDirectTransientFailure(
      a.attributes,
      "https://www.n11.com/urun/note-pudra-1",
      now,
    );
    expect(b.failures).toBe(1);
    expect(b.rejected).toBe(false);
  });

  it("doğrulama bekleyen aday yeni aramayı 24 saat bekletir; reddedilen aday listede kalır", () => {
    const url = "https://www.trendyol.com/philips/hd9650-90-p-831352478";
    const pending = withDirectCandidate({ seller: "Trendyol" }, url, now);
    expect(readDirectCandidate(pending)?.url).toBe(url);
    expect(isDirectLookupDue(pending, new Date(now.getTime() + 3_600_000))).toBe(false);
    expect(isDirectLookupDue(pending, new Date(now.getTime() + 25 * 3_600_000))).toBe(true);
    const rejected = withDirectRejected(pending, url);
    expect(readDirectCandidate(rejected)).toBeNull();
    expect(readDirectRejected(rejected)).toEqual([competitorUrlKey(url)]);
    let many: Record<string, unknown> = {};
    for (let i = 0; i < MAX_DIRECT_REJECTED + 3; i++) {
      many = withDirectRejected(many, `https://www.n11.com/urun/x-${i}`);
    }
    expect(readDirectRejected(many)).toHaveLength(MAX_DIRECT_REJECTED);
  });

  it("en fazla 7 gün önce bayatlamış kayıt da aranır", () => {
    const day = 86_400_000;
    expect(isFreshEnoughForLookup(new Date(now.getTime() - 2 * day), now, 72)).toBe(true);
    expect(isFreshEnoughForLookup(new Date(now.getTime() - 9 * day), now, 72)).toBe(true);
    expect(isFreshEnoughForLookup(new Date(now.getTime() - 11 * day), now, 72)).toBe(false);
    expect(isFreshEnoughForLookup(null, now, 72)).toBe(false);
  });
});

describe("aranabilir pazaryerleri", () => {
  it("scraper'ı olan pazaryerlerinin alan adını verir, diğerlerinde null", () => {
    expect(siteDomainForMarketplace("TEKNOSA")).toBe("teknosa.com");
    expect(siteDomainForMarketplace("TRENDYOL")).toBe("trendyol.com");
    expect(siteDomainForMarketplace("CUSTOM")).toBeNull();
    expect(siteDomainForMarketplace("CICEKSEPETI")).toBeNull();
  });

  it("enum dışı satıcı adından satıcı sitesini bulur; fiyat karşılaştırma siteleri hariç", () => {
    expect(sellerSiteDomain("CUSTOM", "idefix")).toEqual({ domain: "idefix.com", kind: "store" });
    expect(sellerSiteDomain("CUSTOM", "D&R")).toEqual({ domain: "dr.com.tr", kind: "store" });
    expect(sellerSiteDomain("KOCTAS", null)).toEqual({ domain: "koctas.com.tr", kind: "store" });
    expect(sellerSiteDomain("CICEKSEPETI", "Çiçeksepeti")?.domain).toBe("ciceksepeti.com");
    expect(sellerSiteDomain("TRENDYOL", "Trendyol")).toEqual({
      domain: "trendyol.com",
      kind: "marketplace",
    });
    expect(sellerSiteDomain("AKAKCE", "Akakçe")).toBeNull();
    expect(sellerSiteDomain("CUSTOM", "akakce.com")).toBeNull();
    expect(sellerSiteDomain("CUSTOM", "Bilinmeyen Mağaza")).toBeNull();
    expect(sellerSiteDomain("CUSTOM", null)).toBeNull();
  });

  it("özel scraper'ı olmayan satıcı siteleri SSRF korumalı bağımsız mağaza yolundan taranır", () => {
    expect(scraperMarketplaceFor("TRENDYOL")).toBe("TRENDYOL");
    expect(scraperMarketplaceFor("TEKNOSA")).toBe("TEKNOSA");
    expect(scraperMarketplaceFor("KOCTAS")).toBe("CUSTOM");
    expect(scraperMarketplaceFor("CUSTOM")).toBe("CUSTOM");
  });

  it("idefix ürün sayfası site: aramasından düşmez; kategori/arama/karşılaştırma düşer", () => {
    const product = "https://www.idefix.com/philips-hd9650-90-airfryer-xxl-fritoz-p-1234567";
    expect(isLikelyStoreProductUrl(product, "idefix.com")).toBe(true);
    expect(
      isLikelyStoreProductUrl("https://www.idefix.com/kategori/elektronik", "idefix.com"),
    ).toBe(false);
    expect(isLikelyStoreProductUrl("https://www.idefix.com/arama?q=philips", "idefix.com")).toBe(
      false,
    );
    expect(isLikelyStoreProductUrl("https://www.idefix.com/", "idefix.com")).toBe(false);
    expect(isLikelyStoreProductUrl("https://idefix.com.evil.net/x-p-1234567", "idefix.com")).toBe(
      false,
    );
    expect(
      isLikelyStoreProductUrl("https://www.akakce.com/fritoz/en-ucuz-1234567.html", "akakce.com"),
    ).toBe(false);
    const organic = [
      { title: "Philips HD9650/90 Airfryer XXL", link: product },
      { title: "Elektronik", link: "https://www.idefix.com/kategori/elektronik" },
    ];
    expect(mapOrganicToShoppingResults(organic)).toHaveLength(0);
    expect(mapOrganicToShoppingResults(organic, ["idefix.com"]).map((r) => r.link)).toEqual([
      product,
    ]);
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

describe("gerçek sayfa adayı: hepsini puanla, kesin retler", () => {
  it("HD9650 'hediyeli' paket ilanını kod + marka eşleşse de reddeder", () => {
    expect(
      pickDirectListing(OWN, "Philips HD9650/90 Airfryer XXL", [
        {
          title: "Philips HD9650/90 Airfryer Ekmek Kızartma Hediyeli 2 Yıl Türkiye Garantisi",
          link: "https://www.trendyol.com/philips/hd9650-90-airfryer-ekmek-kizartma-hediyeli-2-yil-turkiye-garantisi-p-123456",
        },
      ]),
    ).toBeNull();
  });

  it("hediyeli ilan ile doğru ilan birlikte gelince doğru ilanı seçer", () => {
    const picked = pickDirectListing(OWN, "Philips HD9650/90 Airfryer XXL", [
      {
        title: "Philips HD9650/90 Airfryer Ekmek Kızartma Hediyeli",
        link: "https://www.trendyol.com/philips/hd9650-90-airfryer-ekmek-kizartma-hediyeli-p-123456",
      },
      {
        title: "Philips Airfryer XXL HD9650/90",
        link: "https://www.trendyol.com/philips/airfryer-xxl-hd9650-90-p-831352478",
      },
    ]);
    expect(picked?.link).toContain("p-831352478");
  });

  it("Oral-B Lila ürününe D103 Cross Action Siyah sayfası bağlanmaz", () => {
    expect(
      pickDirectListing(
        "Oral-B Şarjlı Vitality Pro Koruma ve Temizlik Elektrikli Diş Fırçası Lila",
        "Oral-B Vitality Pro Şarjlı Diş Fırçası",
        [
          {
            title: "Oral b D103 Vitality Pro Cross Action Şarjlı Diş Fırçası Siyah",
            link: "https://www.hepsiburada.com/oral-b-d103-vitality-pro-cross-action-sarjli-dis-fircasi-siyah-pm-HBC00001ABCD",
          },
        ],
      ),
    ).toBeNull();
  });

  it("icollagen 5 Tip Kolajen ürününe Doctamin icollagen İyi Uykular bağlanmaz", () => {
    expect(
      pickDirectListing(
        "icollagen 5 Tip Kolajen ve Prebiyotik 60 Tablet",
        "Doctamin iCollagen İyi Uykular 1500 mg 60 Tablet",
        [
          {
            title: "Doctamin icollagen İyi Uykular 1500 mg 60 Tablet",
            link: "https://www.hepsiburada.com/doctamin-icollagen-iyi-uykular-1500-mg-60-tablet-pm-HBC0000JU8DTC",
          },
        ],
      ),
    ).toBeNull();
  });

  it("farklı sayfalardaki iki eşit güçte aday belirsizliktir → null", () => {
    const title = "Philips Airfryer XXL HD9650/90 Avance Collection Fritöz";
    expect(
      pickDirectListing(OWN, "Philips HD9650/90 Airfryer XXL", [
        { title, link: "https://www.trendyol.com/philips/airfryer-xxl-hd9650-90-p-111111" },
        { title, link: "https://www.trendyol.com/philips/airfryer-xxl-hd9650-90-p-222222" },
      ]),
    ).toBeNull();
    // Aynı ilanın iki URL'si belirsizlik değildir.
    expect(
      pickDirectListing(OWN, "Philips HD9650/90 Airfryer XXL", [
        { title, link: "https://www.trendyol.com/philips/airfryer-xxl-hd9650-90-p-111111" },
        {
          title,
          link: "https://www.trendyol.com/philips/airfryer-xxl-hd9650-p-111111?boutiqueId=5",
        },
      ]),
    ).not.toBeNull();
  });

  it("doğrulama gerçek sayfa başlığını kendi ürünle karşılaştırır", () => {
    const url = "https://www.trendyol.com/philips/airfryer-xxl-hd9650-90-p-831352478";
    expect(verifyDirectPage(OWN, "", "Philips Airfryer XXL HD9650/90 Avance Collection", url)).toBe(
      true,
    );
    expect(
      verifyDirectPage(
        OWN,
        "",
        "Philips HD9650/90 Airfryer + Ekmek Kızartma Makinesi Hediyeli",
        url,
      ),
    ).toBe(false);
    expect(verifyDirectPage(OWN, "", null, url)).toBe(false);
  });
});

describe("birleştirme ve takma anahtar", () => {
  const base = { targetConfirmed: false, existingTrusted: true };

  it("farklı satıcının satırına birleştirme yapılmaz (Google satırı silinmez)", () => {
    expect(decideDirectMerge({ ...base, targetSeller: "idefix", existingSeller: "Trendyol" })).toBe(
      "skip-different-seller",
    );
    expect(
      decideDirectMerge({ ...base, targetSeller: "Trendyol", existingSeller: "Trendyol" }),
    ).toBe("merge");
    expect(
      decideDirectMerge({
        ...base,
        targetConfirmed: true,
        targetSeller: "Trendyol",
        existingSeller: "Trendyol",
      }),
    ).toBe("skip-confirmed");
    expect(
      decideDirectMerge({
        ...base,
        existingTrusted: false,
        targetSeller: "Trendyol",
        existingSeller: "Trendyol",
      }),
    ).toBe("skip-untrusted-existing");
  });

  it("Google kartı yeniden görülünce gerçek sayfa kaydının fiyatı/adı Google'dan yazılmaz", () => {
    const googleLink =
      "https://www.google.com/search?ibp=oshop&q=x&prds=catalogid:123,headlineOfferDocid:9";
    const key = competitorUrlKey(googleLink);
    const rows = [
      { id: "g", competitorUrl: googleLink },
      {
        id: "d",
        competitorUrl: "https://www.trendyol.com/philips/airfryer-xxl-hd9650-90-p-831352478",
      },
    ];
    const { direct, viaGoogle } = partitionAliasHits(rows, key);
    expect(viaGoogle.map((r) => r.id)).toEqual(["g"]);
    expect(direct.map((r) => r.id)).toEqual(["d"]);
    const now = new Date("2026-11-16T10:00:00Z");
    expect(needsAliasDirectRefresh(new Date(now.getTime() - 3_600_000), now)).toBe(false);
    expect(needsAliasDirectRefresh(new Date(now.getTime() - 13 * 3_600_000), now)).toBe(true);
  });
});
