"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Onay değeri "granted" | "denied". KVKK Kurulu çerez rehberine göre analitik/
// reklam pixel'leri yalnızca açık onaydan SONRA yüklenmelidir; bu banner
// pixel'leri kapılar (AnalyticsScripts consent event'ini dinler).
export const CONSENT_KEY = "ch_cookie_consent";
export const CONSENT_EVENT = "ch-consent-change";

export function readConsent(): "granted" | "denied" | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

function writeConsent(value: "granted" | "denied") {
  try {
    localStorage.setItem(CONSENT_KEY, value);
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
  } catch {
    // localStorage erişilemiyorsa sessizce geç
  }
}

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (readConsent() === null) setVisible(true);
  }, []);

  if (!visible) return null;

  const decide = (value: "granted" | "denied") => {
    writeConsent(value);
    setVisible(false);
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] p-4">
      <div className="max-w-3xl mx-auto bg-[#111113] border border-[#1F1F23] rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 shadow-lg">
        <p className="text-xs text-dark-300 leading-relaxed flex-1">
          Zorunlu çerezler her zaman kullanılır. Deneyimi iyileştirmek ve tanıtım ölçümü için isteğe
          bağlı analitik/reklam çerezlerini yalnızca onayınızla kullanırız. Ayrıntılar için{" "}
          <Link href="/cerez" className="text-hive-500 hover:underline">
            Çerez Aydınlatma Metni
          </Link>
          .
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => decide("denied")}
            className="border border-[#323239] hover:border-[#4A4A52] text-dark-200 px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap"
          >
            Reddet
          </button>
          <button
            onClick={() => decide("granted")}
            className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap"
          >
            Kabul Et
          </button>
        </div>
      </div>
    </div>
  );
}
