import { describe, it, expect } from "vitest";

import {
  withinPriceBand,
  isPackagingListing,
  assessCompetitor,
  isUsableCompetitor,
  extractProductCodes,
  sharesStrongProductCode,
  COMPETITOR_STALE_HOURS,
  hasConflictingSpecs,
  hasConflictingCountDescriptors,
  compareProductCodes,
  isAccessoryListing,
} from "../competitor-quality";

describe("extractProductCodes", () => {
  it("extracts MPN and barcode, longest (most specific) first", () => {
    const codes = extractProductCodes(
      "LENOVO LOQ i5-13450HX 16GB 512GB SSD RTX 5050 FreeDOS 83SC000QTR",
    );
    expect(codes[0]).toBe("83SC000QTR"); // MPN, norm len 10 — en spesifik
  });

  it("extracts a barcode", () => {
    expect(extractProductCodes("Evde Aesthetic Serum 2ml X 10 Ampul 8681677004991")).toContain(
      "8681677004991",
    );
  });

  it("extracts 5-char appliance model codes (Arzum OK004 prod vakası)", () => {
    expect(
      extractProductCodes("Arzum OK004 Okka Minio Türk Kahvesi Makinesi 4 Fincan Kapasiteli"),
    ).toContain("OK004");
    expect(extractProductCodes("Philips Airfryer XXL HD9650/90 Fritöz")).toContain("HD9650");
  });

  it("does NOT treat shared hardware/spec codes as product identity", () => {
    const codes = extractProductCodes(
      'LENOVO LOQE i5-13450HX 16GB 512GB SSD 15.6" FHD 144Hz RTX5050 8GB GDDR7 FreeDOS',
    );
    // i5-13450HX, RTX5050, 144Hz, GDDR7: iki FARKLI laptopta da geçer — kimlik değil.
    expect(codes).toEqual([]);
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

describe("hasConflictingSpecs (varyant guard'ı)", () => {
  const LENOVO_16_512 =
    'LENOVO LOQE i5-13450HX 16GB 512GB SSD 15.6" FHD 144Hz RTX 5050 8GB GDDR7 FreeDOS 83SC000QTR';

  it("flags RAM variant of the same MPN (16GB vs 20GB)", () => {
    const candidate =
      "Lenovo Loqe Intel Core I5-13450HX 20GB 512GB SSD 8 GB RTX5050 144Hz Gaming Laptop 83SC000QTR 001";
    expect(hasConflictingSpecs(LENOVO_16_512, candidate)).toBe(true);
  });

  it("flags storage variant across units (512GB vs 1TB)", () => {
    const candidate =
      "LENOVO LOQE i5-13450HX 16GB 1TB SSD 8 GB RTX5050 144Hz Gaming Laptop 83SC000QTR 006";
    expect(hasConflictingSpecs(LENOVO_16_512, candidate)).toBe(true);
  });

  it("does not flag the identical configuration with different wording", () => {
    const candidate =
      "Lenovo LOQ 15IRX11 Intel Core i5 13450HX 16GB 512GB SSD 8GB RTX5050 15.6 FHD 144Hz IPS Freedos 83SC000QTR";
    expect(hasConflictingSpecs(LENOVO_16_512, candidate)).toBe(false);
  });

  it("does not flag color-only variants (no numeric specs)", () => {
    expect(
      hasConflictingSpecs(
        "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Bakır",
        "Arzum OK004-K Okka Minio Türk Kahvesi Makinesi Krom",
      ),
    ).toBe(false);
  });

  it("treats one-sided (missing) spec info as no conflict", () => {
    expect(
      hasConflictingSpecs(
        "Philips Airfryer XXL HD9650/90 7,2 lt Fritöz",
        "Philips Airfryer XXL HD9650/90 Fritöz",
      ),
    ).toBe(false);
  });

  it("flags volume variants (50ml vs 100ml, L→ml normalization)", () => {
    expect(hasConflictingSpecs("Parfüm 50ml", "Parfüm 100 ml")).toBe(true);
    expect(hasConflictingSpecs("Süt 1L", "Süt 1000 ml")).toBe(false);
  });
});

describe("hasConflictingCountDescriptors (birimsiz adet tanımlayıcıları)", () => {
  const ARZUM_SOURCE =
    "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Taşma Önleyici Sistem, 4 Fincan Kapasiteli,";

  it("does not flag one-sided count info (4 Fincan vs hiç yazmamış) — Kural 14", () => {
    expect(
      hasConflictingCountDescriptors(ARZUM_SOURCE, "Arzum OK004 Okka Minio Türk Kahvesi Makinesi"),
    ).toBe(false);
  });

  it("flags real count conflicts (4 fincan vs 6 fincan)", () => {
    expect(
      hasConflictingCountDescriptors(ARZUM_SOURCE, "Arzum Kahve Makinesi 6 Fincan Kapasiteli"),
    ).toBe(true);
  });

  it("is accent/case-insensitive and normalizes suffix variants (6 parça = 6 parçalı)", () => {
    expect(hasConflictingCountDescriptors("Tencere Seti 6 Parça", "Tencere Seti 6 PARÇALI")).toBe(
      false,
    );
    expect(
      hasConflictingCountDescriptors("Yemek Takımı 6 Kişilik", "Yemek Takımı 12 kisilik"),
    ).toBe(true);
  });
});

describe("compareProductCodes (exact / renk varyantı / konfigürasyon varyantı)", () => {
  const ARZUM_SOURCE =
    "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Taşma Önleyici Sistem, 4 Fincan Kapasiteli,";
  const LENOVO_SOURCE =
    'LENOVO LOQE i5-13450HX 16GB 512GB SSD 15.6" FHD 144Hz RTX 5050 8GB GDDR7 FreeDOS 83SC000QTR';

  it("classifies identical short codes as exact (Arzum OK004 prod vakası)", () => {
    expect(
      compareProductCodes(ARZUM_SOURCE, "Arzum Ok004 Okka Minio Türk Kahve Makinesi Bakır"),
    ).toBe("exact");
  });

  it("classifies 1-2 letter code suffixes as color variants (OK004 vs OK004-K)", () => {
    expect(
      compareProductCodes(ARZUM_SOURCE, "Arzum OK004-K Okka Minio Türk Kahvesi Makinesi Krom"),
    ).toBe("color-variant");
  });

  it("returns none when the candidate has no code", () => {
    expect(compareProductCodes(ARZUM_SOURCE, "ARZUM OKKA Minio Türk Kahvesi Makinesi")).toBe(
      "none",
    );
  });

  it("flags zero-padded adjacent sub-SKU groups as config variants ('83SC000QTR 001')", () => {
    expect(
      compareProductCodes(
        LENOVO_SOURCE,
        "Lenovo Loqe 20GB RAM 512GB SSD FreeDOS Gaming Laptop 83sc000qtr 001",
      ),
    ).toBe("config-variant");
  });

  it("flags dash-joined numeric suffixes as config variants (83SC000QTR-015, prod vakası)", () => {
    expect(
      compareProductCodes(
        LENOVO_SOURCE,
        "Lenovo LOQE i5-13450HX 16GB 512GB 83SC000QTR-015 Windows 11 Pro Gaming Laptop",
      ),
    ).toBe("config-variant");
  });

  it("does NOT mistake screen sizes after the code for sub-SKU suffixes (15.6)", () => {
    expect(
      compareProductCodes(
        LENOVO_SOURCE,
        'Lenovo LOQ Intel Core i5 13450HX 16GB 512GB SSD 83SC000QTR 15.6" FHD Freedos',
      ),
    ).toBe("exact");
  });

  it("classifies same bare long MPN as exact", () => {
    expect(
      compareProductCodes(
        LENOVO_SOURCE,
        "Lenovo LOQ 15IRX11 Intel Core i5 13450HX 16GB 512GB SSD RTX5050 FHD Freedos 83SC000QTR",
      ),
    ).toBe("exact");
  });

  it("returns none for different laptops sharing only hardware codes (CPU/GPU)", () => {
    expect(
      compareProductCodes(
        "Lenovo LOQ i5-13450HX 16GB RTX 5050",
        "Asus TUF i5-13450HX 16GB RTX 5050",
      ),
    ).toBe("none");
  });
});

describe("isAccessoryListing (aksesuar/yedek parça guard'ı)", () => {
  const ARZUM =
    "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Taşma Önleyici Sistem, 4 Fincan Kapasiteli,";

  it("flags 'İÇİN' pattern accessories carrying the source model code (prod vakası)", () => {
    expect(
      isAccessoryListing(
        "ARZUM OK004 OKKA MİNİO TÜRK KAHVESİ MAKİNESİ İÇİN ORİJİNAL CEZVE GRUBU BAKIR",
        ARZUM,
      ),
    ).toBe(true);
  });

  it("flags accessory tokens without 'için' (yedek cezve)", () => {
    expect(isAccessoryListing("Arzum Okka Minio Yedek Cezve Bakır", ARZUM)).toBe(true);
  });

  it("does not flag the machine itself (renk varyantı dahil)", () => {
    expect(isAccessoryListing("Arzum OK004-K Okka Minio Türk Kahvesi Makinesi Krom", ARZUM)).toBe(
      false,
    );
    expect(isAccessoryListing("Arzum Ok004 Okka Minio Türk Kahvesi Makinesi Okyanus", ARZUM)).toBe(
      false,
    );
  });

  it("is one-sided: source that is itself an accessory disables the signal", () => {
    expect(isAccessoryListing("Arzum Okka için yedek cezve", "Arzum Okka Yedek Cezve Grubu")).toBe(
      false,
    );
  });
});

// ============================================
// Akran-medyan fiyat aykırılığı (peer outlier) — Philips prod vakası
// ============================================
//
// Gerçek veri (2026-07, Philips HD9650/90, kendi fiyat ₺9.475): 16 rakibin
// 14'ü ₺7.2K–16.4K bandında, biri ₺3.000 (sahte/yem ilan), biri ₺29.002
// (bundle/aşırı). ₺3.000, 0.3x bandını (0.317) kılpayı geçip "önerilen fiyat
// ₺2.999" ürettirdi. Akran-medyan kuralı ikisini de karar dışına alır ama
// ₺7.249'luk GERÇEK agresif rakibi korur.

import {
  detectPeerPriceOutlier,
  assessCompetitorList,
  PEER_OUTLIER_MIN_PEERS,
} from "../competitor-quality";

const PHILIPS_PRICES = [
  3000, 7249, 9082.26, 9082.26, 9082.26, 9499, 9688.56, 9999, 10580, 10989, 11490, 11999.9, 14353,
  15197.11, 16392.03, 29002.03,
];

function peersOf(price: number, all: number[]): number[] {
  const idx = all.indexOf(price);
  return all.filter((_, i) => i !== idx);
}

describe("detectPeerPriceOutlier (akran-medyan aykırılığı)", () => {
  it("flags the ₺3.000 fake listing as too-low (Philips prod vakası)", () => {
    expect(detectPeerPriceOutlier(3000, peersOf(3000, PHILIPS_PRICES))).toBe("too-low");
  });

  it("flags the ₺29.002 listing as too-high", () => {
    expect(detectPeerPriceOutlier(29002.03, peersOf(29002.03, PHILIPS_PRICES))).toBe("too-high");
  });

  it("does NOT flag the genuinely aggressive ₺7.249 competitor", () => {
    expect(detectPeerPriceOutlier(7249, peersOf(7249, PHILIPS_PRICES))).toBeNull();
  });

  it("does NOT flag mid-market prices", () => {
    expect(detectPeerPriceOutlier(9499, peersOf(9499, PHILIPS_PRICES))).toBeNull();
    expect(detectPeerPriceOutlier(16392.03, peersOf(16392.03, PHILIPS_PRICES))).toBeNull();
  });

  it("cluster protection: two sellers together at a low price are NOT flagged", () => {
    // İki satıcı birlikte ucuzsa gerçek olabilir (tasfiye/kampanya) — izolasyon
    // şartı (en yakın akrandan ≥1.8x kopukluk) sağlanmaz, bayrak yok.
    const prices = [3000, 3100, 9500, 9800, 10000, 10500];
    expect(detectPeerPriceOutlier(3000, peersOf(3000, prices))).toBeNull();
    expect(detectPeerPriceOutlier(3100, peersOf(3100, prices))).toBeNull();
  });

  it("small samples are never flagged (median unreliable)", () => {
    const few = [3000, 9500, 10000, 10500]; // kendisi hariç 3 akran < MIN_PEERS
    expect(peersOf(3000, few).length).toBeLessThan(PEER_OUTLIER_MIN_PEERS);
    expect(detectPeerPriceOutlier(3000, peersOf(3000, few))).toBeNull();
  });

  it("ignores invalid peer prices and returns null for invalid price", () => {
    expect(detectPeerPriceOutlier(0, PHILIPS_PRICES)).toBeNull();
    expect(detectPeerPriceOutlier(NaN, PHILIPS_PRICES)).toBeNull();
    expect(detectPeerPriceOutlier(3000, [0, -5, NaN, 9500])).toBeNull();
  });
});

describe("assessCompetitorList (iki geçişli liste değerlendirmesi)", () => {
  const now = new Date("2026-07-10T12:00:00Z");
  const fresh = new Date("2026-07-10T10:00:00Z");
  const input = (price: number) => ({ price, matchScore: 85, lastScrapedAt: fresh });

  it("marks the Philips outliers unusable with the peer-outlier issue", () => {
    const inputs = PHILIPS_PRICES.map(input);
    const assessments = assessCompetitorList(inputs, { ownPrice: 9475, now });

    const at = (price: number) => assessments[PHILIPS_PRICES.indexOf(price)];
    expect(at(3000).usable).toBe(false);
    expect(at(3000).issues).toContain("peer-outlier");
    // ₺29.002 daha 1. geçişte 3x bandının (9475×3=28425) dışında kalır —
    // out-of-band ile elenir, akran kuralına hiç ulaşmaz. Sonuç aynı: karar dışı.
    expect(at(29002.03).usable).toBe(false);
    expect(at(29002.03).issues).toContain("out-of-band");
    expect(at(7249).usable).toBe(true);
    expect(at(9499).usable).toBe(true);

    const usableCount = assessments.filter((a) => a.usable).length;
    expect(usableCount).toBe(14);
  });

  it("peer set excludes rows that already failed basic checks", () => {
    // Bayat/bantdışı kayıtlar akran havuzuna girmez — çöp veri medyanı bükemez.
    const stale = new Date("2026-07-01T00:00:00Z");
    const inputs = [
      { price: 3000, matchScore: 85, lastScrapedAt: fresh },
      { price: 3050, matchScore: 85, lastScrapedAt: stale }, // bayat → akran DEĞİL
      ...[9500, 9800, 10000, 10500, 11000].map(input),
    ];
    const assessments = assessCompetitorList(inputs, { ownPrice: 9475, now });
    // Bayat 3050 akran olsaydı 3000 kümelenme korumasına takılıp bayraklanmazdı;
    // akran değil → 3000 izole kalır ve bayraklanır.
    expect(assessments[0].usable).toBe(false);
    expect(assessments[0].issues).toContain("peer-outlier");
    expect(assessments[1].issues).toContain("stale");
  });

  it("keeps single-check behavior when there are not enough peers", () => {
    const inputs = [900, 9500, 10000].map(input);
    const assessments = assessCompetitorList(inputs, { ownPrice: 9475, now });
    // 900, band (0.3x=2842) dışı zaten — ama peer-outlier EKLENMEZ (akran az).
    expect(assessments[0].issues).toContain("out-of-band");
    expect(assessments[0].issues).not.toContain("peer-outlier");
    expect(assessments[1].usable).toBe(true);
  });

  it("preserves input order in the returned array", () => {
    const inputs = [
      input(29002.03),
      input(9499),
      input(3000),
      input(9999),
      input(10580),
      input(7249),
    ];
    const assessments = assessCompetitorList(inputs, { ownPrice: 9475, now });
    expect(assessments).toHaveLength(6);
    expect(assessments[1].usable).toBe(true); // 9499
    expect(assessments[2].usable).toBe(false); // 3000
  });

  it("equal-priced sellers act as each other's peers (only one copy removed)", () => {
    // Aynı fiyatta üç satıcı (9082.26×3) — birbirlerinin akranı olarak kalır
    // ve hiçbiri bayraklanmaz.
    const inputs = PHILIPS_PRICES.map(input);
    const assessments = assessCompetitorList(inputs, { ownPrice: 9475, now });
    const dupIdx = PHILIPS_PRICES.indexOf(9082.26);
    expect(assessments[dupIdx].usable).toBe(true);
    expect(assessments[dupIdx + 1].usable).toBe(true);
    expect(assessments[dupIdx + 2].usable).toBe(true);
  });
});
