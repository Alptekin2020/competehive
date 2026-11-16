import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CompetitorCard, type CompetitorCardData } from "../products/CompetitorCards";

const NOW = new Date("2026-11-16T12:00:00Z");
const OWN_PRICE = 17563.08;
const TITLE = "Philips Series 3300 tam otomatik espresso makinesi 6 sıcak ve buzlu içecek";
const REASON =
  "Marka ve seri aynı ancak model kodu belirtilmemiş; EP3347/90 ile EP3341/50 aynı seride farklı modeller olabilir, bu yüzden emin değilim.";

const PENDING: CompetitorCardData = {
  id: "c7",
  competitorUrl:
    "https://www.google.com/search?ibp=oshop&q=Philips+Series+3300&prds=catalogid:987,pvo:2&gl=tr",
  competitorName: TITLE,
  marketplace: "CUSTOM",
  currentPrice: "47181.75",
  lastScrapedAt: "2026-11-15T04:00:00Z",
  matchScore: 60,
  matchReason: REASON,
  review: "pending",
  seller: null,
};

function renderPending(overrides: Partial<CompetitorCardData> = {}) {
  const onConfirm = vi.fn();
  const onReject = vi.fn();
  const view = render(
    <CompetitorCard
      competitor={{ ...PENDING, ...overrides }}
      variant="pending"
      ownPrice={OWN_PRICE}
      currency="TRY"
      onConfirm={onConfirm}
      onReject={onReject}
      now={NOW}
    />,
  );
  return { ...view, onConfirm, onReject };
}

describe("CompetitorCard (onay bekleyen)", () => {
  it("tam başlık, tam gerekçe ve nötr fiyat farkı gösterir", () => {
    const { container } = renderPending();
    expect(screen.getByText(TITLE)).toBeTruthy();
    expect(container.textContent).toContain(REASON);
    const gap = screen.getByTestId("price-gap");
    expect(gap.textContent).toBe("Fiyat farkı 2,7 kat");
    expect(gap.className).not.toContain("red");
    expect(container.textContent).not.toContain("+%168");
    expect(container.querySelector(".line-clamp-2")).toBeNull();
  });

  it("tek bir tazelik etiketi gösterir", () => {
    const { container } = renderPending();
    expect(container.textContent).toContain("1 gün önce");
    expect(container.textContent).not.toMatch(/\d+sa\b/);
  });

  it("Google kartını açmaz; satıcı yoksa 'Satıcı bilinmiyor' ve kaynak çipi gösterir", () => {
    const { container } = renderPending();
    const links = [...container.querySelectorAll("a")];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("href")).toContain("udm=28");
      expect(link.getAttribute("href")).not.toContain("ibp=oshop");
    }
    expect(screen.getByText("Google'da ara")).toBeTruthy();
    expect(screen.getByText("Satıcı bilinmiyor")).toBeTruthy();
    expect(screen.getByText("Google Alışveriş")).toBeTruthy();
  });

  it("bilinen satıcıyı rozet olarak gösterir", () => {
    renderPending({ seller: "Evkur" });
    expect(screen.getByText("Evkur")).toBeTruthy();
    expect(screen.queryByText("Satıcı bilinmiyor")).toBeNull();
  });

  it("tek bir 'Aynı ürün değil' kontrolü vardır", () => {
    const { onReject } = renderPending();
    const rejects = screen.getAllByRole("button", { name: /değil|kaldır/i });
    expect(rejects).toHaveLength(1);
    fireEvent.click(rejects[0]);
    expect(onReject).toHaveBeenCalledWith("c7");
  });

  it("fark %50'yi aşınca onay satır içi ek adım ister", () => {
    const { onConfirm } = renderPending();
    fireEvent.click(screen.getByRole("button", { name: "Bu aynı ürün" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Onayı doğrula" }).textContent).toContain(
      "Fiyat farkı 2,7 kat",
    );
    fireEvent.click(screen.getByRole("button", { name: "Vazgeç" }));
    expect(screen.queryByRole("group", { name: "Onayı doğrula" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bu aynı ürün" }));
    fireEvent.click(screen.getByRole("button", { name: "Evet, aynı ürün" }));
    expect(onConfirm).toHaveBeenCalledWith("c7");
  });

  it("küçük farkta onay doğrudan gönderilir", () => {
    const { onConfirm } = renderPending({ currentPrice: "18200.00" });
    fireEvent.click(screen.getByRole("button", { name: "Bu aynı ürün" }));
    expect(onConfirm).toHaveBeenCalledWith("c7");
  });
});

describe("CompetitorCard (güvenilir)", () => {
  it("numara, işaretli yüzde ve gerçek pazaryeri bağlantısı gösterir", () => {
    const url = "https://www.hepsiburada.com/philips-ep3347-90-p-HBC000012345";
    const { container } = render(
      <CompetitorCard
        competitor={{
          ...PENDING,
          id: "t1",
          competitorUrl: url,
          marketplace: "HEPSIBURADA",
          currentPrice: "17299.00",
          matchScore: 92,
          review: null,
          competitorName: "Philips EP3347/90 LatteGo Tam Otomatik Espresso Makinesi",
          lastScrapedAt: "2026-11-16T09:00:00Z",
        }}
        variant="trusted"
        index={1}
        ownPrice={OWN_PRICE}
        currency="TRY"
        isCheapest
        onReject={() => undefined}
        now={NOW}
      />,
    );
    expect(container.textContent).toContain("1.");
    expect(container.textContent).toContain("−%1,5");
    expect(container.textContent).toContain("En düşük rakip");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(url);
    expect(screen.queryByRole("button", { name: "Bu aynı ürün" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
