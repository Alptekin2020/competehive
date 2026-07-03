import { describe, it, expect } from "vitest";
import { isAkamaiBlockHtml } from "../scrapers";

// Üretim vakası: Hepsiburada 200 + 607KB gerçek ürün sayfası, inline SPA
// bundle'ı "güvenlik" başlık şablonunu ve "akamai"+"iframe" kelimelerini
// içerdiği için blok sanılıp ayrıştırılmadan atılıyordu.
describe("isAkamaiBlockHtml", () => {
  const realBlockPage =
    "<html><head><title>Hepsiburada | Güvenlik</title></head>" +
    '<body><iframe src="https://x.akamai.com/challenge"></iframe></body></html>';

  it("flags the small güvenlik challenge page", () => {
    expect(isAkamaiBlockHtml(realBlockPage.toLowerCase(), 200, "hepsiburada")).toBe(true);
    expect(isAkamaiBlockHtml(realBlockPage, 200, "hepsiburada")).toBe(true);
  });

  it("flags 403 responses served by Akamai regardless of body", () => {
    expect(isAkamaiBlockHtml("x".repeat(100_000), 403, "AkamaiGHost")).toBe(true);
  });

  it("does NOT flag a large real product page containing akamai+iframe strings", () => {
    const productPage =
      '<html><body><h1>VSA Batarya</h1><script type="application/ld+json">{"@type":"Product"}</script>' +
      '<script>var securityTitle="hepsiburada | güvenlik"; var bot="akamai"; var f="<iframe>";</script>' +
      "<div>" +
      "ürün ".repeat(20_000) + // ~100KB — gerçek sayfa boyutu profili
      "</div></body></html>";
    expect(productPage.length).toBeGreaterThanOrEqual(50_000);
    expect(isAkamaiBlockHtml(productPage, 200, "hepsiburada")).toBe(false);
  });

  it("does NOT flag a small page without block markers", () => {
    expect(isAkamaiBlockHtml("<html><body>ok</body></html>", 200, "hepsiburada")).toBe(false);
  });
});
