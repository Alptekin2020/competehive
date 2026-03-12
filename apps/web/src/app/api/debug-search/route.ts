import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

function isProduction() {
  return process.env.NODE_ENV === "production";
}

export async function GET(req: NextRequest) {
  if (isProduction()) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  const query = req.nextUrl.searchParams.get("q") || "samsung televizyon";
  const results: {
    serperConfigured: boolean;
    shopping?: unknown;
    organic?: unknown;
    openaiConfigured: boolean;
    googleSearchConfigured: boolean;
    googleSearchEngineConfigured: boolean;
  } = {
    serperConfigured: !!process.env.SERPER_API_KEY,
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    googleSearchConfigured: !!process.env.GOOGLE_SEARCH_API_KEY,
    googleSearchEngineConfigured: !!process.env.GOOGLE_SEARCH_ENGINE_ID,
  };

  const serperKey = process.env.SERPER_API_KEY;

  if (serperKey) {
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
        items: (shoppingData.shopping || []).slice(0, 3).map((item: Record<string, unknown>) => ({
          title: item.title,
          price: item.price,
          source: item.source,
          link: item.link,
        })),
        error: shoppingData.message || null,
      };
    } catch (e: unknown) {
      results.shopping = { error: e instanceof Error ? e.message : "Unknown error" };
    }

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
        items: (searchData.organic || []).slice(0, 3).map((item: Record<string, unknown>) => ({
          title: item.title,
          link: item.link,
          snippet: typeof item.snippet === "string" ? item.snippet.substring(0, 100) : null,
        })),
        error: searchData.message || null,
      };
    } catch (e: unknown) {
      results.organic = { error: e instanceof Error ? e.message : "Unknown error" };
    }
  }

  return NextResponse.json(results);
}
