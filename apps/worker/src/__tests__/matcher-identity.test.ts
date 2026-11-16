import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { reevaluateUncertainMatch, verifyProductMatch } from "../matcher";
import { shouldKeepAsCandidate } from "../utils/match-review";

function aiSays(answer: Record<string, unknown>) {
  create.mockResolvedValueOnce({
    choices: [{ message: { content: JSON.stringify(answer) } }],
  });
}

const OWNER_SOURCE = {
  title: "Philips EP3347/90 3300 Serisi Tam Otomatik Espresso Makinesi",
  url: "https://www.trendyol.com/philips/ep3347-90-tam-otomatik-espresso-makinesi-p-795891055",
  price: 17563.08,
};
const GOOGLE_CARD =
  "https://www.google.com/search?ibp=oshop&q=philips+series+3300&prds=catalogid:123,pvo:1";
const UNCERTAIN = {
  score: 60,
  brandMatch: true,
  modelMatch: true,
  categoryMatch: true,
  specMatch: true,
  reason: "Model kodu adayda belirtilmemiş",
};

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  create.mockReset();
});
afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
});

describe("verifyProductMatch — model identity gate", () => {
  it("owner case: code-less Google card is rejected below the pending band without AI", async () => {
    const result = await verifyProductMatch(OWNER_SOURCE, {
      title: "Philips Series 3300 tam otomatik espresso makinesi 6 sıcak ve buzlu içecek",
      url: GOOGLE_CARD,
      price: 47181.75,
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.isMatch).toBe(false);
    expect(result.score).toBeLessThan(50);
    expect(result.modelIdentity).toBe("unknown");
    expect(shouldKeepAsCandidate(result)).toBe(false);
  });

  it("owner case: EP3341/50 is rejected (≤30) with the code reason, without AI", async () => {
    const result = await verifyProductMatch(OWNER_SOURCE, {
      title: "Philips EP3341/50 3300 Serisi Tam Otomatik Espresso Makinesi",
      price: 20000,
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.isMatch).toBe(false);
    expect(result.score).toBeLessThanOrEqual(30);
    expect(result.reason).toContain("EP3347/90 ≠ EP3341/50");
    expect(shouldKeepAsCandidate(result)).toBe(false);
  });

  it("rejects a conflicting code found only in the candidate URL slug", async () => {
    const result = await verifyProductMatch(OWNER_SOURCE, {
      title: "Philips 3300 Serisi Tam Otomatik Espresso Makinesi",
      url: "https://www.trendyol.com/philips/ep3341-50-3300-serisi-p-12345",
    });
    expect(create).not.toHaveBeenCalled();
    expect(result.score).toBeLessThanOrEqual(30);
  });

  it("HD9650/90 vs HD9650/99 is a config variant → rejected", async () => {
    const result = await verifyProductMatch(
      { title: "Philips Airfryer XXL HD9650/90 Fritöz", price: 5000 },
      { title: "Philips Airfryer XXL HD9650/99 Fritöz", price: 5200 },
    );
    expect(result.isMatch).toBe(false);
    expect(result.score).toBeLessThanOrEqual(30);
    expect(result.modelIdentity).toBe("config-variant");
  });

  it.each([
    ["Samsung Galaxy A55 5G SM-A556 128GB Siyah", "Samsung Galaxy A56 5G SM-A566 128GB Siyah"],
    ["Apple iPhone 15 128GB Siyah", "Apple iPhone 16 128GB Siyah"],
    [
      'Samsung 55" Crystal UHD 4K Smart TV UE55DU7000',
      'Samsung 65" Crystal UHD 4K Smart TV UE65DU7000',
    ],
    ["Dyson V15 Detect Absolute Kablosuz Süpürge", "Dyson V12 Detect Slim Kablosuz Süpürge"],
  ])("rejects different models before the AI: %s vs %s", async (source, candidate) => {
    const result = await verifyProductMatch({ title: source }, { title: candidate });
    expect(create).not.toHaveBeenCalled();
    expect(result.isMatch).toBe(false);
    expect(result.score).toBeLessThanOrEqual(30);
  });

  it("unknown identity caps a confident AI score at 69 (pending, not trusted)", async () => {
    aiSays({ ...UNCERTAIN, score: 85, reason: "Aynı ürün" });
    const result = await verifyProductMatch(OWNER_SOURCE, {
      title: "Philips 3300 Serisi LatteGo Tam Otomatik Espresso Makinesi",
      url: "https://www.hepsiburada.com/philips-3300-serisi-lattego-espresso-p-HBCV0000ABC",
      price: 18000,
    });
    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(69);
    expect(shouldKeepAsCandidate(result)).toBe(true);
  });

  it("unknown identity never gets the Rule 14 or title-overlap promotion", async () => {
    aiSays(UNCERTAIN);
    const result = await verifyProductMatch(OWNER_SOURCE, {
      title: "Philips 3300 Serisi Tam Otomatik Espresso Makinesi",
      url: "https://www.trendyol.com/philips/3300-serisi-tam-otomatik-espresso-makinesi-p-1",
    });
    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(60);
  });

  it("unknown identity skips the 88 near-identical accept", async () => {
    aiSays(UNCERTAIN);
    const result = await verifyProductMatch(
      { title: "Philips EP3347/90 3300 Serisi Espresso Makinesi" },
      { title: "Philips 3300 Serisi Espresso Makinesi" },
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.isMatch).toBe(false);
  });

  it("Rule 14 backstop does not promote colour variants (Oral-B Lila vs Siyah)", async () => {
    aiSays({ ...UNCERTAIN, score: 40, reason: "Renk farklı" });
    const result = await verifyProductMatch(
      { title: "Oral-B Vitality Pro Şarjlı Diş Fırçası Lila" },
      { title: "Oral-B Vitality Pro Şarjlı Diş Fırçası Siyah" },
    );
    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(40);
  });

  it("Rule 14 backstop still promotes a missing-info rejection without conflicts", async () => {
    aiSays({ ...UNCERTAIN, score: 40, reason: "Kapasite belirtilmemiş" });
    const result = await verifyProductMatch(
      { title: "Artema Maestro Banyo Bataryası Krom" },
      { title: "Artema Maestro Lavabo Bataryası" },
    );
    expect(result.isMatch).toBe(true);
    expect(result.score).toBe(70);
  });

  it("colour-only code variant stays a deterministic accept (OK004 vs OK004-K)", async () => {
    const result = await verifyProductMatch(
      { title: "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Bakır", price: 1899 },
      { title: "Arzum OK004-K Okka Minio Türk Kahvesi Makinesi Krom", price: 1950 },
    );
    expect(create).not.toHaveBeenCalled();
    expect(result.isMatch).toBe(true);
    expect(result.score).toBe(90);
  });

  it("same code under another brand (Kumtel/Luxell LX-6331) is left to the AI", async () => {
    aiSays({ ...UNCERTAIN, score: 85, reason: "Aynı model" });
    const result = await verifyProductMatch(
      { title: "Kumtel LX-6331 Fanlı Isıtıcı" },
      { title: "Luxell LX-6331 Fanlı Isıtıcı" },
    );
    expect(result.isMatch).toBe(true);
    expect(result.modelIdentity).toBe("same");
  });
});

describe("reevaluateUncertainMatch — model identity", () => {
  it("never promotes a pending candidate whose code is unknown", () => {
    expect(
      reevaluateUncertainMatch(
        { title: "Philips EP3347/90 3300 Serisi Espresso Makinesi" },
        { title: "Philips 3300 Serisi Espresso Makinesi" },
        { score: 60, categoryMatch: true },
      ),
    ).toBeNull();
  });

  it("never promotes a conflicting code read from the URL slug", () => {
    expect(
      reevaluateUncertainMatch(
        { title: "Philips EP3347/90 Espresso Makinesi LatteGo" },
        {
          title: "Philips Espresso Makinesi LatteGo",
          url: "https://www.trendyol.com/philips/ep3341-50-espresso-p-1",
        },
        { score: 60, categoryMatch: true },
      ),
    ).toBeNull();
  });

  it("still promotes code-less near-identical titles", () => {
    const promoted = reevaluateUncertainMatch(
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr" },
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr" },
      { score: 60, categoryMatch: true },
    );
    expect(promoted?.score).toBe(88);
  });
});

describe("matchAttributes.matchBasis", () => {
  it("marks shared model-code accepts as model-code", async () => {
    const result = await verifyProductMatch(
      { title: "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Bakır", price: 1899 },
      { title: "Arzum OK004-K Okka Minio Türk Kahvesi Makinesi Krom", price: 1950 },
    );
    expect(result.attributes.matchBasis).toBe("model-code");
    expect(result.attributes.details.startsWith("Ortak model kodu")).toBe(true);
  });

  it("marks title and AI accepts as title, rejections carry none", async () => {
    const near = await verifyProductMatch(
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr" },
      { title: "Kahve Dünyası Tambol Çilekli Milföy Dolgulu 100 gr" },
    );
    expect(near.attributes.matchBasis).toBe("title");

    aiSays({ ...UNCERTAIN, score: 85, reason: "Aynı ürün" });
    const ai = await verifyProductMatch(
      { title: "Kumtel LX-6331 Fanlı Isıtıcı" },
      { title: "Luxell LX-6331 Fanlı Isıtıcı" },
    );
    expect(ai.attributes.matchBasis).toBe("title");

    // Luxell = Kumtel takma adıyla bu çift AI'sız da kabul edilebilir; kullanılmayan
    // yanıt bir sonraki çağrıya sızmasın.
    create.mockReset();
    aiSays({ ...UNCERTAIN, score: 20, categoryMatch: false, reason: "Farklı ürün" });
    const rejected = await verifyProductMatch(
      { title: "Oral-B Vitality Pro Diş Fırçası Lila" },
      { title: "Oral-B Diş Macunu 75 ml" },
    );
    expect(rejected.isMatch).toBe(false);
    expect(rejected.attributes.matchBasis).toBeUndefined();
  });
});
