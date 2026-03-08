import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") || "samsung televizyon";
  const results: any = {};

  // Serper.dev test
  const serperKey = process.env.SERPER_API_KEY;
  results.serperKeyExists = !!serperKey;
  results.serperKeyPrefix = serperKey ? serperKey.substring(0, 8) + "..." : "MISSING";

  if (serperKey) {
    // Shopping arama
    try {
      const shoppingRes = await fetch("https://google.serper.dev/shopping", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, gl: "tr", hl: "tr", num: 5 }),
        cache: "no-store",
      });
      const shoppingData = await shoppingRes.json();
      results.shopping = {
        status: shoppingRes.status,
        count: shoppingData.shopping?.length || 0,
        items: (shoppingData.shopping || []).slice(0, 3).map((item: any) => ({
          title: item.title,
          price: item.price,
          source: item.source,
          link: item.link,
        })),
        error: shoppingData.message || null,
      };
    } catch (e: any) {
      results.shopping = { error: e.message };
    }

    // Normal arama
    try {
      const searchRes = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query + " fiyat", gl: "tr", hl: "tr", num: 5 }),
        cache: "no-store",
      });
      const searchData = await searchRes.json();
      results.organic = {
        status: searchRes.status,
        count: searchData.organic?.length || 0,
        items: (searchData.organic || []).slice(0, 3).map((item: any) => ({
          title: item.title,
          link: item.link,
          snippet: item.snippet?.substring(0, 100),
        })),
        error: searchData.message || null,
      };
    } catch (e: any) {
      results.organic = { error: e.message };
    }
  }

  // OpenAI key test
  results.openaiKeyExists = !!process.env.OPENAI_API_KEY;

  // Google Custom Search key test
  results.googleKeyExists = !!process.env.GOOGLE_SEARCH_API_KEY;
  results.googleCxExists = !!process.env.GOOGLE_SEARCH_ENGINE_ID;

  return NextResponse.json(results);
}
