"use client";

import { useEffect, useState } from "react";

interface AlertPrefs {
  emailAlertsEnabled: boolean;
  alertThresholdPct: number;
}

export default function AlertPrefsCard() {
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/account/alert-prefs");
        if (!res.ok) throw new Error("load");
        const data = (await res.json()) as AlertPrefs;
        if (active) setPrefs(data);
      } catch {
        if (active) setError("Tercihler yüklenemedi.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function save(next: Partial<AlertPrefs>) {
    if (!prefs) return;
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/account/alert-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("save");
      const data = (await res.json()) as AlertPrefs;
      setPrefs(data);
      setSavedAt(Date.now());
    } catch {
      setError("Kaydedilemedi, tekrar deneyin.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6">
        <div className="h-5 w-40 bg-dark-800 rounded animate-pulse" />
      </div>
    );
  }

  if (!prefs) {
    return (
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6 text-sm text-red-400">
        {error ?? "Tercihler yüklenemedi."}
      </div>
    );
  }

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6">
      <h3 className="text-base sm:text-lg font-semibold text-white">E-posta Uyarıları</h3>
      <p className="mt-1 text-sm text-dark-400">
        Rakip fiyatları belirlediğiniz eşikten fazla değiştiğinde e-posta ile haber verelim.
      </p>

      <div className="mt-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-white">E-posta uyarılarını aç</p>
          <p className="text-xs text-dark-500">Önemli fiyat değişimleri için bildirim.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={prefs.emailAlertsEnabled}
          disabled={saving}
          onClick={() => save({ emailAlertsEnabled: !prefs.emailAlertsEnabled })}
          className={
            "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition " +
            (prefs.emailAlertsEnabled ? "bg-hive-500" : "bg-dark-700")
          }
        >
          <span
            className={
              "inline-block h-5 w-5 transform rounded-full bg-white transition " +
              (prefs.emailAlertsEnabled ? "translate-x-5" : "translate-x-0.5")
            }
          />
        </button>
      </div>

      <div className="mt-5">
        <label htmlFor="alert-threshold" className="text-sm font-medium text-white">
          Uyarı eşiği (%)
        </label>
        <p className="text-xs text-dark-500">
          Bu yüzdeden küçük fiyat değişimleri için e-posta gönderilmez.
        </p>
        <input
          id="alert-threshold"
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={prefs.alertThresholdPct}
          disabled={saving || !prefs.emailAlertsEnabled}
          onChange={(e) => setPrefs({ ...prefs, alertThresholdPct: Number(e.target.value) })}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v >= 0 && v <= 100) {
              save({ alertThresholdPct: v });
            }
          }}
          className="mt-2 w-32 rounded-lg bg-dark-950 border border-dark-700 px-3 py-2 text-sm text-white outline-none focus:border-hive-500 disabled:opacity-50"
        />
      </div>

      <div className="mt-4 h-4 text-xs">
        {error ? (
          <span className="text-red-400">{error}</span>
        ) : saving ? (
          <span className="text-dark-500">Kaydediliyor…</span>
        ) : savedAt ? (
          <span className="text-emerald-400">Kaydedildi.</span>
        ) : null}
      </div>
    </div>
  );
}
