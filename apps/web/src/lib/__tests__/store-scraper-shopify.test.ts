import { describe, it, expect, vi, beforeEach } from "vitest";

// fetchWithTimeout sahte: HTML ve Shopify JSON yanıtlarını URL'ye göre döner.
const { fetchWithTimeout } = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));
vi.mock("@/lib/scraper", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scraper")>();
  return { ...actual, fetchWithTimeout };
});

import { scrapeStorePage } from "../store-scraper";

const PRODUCT_URL = "https://www.jumbo.com.tr/products/kesme-tahtasi";
// og fiyatı var ama stok etiketi bozuk (”product:availability”) — Jumbo'daki gerçek durum.
const HTML = `<html><head>
  <meta property="og:title" content="Kesme Tahtası" />
  <meta property="og:price:amount" content="3.909,00" />
  <meta property="og:price:currency" content="TRY" />
  <meta property=”product:availability” content="out stock" />
</head><body></body></html>`;

function htmlResponse(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

describe("scrapeStorePage Shopify stock completion", () => {
  beforeEach(() => {
    fetchWithTimeout.mockReset();
  });

  it("fills unknown stock from the Shopify product JSON and keeps the HTML price", async () => {
    fetchWithTimeout.mockImplementation(async (url: string) =>
      url.endsWith(".js")
        ? new Response(
            JSON.stringify({ title: "Kesme Tahtası", price: 390900, available: false }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          )
        : htmlResponse(HTML),
    );

    const result = await scrapeStorePage(PRODUCT_URL);

    expect(result.support).toBe("full");
    expect(result.issues).toEqual([]);
    expect(result.product).toMatchObject({ price: 3909, inStock: false, currency: "TRY" });
  });

  it("stays partial when the JSON endpoint is unavailable", async () => {
    fetchWithTimeout.mockImplementation(async (url: string) =>
      url.endsWith(".js") ? new Response("not found", { status: 404 }) : htmlResponse(HTML),
    );

    const result = await scrapeStorePage(PRODUCT_URL);

    expect(result.support).toBe("partial");
    expect(result.product.price).toBe(3909);
    expect(result.issues.join(" ")).toContain("Stok durumu okunamadı");
  });

  it("does not call the JSON endpoint for non-Shopify URLs", async () => {
    fetchWithTimeout.mockImplementation(async () => htmlResponse(HTML));

    await scrapeStorePage("https://www.loft.com.tr/p/pantolon-14481");

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });
});
