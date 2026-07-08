import { describe, it, expect } from "vitest";
import { buildZeroReason } from "../utils/zero-reason";

describe("buildZeroReason", () => {
  it("AI kullanılamadıysa 'rakibiniz yok' yerine dürüst altyapı mesajı verir", () => {
    const msg = buildZeroReason(103, {
      packaging: 0,
      priceFiltered: 0,
      aiRejected: 103,
      priceUnrecoverable: 0,
      aiUnavailable: 103,
    });
    expect(msg).toContain("yapay zekâ doğrulaması");
    expect(msg).not.toContain("piyasada birebir rakibi görünmüyor");
  });

  it("AI gerçekten reddettiyse eski davranışı korur (Rakip Ekle yönlendirmesiyle)", () => {
    const msg = buildZeroReason(50, {
      packaging: 0,
      priceFiltered: 3,
      aiRejected: 40,
      priceUnrecoverable: 0,
      aiUnavailable: 0,
    });
    expect(msg).toContain("doğrulanamadı");
    expect(msg).toContain("Rakip Ekle");
  });

  it("hiç eleme yoksa nötr mesaj", () => {
    const msg = buildZeroReason(0, {
      packaging: 0,
      priceFiltered: 0,
      aiRejected: 0,
      priceUnrecoverable: 0,
    });
    expect(msg).toContain("birebir aynı ürün bulunamadı");
  });
});
