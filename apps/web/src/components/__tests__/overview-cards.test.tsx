import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  MarketPositionCard,
  OnboardingGuide,
  OpportunityList,
  TodoCards,
} from "../dashboard/OverviewCards";
import { PositionChip, PricePositionBar } from "../insights/PricePosition";
import { computeProductInsight } from "@/lib/product-insights";

const NOW = new Date("2026-11-14T12:00:00Z");
const fresh = "2026-11-14T11:00:00Z";

describe("OverviewCards", () => {
  it("shows the remaining onboarding steps and hides when done", () => {
    const steps = [
      { key: "a", title: "Ürün ekle", description: "", done: true, href: "/a", cta: "Ekle" },
      { key: "b", title: "Rakipleri gör", description: "", done: false, href: "/b", cta: "Gör" },
      { key: "c", title: "Uyarı kur", description: "", done: false, href: "/c", cta: "Kur" },
    ];
    const { container, rerender } = render(<OnboardingGuide steps={steps} />);
    expect(screen.getByText("Kuruluma 2 adım kaldı")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
    rerender(<OnboardingGuide steps={steps.map((s) => ({ ...s, done: true }))} />);
    expect(container.textContent).toBe("");
  });

  it("renders an all-clear todo state", () => {
    render(<TodoCards items={[]} />);
    expect(screen.getByText("Her şey yolunda")).toBeTruthy();
  });

  it("links todo cards to filtered product lists", () => {
    render(
      <TodoCards
        items={[
          {
            key: "cheaper",
            count: 2,
            title: "Rakip sizden ucuz",
            description: "",
            cta: "Ürünleri gör",
            href: "/dashboard/products?filter=CHEAPER_COMPETITOR",
            tone: "orange",
          },
        ]}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "/dashboard/products?filter=CHEAPER_COMPETITOR",
    );
  });

  it("summarizes market position counts", () => {
    render(
      <MarketPositionCard counts={{ cheapest: 3, middle: 2, "most-expensive": 1, "no-data": 4 }} />,
    );
    expect(screen.getByText("6 ürününüz rakiplerine göre nerede?")).toBeTruthy();
    expect(screen.getByText(/4 ürün için henüz/)).toBeTruthy();
  });

  it("lists opportunities with the suggested price", () => {
    render(
      <OpportunityList
        items={[
          {
            productId: "p1",
            productName: "Air Fryer",
            kind: "undercut",
            title: "21 ₺ indirimle en ucuz olun",
            detail: "",
            suggestedPrice: 979,
            weight: 1,
          },
        ]}
      />,
    );
    expect(screen.getByText("En ucuz ol")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/dashboard/products/p1");
  });
});

describe("PricePosition", () => {
  it("shows the chip and the bar for a compared product", () => {
    const insight = computeProductInsight(
      {
        id: "p1",
        name: "Air Fryer",
        currentPrice: 1000,
        cost: null,
        lastSuccessAt: fresh,
        lastScrapedAt: fresh,
        competitors: [
          { price: 900, matchScore: 90, lastScrapedAt: fresh },
          { price: 1200, matchScore: 90, lastScrapedAt: fresh },
        ],
      },
      NOW,
    );
    render(
      <>
        <PositionChip insight={insight} />
        <PricePositionBar insight={insight} />
      </>,
    );
    expect(screen.getByText("1 rakip daha ucuz")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("1 rakip daha ucuz");
  });
});
