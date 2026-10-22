"use client";

import { useState } from "react";
import Link from "next/link";
import { SUPPORTED_MARKETPLACE_LABEL } from "@/lib/marketplaces";

type SupportLevel = "full" | "partial" | "unsupported";

interface ProductPreview {
  marketplace: string;
  storeName: string;
  isOwnStore: boolean;
  support: SupportLevel;
  canAdd: boolean;
  issues: string[];
  product: {
    name: string;
    price: number | null;
    currency: string;
    image: string | null;
    inStock: boolean;
  } | null;
}

const SUPPORT_STYLES: Record<SupportLevel, { label: string; className: string }> = {
  full: {
    label: "✅ Tam destek",
    className: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  },
  partial: {
    label: "⚠️ Kısmi destek",
    className: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  },
  unsupported: {
    label: "❌ Şu an desteklenmiyor",
    className: "bg-red-500/10 border-red-500/20 text-red-400",
  },
};

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(price);
  } catch {
    return `${price.toLocaleString("tr-TR")} ${currency}`;
  }
}

interface AddProductModalProps {
  url: string;
  onUrlChange: (url: string) => void;
  loading: boolean;
  error: string;
  // Plan limiti hatasında modal içinde yükseltme yolu göster — kullanıcı
  // kırmızı metinle baş başa kalmasın.
  showUpgradeCta?: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function AddProductModal({
  url,
  onUrlChange,
  loading,
  error,
  showUpgradeCta = false,
  onSubmit,
  onClose,
}: AddProductModalProps) {
  // Önizleme yalnızca okunduğu URL için geçerli: link değişirse kullanıcı
  // yeniden "Kontrol Et" adımından geçer (önceki sitenin onayı taşınmaz).
  const [previewState, setPreviewState] = useState<{ url: string; data: ProductPreview } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const preview = previewState?.url === url ? previewState.data : null;
  const busy = loading || checking;

  const runPreview = async () => {
    setCheckError("");
    setChecking(true);
    try {
      const res = await fetch("/api/products/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productUrl: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCheckError(data.error || "Link kontrol edilemedi");
        return;
      }
      setPreviewState({ url, data: data as ProductPreview });
    } catch (err) {
      console.error("Product preview failed", err);
      setCheckError("Link kontrol edilemedi. Lütfen tekrar deneyin.");
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    if (preview?.canAdd) {
      onSubmit(e);
      return;
    }
    e.preventDefault();
    if (!url.trim()) {
      setCheckError("Lütfen bir ürün linki yapıştırın.");
      return;
    }
    void runPreview();
  };

  const shownError = error || checkError;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !busy && onClose()}
      />
      <div className="bg-dark-900 border border-dark-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-lg relative z-10 max-h-[85vh] overflow-y-auto safe-bottom">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Ürün Ekle</h2>
          <button
            onClick={() => !busy && onClose()}
            className="text-dark-500 hover:text-white transition p-2 -m-1"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {shownError && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-4">
            <p className="text-red-400 text-sm">{shownError}</p>
            {showUpgradeCta && (
              <Link
                href="/dashboard/pricing"
                className="inline-flex items-center gap-1 mt-2 text-sm font-semibold text-hive-400 hover:text-hive-300 transition"
              >
                Planı Yükselt →
              </Link>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-dark-300 mb-2">Ürün URL&apos;si</label>
          <input
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm mb-2"
            placeholder="Marketplace ürün URL'sini yapıştırın..."
            required
            disabled={busy}
          />
          <p className="text-dark-600 text-xs mb-4">
            {SUPPORTED_MARKETPLACE_LABEL} ya da kendi e-ticaret sitenizdeki ürün linkini yapıştırın.
          </p>

          {preview && (
            <div className="bg-dark-950 border border-dark-800 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-xs text-dark-400 truncate">
                  {preview.isOwnStore ? "🌐 Kendi siteniz: " : ""}
                  <span className="text-dark-200 font-medium">{preview.storeName}</span>
                </span>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border flex-shrink-0 ${SUPPORT_STYLES[preview.support].className}`}
                >
                  {SUPPORT_STYLES[preview.support].label}
                </span>
              </div>

              {preview.product && (
                <div className="flex gap-3">
                  {preview.product.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={preview.product.image}
                      alt=""
                      className="w-16 h-16 rounded-lg object-cover bg-dark-900 flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium line-clamp-2">
                      {preview.product.name || "Ürün adı okunamadı"}
                    </p>
                    <p className="text-base font-bold text-hive-400 mt-1">
                      {preview.product.price !== null
                        ? formatPrice(preview.product.price, preview.product.currency)
                        : "Fiyat okunamadı"}
                    </p>
                    <p
                      className={`text-xs mt-0.5 ${preview.product.inStock ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {preview.product.inStock ? "Stokta" : "Stokta yok"}
                    </p>
                  </div>
                </div>
              )}

              {preview.issues.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {preview.issues.map((issue) => (
                    <li key={issue} className="text-xs text-dark-400 leading-relaxed">
                      • {issue}
                    </li>
                  ))}
                </ul>
              )}

              {preview.canAdd && preview.product?.price != null && (
                <p className="text-xs text-dark-300 mt-3">
                  Bilgiler doğruysa <span className="text-white font-medium">Takibe Al</span> ile
                  devam edin. Fiyat yanlışsa bu ürünü eklemeyin ve bize bildirin.
                </p>
              )}
            </div>
          )}

          <div className="bg-hive-500/5 border border-hive-500/20 rounded-xl px-3.5 py-3 mb-6">
            <div className="flex items-start gap-2.5">
              <span className="text-base leading-none mt-0.5">🔔</span>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm text-hive-300 font-medium">
                  Tüm bildirimler otomatik açılır
                </p>
                <p className="text-[11px] sm:text-xs text-dark-400 mt-1 leading-relaxed">
                  Fiyat düşüşü, fiyat artışı, rakip ucuzladığında, stoğa girince ve yüzde değişim
                  bildirimleri planınıza uygun kanallarla aktif edilir. İstemediklerinizi{" "}
                  <span className="text-dark-200">Uyarılar</span> sayfasından tek tıkla
                  kapatabilirsiniz.
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => !busy && onClose()}
              className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 transition"
              disabled={busy}
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={busy || (preview !== null && !preview.canAdd)}
              className="flex-1 bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeDasharray="30 70"
                    />
                  </svg>
                  {checking ? "Sayfa okunuyor..." : "AI analiz ediyor..."}
                </span>
              ) : preview?.canAdd ? (
                "Takibe Al"
              ) : (
                "Kontrol Et"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
