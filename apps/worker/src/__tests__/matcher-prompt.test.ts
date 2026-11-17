import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

import { verifyProductMatch } from "../matcher";

function aiAnswer(answer: Record<string, unknown>) {
  create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(answer) } }] });
}

// Prod (14 Kasım): AI, fiyatı gördüğü için birebir aynı ürünleri "Farklı fiyat"
// gerekçesiyle reddediyordu. Fiyat artık prompt'a girmez; fiyat sağduyusu kodda.
describe("verifyProductMatch — price is not product identity", () => {
  beforeEach(() => {
    create.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  const source = {
    title:
      "Oral-B Şarjlı Vitality Pro Koruma ve Temizlik Elektrikli Diş Fırçası Lila Fiyatları ve Özellikleri",
    price: 1299,
    marketplace: "HEPSIBURADA",
  };

  it("sends neither prices nor marketplace SEO suffixes to the model", async () => {
    aiAnswer({ score: 90, brandMatch: true, modelMatch: true, categoryMatch: true, reason: "ok" });
    await verifyProductMatch(source, { title: "Oral-B Vitality Pro", price: 1749.9 });
    const prompt = String(create.mock.calls[0][0].messages[0].content);
    expect(prompt).not.toContain("1299");
    expect(prompt).not.toContain("1749");
    expect(prompt).not.toContain("- Fiyat:");
    expect(prompt).not.toContain("Fiyatları ve Özellikleri");
  });

  it("overturns a rejection whose only reason is the price", async () => {
    aiAnswer({
      score: 60,
      brandMatch: true,
      modelMatch: true,
      categoryMatch: true,
      reason: "Farklı fiyat ve potansiyel model farklılığı",
    });
    const result = await verifyProductMatch(source, {
      title: "Oral B Şarjlı Diş Fırçası Vitality Pro",
      price: 1749.9,
    });
    expect(result.isMatch).toBe(true);
  });

  it("still rejects when the titles carry a real spec conflict", async () => {
    aiAnswer({
      score: 60,
      brandMatch: true,
      modelMatch: true,
      categoryMatch: true,
      reason: "Farklı fiyat ve hacim",
    });
    const result = await verifyProductMatch(
      { title: "Siveno Sivrisinek Kovucu Losyon 50 ml", price: 200 },
      { title: "Siveno Sivrisinek Kovucu Losyon 100 ml", price: 320 },
    );
    expect(result.isMatch).toBe(false);
  });

  it("keeps the deterministic extreme-price backstop", async () => {
    aiAnswer({ score: 95, brandMatch: true, modelMatch: true, categoryMatch: true, reason: "ok" });
    const result = await verifyProductMatch(source, { title: "Oral-B Vitality Pro", price: 99 });
    expect(result.isMatch).toBe(false);
  });
});

// Prod (17 Kasım): N11 web sonucu "Multi Vitamin Hair Cocktail Dökülme Karşıtı
// Saç/kaş Bakım ..." kesik geldi; "2ml x 10 ampul" yalnızca URL'deydi ve AI
// aynı ürünü "Farklı hacim/miktar" diye 40 puanla reddetti.
describe("verifyProductMatch — truncated candidate titles", () => {
  beforeEach(() => {
    create.mockReset();
    process.env.OPENAI_API_KEY = "test-key";
  });

  const source = {
    title:
      "Evde Aesthetic Multi Vitamin Hair Cocktail Saç Bölgesi Serum 2ml X 10 Ampul 8681677004991",
    marketplace: "TRENDYOL",
  };
  const n11Url =
    "https://www.n11.com/urun/multi-vitamin-hair-cocktail-dokulme-karsiti-sackas-bakim-serumu-2ml-x-10-ampul-vitamin-kompleksi-peptid-icerikli-111492082";

  it("shows the listing URL's product name when the title is cut", async () => {
    aiAnswer({ score: 80, brandMatch: true, modelMatch: true, categoryMatch: true, reason: "ok" });
    await verifyProductMatch(source, {
      title: "Multi Vitamin Hair Cocktail Dökülme Karşıtı Saç/kaş Bakım ...",
      url: n11Url,
      marketplace: "N11",
    });
    const prompt = String(create.mock.calls[0][0].messages[0].content);
    expect(prompt).toContain("İlan adresindeki ürün adı (başlık kısaltılmış)");
    expect(prompt).toContain("2ml x 10 ampul");
    expect(prompt).not.toContain("111492082");
  });

  it("adds nothing for a complete title", async () => {
    aiAnswer({ score: 80, brandMatch: true, modelMatch: true, categoryMatch: true, reason: "ok" });
    await verifyProductMatch(source, {
      title: "Evde Aesthetic Multi Vitamin Hair Cocktail Serum 2ml x 10 Ampul",
      url: n11Url,
      marketplace: "N11",
    });
    const prompt = String(create.mock.calls[0][0].messages[0].content);
    expect(prompt).not.toContain("İlan adresindeki ürün adı (başlık");
  });
});
