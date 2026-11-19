import { describe, expect, it } from "vitest";
import {
  extractTitleGtin,
  gtinUrlText,
  isValidGtin,
  textHasGtin,
  trendyolBrandSlug,
  withListingBrand,
} from "../utils/listing-identity";
import { reevaluateUncertainMatch, verifyProductMatch } from "../matcher";

const EVDE_SOURCE =
  "Evde Aesthetic Multi Vitamin Hair Cocktail Saç Bölgesi Serum 2ml X 10 Ampul 8681677004991";

describe("barkod (GTIN)", () => {
  it("validates check digits", () => {
    expect(isValidGtin("8681677004991")).toBe(true);
    expect(isValidGtin("8681677004992")).toBe(false);
    expect(isValidGtin("12345")).toBe(false);
  });

  it("reads a valid barcode from the title, never a random digit run", () => {
    expect(extractTitleGtin(EVDE_SOURCE)).toBe("8681677004991");
    expect(extractTitleGtin("Ürün 8681677004992 kodlu")).toBeNull();
    expect(extractTitleGtin("Lenovo 83SC000QTR 16GB")).toBeNull();
  });

  it("matches the barcode only as a standalone number", () => {
    expect(textHasGtin('"gtin13":"8681677004991"', "8681677004991")).toBe(true);
    expect(textHasGtin("id 186816770049910", "8681677004991")).toBe(false);
  });
});

describe("Trendyol marka yolu", () => {
  it("reads the store segment, including /pd/ listings", () => {
    expect(trendyolBrandSlug("https://www.trendyol.com/doganay/mutfak-bataryasi-p-34370701")).toBe(
      "doganay",
    );
    expect(trendyolBrandSlug("https://www.trendyol.com/pd/bariton/mutfak-evye-p-665923238")).toBe(
      "bariton",
    );
    expect(trendyolBrandSlug("https://www.n11.com/urun/x-1")).toBeNull();
    expect(trendyolBrandSlug("https://www.trendyol.com/sr")).toBeNull();
  });

  it("prefixes the source brand when the store path names it (Doğanay prod vakası)", () => {
    const title = withListingBrand(
      "Doğanay Krom Mutfak Bataryası Uzun Kuğu Aç Kapa",
      "Mutfak Bataryası Sıcak Soğuk Çift Girişli Aç Kapa Pirinç Malzeme",
      "https://www.trendyol.com/doganay/mutfak-bataryasi-sicak-soguk-cift-girisli-ac-kapa-pirinc-malzeme-p-34370701",
    );
    expect(title).toBe("Doğanay Mutfak Bataryası Sıcak Soğuk Çift Girişli Aç Kapa Pirinç Malzeme");
  });

  it("handles multi-word brands and leaves other stores alone", () => {
    expect(
      withListingBrand(
        "Pati Clean 20 Lt Kedi Kumu",
        "20 Lt Kedi Kumu",
        "https://www.trendyol.com/pati-clean/20-lt-kedi-kumu-p-1",
      ),
    ).toBe("Pati Clean 20 Lt Kedi Kumu");
    expect(
      withListingBrand(
        "Blue Home Papatya Raf Örtüsü",
        "2-3-5-10 Metre X 45 Cm Papatya",
        "https://www.trendyol.com/yek-home-tekstil-evinizin-her-yerinde/2-3-5-10-metre-p-1",
      ),
    ).toBe("2-3-5-10 Metre X 45 Cm Papatya");
    expect(
      withListingBrand(
        "Doğanay Batarya",
        "Doğanay Mutfak Bataryası",
        "https://www.trendyol.com/doganay/mutfak-bataryasi-p-1",
      ),
    ).toBe("Doğanay Mutfak Bataryası");
  });
});

describe("matcher — barkod ve marka yolu", () => {
  it("accepts a truncated, brandless listing whose search snippet carries the barcode", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await verifyProductMatch(
      { title: EVDE_SOURCE, price: 248.9 },
      {
        title: "Multi Vitamin Hair Cocktail Dökülme Karşıtı Saç/kaş Bakım Serumu 2ml ...",
        url: "https://www.n11.com/urun/multi-vitamin-hair-cocktail-dokulme-karsiti-sackas-bakim-serumu-2ml-x-10-ampul-111492082",
        snippet: "Barkod: 8681677004991 · Evde Aesthetic",
      },
    );
    expect(result.isMatch).toBe(true);
    expect(result.score).toBe(95);
    expect(result.attributes.matchBasis).toBe("model-code");
  });

  it("does not accept on a different barcode", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await verifyProductMatch(
      { title: EVDE_SOURCE, price: 248.9 },
      {
        title: "Evde Aesthetic Whitening Cocktail Serum 2ml x 10",
        url: "https://www.hepsiburada.com/evde-aesthetic-whitening-cocktail-pm-HBC0000",
        snippet: "Barkod: 8681677004984",
      },
    );
    expect(result.score).not.toBe(95);
  });

  it("promotes a Trendyol listing whose title omits the brand found in its store path", () => {
    const promoted = reevaluateUncertainMatch(
      { title: "Pati Clean 20 Lt İnce Taneli Kedi Kumu Kokusuz", price: 179.9 },
      {
        title: "20 Lt İnce Taneli Kedi Kumu Kokusuz",
        url: "https://www.trendyol.com/pati-clean/20-lt-ince-taneli-kedi-kumu-kokusuz-p-1145330103",
        price: 189.9,
      },
      { score: 30 },
    );
    expect(promoted?.isMatch).toBe(true);
  });
});

describe("barcode evidence never comes from a search query (prod 19 Nov)", () => {
  const GOOGLE_CARD =
    "https://www.google.com/search?ibp=oshop&q=Evde+Aesthetic+8681677004991&prds=catalogid:5542020750947907179,pvo:2&gl=tr&udm=28";

  it("drops Google cards and query strings from the URL text", () => {
    expect(gtinUrlText(GOOGLE_CARD)).toBe("");
    expect(gtinUrlText("https://www.n11.com/urun/serum-8681677004991-123?q=1")).toBe(
      "www.n11.com/urun/serum-8681677004991-123",
    );
    expect(gtinUrlText("https://shop.example.com/p?barcode=8681677004991")).toBe(
      "shop.example.com/p",
    );
    expect(gtinUrlText(undefined)).toBe("");
  });

  it("does not accept another product of the brand whose Google card URL echoes the query", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await verifyProductMatch(
      { title: EVDE_SOURCE },
      { title: "Evde Aesthetic Dermoroller 540 İğneli 2 mm", url: GOOGLE_CARD },
    );
    expect(result.score).toBeLessThan(95);
  });

  it("still accepts the barcode in a listing path", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await verifyProductMatch(
      { title: EVDE_SOURCE },
      {
        title: "Evde Aesthetic Multi Vitamin...",
        url: "https://www.n11.com/urun/evde-aesthetic-serum-8681677004991-123456",
      },
    );
    expect(result.score).toBe(95);
  });
});
