import { describe, it, expect, beforeAll } from "vitest";
import { verifyProductMatch } from "../matcher";
import {
  compareTitles,
  hasConflictingQuantities,
  hasMultipackSignal,
  hasPackOrSpecConflict,
  urlSlugText,
  hasDifferentProductCodes,
  isNearIdenticalTitle,
  isStrongTitleOverlap,
  titleTokens,
} from "../utils/title-similarity";

beforeAll(() => {
  // Deterministik kabul AI'dan önce döner; reddedilmesi gereken vakalar AI
  // yerine fallback'e düşsün diye anahtar kaldırılır.
  delete process.env.OPENAI_API_KEY;
});

// 14–15 Kasım 2026 prod loglarından alınan gerçek başlıklar.
const TAMBOL = "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr";
const ICOLLAGEN = "icollagen Kolajen Ve Prebiyotik Tablet 60 adet";
const PHILIPS =
  "Philips 3300 Serisi LatteGo Tam Otomatik Espresso Makinesi, AquaClean Filtre, 6 İçecek Hazırlama, EP3347/90";

describe("titleTokens", () => {
  it("folds Turkish letters, drops noise words and splits glued units", () => {
    expect(titleTokens("İcollagen Kolajen Ve Prebiyotik Tablet Bandrollü 60'lı")).toEqual([
      "icollagen",
      "kolajen",
      "prebiyotik",
      "tablet",
      "60",
    ]);
    expect(titleTokens("Tambol 100gr")).toEqual(["tambol", "100", "gr"]);
  });
});

describe("isNearIdenticalTitle — prod false negatives", () => {
  it("accepts the identical title the AI scored 30", () => {
    expect(isNearIdenticalTitle(TAMBOL, "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr")).toBe(
      true,
    );
  });

  it("accepts the same product with extra descriptive words", () => {
    expect(
      isNearIdenticalTitle(
        TAMBOL,
        "Kahve Dünyası Tambol Çilekli Milföy Dolgulu Sütlü Çikolata 100 gr",
      ),
    ).toBe(true);
    expect(
      isNearIdenticalTitle(ICOLLAGEN, "iCollagen Kolajen ve Prebiyotik Lif 60'lı Tablet"),
    ).toBe(true);
  });

  it("does not accept a multipack, another brand or another form", () => {
    expect(
      isNearIdenticalTitle(
        TAMBOL,
        "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 Gr 10'lu Ekonomi Paketi",
      ),
    ).toBe(false);
    expect(isNearIdenticalTitle(ICOLLAGEN, "Life In Kolajen Tablet 60 Adet")).toBe(false);
    expect(isNearIdenticalTitle(ICOLLAGEN, "İcollagen İyi Uykular Kolajen Gummy 60'lı")).toBe(
      false,
    );
  });

  it("does not accept a different tier of the same family (15 vs 15 Pro)", () => {
    expect(
      isNearIdenticalTitle("Apple iPhone 15 128GB Siyah", "Apple iPhone 15 Pro 128GB Siyah"),
    ).toBe(false);
    expect(
      isNearIdenticalTitle("Apple iPhone 15 Pro 128GB Siyah", "Apple iPhone 15 128GB Siyah"),
    ).toBe(false);
  });

  it("does not accept a different size or a different model code", () => {
    expect(isNearIdenticalTitle(TAMBOL, "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 200 gr")).toBe(
      false,
    );
    expect(
      isNearIdenticalTitle(
        PHILIPS,
        "Philips 3300 Serisi LatteGo Tam Otomatik Espresso Makinesi AquaClean Filtre EP3343/50",
      ),
    ).toBe(false);
  });
});

describe("isStrongTitleOverlap — supports an uncertain AI score", () => {
  it("accepts the icollagen listings the AI left at 60", () => {
    expect(isStrongTitleOverlap(ICOLLAGEN, "icollagen 5 Tip Kolajen Ve Prebiyotik 60 Tablet")).toBe(
      true,
    );
    expect(isStrongTitleOverlap(ICOLLAGEN, "icollagen Kolajen Ve Prebiyotik Tablet")).toBe(true);
    expect(
      isStrongTitleOverlap(ICOLLAGEN, "İcollagen Kolajen Ve Prebiyotik Tablet Bandrollü 60 Adet"),
    ).toBe(true);
  });

  it("rejects a double pack, a set and a codeless listing of a multi-model series", () => {
    expect(isStrongTitleOverlap(ICOLLAGEN, "Icollagen Kolajen Prebiyotik 60 Tablet 2 Adet")).toBe(
      false,
    );
    expect(
      isStrongTitleOverlap(
        "Erbatab Vitamin D3 K2 2'si 1 Arada Damla",
        "ERBATAB Vitamin D3 K2 damla 2'li set",
      ),
    ).toBe(false);
    expect(
      isStrongTitleOverlap(PHILIPS, "Philips Series 3300 tam otomatik espresso makinesi"),
    ).toBe(false);
  });
});

describe("conflict helpers", () => {
  it("flags quantity conflicts only when both titles state a quantity", () => {
    expect(hasConflictingQuantities("X 60 Tablet", "X 60 Tablet 2 Adet")).toBe(true);
    expect(hasConflictingQuantities("X 30 Kapsül", "X 60 Kapsül")).toBe(true);
    expect(hasConflictingQuantities("X 60 Tablet", "X 60'lı")).toBe(false);
    expect(hasConflictingQuantities("X 60 Tablet", "X Tablet")).toBe(false);
  });

  it("flags different model codes, not a one-sided code", () => {
    expect(hasDifferentProductCodes("Philips EP3347/90", "Philips EP3343/50")).toBe(true);
    expect(hasDifferentProductCodes("Philips EP3347/90", "Philips 3300 LatteGo")).toBe(false);
  });

  it("reports coverage in both directions", () => {
    const sim = compareTitles(ICOLLAGEN, "icollagen Kolajen Ve Prebiyotik Tablet");
    expect(sim.brandShared).toBe(true);
    expect(sim.candidateCoverage).toBe(1);
    expect(sim.sourceCoverage).toBeCloseTo(0.8);
  });
});

describe("verifyProductMatch — near-identical titles skip the AI", () => {
  it("accepts with a usable score and no AI", async () => {
    const result = await verifyProductMatch(
      { title: TAMBOL, price: 120 },
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr - Trendyol" },
    );
    expect(result.isMatch).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.aiUnavailable).toBeUndefined();
  });

  it("does not accept a near-identical title outside the price band", async () => {
    const result = await verifyProductMatch(
      { title: TAMBOL, price: 120 },
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr", price: 1200 },
    );
    expect(result.score).toBeLessThan(70);
  });
});

// 15 Kasım 2026 prod vakası: kısaltılmış arama başlığı paket bilgisini gizledi,
// N11'deki 6'lı paket (455,80 ₺) tekli ürünün (159,90 ₺) rakibi olarak yazıldı.
describe("multipack guards (Tambol prod false positive)", () => {
  const N11_PAGE_TITLE =
    "Kahve Dünyası Tambol Çilekli Milföy Dolgulu Sütlü Çikolata 100 Gr X 6 Adet";
  const PTT_URL =
    "https://www.pttavm.com/kahve-dunyasi-tambol-cilekli-milfoy-dolgulu-sutlu-cikolata-100-g-7-li-paket-p-1546025547";

  it("detects a multipack when the source states no quantity", () => {
    expect(hasMultipackSignal(TAMBOL, N11_PAGE_TITLE)).toBe(true);
    expect(hasMultipackSignal(TAMBOL, "Tambol 100 G (7'li Paket)")).toBe(true);
    expect(hasMultipackSignal(TAMBOL, "Tambol 6x100 gr")).toBe(true);
    expect(hasMultipackSignal(TAMBOL, "Kahve Dünyası Tambol Çilekli 100 gr 1 Adet")).toBe(false);
    expect(hasMultipackSignal(ICOLLAGEN, "icollagen 60 Tablet")).toBe(false);
  });

  it("never accepts the full multipack title as near-identical", () => {
    expect(isNearIdenticalTitle(TAMBOL, N11_PAGE_TITLE)).toBe(false);
  });

  it("reads the pack size from the URL path", () => {
    expect(urlSlugText(PTT_URL)).toContain("7 li paket");
    expect(hasPackOrSpecConflict(TAMBOL, urlSlugText(PTT_URL))).toBe(true);
    expect(urlSlugText("not a url")).toBe("");
  });

  it("does not auto-accept a truncated title whose URL shows a multipack", async () => {
    const result = await verifyProductMatch(
      { title: TAMBOL, price: 159.9 },
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu Sütlü Çikolata", url: PTT_URL },
    );
    expect(result.score).toBeLessThan(70);
  });

  it("still accepts the single pack when the URL shows no conflict", async () => {
    const result = await verifyProductMatch(
      { title: TAMBOL, price: 159.9 },
      {
        title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu Sütlü Çikolata 100 gr",
        url: "https://www.trendyol.com/kahve-dunyasi/tambol-cilekli-milfoy-dolgulu-100-gr-p-812345678",
      },
    );
    expect(result.isMatch).toBe(true);
  });
});

describe("titleTokens: Air Fryer", () => {
  it("'Air Fryer', 'Air-Fryer' ve 'Airfryer' tek token olur", () => {
    expect(titleTokens("Philips Air Fryer XXL")).toContain("airfryer");
    expect(titleTokens("Philips Air-Fryer XXL")).toContain("airfryer");
    expect(titleTokens("Philips Air Fryer XXL")).not.toContain("air");
  });
});
