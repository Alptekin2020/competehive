import { describe, it, expect } from "vitest";
import { buildScrapeFailureContent } from "../services/notifications";

// SCRAPE_FAILURE sistem bildirimi içerik üretimi. Gönderim yolları (Resend/
// Telegram/DB) entegrasyon gerektirir; burada deterministik olan kısım —
// kullanıcıya giden Türkçe metin — regresyon altına alınır.
describe("buildScrapeFailureContent", () => {
  const input = {
    productId: "7716d45c-e45a-4193-bcda-14169c0f628b",
    productName: "Philips HD9650/90 Airfryer XXL Fritöz",
    marketplace: "TRENDYOL",
    productUrl: "https://www.trendyol.com/philips/airfryer-p-14262809",
    failureCount: 5,
  };

  it("builds a Turkish title containing the product name", () => {
    const { title } = buildScrapeFailureContent(input);
    expect(title).toContain("Ürün taranamıyor");
    expect(title).toContain("Philips HD9650/90 Airfryer XXL Fritöz");
  });

  it("mentions failure count, ERROR state and the 24h auto-retry in the message", () => {
    const { message } = buildScrapeFailureContent(input);
    expect(message).toContain("5 ardışık denemede");
    expect(message).toContain("HATA durumuna alındı");
    expect(message).toContain("24 saatte bir");
    expect(message).toContain("kendini düzeltir");
  });

  it("uses the human marketplace label, not the enum constant", () => {
    const { message } = buildScrapeFailureContent(input);
    expect(message).toContain("Trendyol");
    expect(message).not.toContain("TRENDYOL");
  });

  it("telegram text links to both the marketplace page and the app product page", () => {
    const { telegramText } = buildScrapeFailureContent(input);
    expect(telegramText).toContain(input.productUrl);
    expect(telegramText).toContain(`/dashboard/products/${input.productId}`);
    expect(telegramText).toContain("Ürüne git");
    expect(telegramText).toContain("CompeteHive'da aç");
  });

  it("escapes HTML-sensitive characters in the product name for Telegram", () => {
    const { telegramText } = buildScrapeFailureContent({
      ...input,
      productName: 'Ürün <script>"kötü"</script> & Adı',
    });
    expect(telegramText).not.toContain("<script>");
    expect(telegramText).toContain("&lt;script&gt;");
    expect(telegramText).toContain("&amp;");
  });

  it("falls back to the raw marketplace key for unknown marketplaces", () => {
    const { message } = buildScrapeFailureContent({ ...input, marketplace: "YENIPAZAR" });
    expect(message).toContain("YENIPAZAR");
  });
});
