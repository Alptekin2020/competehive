"use client";

import { useState } from "react";
import Link from "next/link";

type SupportLevel = "full" | "partial" | "unsupported";

interface CheckResult {
  checkId: string | null;
  kind: "marketplace" | "own-store" | "unsupported-marketplace";
  domain: string;
  storeName: string;
  support: SupportLevel;
  issues: string[];
  product: {
    name: string;
    price: number | null;
    currency: string;
    image: string | null;
    inStock: boolean;
  } | null;
}

const SUPPORT_UI: Record<SupportLevel, { title: string; className: string }> = {
  full: {
    title: "✅ Siteniz uyumlu",
    className: "border-emerald-500/30 bg-emerald-500/5",
  },
  partial: {
    title: "⚠️ Kısmen uyumlu",
    className: "border-amber-500/30 bg-amber-500/5",
  },
  unsupported: {
    title: "❌ Şu an desteklenmiyor",
    className: "border-red-500/30 bg-red-500/5",
  },
};

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(price);
  } catch {
    return `${price.toLocaleString("tr-TR")} ${currency}`;
  }
}

export default function StoreCompatibilityChecker({ signedIn }: { signedIn: boolean }) {
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [email, setEmail] = useState("");
  const [notifyState, setNotifyState] = useState<"idle" | "sending" | "done">("idle");
  const [notifyError, setNotifyError] = useState("");

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setResult(null);
    setNotifyState("idle");
    setNotifyError("");
    if (!url.trim()) {
      setError("Lütfen bir ürün linki yapıştırın.");
      return;
    }
    setChecking(true);
    try {
      const res = await fetch("/api/public/store-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Çok fazla kontrol yaptınız. Lütfen biraz sonra tekrar deneyin."
            : data.error || "Link kontrol edilemedi.",
        );
        return;
      }
      setResult(data as CheckResult);
    } catch (err) {
      console.error("Store check failed", err);
      setError("Link kontrol edilemedi. Lütfen tekrar deneyin.");
    } finally {
      setChecking(false);
    }
  };

  const requestNotify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!result?.checkId) return;
    setNotifyError("");
    setNotifyState("sending");
    try {
      const res = await fetch("/api/public/store-check/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkId: result.checkId, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotifyError(data.error || "Kaydedilemedi.");
        setNotifyState("idle");
        return;
      }
      setNotifyState("done");
    } catch (err) {
      console.error("Store check notify failed", err);
      setNotifyError("Kaydedilemedi. Lütfen tekrar deneyin.");
      setNotifyState("idle");
    }
  };

  const ui = result ? SUPPORT_UI[result.support] : null;

  return (
    <div className="bg-dark-900/80 border border-dark-700/80 rounded-2xl p-4 sm:p-6">
      <form onSubmit={check} className="flex flex-col sm:flex-row gap-3">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://siteniz.com/urun/..."
          className="flex-1 min-w-0 bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
          disabled={checking}
          aria-label="Ürün linki"
        />
        <button
          type="submit"
          disabled={checking}
          className="bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 px-6 py-3 rounded-xl text-sm font-semibold transition whitespace-nowrap"
        >
          {checking ? "Kontrol ediliyor..." : "Uyumluluğu Kontrol Et"}
        </button>
      </form>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      {result && ui && (
        <div className={`mt-4 border rounded-xl p-4 ${ui.className}`}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-white font-semibold">{ui.title}</p>
            <span className="text-xs text-dark-400 truncate">{result.storeName}</span>
          </div>

          {result.kind === "marketplace" && (
            <p className="text-sm text-dark-300">
              {result.storeName} doğrudan desteklediğimiz pazaryerlerinden biri. Ürünlerinizi hemen
              takibe alabilirsiniz.
            </p>
          )}

          {result.product && (
            <div className="flex gap-3 mt-2">
              {result.product.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.product.image}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover bg-dark-950 flex-shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm text-white font-medium line-clamp-2">
                  {result.product.name || "Ürün adı okunamadı"}
                </p>
                {result.product.price !== null && (
                  <p className="text-base font-bold text-hive-400 mt-1">
                    {formatPrice(result.product.price, result.product.currency)}
                  </p>
                )}
                <p className="text-xs text-dark-400 mt-0.5">
                  Okuduğumuz bilgiler bunlar. Fiyatınız ve stok durumunuz otomatik takip edilir.
                </p>
              </div>
            </div>
          )}

          {result.issues.length > 0 && (
            <ul className="mt-3 space-y-1">
              {result.issues.map((issue) => (
                <li key={issue} className="text-xs text-dark-300 leading-relaxed">
                  • {issue}
                </li>
              ))}
            </ul>
          )}

          {result.support !== "unsupported" && (
            <Link
              href={signedIn ? "/dashboard/products" : "/register"}
              className="inline-flex items-center gap-1 mt-4 text-sm font-semibold text-hive-400 hover:text-hive-300 transition"
            >
              {signedIn ? "Ürünü takibe al →" : "Ücretsiz başlayın ve takibe alın →"}
            </Link>
          )}

          {result.support === "unsupported" &&
            result.checkId &&
            (notifyState === "done" ? (
              <p className="text-sm text-emerald-400 mt-4">
                Teşekkürler! {result.domain} desteklendiğinde size haber vereceğiz.
              </p>
            ) : (
              <form onSubmit={requestNotify} className="mt-4">
                <p className="text-sm text-dark-300 mb-2">
                  Bu siteye destek eklendiğinde haber verelim mi?
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="eposta@adresiniz.com"
                    className="flex-1 min-w-0 bg-dark-950 border border-dark-800 rounded-xl px-3 py-2 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
                    disabled={notifyState === "sending"}
                    aria-label="E-posta adresi"
                  />
                  <button
                    type="submit"
                    disabled={notifyState === "sending"}
                    className="border border-dark-700 hover:border-hive-500/50 text-white px-4 py-2 rounded-xl text-sm font-medium transition disabled:opacity-50"
                  >
                    Haber Ver
                  </button>
                </div>
                {notifyError && <p className="text-red-400 text-xs mt-2">{notifyError}</p>}
                <p className="text-[11px] text-dark-500 mt-2">
                  E-postanızı yalnızca bu bildirim için kullanırız. Ayrıntılar:{" "}
                  <Link href="/kvkk" className="underline hover:text-dark-300">
                    KVKK Aydınlatma Metni
                  </Link>
                  .
                </p>
              </form>
            ))}
        </div>
      )}
    </div>
  );
}
