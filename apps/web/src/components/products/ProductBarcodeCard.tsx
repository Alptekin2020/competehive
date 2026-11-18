"use client";

import { useEffect, useState } from "react";
import { ScanBarcode } from "lucide-react";
import { checkGtinInput } from "@competehive/shared";
import InfoTip from "@/components/ui/InfoTip";
import { BarcodeScanner } from "./BarcodeScanner";

interface ProductBarcodeCardProps {
  productId: string;
  gtin: string | null;
  /** Kayıttan sonra sayfadaki ürünün barkodunu günceller. */
  onSaved: (gtin: string | null) => void;
}

// Takipteki ürünün barkodu: elle yazılır ya da kamerayla okutulur. Kaydedilince
// rakipler barkodla yeniden aranır (bkz. PUT /api/products/[id]/barcode).
export function ProductBarcodeCard({ productId, gtin, onSaved }: ProductBarcodeCardProps) {
  const [input, setInput] = useState(gtin ?? "");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Sunucudaki değer değişirse (ürün yeniden yüklendi) alanı eşitle.
  useEffect(() => {
    setInput(gtin ?? "");
  }, [gtin]);

  const check = checkGtinInput(input);
  const inputError = check && !check.ok ? check.error : "";
  const normalized = check?.ok ? check.gtin : null;
  const unchanged = normalized === (gtin ?? null);

  const save = async (value: string | null) => {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${productId}/barcode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gtin: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Çok sık barkod kaydettiniz. Biraz sonra tekrar deneyin."
            : data?.error || "Barkod kaydedilemedi.",
        );
        return;
      }
      const saved: string | null = data?.gtin ?? null;
      onSaved(saved);
      setInput(saved ?? "");
      if (data?.searchStarted) {
        setNotice(
          "Barkod kaydedildi. Rakipler barkodla yeniden aranıyor, sonuçlar birkaç dakika içinde listeye düşer.",
        );
      } else if (saved) {
        setNotice("Barkod kaydedildi. Sonraki rakip taramasında kullanılacak.");
      } else {
        setNotice("Barkod kaldırıldı.");
      }
    } catch (err) {
      console.error("Barcode save failed", err);
      setError("Barkod kaydedilemedi. Lütfen tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (inputError) {
      setError(inputError);
      return;
    }
    void save(normalized);
  };

  return (
    <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6">
      <h3 className="text-white font-semibold mb-1 inline-flex items-center gap-2">
        Barkod
        <InfoTip
          align="left"
          text="Ürünün barkodunu (EAN/GTIN) girerseniz rakipleri barkodla da ararız ve aynı barkodu taşıyan ilanları doğrudan aynı ürün sayarız. Bu, özellikle başlığı farklı yazılmış ilanlarda eşleşmeyi daha doğru yapar."
        />
      </h3>
      <p className="text-xs text-gray-500 mb-3">
        {gtin
          ? "Rakipler bu barkodla da aranıyor."
          : "Daha doğru rakip eşleşmesi için ürünün barkodunu okutun ya da yazın."}
      </p>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="product-gtin"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError("");
            setNotice("");
          }}
          placeholder="Örn. 8690000000000"
          aria-label="Barkod"
          aria-invalid={inputError ? true : undefined}
          disabled={saving}
          className={`flex-1 min-w-0 bg-dark-900 border rounded-xl px-4 py-2.5 text-white text-sm placeholder-dark-600 focus:outline-none transition ${
            inputError
              ? "border-red-500/40 focus:border-red-500/60"
              : "border-dark-800 focus:border-hive-500/50"
          }`}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScanning(true)}
            disabled={saving}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 border border-dark-700 hover:bg-dark-800 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 text-sm font-medium transition"
          >
            <ScanBarcode className="w-4 h-4" />
            Barkod tarat
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || unchanged || Boolean(inputError)}
            className="flex-1 sm:flex-none bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 px-5 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            {saving ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
      </div>

      {(inputError || error) && <p className="mt-2 text-xs text-rose-400">{inputError || error}</p>}
      {notice && !error && !inputError && <p className="mt-2 text-xs text-emerald-400">{notice}</p>}
      {gtin && !saving && (
        <button
          type="button"
          onClick={() => void save(null)}
          className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2"
        >
          Barkodu kaldır
        </button>
      )}

      {scanning && (
        <BarcodeScanner
          onDetected={(code) => {
            setScanning(false);
            setInput(code);
            // Okunan barkod geçerli (kontrol hanesi tuttu): ayrıca "Kaydet"e
            // basmak gerekmesin, hemen kaydedilip arama başlatılır.
            if (code !== gtin) void save(code);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
