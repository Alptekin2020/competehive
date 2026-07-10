import { describe, it, expect } from "vitest";
import { parseN11Html, parseAmazonTRHtml, detectBotChallenge } from "../scrapers";

// ============================================
// N11 — canlı doğrulanan yapı (2026-07, Oral-B prod vakası)
// ============================================
// JSON-LD artık @type=AggregateOffer taşıyor: `price` alanı YOK, yalnızca
// `lowPrice` (tüm satıcıların en düşüğü) var. Eski parser offer.price'a
// baktığı için JSON-LD yolu hiç tetiklenmiyordu. DOM'daki .newPrice ins ise
// gösterilen satıcının fiyatı — kendi-fiyat için öncelik onda.
describe("parseN11Html — AggregateOffer JSON-LD (N11 prod vakası)", () => {
  const oralBLd = {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: "Oral-B Şarjlı Vitality Pro Koruma ve Temizlik Elektrikli Diş Fırçası Lila",
    image:
      "https://n11scdn2-im.akamaized.net/a1/640/20/09/21/84/44/56/86/11/27/49/86/67/01624004745729654692.jpg",
    brand: "Oral-B",
    aggregateRating: { "@type": "AggregateRating", ratingCount: "277", ratingValue: 5 },
    offers: {
      "@type": "AggregateOffer",
      lowPrice: "1444.15",
      offerCount: "14",
      priceCurrency: "TRY",
      url: "https://m.n11.com/urun/oral-b-sarjli-x?magaza=oralbturkiye",
    },
  };

  it("prefers the displayed seller's DOM price over the aggregate lowPrice", () => {
    const page = `<html><body>
      <script type="application/ld+json">${JSON.stringify(oralBLd)}</script>
      <h1>Oral-B Şarjlı Vitality Pro Koruma ve Temizlik Elektrikli Diş Fırçası Lila</h1>
      <div class="newPrice"><ins>1.259 TL</ins></div>
      <link rel="canonical" href="https://www.n11.com/urun/oral-b-x-18872592?magaza=mutlufiyatlar" />
    </body></html>`;

    const result = parseN11Html(page);
    expect(result).not.toBeNull();
    expect(result?.price).toBe(1259);
    expect(result?.name).toContain("Oral-B");
    expect(result?.currency).toBe("TRY");
  });

  it("falls back to AggregateOffer.lowPrice when the DOM price block is absent", () => {
    // Puppeteer domcontentloaded anında fiyat DOM'u henüz boş olabilir —
    // lowPrice, hiç fiyat alamamaktan iyidir (yaklaşık piyasa tabanı).
    const page = `<html><body>
      <script type="application/ld+json">${JSON.stringify(oralBLd)}</script>
      <h1>Oral-B Şarjlı Vitality Pro</h1>
    </body></html>`;

    const result = parseN11Html(page);
    expect(result?.price).toBe(1444.15);
  });

  it("extracts seller name from the ?magaza= URL parameter when DOM selector is dead", () => {
    const page = `<html><body>
      <script type="application/ld+json">${JSON.stringify(oralBLd)}</script>
      <div class="newPrice"><ins>1.259 TL</ins></div>
      <link rel="canonical" href="https://www.n11.com/urun/oral-b-x-18872592?magaza=mutlufiyatlar" />
    </body></html>`;

    const result = parseN11Html(page);
    expect(result?.sellerName).toBe("mutlufiyatlar");
  });

  it("still parses legacy flat Offer JSON-LD with a direct price", () => {
    const page = `<html><body><script type="application/ld+json">${JSON.stringify({
      "@type": "Product",
      name: "Örnek N11 Ürünü",
      offers: { "@type": "Offer", price: "499.90", priceCurrency: "TRY" },
    })}</script></body></html>`;

    const result = parseN11Html(page);
    expect(result?.price).toBe(499.9);
  });

  it("returns null for a page with no product signal", () => {
    expect(parseN11Html("<html><body><p>hata</p></body></html>")).toBeNull();
  });
});

// ============================================
// Amazon TR — canlı doğrulanan yapı (2026-07, HD9650/90 vakası)
// ============================================
describe("parseAmazonTRHtml — buybox kapsamı (Amazon prod vakası)", () => {
  it("takes the price ONLY from buybox scopes, never from carousels", () => {
    // Canlı vaka: buybox'sız üründe ilk .a-price karuseldeki alakasız ürünün
    // 926,25TL fiyatıydı. Karusel fiyatı buybox kapsamı dışında kaldığı için
    // YOK sayılmalı — ürün fiyatsız kalmalı (yanlış veri kaydetmekten iyi).
    const page = `<html><body>
      <span id="productTitle"> Philips HD9650/90 Airfryer XXL Fritöz </span>
      <div id="anonCarousel2">
        <span class="a-price"><span class="a-offscreen">926,25TL</span></span>
        <span class="a-price"><span class="a-offscreen">1.322,31TL</span></span>
      </div>
    </body></html>`;

    const result = parseAmazonTRHtml(page);
    expect(result?.name).toBe("Philips HD9650/90 Airfryer XXL Fritöz");
    expect(result?.price).toBe(0);
  });

  it("extracts the buybox price from #corePrice_feature_div (live-verified layout)", () => {
    const page = `<html><body>
      <span id="productTitle">Philips Premium Airfryer XXL (HD9650/90)</span>
      <div id="anonCarousel2">
        <span class="a-price"><span class="a-offscreen">926,25TL</span></span>
      </div>
      <div id="corePrice_feature_div">
        <span class="a-price"><span class="a-offscreen">9.499,00TL</span></span>
      </div>
      <div id="availability"><span> Stokta var </span></div>
      <img id="landingImage" src="https://m.media-amazon.com/images/I/61mgyoNksKL._AC_SX679_.jpg" />
      <a id="sellerProfileTriggerId">TAŞARAVM</a>
    </body></html>`;

    const result = parseAmazonTRHtml(page);
    expect(result?.price).toBe(9499);
    expect(result?.sellerName).toBe("TAŞARAVM");
    expect(result?.inStock).toBe(true);
    expect(result?.imageUrl).toContain("media-amazon.com");
  });

  it("reads the newer merchantInfoFeature block when sellerProfileTriggerId is absent", () => {
    const page = `<html><body>
      <span id="productTitle">Ürün</span>
      <div id="corePriceDisplay_desktop_feature_div">
        <span class="a-price"><span class="a-offscreen">1.500,00TL</span></span>
      </div>
      <div id="merchantInfoFeature_feature_div">Satıcı TAŞARAVM  TAŞARAVM</div>
    </body></html>`;

    const result = parseAmazonTRHtml(page);
    expect(result?.price).toBe(1500);
    expect(result?.sellerName).toBe("TAŞARAVM");
  });

  it("marks Turkish 'mevcut değil' availability as out of stock", () => {
    const page = `<html><body>
      <span id="productTitle">Ürün</span>
      <div id="availability"><span>Şu anda mevcut değil.</span></div>
    </body></html>`;

    const result = parseAmazonTRHtml(page);
    expect(result?.inStock).toBe(false);
    expect(result?.price).toBe(0);
  });
});

// ============================================
// detectBotChallenge — generic yol için ortak imza tespiti
// ============================================
describe("detectBotChallenge", () => {
  it("flags the Amazon robot-check form regardless of page size", () => {
    const page = `<html><body>${"x".repeat(60_000)}<form method="get" action="/errors/validateCaptcha">…</form></body></html>`;
    expect(detectBotChallenge(page)).toBe('action="/errors/validatecaptcha');
  });

  it("flags small challenge pages by generic markers", () => {
    expect(detectBotChallenge("<html><title>Robot Check</title></html>")).toBe("robot check");
    expect(detectBotChallenge("<html><body>Erişim Engellendi</body></html>")).toBe(
      "erişim engellendi",
    );
  });

  it("does NOT flag a large real product page containing the word 'captcha' in a bundle", () => {
    const page = `<html><body><script>var a="captcha";</script>${"ürün ".repeat(20_000)}</body></html>`;
    expect(page.length).toBeGreaterThanOrEqual(50_000);
    expect(detectBotChallenge(page)).toBeNull();
  });

  it("returns null for a normal small page without markers", () => {
    expect(detectBotChallenge("<html><body>normal sayfa</body></html>")).toBeNull();
  });
});
