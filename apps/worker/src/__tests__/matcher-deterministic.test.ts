import { describe, it, expect, beforeAll } from "vitest";
import { verifyProductMatch } from "../matcher";

beforeAll(() => {
  // Deterministik yollar AI'a hiç ulaşmaz; fiyat-bandı testi ise bilinçli
  // olarak AI'a düşer — orada gerçek API çağrısı yerine fallback çalışsın.
  delete process.env.OPENAI_API_KEY;
});

// Bu testler yalnızca verifyProductMatch'in AI'DAN ÖNCE dönen deterministik
// yollarını kapsar (kod analizi + varyant guard'ları) — OpenAI çağrısına hiç
// ulaşılmaz, API anahtarı gerekmez. İki gerçek prod vakası regresyon altına
// alınır: Arzum OK004 (yanlış negatif) ve Lenovo 83SC000QTR alt-SKU ekleri
// (yanlış pozitif).

const ARZUM_SOURCE =
  "Arzum OK004 Okka Minio Türk Kahvesi Makinesi Taşma Önleyici Sistem, 4 Fincan Kapasiteli,";
const LENOVO_SOURCE =
  'LENOVO LOQE i5-13450HX 16GB 512GB SSD 15.6" FHD 144Hz RTX 5050 8GB GDDR7 FreeDOS 83SC000QTR';

describe("verifyProductMatch — deterministik kod kabulü (Arzum OK004 prod vakası)", () => {
  it("accepts identical machines sharing a 5-char model code without asking the AI", async () => {
    const result = await verifyProductMatch(
      { title: ARZUM_SOURCE, price: 1899 },
      { title: "Arzum Ok004 Okka Minio Türk Kahvesi Makinesi Bakır", price: 2049 },
    );
    expect(result.isMatch).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("accepts 1-2 letter color-suffix codes as the same product (OK004 vs OK004-K)", async () => {
    const result = await verifyProductMatch(
      { title: ARZUM_SOURCE, price: 1899 },
      { title: "Arzum OK004-K Okka Minio Türk Kahvesi Makinesi Krom", price: 2158 },
    );
    expect(result.isMatch).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("does NOT auto-accept when the count descriptor genuinely conflicts (4 vs 6 fincan)", async () => {
    const result = await verifyProductMatch(
      { title: ARZUM_SOURCE, price: 1899 },
      { title: "Arzum OK004 Okka Türk Kahvesi Makinesi 6 Fincan Kapasiteli", price: 2299 },
    );
    expect(result.isMatch).toBe(false);
    expect(result.score).toBeLessThan(70);
  });

  it("does NOT auto-accept a shared short code when the price is far out of band", async () => {
    // Fiyat bandı sağlaması: kod eşleşse bile 10x fiyat farkı deterministik
    // kabulü engeller; karar AI'a (testte fallback'e) kalır.
    const result = await verifyProductMatch(
      { title: ARZUM_SOURCE, price: 1899 },
      { title: "Arzum OK004 Okka Minio Türk Kahvesi Makinesi", price: 18990 },
    );
    expect(result.score).toBeLessThan(90);
  });
});

describe("verifyProductMatch — alt-SKU / konfigürasyon varyantı (Lenovo prod vakası)", () => {
  it("keeps the exact bare-MPN match at 95", async () => {
    const result = await verifyProductMatch(
      { title: LENOVO_SOURCE, price: 39829 },
      {
        title:
          "Lenovo LOQ 15IRX11 Intel Core i5 13450HX 16GB 512GB SSD 8GB RTX5050 FHD Freedos 83SC000QTR",
        price: 40790,
      },
    );
    expect(result.isMatch).toBe(true);
    expect(result.score).toBe(95);
  });

  it("downgrades zero-padded adjacent sub-SKU groups ('83SC000QTR 015') even without spec conflicts", async () => {
    // "015" eki FreeDOS→Windows gibi spec imzasına yansımayan farkları taşır;
    // eski davranış %95 veriyordu.
    const result = await verifyProductMatch(
      { title: LENOVO_SOURCE, price: 39829 },
      {
        title:
          "LENOVO LOQE i5-13450HX 16GB 512GB SSD RTX5050 FHD 83SC000QTR 015 Windows 11 Pro Gaming Laptop",
        price: 44990,
      },
    );
    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(55);
  });

  it("downgrades dash-joined numeric suffixes (83SC000QTR-015)", async () => {
    const result = await verifyProductMatch(
      { title: LENOVO_SOURCE, price: 39829 },
      {
        title: "Lenovo LOQE i5-13450HX 16GB 512GB SSD 83SC000QTR-015 W11 Pro Gaming Laptop",
        price: 44990,
      },
    );
    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(55);
  });

  it("still downgrades conflicting spec variants sharing the bare MPN (16GB vs 20GB)", async () => {
    const result = await verifyProductMatch(
      { title: LENOVO_SOURCE, price: 39829 },
      {
        title: "Lenovo Loqe I5-13450HX 20GB 512GB SSD RTX5050 Gaming Laptop 83SC000QTR 001",
        price: 52890,
      },
    );
    expect(result.isMatch).toBe(false);
    expect(result.score).toBe(55);
  });

  it("does not screen-size false-positive: '83SC000QTR 15.6\"' is not a sub-SKU", async () => {
    const result = await verifyProductMatch(
      { title: LENOVO_SOURCE, price: 39829 },
      {
        title:
          'Lenovo LOQ i5 13450HX 16GB 512GB SSD 8GB RTX5050 83SC000QTR 15.6" FHD 144Hz Freedos',
        price: 43786,
      },
    );
    expect(result.isMatch).toBe(true);
    expect(result.score).toBe(95);
  });
});
