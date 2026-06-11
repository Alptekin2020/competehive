import { describe, it, expect } from "vitest";
import { shouldPurgeCompetitor } from "../jobs/competitor-cleanup";

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
