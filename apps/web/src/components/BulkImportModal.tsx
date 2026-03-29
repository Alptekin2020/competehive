"use client";

import { useState } from "react";
import { getMarketplaceInfo } from "@competehive/shared";

interface BulkResult {
  url: string;
  status: "success" | "error" | "duplicate" | "skipped";
  message: string;
}

interface BulkSummary {
  total: number;
  added: number;
  errors: number;
  duplicates: number;
  skipped: number;
}

interface BulkImportModalProps {
  onClose: () => void;
  onComplete: () => void;
}

const DOMAIN_TO_MARKETPLACE: Record<string, string> = {
  "trendyol.com": "TRENDYOL",
  "hepsiburada.com": "HEPSIBURADA",
  "amazon.com.tr": "AMAZON_TR",
  "n11.com": "N11",
  "teknosa.com": "TEKNOSA",
  "vatanbilgisayar.com": "VATAN",
  "decathlon.com": "DECATHLON",
  "mediamarkt.com": "MEDIAMARKT",
  "ciceksepeti.com": "CICEKSEPETI",
  "pttavm.com": "PTTAVM",
  "boyner.com": "BOYNER",
  "gratis.com": "GRATIS",
  "kitapyurdu.com": "KITAPYURDU",
  "sephora.com": "SEPHORA",
  "koctas.com": "KOCTAS",
  "itopya.com": "ITOPYA",
};

function detectMpPreview(url: string): { name: string; color: string } | null {
  const lower = url.toLowerCase();
  for (const [domain, key] of Object.entries(DOMAIN_TO_MARKETPLACE)) {
    if (lower.includes(domain)) {
      return getMarketplaceInfo(key);
    }
  }
  return null;
}

function parseUrls(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.startsWith("http"));
}

export default function BulkImportModal({ onClose, onComplete }: BulkImportModalProps) {
  const [urlText, setUrlText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<BulkResult[] | null>(null);
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [error, setError] = useState("");

  const urlCount = parseUrls(urlText).length;

  const handleSubmit = async () => {
    const urls = parseUrls(urlText);
    if (urls.length === 0) {
      setError("En az 1 geçerli URL girin");
      return;
    }
    if (urls.length > 20) {
      setError("Tek seferde en fazla 20 URL ekleyebilirsiniz");
      return;
    }

    setError("");
    setSubmitting(true);

    try {
      const res = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Toplu ekleme başarısız");
        setSubmitting(false);
        return;
      }

      setResults(data.results);
      setSummary(data.summary);

      if (data.summary.added > 0) {
        onComplete();
      }
    } catch {
      setError("Bağlantı hatası");
    } finally {
      setSubmitting(false);
    }
  };

  const statusIcon: Record<string, string> = {
    success: "✅",
    error: "❌",
    duplicate: "⚠️",
    skipped: "⏭️",
  };

  const statusColor: Record<string, string> = {
    success: "text-green-400",
    error: "text-red-400",
    duplicate: "text-amber-400",
    skipped: "text-gray-500",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-[#111113] border border-[#1F1F23] rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-2xl relative z-10 max-h-[85vh] overflow-y-auto safe-bottom">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-white">Toplu Ürün Ekle</h2>
            <p className="text-gray-500 text-sm mt-0.5">
              Birden fazla ürün URL&apos;sini tek seferde ekleyin
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition p-2 -m-1">
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

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {/* Results View */}
        {results && summary ? (
          <div>
            {/* Summary */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <div className="bg-[#0A0A0B] rounded-xl p-3 text-center">
                <p className="text-green-400 font-bold text-xl">{summary.added}</p>
                <p className="text-gray-600 text-xs">Eklendi</p>
              </div>
              <div className="bg-[#0A0A0B] rounded-xl p-3 text-center">
                <p className="text-red-400 font-bold text-xl">{summary.errors}</p>
                <p className="text-gray-600 text-xs">Hata</p>
              </div>
              <div className="bg-[#0A0A0B] rounded-xl p-3 text-center">
                <p className="text-amber-400 font-bold text-xl">{summary.duplicates}</p>
                <p className="text-gray-600 text-xs">Tekrar</p>
              </div>
              <div className="bg-[#0A0A0B] rounded-xl p-3 text-center">
                <p className="text-gray-500 font-bold text-xl">{summary.skipped}</p>
                <p className="text-gray-600 text-xs">Atlandı</p>
              </div>
            </div>

            {/* Per-URL Results */}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {results.map((result, i) => {
                const mp = detectMpPreview(result.url);
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[#0A0A0B] border border-[#1F1F23]"
                  >
                    <span className="text-sm">{statusIcon[result.status]}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-400 text-xs truncate">{result.url}</p>
                      <p className={`text-xs ${statusColor[result.status]}`}>{result.message}</p>
                    </div>
                    {mp && (
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
                        style={{ backgroundColor: `${mp.color}20`, color: mp.color }}
                      >
                        {mp.name}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Done Button */}
            <div className="mt-6">
              <button
                onClick={onClose}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black py-2.5 rounded-xl text-sm font-semibold transition"
              >
                Tamam
              </button>
            </div>
          </div>
        ) : (
          /* Input View */
          <div>
            {/* URL Textarea */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Ürün URL&apos;leri
                {urlCount > 0 && <span className="text-amber-500 ml-2">({urlCount} URL)</span>}
              </label>
              <textarea
                value={urlText}
                onChange={(e) => setUrlText(e.target.value)}
                rows={8}
                className="w-full bg-[#0A0A0B] border border-[#1F1F23] rounded-xl px-4 py-3 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-amber-500/50 transition font-mono resize-none"
                placeholder={`Her satıra bir URL yapıştırın:\n\nhttps://www.trendyol.com/urun-1\nhttps://www.hepsiburada.com/urun-2\nhttps://www.amazon.com.tr/urun-3`}
              />
              <p className="text-gray-600 text-xs mt-1.5">
                Her satıra bir URL. En fazla 20 URL. Desteklenen: Trendyol, Hepsiburada, Amazon TR,
                N11, Teknosa, Vatan, Decathlon, MediaMarkt.
              </p>
            </div>

            {/* URL Preview */}
            {urlCount > 0 && (
              <div className="mb-6">
                <p className="text-sm text-gray-400 mb-2">Önizleme:</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {parseUrls(urlText).map((url, i) => {
                    const mp = detectMpPreview(url);
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-600 font-mono w-4">{i + 1}</span>
                        {mp ? (
                          <span
                            className="font-medium px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: `${mp.color}20`, color: mp.color }}
                          >
                            {mp.name}
                          </span>
                        ) : (
                          <span className="text-red-400 px-1.5 py-0.5 rounded bg-red-500/10">
                            Desteklenmiyor
                          </span>
                        )}
                        <span className="text-gray-500 truncate">{url}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 border border-[#1F1F23] text-white py-2.5 rounded-xl text-sm font-medium hover:bg-[#1F1F23] transition"
              >
                İptal
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || urlCount === 0}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black py-2.5 rounded-xl text-sm font-semibold transition"
              >
                {submitting ? (
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
                    Ekleniyor...
                  </span>
                ) : (
                  `${urlCount} Ürünü Ekle`
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
