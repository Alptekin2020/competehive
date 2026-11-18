import { describe, expect, it } from "vitest";
import { isUserEnteredGtin, nextUserGtinWarning, userGtinCorroborated } from "../utils/user-gtin";
import { reevaluateUncertainMatch, verifyProductMatch } from "../matcher";

const SOURCE = "Philips Sonicare Diş Fırçası Yedek Başlık 4'lü";
const GTIN = "8710103876380";

describe("isUserEnteredGtin", () => {
  it("is true only for a user barcode that the own title does not carry", () => {
    expect(isUserEnteredGtin({ gtin: GTIN, gtinSource: "user" }, GTIN, [SOURCE])).toBe(true);
    expect(isUserEnteredGtin({ gtin: GTIN }, GTIN, [SOURCE])).toBe(false);
    expect(isUserEnteredGtin({ gtin: GTIN, gtinSource: "user" }, GTIN, [`${SOURCE} ${GTIN}`])).toBe(
      false,
    );
    expect(isUserEnteredGtin({ gtinSource: "user" }, null, [SOURCE])).toBe(false);
  });
});

describe("userGtinCorroborated", () => {
  it("accepts a listing of the same brand without a title conflict", () => {
    expect(
      userGtinCorroborated(SOURCE, {
        title: "Philips Sonicare Yedek Diş Fırçası Başlığı 4'lü",
        url: "https://www.hepsiburada.com/philips-sonicare-p-HBC1",
      }),
    ).toBe(true);
  });

  it("reads the brand from the Trendyol store path and the snippet", () => {
    expect(
      userGtinCorroborated(SOURCE, {
        title: "Sonicare Yedek Başlık 4'lü",
        url: "https://www.trendyol.com/philips/sonicare-yedek-baslik-p-1",
      }),
    ).toBe(true);
    expect(
      userGtinCorroborated(SOURCE, {
        title: "Sonicare Yedek Başlık 4'lü",
        url: "https://www.n11.com/urun/sonicare-yedek-baslik-1",
        snippet: "Marka: Philips",
      }),
    ).toBe(true);
  });

  it("rejects a listing of another brand (barcode belongs to another product)", () => {
    expect(
      userGtinCorroborated(SOURCE, {
        title: "Oral-B Pro 3 Şarjlı Diş Fırçası",
        url: "https://www.hepsiburada.com/oral-b-pro-3-p-HBC2",
      }),
    ).toBe(false);
  });

  it("rejects the same brand with a conflicting pack size", () => {
    expect(
      userGtinCorroborated(SOURCE, {
        title: "Philips Sonicare Diş Fırçası Yedek Başlık 8'li",
        url: "https://www.hepsiburada.com/philips-sonicare-8li-p-HBC3",
      }),
    ).toBe(false);
  });
});

describe("matcher with a user barcode", () => {
  it("does not accept another product's listing just because it carries the barcode", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await verifyProductMatch(
      { title: SOURCE, price: 499, gtin: GTIN, gtinFromUser: true },
      {
        title: "Oral-B Pro 3 Şarjlı Diş Fırçası",
        url: "https://www.hepsiburada.com/oral-b-pro-3-p-HBC2",
        snippet: `Barkod: ${GTIN}`,
      },
    );
    expect(result.score).not.toBe(95);
    expect(result.isMatch).toBe(false);
  });

  it("still accepts a matching listing that carries the user barcode", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await verifyProductMatch(
      { title: SOURCE, price: 499, gtin: GTIN, gtinFromUser: true },
      {
        title: "Philips Sonicare Yedek Diş Fırçası Başlığı 4'lü",
        url: "https://www.hepsiburada.com/philips-sonicare-p-HBC1",
        snippet: `Barkod: ${GTIN}`,
      },
    );
    expect(result.score).toBe(95);
  });

  it("keeps trusting a barcode that did not come from the user", async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await verifyProductMatch(
      { title: SOURCE, price: 499, gtin: GTIN },
      {
        title: "Diş Fırçası Başlığı ...",
        url: "https://www.n11.com/urun/dis-fircasi-1",
        snippet: `Barkod: ${GTIN}`,
      },
    );
    expect(result.score).toBe(95);
  });

  it("does not promote a pending candidate on an unconfirmed user barcode", () => {
    const promoted = reevaluateUncertainMatch(
      { title: SOURCE, price: 499, gtin: GTIN, gtinFromUser: true },
      {
        title: "Oral-B Pro 3 Şarjlı Diş Fırçası",
        url: "https://www.hepsiburada.com/oral-b-pro-3-p-HBC2",
        price: 520,
        snippet: GTIN,
      },
      { score: 60 },
    );
    expect(promoted?.score).not.toBe(95);
  });
});

describe("nextUserGtinWarning", () => {
  const now = new Date("2026-11-18T18:00:00Z");

  it("warns when only mismatching listings carried the barcode", () => {
    const next = nextUserGtinWarning(undefined, { corroborated: 0, mismatched: ["A", "B"] }, now);
    expect(next?.warning).toEqual({
      at: now.toISOString(),
      mismatches: 2,
      samples: ["A", "B"],
    });
  });

  it("clears the warning once a matching listing is found", () => {
    expect(
      nextUserGtinWarning({ mismatches: 2 }, { corroborated: 1, mismatched: ["A", "B"] }, now),
    ).toEqual({ warning: null });
  });

  it("leaves things alone on a single mismatch or no hits", () => {
    expect(nextUserGtinWarning(undefined, { corroborated: 0, mismatched: ["A"] }, now)).toBeNull();
    expect(
      nextUserGtinWarning({ mismatches: 2 }, { corroborated: 0, mismatched: [] }, now),
    ).toBeNull();
    expect(nextUserGtinWarning(undefined, { corroborated: 1, mismatched: [] }, now)).toBeNull();
  });
});
