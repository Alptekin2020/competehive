"use client";

import { useEffect, useState } from "react";

// Bu sabit BUILD anında pakete gömülür (Vercel system env). Sunucudaki
// /api/version ile uyuşmuyorsa kullanıcı eski JS paketini çalıştırıyordur.
const CLIENT_SHA = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null;

const CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Eski-paket bekçisi: açık sekme, yeni bir deploy'dan sonra eski JavaScript'i
 * çalıştırmaya devam eder (tarayıcı yüklü chunk'ları bırakmaz). Bu bileşen
 * sunucu sürümünü periyodik ve sekme görünür olduğunda kontrol eder;
 * uyuşmazlıkta tam genişlik bir "yenile" bandı gösterir. Bu, "düzeltme
 * yayınlandı ama kullanıcı hâlâ eski davranışı görüyor" sınıfı sorunların
 * kalıcı çözümüdür.
 */
export default function StaleBundleGuard() {
  const [isStale, setIsStale] = useState(false);

  useEffect(() => {
    // Lokal geliştirmede veya system env kapalıysa sessizce devre dışı.
    if (!CLIENT_SHA) return;

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { sha?: string | null };
        if (!cancelled && data.sha && data.sha !== CLIENT_SHA) {
          setIsStale(true);
        }
      } catch {
        // Ağ hatasında sessiz kal — bir sonraki kontrolde tekrar denenir.
      }
    };

    check();
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!isStale) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-[100] bg-hive-500 text-dark-1000 px-4 py-2.5 flex items-center justify-center gap-3 text-sm font-medium shadow-lg">
      <span>Panelin yeni bir sürümü yayınlandı — güncel özellikler için sayfayı yenileyin.</span>
      <button
        onClick={() => window.location.reload()}
        className="bg-dark-1000 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-dark-900 transition"
      >
        Şimdi Yenile
      </button>
    </div>
  );
}
