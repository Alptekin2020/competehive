import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Yayındaki sunucu sürümünü döner. İstemci (StaleBundleGuard) kendi build
// SHA'sıyla karşılaştırır; eskiyse kullanıcıya yenileme bandı gösterir —
// "deploy çıktı ama açık sekme eski JS'i çalıştırıyor" sınıfı sorunların
// kalıcı çözümü.
export async function GET() {
  return NextResponse.json(
    { sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
