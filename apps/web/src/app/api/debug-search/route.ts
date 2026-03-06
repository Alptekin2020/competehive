import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") || "samsung televizyon";
  const results: any = {};

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "tr-TR,tr;q=0.9",
  };

  // Akakçe test
  try {
    const res = await fetch(`https://www.akakce.com/arama/?q=${encodeURIComponent(query)}`, { headers, cache: "no-store" });
    const html = await res.text();
    results.akakce = {
      status: res.status,
      htmlLength: html.length,
      title: html.match(/<title>(.*?)<\/title>/)?.[1] || "no title",
      hasProducts: html.includes("p_w") || html.includes("product") || html.includes("pn_t"),
      sampleHtml: html.substring(0, 3000),
      containsClasses: {
        p_w: html.includes("p_w"),
        pn_t: html.includes("pn_t"),
        pt_v8: html.includes("pt_v8"),
        product: html.includes("product"),
        search_result: html.includes("search-result"),
        li_class: (html.match(/class="[^"]*"/g) || []).slice(0, 30),
      }
    };
  } catch (e: any) {
    results.akakce = { error: e.message };
  }

  // Cimri test
  try {
    const res = await fetch(`https://www.cimri.com/arama?q=${encodeURIComponent(query)}`, { headers, cache: "no-store" });
    const html = await res.text();
    results.cimri = {
      status: res.status,
      htmlLength: html.length,
      title: html.match(/<title>(.*?)<\/title>/)?.[1] || "no title",
      hasNextData: html.includes("__NEXT_DATA__"),
      hasJsonLd: html.includes("application/ld+json"),
      sampleHtml: html.substring(0, 3000),
    };
  } catch (e: any) {
    results.cimri = { error: e.message };
  }

  // Google Shopping test
  try {
    const res = await fetch(`https://www.google.com.tr/search?tbm=shop&q=${encodeURIComponent(query)}&hl=tr&gl=tr`, { headers, cache: "no-store" });
    const html = await res.text();
    results.google = {
      status: res.status,
      htmlLength: html.length,
      title: html.match(/<title>(.*?)<\/title>/)?.[1] || "no title",
      sampleHtml: html.substring(0, 3000),
    };
  } catch (e: any) {
    results.google = { error: e.message };
  }

  return NextResponse.json(results);
}
