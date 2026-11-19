import { describe, it, expect } from "vitest";
import {
  isFalseGtinGoogleAccept,
  isWrongColourDirectLink,
  shouldPurgeCompetitor,
} from "../jobs/competitor-cleanup";
import { SAME_GTIN_REASON } from "../utils/listing-identity";

const slipper = {
  productName: "Havaianas Top Tiras Kadın Gümüş Terlik 4137428-5178 Gümüş - Gri",
  ownPrice: 2500,
};

describe("shouldPurgeCompetitor", () => {
  it("purges packaging listings attached to a consumer product", () => {
    expect(
      shouldPurgeCompetitor(
        { competitorName: "Bojopack 20x15x10 Koli 25 Adet", competitorPrice: 11, matchScore: null },
        slipper,
      ),
    ).toBe("packaging");
    expect(
      shouldPurgeCompetitor(
        { competitorName: "kolikutugelsin Kraft Kutu", competitorPrice: 13, matchScore: null },
        slipper,
      ),
    ).toBe("packaging");
  });

  it("purges unscored rows with extreme price deviation", () => {
    // ₺11 koli vs ₺2.500 terlik — ekran görüntüsündeki vaka (ambalaj adı tespit
    // edilemese bile fiyat sapması yakalar).
    expect(
      shouldPurgeCompetitor(
        { competitorName: "Gümüş Renkli Ürün", competitorPrice: 11, matchScore: null },
        slipper,
      ),
    ).toBe("price-out-of-band");
    expect(
      shouldPurgeCompetitor(
        { competitorName: "Lüks Versiyon", competitorPrice: 20000, matchScore: 50 },
        slipper,
      ),
    ).toBe("price-out-of-band");
  });

  it("keeps rows within the purge band even when unscored", () => {
    expect(
      shouldPurgeCompetitor(
        { competitorName: "Havaianas Terlik Gümüş", competitorPrice: 900, matchScore: null },
        slipper,
      ),
    ).toBeNull();
  });

  it("keeps strongly-scored rows even when the price deviates", () => {
    // Fiyat meşru şekilde değişmiş olabilir; görüntüleme katmanı zaten karar
    // dışı bırakıyor — silme geri alınamaz olduğundan güçlü skoru koru.
    expect(
      shouldPurgeCompetitor(
        { competitorName: "Havaianas Top Tiras Terlik", competitorPrice: 100, matchScore: 90 },
        slipper,
      ),
    ).toBeNull();
  });

  it("skips the price check when own price is unknown", () => {
    expect(
      shouldPurgeCompetitor(
        { competitorName: "Bilinmeyen Ürün", competitorPrice: 11, matchScore: null },
        { productName: slipper.productName, ownPrice: null },
      ),
    ).toBeNull();
  });

  it("does not purge packaging names when the source itself is packaging", () => {
    expect(
      shouldPurgeCompetitor(
        { competitorName: "Bojopack 20x15x10 Koli", competitorPrice: 12, matchScore: null },
        { productName: "Avantajpack Koli 20x15x10 25 Adet", ownPrice: 10 },
      ),
    ).toBeNull();
  });
});

describe("isWrongColourDirectLink (prod 17 Kasım: Arzum OK004 Bakır)", () => {
  const own = "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Bakır";
  const verified = { directVerifiedAt: "2026-11-17T03:40:43Z" };

  it("gerçek sayfaya taşınmış farklı renk ilanını yakalar (URL yolu dahil)", () => {
    expect(
      isWrongColourDirectLink(own, null, {
        competitorName: "OK004 Okka Minio Türk Kahvesi Makinesi",
        competitorUrl:
          "https://www.trendyol.com/arzum/ok004-okka-minio-turk-kahvesi-makinesi-4-fincan-kapasiteli-nar-p-185831",
        matchAttributes: verified,
      }),
    ).toBe(true);
  });

  it("aynı renk, onaylı satır ve taşınmamış satır dokunulmaz", () => {
    const sameColour = {
      competitorName: "Arzum OK004 Okka Minio Bakır",
      competitorUrl: "https://www.trendyol.com/arzum/ok004-bakir-p-146157",
      matchAttributes: verified,
    };
    expect(isWrongColourDirectLink(own, null, sameColour)).toBe(false);
    expect(
      isWrongColourDirectLink(own, null, {
        ...sameColour,
        competitorName: "Arzum OK004 Siyah",
        matchAttributes: { ...verified, review: "confirmed" },
      }),
    ).toBe(false);
    expect(
      isWrongColourDirectLink(own, null, {
        ...sameColour,
        competitorName: "Arzum OK004 Siyah",
        matchAttributes: {},
      }),
    ).toBe(false);
  });

  it("kendi başlığı rengi yazmıyorsa kendi URL'sindeki renk esas alınır (gerçek prod satırı)", () => {
    const prodTitle =
      "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Taşma Önleyici Sistem, 4 Fincan Kapasiteli";
    const ownUrl =
      "https://www.hepsiburada.com/arzum-ok004-okka-minio-turk-kahvesi-makinesi-bakir-p-HBV000001ALSP";
    const nar = {
      competitorName:
        "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Taşma Önleyici Sistem, 4 Fincan Kapasiteli, Nar",
      competitorUrl:
        "https://www.trendyol.com/arzum/ok004-okka-minio-turk-kahvesi-makinesi-tasma-onleyici-sistem-4-fincan-kapasiteli-nar-p-185831",
      matchAttributes: verified,
    };
    expect(isWrongColourDirectLink(prodTitle, null, nar)).toBe(false);
    expect(isWrongColourDirectLink(prodTitle, ownUrl, nar)).toBe(true);
    expect(
      isWrongColourDirectLink(prodTitle, ownUrl, {
        ...nar,
        competitorName: nar.competitorName.replace("Nar", "Bakır"),
        competitorUrl: nar.competitorUrl.replace("nar-p-185831", "bakir-p-146157"),
      }),
    ).toBe(false);
  });
});

describe("isFalseGtinGoogleAccept (prod 19 Nov)", () => {
  const gtin = "8681677004991";
  const card =
    "https://www.google.com/search?ibp=oshop&q=Evde+Aesthetic+8681677004991&prds=catalogid:1,pvo:2";
  const row = (over: Partial<Parameters<typeof isFalseGtinGoogleAccept>[1]> = {}) => ({
    competitorName: "Evde Aesthetic Dermoroller 540 İğneli 2 mm",
    competitorUrl: card,
    matchReason: SAME_GTIN_REASON,
    matchAttributes: {},
    ...over,
  });

  it("flags a Google card accepted only through the query string", () => {
    expect(isFalseGtinGoogleAccept(gtin, row())).toBe(true);
  });

  it("keeps cards whose title has the barcode, real pages, other reasons and confirmed rows", () => {
    expect(isFalseGtinGoogleAccept(gtin, row({ competitorName: `Serum ${gtin}` }))).toBe(false);
    expect(
      isFalseGtinGoogleAccept(gtin, row({ competitorUrl: "https://www.n11.com/urun/serum-1" })),
    ).toBe(false);
    expect(isFalseGtinGoogleAccept(gtin, row({ matchReason: "Aynı ürün" }))).toBe(false);
    expect(isFalseGtinGoogleAccept(gtin, row({ matchAttributes: { review: "confirmed" } }))).toBe(
      false,
    );
  });
});
