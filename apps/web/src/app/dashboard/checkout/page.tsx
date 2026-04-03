"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { PLANS } from "@/lib/plans";

function CheckoutContent() {
  const searchParams = useSearchParams();
  const planId = searchParams.get("plan");
  const billing = searchParams.get("billing") === "yearly" ? "yearly" : "monthly";

  const [status, setStatus] = useState<"idle" | "loading" | "opened" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const plan = PLANS.find((p) => p.id === planId);

  const initiateCheckout = useCallback(async () => {
    if (!planId) return;
    setStatus("loading");
    setError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, billing }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Ödeme başlatılamadı");
        setStatus("error");
        return;
      }

      setCheckoutUrl(data.checkoutUrl);
      setStatus("idle");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
      setStatus("error");
    }
  }, [planId, billing]);

  useEffect(() => {
    initiateCheckout();
  }, [initiateCheckout]);

  const openCheckout = () => {
    if (checkoutUrl) {
      window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      setStatus("opened");
    }
  };

  if (!plan || !planId || planId === "FREE") {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <p className="text-dark-400">Geçersiz plan seçimi.</p>
        <Link
          href="/dashboard/pricing"
          className="text-hive-500 hover:text-hive-400 text-sm font-medium"
        >
          ← Fiyatlandırmaya Dön
        </Link>
      </div>
    );
  }

  const price = billing === "yearly" ? plan.yearlyPrice : plan.price;

  return (
    <div className="max-w-lg mx-auto py-10 px-4">
      {/* Back button */}
      <Link
        href="/dashboard/pricing"
        className="inline-flex items-center gap-2 text-dark-400 hover:text-white text-sm mb-8 transition-colors"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Fiyatlandırmaya Dön
      </Link>

      {/* Plan summary card */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-white">{plan.name} Plan</h1>
          {plan.badge && (
            <span className="text-xs font-semibold bg-hive-500/20 text-hive-400 px-2.5 py-1 rounded-full">
              {plan.badge}
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-1 mb-1">
          <span className="text-3xl font-bold text-white">₺{price.toLocaleString("tr-TR")}</span>
          <span className="text-dark-400 text-sm">/ ay</span>
        </div>
        {billing === "yearly" && (
          <p className="text-xs text-green-400 mb-4">
            Yıllık faturalandırma — ₺
            {((plan.price - plan.yearlyPrice) * 12).toLocaleString("tr-TR")} tasarruf
          </p>
        )}

        <div className="border-t border-dark-800 pt-4 mt-4">
          <p className="text-sm text-dark-400 mb-3">Plan dahilinde:</p>
          <ul className="space-y-2">
            {plan.features.slice(0, 5).map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-dark-300">
                <svg
                  className="w-4 h-4 text-hive-500 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Checkout action */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-white mb-2">Ödeme</h2>
        <p className="text-xs text-dark-400 mb-5">
          Güvenli ödeme Whop altyapısı üzerinden yeni sekmede açılacaktır.
        </p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {status === "opened" ? (
          <div className="text-center py-4">
            <div className="w-10 h-10 border-2 border-hive-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-dark-300 mb-1">Ödeme sayfası yeni sekmede açıldı</p>
            <p className="text-xs text-dark-500 mb-4">Ödemeyi tamamladıktan sonra buraya dönün.</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={openCheckout}
                className="text-sm text-hive-500 hover:text-hive-400 font-medium"
              >
                Ödeme sayfası açılmadı mı? Tekrar aç
              </button>
              <Link
                href="/dashboard/pricing"
                className="text-sm text-dark-400 hover:text-dark-300 font-medium mt-2"
              >
                Plan durumumu kontrol et →
              </Link>
            </div>
          </div>
        ) : (
          <button
            onClick={openCheckout}
            disabled={status === "loading" || !checkoutUrl}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all bg-hive-500 hover:bg-hive-600 text-dark-1000 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "loading" ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-dark-1000 border-t-transparent rounded-full animate-spin" />
                Hazırlanıyor...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="1" y="4" width="22" height="16" rx="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
                Ödemeye Geç
              </span>
            )}
          </button>
        )}

        <p className="text-[11px] text-dark-600 text-center mt-4">
          256-bit SSL ile şifrelenmiş güvenli ödeme. İstediğiniz zaman iptal edebilirsiniz.
        </p>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-hive-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
