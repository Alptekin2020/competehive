import { computeMargin, marginBand, priceForMargin } from "../margin";

describe("computeMargin", () => {
  it("hesaplar kâr ve marjı doğru", () => {
    const r = computeMargin(1000, 800);
    expect(r).not.toBeNull();
    expect(r!.profit).toBe(200);
    expect(r!.marginPct).toBeCloseTo(20, 5);
    expect(r!.band).toBe("healthy");
  });

  it("maliyet fiyata eşitse marj 0 (zarar değil)", () => {
    const r = computeMargin(500, 500);
    expect(r!.profit).toBe(0);
    expect(r!.marginPct).toBe(0);
    expect(r!.band).toBe("thin");
  });

  it("maliyet fiyattan yüksekse negatif marj (zarar) döner", () => {
    const r = computeMargin(800, 1000);
    expect(r!.profit).toBe(-200);
    expect(r!.marginPct).toBeCloseTo(-25, 5);
    expect(r!.band).toBe("loss");
  });

  it("Prisma Decimal string girdisini kabul eder", () => {
    const r = computeMargin("1200.00", "600.00");
    expect(r!.profit).toBe(600);
    expect(r!.marginPct).toBeCloseTo(50, 5);
    expect(r!.band).toBe("strong");
  });

  it("maliyet girilmemişse (null) null döner", () => {
    expect(computeMargin(1000, null)).toBeNull();
    expect(computeMargin(1000, undefined)).toBeNull();
  });

  it("geçersiz fiyat/maliyet için null döner", () => {
    expect(computeMargin(0, 100)).toBeNull(); // fiyat ≤ 0
    expect(computeMargin(-50, 10)).toBeNull();
    expect(computeMargin(100, -5)).toBeNull(); // negatif maliyet
    expect(computeMargin("abc", 10)).toBeNull();
    expect(computeMargin(NaN, 10)).toBeNull();
  });
});

describe("marginBand", () => {
  it("bantları eşik değerlerine göre sınıflar", () => {
    expect(marginBand(-1)).toBe("loss");
    expect(marginBand(0)).toBe("thin");
    expect(marginBand(9.99)).toBe("thin");
    expect(marginBand(10)).toBe("healthy");
    expect(marginBand(24.99)).toBe("healthy");
    expect(marginBand(25)).toBe("strong");
    expect(marginBand(80)).toBe("strong");
  });
});

describe("priceForMargin", () => {
  it("hedef marjı koruyan taban fiyatı döndürür", () => {
    // %20 marj için: 800 / (1 - 0.20) = 1000
    expect(priceForMargin(800, 20)).toBeCloseTo(1000, 5);
    // %0 marj → maliyetin kendisi (başabaş)
    expect(priceForMargin(800, 0)).toBeCloseTo(800, 5);
  });

  it("taban fiyatı gerçekten hedef marjı verir (round-trip)", () => {
    const floor = priceForMargin(640, 15)!;
    expect(computeMargin(floor, 640)!.marginPct).toBeCloseTo(15, 5);
  });

  it("marj ≥ %100 veya geçersiz maliyet için null döner", () => {
    expect(priceForMargin(800, 100)).toBeNull();
    expect(priceForMargin(800, 150)).toBeNull();
    expect(priceForMargin(null, 20)).toBeNull();
    expect(priceForMargin(-10, 20)).toBeNull();
  });
});
