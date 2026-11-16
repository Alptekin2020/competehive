import { describe, expect, it } from "vitest";
import { compareProductCodes, extractProductCodes } from "../utils/competitor-quality";
import {
  analyzeModelIdentity,
  compareModelIdentity,
  hasColourOrShadeConflict,
  parseModelCodes,
  slugModelText,
} from "../utils/model-identity";

const OWNER_SOURCE = {
  title: "Philips EP3347/90 3300 Serisi Tam Otomatik Espresso Makinesi",
  url: "https://www.trendyol.com/philips/ep3347-90-tam-otomatik-espresso-makinesi-p-795891055",
};
const GOOGLE_CARD =
  "https://www.google.com/search?ibp=oshop&q=philips+series+3300&prds=catalogid:123,pvo:1";

describe("parseModelCodes", () => {
  it("reads slash and dash suffixes as {base, suffix}", () => {
    expect(parseModelCodes("Philips EP3347/90 Espresso")).toEqual([
      expect.objectContaining({ base: "EP3347", suffix: "90" }),
    ]);
    expect(parseModelCodes("Philips EP3347-90 Espresso")).toEqual([
      expect.objectContaining({ base: "EP3347", suffix: "90" }),
    ]);
  });

  it("never reads EP3347-90 as EP334790", () => {
    expect(extractProductCodes("Philips EP3347-90 Espresso")).toEqual(["EP3347"]);
  });

  it("drops a manufacturer prefix into core (SM-A556B → A556B)", () => {
    expect(parseModelCodes("Samsung Galaxy SM-A556B")[0]).toMatchObject({
      base: "SMA556B",
      core: "A556B",
    });
  });

  it("ignores barcodes and hardware codes", () => {
    expect(parseModelCodes("Lenovo i5-13450HX RTX5050 8681677004991")).toEqual([]);
  });

  it("reads Samsung digit-leading codes (98DU9000)", () => {
    expect(parseModelCodes("SAMSUNG 98 98DU9000 Crystal")[0].base).toBe("98DU9000");
  });
});

describe("slugModelText", () => {
  it("strips the Trendyol listing id and recovers the slash suffix", () => {
    expect(slugModelText(OWNER_SOURCE.url)).toBe(
      "philips ep3347/90 tam otomatik espresso makinesi",
    );
  });

  it("strips Hepsiburada -pm- ids and Amazon ASINs", () => {
    expect(
      slugModelText("https://www.hepsiburada.com/philips-ep3341-50-espresso-pm-HBC00004XYZ12"),
    ).toBe("philips ep3341/50 espresso");
    expect(
      slugModelText("https://www.amazon.com.tr/Philips-EP3347-90-LatteGo/dp/B0C1234567?th=1"),
    ).toBe("philips ep3347/90 lattego");
  });

  it("does not turn a size after the code into a suffix", () => {
    expect(slugModelText("https://www.n11.com/urun/samsung-ue55du7000-55-inc-tv-1234567")).toBe(
      "samsung ue55du7000 55 inc tv",
    );
  });

  it("returns empty for Google product cards", () => {
    expect(slugModelText(GOOGLE_CARD)).toBe("");
  });
});

describe("compareModelIdentity", () => {
  it("owner case: Series 3300 Google card without a code is unknown", () => {
    expect(
      compareModelIdentity(OWNER_SOURCE, {
        title: "Philips Series 3300 tam otomatik espresso makinesi 6 sıcak ve buzlu içecek",
        url: GOOGLE_CARD,
      }),
    ).toBe("unknown");
  });

  it("owner case: EP3341/50 is a conflict with a Turkish reason", () => {
    const analysis = analyzeModelIdentity(OWNER_SOURCE, {
      title: "Philips EP3341/50 3300 Serisi Tam Otomatik Espresso Makinesi",
    });
    expect(analysis.relation).toBe("conflict");
    expect(analysis.reason).toBe("Model kodu farklı: EP3347/90 ≠ EP3341/50");
  });

  it("reads the candidate code from its URL slug", () => {
    expect(
      compareModelIdentity(OWNER_SOURCE, {
        title: "Philips 3300 Serisi Tam Otomatik Espresso Makinesi",
        url: "https://www.trendyol.com/philips/ep3341-50-3300-serisi-p-12345",
      }),
    ).toBe("conflict");
  });

  it("uses the scraped page title", () => {
    expect(
      compareModelIdentity(OWNER_SOURCE, {
        title: "Philips 3300 Serisi Espresso",
        pageTitle: "Philips EP3347/90 LatteGo",
      }),
    ).toBe("same");
  });

  it("EP3347/90 vs EP3347-90 is the same", () => {
    expect(
      compareModelIdentity({ title: "Philips EP3347/90 LatteGo" }, { title: "Philips EP3347-90" }),
    ).toBe("same");
  });

  it("missing region suffix is not a variant (EP3347/90 vs EP3347)", () => {
    expect(
      compareModelIdentity({ title: "Philips EP3347/90 LatteGo" }, { title: "Philips EP3347" }),
    ).toBe("same");
  });

  it("HD9650/90 vs HD9650/99 is a config variant", () => {
    expect(
      compareModelIdentity(
        { title: "Philips Airfryer XXL HD9650/90 Fritöz" },
        { title: "Philips Airfryer XXL HD9650/99 Fritöz" },
      ),
    ).toBe("config-variant");
    expect(
      compareProductCodes("Philips Airfryer XXL HD9650/90", "Philips Airfryer XXL HD9650/99"),
    ).toBe("config-variant");
  });

  it("SM-A556 vs A566 is a conflict", () => {
    expect(
      compareModelIdentity(
        { title: "Samsung Galaxy A55 5G SM-A556 128GB Siyah" },
        { title: "Samsung Galaxy A56 5G SM-A566B 128GB Siyah" },
      ),
    ).toBe("conflict");
    expect(
      compareModelIdentity({ title: "Samsung SM-A556 128GB" }, { title: "Samsung A566 128GB" }),
    ).toBe("conflict");
  });

  it("Galaxy A55 vs A56 without codes is a conflict", () => {
    expect(
      compareModelIdentity(
        { title: "Samsung Galaxy A55 5G 128GB" },
        { title: "Samsung Galaxy A56 5G 128GB" },
      ),
    ).toBe("conflict");
  });

  it("iPhone 15 vs 16 is a conflict; 15 vs 15 is same", () => {
    expect(
      compareModelIdentity(
        { title: "Apple iPhone 15 128GB Siyah" },
        { title: "Apple iPhone 16 128GB Siyah" },
      ),
    ).toBe("conflict");
    expect(
      compareModelIdentity(
        { title: "Apple iPhone 15 128GB Siyah" },
        { title: "iPhone 15 128 GB Mavi" },
      ),
    ).toBe("same");
  });

  it("V15 vs V12 and Note 13 vs Note 14 are conflicts", () => {
    expect(
      compareModelIdentity(
        { title: "Dyson V15 Detect Absolute Kablosuz Süpürge" },
        { title: "Dyson V12 Detect Slim Kablosuz Süpürge" },
      ),
    ).toBe("conflict");
    expect(
      compareModelIdentity(
        { title: "Xiaomi Redmi Note 13 Pro 8GB 256GB" },
        { title: "Xiaomi Redmi Note 14 Pro 8GB 256GB" },
      ),
    ).toBe("conflict");
  });

  it("3300 Serisi vs 2200 Serisi is a conflict; 3300 Serisi vs Series 3300 is same", () => {
    expect(
      compareModelIdentity(
        { title: "Philips 3300 Serisi Espresso Makinesi" },
        { title: "Philips 2200 Serisi Espresso Makinesi" },
      ),
    ).toBe("conflict");
    expect(
      compareModelIdentity(
        { title: "Philips 3300 Serisi Espresso Makinesi" },
        { title: "Philips Series 3300 espresso makinesi" },
      ),
    ).toBe("same");
  });

  it("UE55 vs UE65 is a conflict, also by screen size alone", () => {
    expect(
      compareModelIdentity(
        { title: 'Samsung 55" Crystal UHD 4K Smart TV UE55DU7000' },
        { title: 'Samsung 65" Crystal UHD 4K Smart TV UE65DU7000' },
      ),
    ).toBe("conflict");
    expect(
      compareModelIdentity(
        { title: "Samsung 55 inç Crystal UHD 4K Smart TV" },
        { title: "Samsung 65 inch Crystal UHD 4K Smart TV" },
      ),
    ).toBe("conflict");
    expect(
      compareModelIdentity({ title: 'Samsung 98" 98DU9000' }, { title: "SAMSUNG 98 inç 98DU9000" }),
    ).toBe("same");
  });

  it("98DU9000 vs 85DU9000 is a conflict", () => {
    expect(
      compareModelIdentity({ title: "Samsung 98DU9000 TV" }, { title: "Samsung 85DU9000 TV" }),
    ).toBe("conflict");
  });

  it("Kumtel LX-6331 vs Luxell LX-6331 is the same", () => {
    expect(
      compareModelIdentity(
        { title: "Kumtel LX-6331 Fanlı Isıtıcı" },
        {
          title: "Luxell LX-6331 Fanlı Isıtıcı",
          url: "https://www.trendyol.com/luxell/lx-6331-fanli-isitici-p-998877",
        },
      ),
    ).toBe("same");
  });

  it("colour-only difference keeps the identity same (OK004 vs OK004-K)", () => {
    expect(
      compareModelIdentity(
        { title: "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Bakır" },
        { title: "Arzum OK004-K Okka Minio Türk Kahvesi Makinesi Krom" },
      ),
    ).toBe("same");
  });

  it("different code kinds (MPN vs product line) are unknown, not a conflict", () => {
    expect(
      compareModelIdentity(
        { title: "Lenovo LOQ 16GB 512GB 83SC000QTR" },
        { title: "Lenovo LOQ 15IRX11 16GB 512GB" },
      ),
    ).toBe("unknown");
  });

  it("titles without any model identity are none", () => {
    expect(
      compareModelIdentity(
        { title: "Kahve Dünyası Tambol Çilekli Milföy 100 gr" },
        { title: "Kahve Dünyası Tambol Çilekli Milföy 100 gr" },
      ),
    ).toBe("none");
  });
});

describe("hasColourOrShadeConflict", () => {
  it("flags different colours on both sides (Oral-B Lila vs Siyah)", () => {
    expect(
      hasColourOrShadeConflict(
        "Oral-B Vitality Pro Şarjlı Diş Fırçası Lila",
        "Oral-B Vitality Pro Şarjlı Diş Fırçası Siyah",
      ),
    ).toBe(true);
  });

  it("missing colour on one side is not a conflict", () => {
    expect(
      hasColourOrShadeConflict("Oral-B Vitality Pro Lila", "Oral-B Vitality Pro Diş Fırçası"),
    ).toBe(false);
  });

  it("flags different shade numbers", () => {
    expect(hasColourOrShadeConflict("Note Pudra No:01", "Note Pudra No:02")).toBe(true);
  });
});
