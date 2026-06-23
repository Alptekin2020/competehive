import { describe, it, expect } from "vitest";

import {
  withinPriceBand,
  isPackagingListing,
  assessCompetitor,
  isUsableCompetitor,
  extractProductCodes,
  sharesStrongProductCode,
  COMPETITOR_STALE_HOURS,
} from "../competitor-quality";

describe("extractProductCodes", () => {
  it("extracts MPN and barcode, longest (most specific) first", () => {
    const codes = extractProductCodes(
      "LENOVO LOQ i5-13450HX 16GB 512GB SSD RTX 5050 FreeDOS 83SC000QTR",
    );
    expect(codes[0]).toBe("83SC000QTR"); // MPN, norm len 10 — en spesifik
    expect(codes).toContain("i5-13450HX");
  });

  it("extracts a barcode", () => {
    expect(extractProductCodes("Evde Aesthetic Serum 2ml X 10 Ampul 8681677004991")).toContain(
      "8681677004991",
    );
  });

  it("ignores short spec-like tokens", () => {
    expect(extractProductCodes("Karaca Çelik Tencere 16GB 8 cm")).toEqual([]);
  });

  it("returns [] for plain names", () => {
    expect(extractProductCodes("Havaianas Top Tiras Terlik")).toEqual([]);
  });
});

describe("sharesStrongProductCode", () => {
  it("matches two listings sharing a long MPN", () => {
    expect(
      sharesStrongProductCode(
        "LENOVO LOQ i5-13450HX 83SC000QTR",
        "Lenovo LOQ Notebook 83SC000QTR FreeDOS",
      ),
    ).toBe(true);
  });

  it("matches two listings sharing a barcode", () => {
    expect(
      sharesStrongProductCode("Erbatab D3 K2 8681677004991", "Erbatab Damla 8681677004991 10ml"),
    ).toBe(true);
  });

  it("does NOT match on a shared short spec code (CPU) — different configs stay separate", () => {
    // i5-13450HX normalize len 9 < 10 → güçlü kod değil; iki farklı laptop eşleşmez.
    expect(
      sharesStrongProductCode(
        "Lenovo LOQ i5-13450HX 16GB RTX 5050",
        "Asus TUF i5-13450HX 32GB RTX 4060",
      ),
    ).toBe(false);
  });

  it("does not match when no codes present", () => {
    expect(sharesStrongProductCode("Havaianas Terlik", "Nike Ayakkabı")).toBe(false);
  });
});

const NOW = new Date("2026-06-11T12:00:00Z");
const FRESH = new Date(NOW.getTime() - 2 * 60 * 60 * 1000); // 2 saat önce
const STALE = new Date(NOW.getTime() - (COMPETITOR_STALE_HOURS + 1) * 60 * 60 * 1000);

describe("withinPriceBand", () => {
  it("accepts candidates inside the 0.3x–3x band", () => {
    expect(withinPriceBand(1000, 300)).toBe(true);
    expect(withinPriceBand(1000, 1000)).toBe(true);
    expect(withinPriceBand(1000, 3000)).toBe(true);
  });

  it("rejects candidates outside the band", () => {
    expect(withinPriceBand(2500, 11)).toBe(false); // koli vs terlik vakası
    expect(withinPriceBand(1000, 299)).toBe(false);
    expect(withinPriceBand(1000, 3001)).toBe(false);
  });

  it("passes everything when source price is unknown", () => {
    expect(withinPriceBand(0, 11)).toBe(true);
    expect(withinPriceBand(NaN, 11)).toBe(true);
  });

  it("rejects invalid candidate prices", () => {
    expect(withinPriceBand(1000, 0)).toBe(false);
    expect(withinPriceBand(1000, NaN)).toBe(false);
  });
});

describe("isPackagingListing", () => {
  const slipper = "Havaianas Top Tiras Kadın Gümüş Terlik 4137428-5178 Gümüş - Gri";

  it("flags packaging store/product names against a consumer product", () => {
    expect(isPackagingListing("Bojopack 20x15x10 Koli 25 Adet", slipper)).toBe(true);
    expect(isPackagingListing("kolikutugelsin 30x20x15 Kutu", slipper)).toBe(true);
    expect(isPackagingListing("Kolicim Ambalaj Kraft Kutu", slipper)).toBe(true);
    expect(isPackagingListing("Baloncuklu Naylon 50cm x 10m", slipper)).toBe(true);
    expect(isPackagingListing("Kargo Poşeti 100 Adet 25x35", slipper)).toBe(true);
    expect(isPackagingListing("Koli Bandı Şeffaf 45mm", slipper)).toBe(true);
    expect(isPackagingListing("Streç Film 50cm Endüstriyel", slipper)).toBe(true);
  });

  it("flags dimension + kutu combinations", () => {
    expect(isPackagingListing("E-Ticaret Kutusu 20x20x10 100 Adet", slipper)).toBe(true);
    expect(isPackagingListing("25x15x10 Hediyelik Kutu 50 li", slipper)).toBe(true);
  });

  it("does not flag normal consumer products", () => {
    expect(isPackagingListing("Havaianas Top Tiras Terlik Gümüş", slipper)).toBe(false);
    expect(isPackagingListing("Nike Air Max 270 Spor Ayakkabı", slipper)).toBe(false);
    expect(isPackagingListing("Apple iPhone 15 128 GB", slipper)).toBe(false);
  });

  it("does not flag 'kutu' alone (legit gift-box style products)", () => {
    expect(isPackagingListing("Ahşap Çay Kutusu El Yapımı", slipper)).toBe(false);
    expect(isPackagingListing("Hediye Kutulu Kol Saati", slipper)).toBe(false);
  });

  it("does not flag brokoli (substring exclusion)", () => {
    expect(isPackagingListing("Taze Brokoli 1 Kg", "Sebze Kurutma Makinesi")).toBe(false);
  });

  it("allows packaging candidates when the source itself is a packaging product", () => {
    expect(isPackagingListing("Bojopack 20x15x10 Koli", "Avantajpack 20x15x10 Koli 25 Adet")).toBe(
      false,
    );
  });

  it("handles Turkish casing (İ/I) correctly", () => {
    expect(isPackagingListing("KOLİ KUTU AMBALAJ 10 ADET", slipper)).toBe(true);
  });
});

describe("assessCompetitor", () => {
  it("accepts a fresh, scored, in-band competitor", () => {
    const result = assessCompetitor(
      { price: 2400, matchScore: 85, lastScrapedAt: FRESH },
      { ownPrice: 2500, now: NOW },
    );
    expect(result.usable).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("accepts unscored (legacy/manual) competitors only when price is in band", () => {
    expect(
      isUsableCompetitor(
        { price: 2400, matchScore: null, lastScrapedAt: FRESH },
        { ownPrice: 2500, now: NOW },
      ),
    ).toBe(true);

    // Ekran görüntüsündeki vaka: ₺11 koli vs ₺2.500 terlik, skor yok.
    const box = assessCompetitor(
      { price: 11, matchScore: null, lastScrapedAt: FRESH },
      { ownPrice: 2500, now: NOW },
    );
    expect(box.usable).toBe(false);
    expect(box.issues).toContain("out-of-band");
  });

  it("rejects low match scores", () => {
    const result = assessCompetitor(
      { price: 2400, matchScore: 50, lastScrapedAt: FRESH },
      { ownPrice: 2500, now: NOW },
    );
    expect(result.usable).toBe(false);
    expect(result.issues).toContain("low-score");
  });

  it("rejects stale data", () => {
    const result = assessCompetitor(
      { price: 2400, matchScore: 90, lastScrapedAt: STALE },
      { ownPrice: 2500, now: NOW },
    );
    expect(result.usable).toBe(false);
    expect(result.issues).toContain("stale");
  });

  it("treats missing lastScrapedAt as stale", () => {
    const result = assessCompetitor(
      { price: 2400, matchScore: 90, lastScrapedAt: null },
      { ownPrice: 2500, now: NOW },
    );
    expect(result.issues).toContain("stale");
  });

  it("rejects missing or zero price", () => {
    expect(
      assessCompetitor({ price: null, matchScore: 90, lastScrapedAt: FRESH }, { now: NOW }).issues,
    ).toContain("no-price");
    expect(
      assessCompetitor({ price: 0, matchScore: 90, lastScrapedAt: FRESH }, { now: NOW }).issues,
    ).toContain("no-price");
  });

  it("skips the band check when own price is unknown", () => {
    expect(
      isUsableCompetitor({ price: 11, matchScore: 90, lastScrapedAt: FRESH }, { now: NOW }),
    ).toBe(true);
  });

  it("accepts string dates", () => {
    expect(
      isUsableCompetitor(
        { price: 2400, matchScore: 90, lastScrapedAt: FRESH.toISOString() },
        { ownPrice: 2500, now: NOW },
      ),
    ).toBe(true);
  });

  it("collects multiple issues at once", () => {
    const result = assessCompetitor(
      { price: 11, matchScore: 10, lastScrapedAt: STALE },
      { ownPrice: 2500, now: NOW },
    );
    expect(result.issues).toEqual(expect.arrayContaining(["low-score", "out-of-band", "stale"]));
  });
});
