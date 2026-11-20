"use client";

import { getMarketplaceInfo } from "@competehive/shared";
import { Store, X } from "lucide-react";
import { useEffect, useState } from "react";

import { OWN_STORE_MARKETPLACES } from "@/lib/own-stores";

interface StoreNamesResponse {
  stores: Record<string, string>;
  storeNames: string[];
  error?: string;
}

export default function StoreNamesCard() {
  const [stores, setStores] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [legacyNames, setLegacyNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply(data: StoreNamesResponse) {
    setStores({ ...data.stores });
    setSaved({ ...data.stores });
    setLegacyNames(data.storeNames);
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/account/store-names");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as StoreNamesResponse;
        if (active) apply(data);
      } catch {
        if (active) setError("Mağaza adları yüklenemedi.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save(body: { stores?: Record<string, string>; storeNames?: string[] }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/account/store-names", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<StoreNamesResponse>;
      if (!res.ok || !data.stores || !data.storeNames) {
        throw new Error(data.error ?? "Kaydedilemedi.");
      }
      apply(data as StoreNamesResponse);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kaydedilemedi, tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    stores !== null &&
    OWN_STORE_MARKETPLACES.some((m) => (stores[m] ?? "").trim() !== (saved[m] ?? ""));

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Store className="w-5 h-5 text-hive-400" aria-hidden="true" />
        <h3 className="text-base sm:text-lg font-semibold text-white">Mağaza adım</h3>
      </div>
      <p className="mt-1 text-sm text-dark-400">
        Her pazaryerinde satıcı olarak göründüğünüz mağaza adını yazın. Aynı ilanı başka satıcılar
        da satıyorsa fiyatınız kendi satırınızdan okunur ve mağazanız rakip sayılmaz. Satış
        yapmadığınız pazaryerlerini boş bırakın.
      </p>

      {stores === null ? (
        !error && <div className="mt-4 h-40 w-full bg-dark-800 rounded-lg animate-pulse" />
      ) : (
        <form
          className="mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save({ stores });
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {OWN_STORE_MARKETPLACES.map((marketplace) => {
              const info = getMarketplaceInfo(marketplace);
              const id = `own-store-${marketplace.toLowerCase()}`;
              return (
                <div key={marketplace}>
                  <label
                    htmlFor={id}
                    className="flex items-center gap-1.5 text-xs font-medium text-dark-300"
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: info.color }}
                      aria-hidden="true"
                    />
                    {info.name}
                  </label>
                  <input
                    id={id}
                    type="text"
                    value={stores[marketplace] ?? ""}
                    maxLength={80}
                    onChange={(e) => setStores({ ...stores, [marketplace]: e.target.value })}
                    placeholder="Mağaza adınız"
                    className="mt-1 w-full min-w-0 bg-dark-950 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-dark-600 focus:outline-none focus:border-hive-500"
                  />
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving || !dirty}
              className="px-4 py-2 rounded-lg bg-hive-500 text-dark-950 text-sm font-semibold hover:bg-hive-400 disabled:opacity-50"
            >
              {saving ? "Kaydediliyor…" : "Kaydet"}
            </button>
            <p className="text-xs text-dark-500">
              Adı pazaryerinde göründüğü gibi yazın (büyük/küçük harf fark etmez). Değişiklik bir
              sonraki taramada uygulanır.
            </p>
          </div>
        </form>
      )}

      {legacyNames.length > 0 && (
        <div className="mt-5 border-t border-dark-800 pt-4">
          <p className="text-sm font-medium text-white">Tüm pazaryerleri için</p>
          <p className="text-xs text-dark-500">
            Daha önce girdiğiniz adlar. Yukarıda adı boş bırakılan pazaryerlerinde kullanılır.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {legacyNames.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-1.5 rounded-full bg-dark-800 border border-dark-700 pl-3 pr-1.5 py-1 text-sm text-white"
              >
                {name}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save({ storeNames: legacyNames.filter((n) => n !== name) })}
                  className="rounded-full p-0.5 text-dark-400 hover:text-white hover:bg-dark-700 disabled:opacity-50"
                  aria-label={`${name} adını kaldır`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {!error && savedAt && !dirty && <p className="mt-3 text-xs text-green-400">Kaydedildi.</p>}
    </div>
  );
}
