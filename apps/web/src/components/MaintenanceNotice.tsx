"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Genel Bakış sayfası her açıldığında gösterilen, kapatılabilir bilgilendirme.
 * Ziyaretler arasında bilinçli olarak hatırlanmaz. Kod değişikliği yapmadan
 * kaldırmak için Vercel'de NEXT_PUBLIC_MAINTENANCE_NOTICE=off ayarlayıp yeniden deploy edin.
 */
export default function MaintenanceNotice() {
  const [open, setOpen] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (process.env.NEXT_PUBLIC_MAINTENANCE_NOTICE === "off" || !open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="maintenance-notice-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-hive-500/40 bg-dark-900 p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Anladım"
          className="absolute top-4 end-4 p-1 text-dark-400 hover:text-white transition-colors rounded-md"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <div className="flex items-center gap-3 mb-4">
          <img src="/competehive-logo.png" width={40} height={40} alt="" className="shrink-0" />
          <span className="px-2.5 py-0.5 text-xs font-medium bg-hive-500/20 text-hive-500 rounded-full border border-hive-500/30">
            Platform güncellemesi
          </span>
        </div>

        <h2 id="maintenance-notice-title" className="text-xl font-bold text-white mb-3">
          CompeteHive&apos;ı daha iyi hâle getiriyoruz
        </h2>
        <p className="text-sm text-dark-300 leading-relaxed mb-3">
          Bir yıl boyunca bizimle paylaştığınız geri bildirimleri esas alarak platformu kusursuza
          yakın bir hâle getirmek için işlemleri geçici olarak kapattık ve arka planda
          güncellemelere devam ediyoruz.
        </p>
        <p className="text-sm text-dark-300 leading-relaxed mb-3">
          Çalışmalar tamamlandığında size e-posta ile bildirim yapacağız.
        </p>
        <p className="text-sm text-dark-400 leading-relaxed mb-6">
          Anlayışınız ve geri bildirimleriniz için teşekkür ederiz.
        </p>

        <button
          ref={closeRef}
          type="button"
          onClick={() => setOpen(false)}
          className="w-full px-6 py-3 rounded-xl bg-hive-500 text-dark-1000 font-semibold hover:bg-hive-600 transition-colors"
        >
          Anladım
        </button>
      </div>
    </div>
  );
}
