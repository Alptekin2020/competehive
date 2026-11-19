"use client";

import { Store, X } from "lucide-react";
import { useEffect, useState } from "react";

const MAX_NAMES = 5;

export default function StoreNamesCard() {
  const [names, setNames] = useState<string[] | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/account/store-names");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as { storeNames: string[] };
        if (active) setNames(data.storeNames);
      } catch {
        if (active) setError("Mağaza adları yüklenemedi.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save(next: string[]) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/account/store-names", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeNames: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        storeNames?: string[];
        error?: string;
      };
      if (!res.ok || !data.storeNames) throw new Error(data.error ?? "Kaydedilemedi.");
      setNames(data.storeNames);
      setSavedAt(Date.now());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kaydedilemedi, tekrar deneyin.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    const name = draft.replace(/\s+/g, " ").trim();
    if (!names || name.length < 2) {
      setError("Mağaza adı en az 2 karakter olmalı.");
      return;
    }
    const key = name.toLocaleLowerCase("tr-TR");
    if (names.some((n) => n.toLocaleLowerCase("tr-TR") === key)) {
      setDraft("");
      return;
    }
    if (await save([...names, name])) setDraft("");
  }

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Store className="w-5 h-5 text-hive-400" aria-hidden="true" />
        <h3 className="text-base sm:text-lg font-semibold text-white">Mağaza adım</h3>
      </div>
      <p className="mt-1 text-sm text-dark-400">
        Trendyol ve Hepsiburada&apos;da satıcı olarak görünen mağaza adınızı yazın. Aynı ilanı başka
        satıcılar da satıyorsa fiyatınız kendi satırınızdan okunur ve mağazanız rakip sayılmaz.
      </p>

      {names === null && !error ? (
        <div className="mt-4 h-9 w-full bg-dark-800 rounded-lg animate-pulse" />
      ) : (
        <>
          {names && names.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {names.map((name) => (
                <li
                  key={name}
                  className="inline-flex items-center gap-1.5 rounded-full bg-dark-800 border border-dark-700 pl-3 pr-1.5 py-1 text-sm text-white"
                >
                  {name}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => save(names.filter((n) => n !== name))}
                    className="rounded-full p-0.5 text-dark-400 hover:text-white hover:bg-dark-700 disabled:opacity-50"
                    aria-label={`${name} mağazasını kaldır`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {names && names.length < MAX_NAMES && (
            <form
              className="mt-4 flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <label htmlFor="own-store-name" className="sr-only">
                Mağaza adı
              </label>
              <input
                id="own-store-name"
                type="text"
                value={draft}
                maxLength={80}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Örn. Kumtel Türkiye"
                className="flex-1 min-w-0 bg-dark-950 border border-dark-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:border-hive-500"
              />
              <button
                type="submit"
                disabled={saving || draft.trim().length < 2}
                className="px-4 py-2 rounded-lg bg-hive-500 text-dark-950 text-sm font-semibold hover:bg-hive-400 disabled:opacity-50"
              >
                {saving ? "Kaydediliyor…" : "Ekle"}
              </button>
            </form>
          )}

          <p className="mt-3 text-xs text-dark-500">
            Adı pazaryerinde göründüğü gibi yazın (büyük/küçük harf fark etmez). En fazla{" "}
            {MAX_NAMES} mağaza. Değişiklik bir sonraki taramada uygulanır.
          </p>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {!error && savedAt && <p className="mt-3 text-xs text-green-400">Kaydedildi.</p>}
    </div>
  );
}
