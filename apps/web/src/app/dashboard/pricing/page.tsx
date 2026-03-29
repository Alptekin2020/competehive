"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PLANS, isUpgrade } from "@/lib/plans";

export default function PricingPage() {
  const [currentPlan, setCurrentPlan] = useState<string>("FREE");
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const checkoutSuccess = searchParams.get("success") === "true";
  const upgradedPlan = searchParams.get("plan");

  useEffect(() => {
    async function fetchPlan() {
      try {
        const res = await fetch("/api/user/plan");
        if (res.ok) {
          const data = await res.json();
          setCurrentPlan(data.data?.plan || data.plan || "FREE");
        }
      } catch {
        // Fall back to FREE
      } finally {
        setLoading(false);
      }
    }
    fetchPlan();
  }, []);

  const handleUpgrade = async (planId: string) => {
    setCheckoutLoading(planId);
    setCheckoutError(null);

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, billing }),
      });

      const data = await res.json();

      if (!res.ok) {
        setCheckoutError(data.error || "Ödeme başlatılamadı");
        return;
      }

      // Redirect to Whop checkout
      window.location.href = data.checkoutUrl;
    } catch {
      setCheckoutError("Bağlantı hatası");
    } finally {
      setCheckoutLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-hive-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      {/* Success banner */}
      {checkoutSuccess && (
        <div className="bg-green-500/10 border border-green-500/30 text-green-400 rounded-xl px-5 py-4 mb-8 flex items-center gap-3">
          <svg
            className="w-5 h-5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <div>
            <p className="font-semibold">Ödeme başarılı!</p>
            <p className="text-sm text-green-400/80">
              {upgradedPlan} planınız aktif edildi. Sayfayı yenilemeniz gerekebilir.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="text-center mb-8 sm:mb-12">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">Planınızı Seçin</h1>
        <p className="text-dark-500 text-sm sm:text-base">
          E-ticaret fiyat takibinde bir adım öne geçin
        </p>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mt-6">
          <span
            className={`text-sm font-medium ${billing === "monthly" ? "text-white" : "text-dark-500"}`}
          >
            Aylık
          </span>
          <button
            onClick={() => setBilling(billing === "monthly" ? "yearly" : "monthly")}
            className="relative w-14 h-7 rounded-full transition-colors"
            style={{ backgroundColor: billing === "yearly" ? "#F59E0B" : "#1F1F23" }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform"
              style={{
                transform: billing === "yearly" ? "translateX(28px)" : "translateX(0)",
              }}
            />
          </button>
          <span
            className={`text-sm font-medium ${billing === "yearly" ? "text-white" : "text-dark-500"}`}
          >
            Yıllık
          </span>
          {billing === "yearly" && (
            <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full font-medium">
              %17 tasarruf
            </span>
          )}
        </div>
      </div>

      {/* Plan Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 max-w-6xl mx-auto">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === currentPlan;
          const canUpgrade = isUpgrade(currentPlan, plan.id);
          const price = billing === "yearly" ? plan.yearlyPrice : plan.price;

          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl p-5 sm:p-6 border transition ${
                plan.highlighted
                  ? "bg-hive-500/5 border-hive-500/40 ring-1 ring-hive-500/20"
                  : "bg-dark-900 border-dark-800 hover:border-dark-700"
              }`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-hive-500 text-black text-xs font-bold px-3 py-1 rounded-full">
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* Plan name */}
              <div
                className={`text-sm font-medium mb-2 ${plan.highlighted ? "text-hive-400" : "text-dark-400"}`}
              >
                {plan.name}
              </div>

              {/* Price */}
              <div className="mb-4">
                {price === 0 ? (
                  <div className="text-3xl sm:text-4xl font-bold text-white">Ücretsiz</div>
                ) : (
                  <div>
                    <span className="text-3xl sm:text-4xl font-bold text-white">
                      ₺{price.toLocaleString("tr-TR")}
                    </span>
                    <span className="text-dark-500 text-sm">/ay</span>
                  </div>
                )}
                {billing === "yearly" && price > 0 && (
                  <p className="text-dark-600 text-xs mt-1 line-through">
                    ₺{plan.price.toLocaleString("tr-TR")}/ay
                  </p>
                )}
              </div>

              {/* CTA Button */}
              {isCurrent ? (
                <div className="w-full py-2.5 rounded-xl text-sm font-medium text-center border border-green-500/30 text-green-400 bg-green-500/10 mb-5">
                  Mevcut Plan
                </div>
              ) : canUpgrade ? (
                <button
                  className={`w-full py-2.5 rounded-xl text-sm font-semibold transition mb-5 ${
                    plan.highlighted
                      ? "bg-hive-500 hover:bg-hive-400 text-black"
                      : "border border-dark-800 text-white hover:border-hive-500/30 hover:text-hive-400"
                  } ${checkoutLoading === plan.id ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => handleUpgrade(plan.id)}
                  disabled={checkoutLoading !== null}
                >
                  {checkoutLoading === plan.id ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="3"
                          className="opacity-25"
                        />
                        <path
                          d="M4 12a8 8 0 018-8"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                      İşleniyor...
                    </span>
                  ) : (
                    "Yükselt"
                  )}
                </button>
              ) : (
                <div className="w-full py-2.5 rounded-xl text-sm font-medium text-center text-dark-600 mb-5">
                  —
                </div>
              )}

              {/* Features */}
              <ul className="space-y-2.5">
                {plan.features.map((feature, j) => (
                  <li key={j} className="text-sm text-dark-300 flex items-start gap-2">
                    <svg
                      className={`w-4 h-4 flex-shrink-0 mt-0.5 ${plan.highlighted ? "text-hive-500" : "text-dark-600"}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* Checkout error */}
      {checkoutError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mt-4 max-w-md mx-auto text-center">
          {checkoutError}
        </div>
      )}

      {/* Feature Comparison Table — Desktop only */}
      <div className="mt-12 sm:mt-16 max-w-6xl mx-auto hidden lg:block">
        <h2 className="text-xl font-bold text-white mb-6 text-center">Detaylı Karşılaştırma</h2>
        <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-dark-800">
                <th className="text-left text-dark-500 text-sm font-medium px-6 py-4 w-1/3">
                  Özellik
                </th>
                {PLANS.map((plan) => (
                  <th
                    key={plan.id}
                    className={`text-center text-sm font-semibold px-4 py-4 ${plan.id === currentPlan ? "text-hive-500" : "text-white"}`}
                  >
                    {plan.name}
                    {plan.id === currentPlan && (
                      <span className="block text-[10px] text-green-400 font-normal mt-0.5">
                        Mevcut
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-sm">
              {[
                { label: "Ürün takibi", values: ["5", "50", "500", "Sınırsız"] },
                { label: "Tarama sıklığı", values: ["Günde 1", "Saatte 1", "15 dk", "5 dk"] },
                { label: "Marketplace", values: ["1", "2", "8+", "8+"] },
                {
                  label: "Fiyat geçmişi",
                  values: ["7 gün", "30 gün", "1 yıl", "Sınırsız"],
                },
                { label: "E-posta bildirimi", values: ["\u2713", "\u2713", "\u2713", "\u2713"] },
                { label: "Telegram bildirimi", values: ["\u2014", "\u2713", "\u2713", "\u2713"] },
                { label: "Webhook", values: ["\u2014", "\u2014", "\u2713", "\u2713"] },
                { label: "Toplu URL import", values: ["\u2014", "\u2713", "\u2713", "\u2713"] },
                { label: "Etiketleme", values: ["\u2014", "\u2713", "\u2713", "\u2713"] },
                { label: "Oto-fiyat kuralları", values: ["\u2014", "\u2014", "\u2713", "\u2713"] },
                {
                  label: "Analitik dashboard",
                  values: ["\u2014", "\u2014", "\u2713", "\u2713"],
                },
                { label: "API erişimi", values: ["\u2014", "\u2014", "\u2014", "\u2713"] },
                { label: "Öncelikli destek", values: ["\u2014", "\u2014", "\u2713", "\u2713"] },
              ].map((row, i) => (
                <tr key={i} className="border-b border-dark-800 last:border-b-0">
                  <td className="text-dark-400 px-6 py-3">{row.label}</td>
                  {row.values.map((val, j) => (
                    <td key={j} className="text-center px-4 py-3">
                      {val === "\u2713" ? (
                        <svg
                          className="w-5 h-5 text-green-400 mx-auto"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      ) : val === "\u2014" ? (
                        <span className="text-dark-700">{"\u2014"}</span>
                      ) : (
                        <span className="text-white font-medium">{val}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* FAQ */}
      <div className="mt-12 sm:mt-16 max-w-2xl mx-auto">
        <h2 className="text-xl font-bold text-white mb-6 text-center">Sık Sorulan Sorular</h2>
        <div className="space-y-3">
          {[
            {
              q: "Planımı istediğim zaman değiştirebilir miyim?",
              a: "Evet, planınızı istediğiniz zaman yükseltebilir veya düşürebilirsiniz. Yükseltmede fark anında tahsil edilir.",
            },
            {
              q: "Ücretsiz plan ne kadar sürer?",
              a: "Ücretsiz plan süresizdir. 5 ürüne kadar sınırsız süre takip edebilirsiniz.",
            },
            {
              q: "Ödeme yöntemi nedir?",
              a: "Kredi kartı ve banka kartı ile ödeme yapabilirsiniz. Tüm ödemeler Whop üzerinden güvenli şekilde işlenir.",
            },
            {
              q: "İptal edersem ne olur?",
              a: "İptal ettiğinizde dönem sonuna kadar mevcut planınızı kullanmaya devam edebilirsiniz. Sonra otomatik olarak Ücretsiz plana geçersiniz.",
            },
          ].map((faq, i) => (
            <details key={i} className="bg-dark-900 border border-dark-800 rounded-xl group">
              <summary className="px-5 py-4 text-sm font-medium text-white cursor-pointer list-none flex items-center justify-between">
                {faq.q}
                <svg
                  className="w-4 h-4 text-dark-500 group-open:rotate-180 transition-transform"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </summary>
              <div className="px-5 pb-4 text-sm text-dark-400">{faq.a}</div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
