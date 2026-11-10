import { describe, it, expect } from "vitest";
import { provisionalProductName, titleFromProductUrl } from "../provisional-name";

describe("titleFromProductUrl", () => {
  it("builds a Trendyol title with the brand segment", () => {
    expect(
      titleFromProductUrl(
        "https://www.trendyol.com/philips/airfryer-xxl-hd9650-90-fritoz-p-14262809?boutiqueId=1",
      ),
    ).toBe("Philips Airfryer Xxl Hd9650 90 Fritoz");
  });

  it("builds a title from a '-p-' slug without a brand segment", () => {
    expect(
      titleFromProductUrl(
        "https://www.hepsiburada.com/vichy-dercos-kepek-karsiti-sampuan-200-ml-p-HBV00000WIDCQ",
      ),
    ).toBe("Vichy Dercos Kepek Karsiti Sampuan 200 Ml");
  });

  it("picks the wordiest path segment and drops trailing numeric ids", () => {
    expect(titleFromProductUrl("https://www.n11.com/urun/jbl-tune-520bt-kulaklik-482913345")).toBe(
      "Jbl Tune 520bt Kulaklik",
    );
    expect(
      titleFromProductUrl("https://www.amazon.com.tr/Stanley-Klasik-Termos-1L/dp/B07L6MJN2P"),
    ).toBe("Stanley Klasik Termos 1L");
    expect(titleFromProductUrl("https://www.vatanbilgisayar.com/lenovo-ideapad-slim-3.html")).toBe(
      "Lenovo Ideapad Slim 3",
    );
  });

  it("returns null when the URL has no usable slug", () => {
    expect(titleFromProductUrl("https://www.amazon.com.tr/dp/B07L6MJN2P")).toBeNull();
    expect(titleFromProductUrl("https://www.trendyol.com/x/p-123")).toBeNull();
    expect(titleFromProductUrl("not a url")).toBeNull();
    expect(titleFromProductUrl("https://www.n11.com/urun/%E0%A4%A")).toBeNull();
  });
});

describe("provisionalProductName", () => {
  it("prefers the slug title", () => {
    expect(
      provisionalProductName(
        "https://www.trendyol.com/stanley/termos-1-litre-p-222222",
        "TRENDYOL",
      ),
    ).toBe("Stanley Termos 1 Litre");
  });

  it("falls back to the marketplace display name, never a bare loading placeholder", () => {
    expect(provisionalProductName("https://www.amazon.com.tr/dp/B07L6MJN2P", "AMAZON_TR")).toBe(
      "Amazon TR ürünü",
    );
    expect(provisionalProductName("https://www.pttavm.com/p-123", "PTTAVM")).toBe("PTT AVM ürünü");
  });
});
