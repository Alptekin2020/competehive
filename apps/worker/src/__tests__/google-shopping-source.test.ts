import { describe, expect, it } from "vitest";

import { reevaluateUncertainMatch } from "../matcher";
import {
  marketplaceKeyForRetailer,
  cleanSellerSource,
  isGoogleHostedLink,
  resolveRetailer,
  retailerFromSourceName,
} from "../serper";
import { readCompetitorSeller, withCompetitorSeller } from "../utils/match-review";
import {
  pickStaleCompetitorsForDirectScrape,
  type KnownCompetitorSnapshot,
} from "../utils/stale-competitors";
import { competitorUrlKey } from "../utils/url-match";

// Prod'da görülen Google Alışveriş ürün kartı bağlantısı.
const GOOGLE_LINK =
  "https://www.google.com/search?ibp=oshop&q=Artema+Mutfak+Bataryas%C4%B1&prds=localAnnotatedOfferId:1,catalogid:7167250127575599714,pvo:2,pvt:hg,rds:PC_6027158597472037202%7CPROD_PC_6027158597472037202&gl=tr&udm=28&pvorigin=2";

describe("Google Alışveriş bağlantısında gerçek satıcı", () => {
  it("Google'a giden bağlantıyı tanır, satıcı bağlantısını tanımaz", () => {
    expect(isGoogleHostedLink(GOOGLE_LINK)).toBe(true);
    expect(isGoogleHostedLink("https://www.trendyol.com/x/y-p-123")).toBe(false);
    expect(isGoogleHostedLink("https://googleshop.example.com/p/1")).toBe(false);
    expect(isGoogleHostedLink("")).toBe(false);
  });

  it("source alanındaki pazaryeri adını bilinen pazaryerine çevirir", () => {
    expect(retailerFromSourceName("Trendyol")?.name).toBe("Trendyol");
    expect(retailerFromSourceName("Hepsiburada.com")?.name).toBe("Hepsiburada");
    expect(retailerFromSourceName("Amazon.com.tr - Satıcı")?.name).toBe("Amazon TR");
    expect(retailerFromSourceName("n11.com")?.name).toBe("N11");
    expect(retailerFromSourceName("PttAVM")?.name).toBe("PTT AVM");
    expect(retailerFromSourceName("MediaMarkt Türkiye")?.name).toBe("MediaMarkt");
    expect(retailerFromSourceName("Evkur")).toBeNull();
    expect(retailerFromSourceName("Vatansever Ticaret")).toBeNull();
  });

  it("canlıda görülen satıcı adlarını doğru pazaryerine çevirir (2026-11-15 logları)", () => {
    const cases: Array<[string, string | null]> = [
      ["Amazon.com.tr - Amazon.com.tr – pazaryeri", "AMAZON_TR"],
      ["Amazon", "AMAZON_TR"],
      ["PttAVM.com", "PTTAVM"],
      ["Vatan Bilgisayar", "VATAN"],
      ["ciceksepeti.com", "CICEKSEPETI"],
      ["Koçtaş", "KOCTAS"],
      ["hepsiburada.com", "HEPSIBURADA"],
      ["idefix", null],
      ["Moderneczane.com", null],
      ["Baharatevim.com.tr", null],
    ];
    for (const [source, expected] of cases) {
      const retailer = retailerFromSourceName(source);
      expect(retailer ? marketplaceKeyForRetailer(retailer.name) : null, source).toBe(expected);
    }
  });

  it("google.com ve boş değerleri satıcı saymaz", () => {
    expect(cleanSellerSource("google.com")).toBeNull();
    expect(cleanSellerSource("Google")).toBeNull();
    expect(cleanSellerSource("web")).toBeNull();
    expect(cleanSellerSource("  ")).toBeNull();
    expect(cleanSellerSource(undefined)).toBeNull();
    expect(cleanSellerSource(" Evkur ")).toBe("Evkur");
  });

  it("Google bağlantısında satıcıyı source'tan çözer ve taranamaz işaretler", () => {
    const known = resolveRetailer({ link: GOOGLE_LINK, source: "Trendyol" });
    expect(known).toMatchObject({ name: "Trendyol", viaGoogle: true, sellerName: "Trendyol" });

    const other = resolveRetailer({ link: GOOGLE_LINK, source: "Evkur" });
    expect(other).toMatchObject({ name: "Diğer", viaGoogle: true, sellerName: "Evkur" });

    const unknown = resolveRetailer({ link: GOOGLE_LINK, source: "google.com" });
    expect(unknown).toMatchObject({ name: "Diğer", viaGoogle: true, sellerName: null });
  });

  it("doğrudan satıcı bağlantısında alan adı esastır", () => {
    const direct = resolveRetailer({
      link: "https://www.hepsiburada.com/urun-p-HBV00001",
      source: "Başka Bir Şey",
    });
    expect(direct).toMatchObject({ name: "Hepsiburada", viaGoogle: false, sellerName: null });
  });
});

describe("Google ürün kartı bağlantısı anahtarı", () => {
  it("aynı ilan farklı arama sorgusunda aynı anahtarı verir", () => {
    const other = GOOGLE_LINK.replace("q=Artema+Mutfak+Bataryas%C4%B1", "q=artema+batarya").replace(
      "&pvorigin=2",
      "&pvorigin=3&hl=tr",
    );
    expect(competitorUrlKey(other)).toBe(competitorUrlKey(GOOGLE_LINK));
    expect(competitorUrlKey(GOOGLE_LINK)).toBe("google.com/shopping?catalogid=7167250127575599714");
  });

  it("farklı ürün kimlikleri farklı anahtar verir", () => {
    const other = GOOGLE_LINK.replace("catalogid:7167250127575599714", "catalogid:111");
    expect(competitorUrlKey(other)).not.toBe(competitorUrlKey(GOOGLE_LINK));
  });

  it("satıcı bağlantılarının anahtarı değişmez", () => {
    expect(competitorUrlKey("https://www.trendyol.com/a/b-p-1?merchantId=5&srsltid=x")).toBe(
      "trendyol.com/a/b-p-1?merchantid=5",
    );
  });
});

describe("Google bağlantılı rakip doğrudan taramaya seçilmez", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const base: KnownCompetitorSnapshot = {
    id: "c1",
    competitorName: "Artema Mutfak Bataryası",
    currentPrice: 1000,
    matchScore: 90,
    marketplace: "TRENDYOL",
    lastScrapedAt: new Date("2026-11-10T12:00:00Z"),
  };

  it("pazaryeri Trendyol olsa da google.com bağlantısı elenir", () => {
    const picked = pickStaleCompetitorsForDirectScrape(
      [
        { ...base, competitorUrl: GOOGLE_LINK },
        { ...base, id: "c2", competitorUrl: "https://www.trendyol.com/a/b-p-1" },
      ],
      new Set(),
      now,
    );
    expect(picked.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("satıcı adı matchAttributes içinde saklanır", () => {
  it("mevcut alanları koruyarak ekler ve geri okur", () => {
    const attrs = withCompetitorSeller({ brandMatch: true, review: "pending" }, "Evkur");
    expect(attrs).toEqual({ brandMatch: true, review: "pending", seller: "Evkur" });
    expect(readCompetitorSeller(attrs)).toBe("Evkur");
  });

  it("satıcı yoksa girdiyi değiştirmez (undefined = alana dokunma)", () => {
    expect(withCompetitorSeller(undefined, null)).toBeUndefined();
    const attrs = { brandMatch: true };
    expect(withCompetitorSeller(attrs, null)).toBe(attrs);
    expect(readCompetitorSeller({ seller: "  " })).toBeNull();
  });
});

describe("onay bekleyen adayın deterministik yeniden değerlendirmesi", () => {
  const source = { title: "icollagen 5 Tip Kolajen Ve Prebiyotik 60 Tablet", price: 500 };

  it("güçlü başlık örtüşmesi olan 50–69 puanlı adayı 75 ile kabul eder", () => {
    const result = reevaluateUncertainMatch(
      source,
      { title: "icollagen Kolajen Ve Prebiyotik Tablet", price: 450 },
      { score: 60, categoryMatch: true },
    );
    expect(result).toMatchObject({ isMatch: true, score: 75 });
  });

  it("neredeyse aynı başlığı eski skordan bağımsız 88 ile kabul eder", () => {
    const result = reevaluateUncertainMatch(
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr", price: 160 },
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 Gr", price: 150 },
      { score: 55 },
    );
    expect(result).toMatchObject({ isMatch: true, score: 88 });
  });

  it("çoklu paket, fiyat bandı dışı veya kategori uyuşmazlığında kabul etmez", () => {
    expect(
      reevaluateUncertainMatch(
        { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr", price: 160 },
        { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 Gr X 6 Adet", price: 455 },
        { score: 60 },
      ),
    ).toBeNull();
    expect(
      reevaluateUncertainMatch(
        source,
        { title: "icollagen Kolajen Ve Prebiyotik Tablet", price: 5000 },
        { score: 60, categoryMatch: true },
      ),
    ).toBeNull();
    expect(
      reevaluateUncertainMatch(
        source,
        { title: "icollagen Kolajen Ve Prebiyotik Tablet", price: 450 },
        { score: 60, categoryMatch: false },
      ),
    ).toBeNull();
  });

  it("URL yolundaki paket bilgisi çelişiyorsa kabul etmez", () => {
    expect(
      reevaluateUncertainMatch(
        { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr", price: 160 },
        {
          title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 Gr",
          url: "https://www.pttavm.com/kahve-dunyasi-tambol-cilekli-100-g-7-li-paket-p-123",
          price: 300,
        },
        { score: 60 },
      ),
    ).toBeNull();
  });

  it("30 puanlı (emin olunmayan değil, reddedilmiş) adayı örtüşmeyle yükseltmez", () => {
    expect(
      reevaluateUncertainMatch(
        source,
        { title: "icollagen Kolajen Ve Prebiyotik Tablet", price: 450 },
        { score: 30, categoryMatch: true },
      ),
    ).toBeNull();
  });
});
