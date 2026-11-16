import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { reevaluateUncertainMatch, verifyProductMatch } from "../matcher";
import {
  isCacheableRejection,
  readCachedRejection,
  rejectCacheApplies,
  rejectCacheKey,
  writeCachedRejection,
  type CachedRejection,
  type RejectCacheStore,
} from "../utils/match-reject-cache";
import {
  buildSearchQueries,
  extractGtin,
  truncateRawTitleForSearch,
} from "../utils/search-queries";
import {
  hasConflictingInches,
  hasConflictingQuantities,
  hasTitleConflict,
  isNearIdenticalTitle,
  isSourceSubsetTitle,
  isStrongTitleOverlap,
  titleTokens,
} from "../utils/title-similarity";

// Gerçek başlıklar: prod logları 14–16 Kasım 2026.
const KUSTAR = "KUSTAR 3 Fonksiyonlu Oynar Başlıklı Krom Çubuk Kol Mutfak Evye Bataryası";
const ERBATAB = "Erbatab Vitamin D3 K2 2'si 1 Arada Damla 20 ml";
const PATI = "Pati Clean 20 Lt Kokusuz Bentonit Kedi Kumu";
const TAMBOL = "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr";
const KUMTEL = "Kumtel Lx 6331 2000 W Fanlı Isıtıcı";

describe("search queries", () => {
  it("first query is brand + full model code, suffix kept", () => {
    const q = buildSearchQueries(
      "Philips Series 3300 EP3347/90 Tam Otomatik Espresso Makinesi LatteGo",
      "",
      {},
    );
    expect(q[0]).toBe("Philips EP3347/90");
  });

  it('never cuts inside "N\'si 1 arada" and keeps the head noun (Erbatab)', () => {
    const q = buildSearchQueries(ERBATAB, ERBATAB, {});
    expect(q[0]).toBe("Erbatab Vitamin D3 K2 2'si 1 Arada Damla");
    expect(
      truncateRawTitleForSearch("Marka Ürün Adı Uzun Seri 3'ü 1 Arada Bakım Seti Mavi"),
    ).toMatch(/3'ü 1 Arada/);
  });

  it("keeps the product type when truncating (KUSTAR bataryası, Pati Clean kedi kumu)", () => {
    const kustar = buildSearchQueries(KUSTAR, KUSTAR, {});
    expect(kustar[0]).toBe("KUSTAR 3 Fonksiyonlu Oynar Başlıklı Evye Bataryası");
    expect(kustar).toContain("KUSTAR Evye Bataryası");
    const pati = buildSearchQueries(PATI, PATI, {});
    expect(pati[0]).toContain("Kedi Kumu");
    expect(pati).toContain("Pati Clean Kedi Kumu");
  });

  it("drops electrical spec noise and commas before the word cut", () => {
    expect(buildSearchQueries(KUMTEL, KUMTEL, {})[0]).not.toMatch(/2000|\bW\b/);
    expect(
      truncateRawTitleForSearch("Arzum Okka Minio Türk Kahvesi Makinesi , 4 Fincan Kapasiteli,"),
    ).not.toContain(",");
  });

  it("adds a bare GTIN query when the product stores a barcode", () => {
    expect(extractGtin({ gtin: "8690000123456" })).toBe("8690000123456");
    expect(extractGtin({ gtin: "abc" })).toBeNull();
    expect(buildSearchQueries(PATI, PATI, { gtin: "8690000123456" })).toContain("8690000123456");
  });

  it("treats 'model' as search noise", () => {
    expect(buildSearchQueries("Kumtel Model Fanlı Isıtıcı", "", {})[0]).toBe(
      "Kumtel Fanlı Isıtıcı",
    );
  });
});

describe("title tokenisation", () => {
  it("normalises 'N'si 1 arada' spellings to one token", () => {
    expect(titleTokens("2'si 1 arada")).toEqual(["2in1"]);
    expect(titleTokens("3'ü 1 Arada")).toEqual(["3in1"]);
    expect(titleTokens("2 si 1 arada")).toEqual(["2in1"]);
  });

  it("splits vitamin compounds d3k2 / d3-k2 but leaves model codes alone", () => {
    expect(titleTokens("D3K2")).toEqual(["d3", "k2"]);
    expect(titleTokens("D3-K2")).toEqual(["d3", "k2"]);
    expect(titleTokens("EP3347 HD9650")).toEqual(["ep3347", "hd9650"]);
  });

  it("counts ampul/poşet/ped/kapsül/şase as quantity words", () => {
    expect(hasConflictingQuantities("Serum 10 Ampul", "Serum 20 Ampül")).toBe(true);
    expect(hasConflictingQuantities("Çay 25 Poşet", "Çay 100 Poşet")).toBe(true);
    expect(hasConflictingQuantities("Hijyenik 10 Ped", "Hijyenik 30 Ped")).toBe(true);
    expect(hasConflictingQuantities("Kolajen 30 Şase", "Kolajen 15 Şase")).toBe(true);
  });

  it('treats inch sizes (inç / inch / ") as a spec axis', () => {
    expect(hasConflictingInches("Samsung 98 inç Crystal UHD", 'Samsung 85" Crystal UHD')).toBe(
      true,
    );
    expect(hasConflictingInches("Samsung 98 inç Crystal UHD", 'Samsung 98" Crystal UHD')).toBe(
      false,
    );
    expect(titleTokens("98 inç")).toEqual(titleTokens('98"'));
  });
});

describe("deterministic title accepts (real titles)", () => {
  it("2'si 1 arada vs 3'ü 1 arada never matches", () => {
    const other = "Erbatab Vitamin D3 K2 3'ü 1 Arada Damla 20 ml";
    expect(hasTitleConflict(ERBATAB, other)).toBe(true);
    expect(isNearIdenticalTitle(ERBATAB, other)).toBe(false);
    expect(isStrongTitleOverlap(ERBATAB, other)).toBe(false);
    expect(isSourceSubsetTitle(ERBATAB, other)).toBe(false);
  });

  it("Erbatab D3-K2 20 ml is a strong overlap", () => {
    expect(isStrongTitleOverlap(ERBATAB, "Erbatab D3-K2 20 ml")).toBe(true);
  });

  it("Pati Clean: a longer title containing every source word is accepted", () => {
    const longer = "Pati Clean 20 Lt Kokusuz Bentonit Kedi Kumu İnce Taneli Süper Topaklanan";
    expect(isNearIdenticalTitle(PATI, longer)).toBe(false);
    expect(isSourceSubsetTitle(PATI, longer)).toBe(true);
    const viaReeval = reevaluateUncertainMatch({ title: PATI }, { title: longer }, { score: 30 });
    expect(viaReeval?.score).toBe(88);
  });

  it("subset accept refuses variant, scent and different-scent titles", () => {
    expect(
      isSourceSubsetTitle(PATI, "Pati Clean 20 Lt Bebek Pudra Kokulu İnce Taneli Süper Topaklanan"),
    ).toBe(false);
    expect(isSourceSubsetTitle(PATI, `${PATI} Lavantalı`)).toBe(false);
    expect(isSourceSubsetTitle(PATI, `${PATI} 2 Adet`)).toBe(false);
  });

  it("Tambol sub-brand: 'Tablet Tambol …' shares the brand and is near-identical", () => {
    expect(isNearIdenticalTitle(TAMBOL, "Tablet Tambol Çilekli Milföy Dolgulu 100 gr")).toBe(true);
    expect(isNearIdenticalTitle(TAMBOL, "Tambol Çilekli Milföy Dolgulu 100 Gr 10'lu Ekonomi")).toBe(
      false,
    );
  });

  it("Kumtel/Luxell are one brand (strong overlap, still no near-identical with a missing spec)", () => {
    expect(isStrongTitleOverlap(KUMTEL, "Luxell LX-6331 Fanlı Isıtıcı")).toBe(true);
    expect(
      isNearIdenticalTitle("Kumtel LX-6331 Fanlı Isıtıcı", "Luxell LX-6331 Fanlı Isıtıcı"),
    ).toBe(true);
  });
});

describe("Kural 14 backstop wording", () => {
  beforeEach(() => {
    create.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  it("catches 'Farklı hacim: …' word order", async () => {
    create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 40,
              brandMatch: true,
              modelMatch: true,
              categoryMatch: true,
              reason: "Farklı hacim: kaynak 2'si 1 arada, aday 20 ml.",
            }),
          },
        },
      ],
    });
    const result = await verifyProductMatch(
      { title: ERBATAB },
      { title: "Erbatab D3K2 Vitamin Damla 20 ml" },
    );
    expect(result.isMatch).toBe(true);
  });
});

describe("AI rejection cache", () => {
  function memoryStore(fail = false): RejectCacheStore & { data: Map<string, CachedRejection> } {
    const data = new Map<string, CachedRejection>();
    return {
      data,
      get: async (k) => {
        if (fail) throw new Error("redis down");
        return data.get(k) ?? null;
      },
      set: async (k, v) => {
        if (fail) throw new Error("redis down");
        data.set(k, v);
      },
    };
  }

  it("only caches firm AI rejections below 40", () => {
    expect(isCacheableRejection({ isMatch: false, score: 30 })).toBe(true);
    expect(isCacheableRejection({ isMatch: false, score: 40 })).toBe(false);
    expect(isCacheableRejection({ isMatch: false, score: 60 })).toBe(false);
    expect(isCacheableRejection({ isMatch: false, score: 0, aiUnavailable: true })).toBe(false);
    expect(isCacheableRejection({ isMatch: true, score: 90 })).toBe(false);
  });

  it("is keyed per product and URL key", async () => {
    const store = memoryStore();
    await writeCachedRejection("p1", "trendyol.com/x-p-1", { score: 30, reason: "r" }, store);
    expect(await readCachedRejection("p1", "trendyol.com/x-p-1", store)).toEqual({
      score: 30,
      reason: "r",
    });
    expect(await readCachedRejection("p2", "trendyol.com/x-p-1", store)).toBeNull();
    expect(rejectCacheKey("p1", "a")).not.toBe(rejectCacheKey("p1", "b"));
  });

  it("fails open when Redis is down", async () => {
    const store = memoryStore(true);
    await expect(writeCachedRejection("p1", "u", { score: 0, reason: "" }, store)).resolves.toBe(
      undefined,
    );
    expect(await readCachedRejection("p1", "u", store)).toBeNull();
  });

  it("bypasses the cache when the titles share a model code", () => {
    expect(rejectCacheApplies("Philips EP3347/90 Espresso", "Philips EP3347 Espresso")).toBe(false);
    expect(rejectCacheApplies(PATI, "Aesco Kokusuz Bentonit 20 L")).toBe(true);
  });
});
