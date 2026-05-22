"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const CONSENT_KEY = "ch_cookie_consent";

export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch {
      // localStorage erişilemiyorsa banner gösterilmez
    }
  }, []);

  if (!visible) return null;

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      // yoksay
    }
    setVisible(false);
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] p-4">
      <div className="max-w-3xl mx-auto bg-[#111113] border border-[#1F1F23] rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 shadow-lg">
        <p className="text-xs text-dark-300 leading-relaxed flex-1">
          Deneyiminizi iyileştirmek için işlevsel ve analitik çerezler kullanıyoruz. Ayrıntılar için{" "}
          <Link href="/cerez" className="text-hive-500 hover:underline">
            Çerez Aydınlatma Metni
          </Link>
          .
        </p>
        <button
          onClick={accept}
          className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-4 py-2 rounded-lg text-xs font-semibold transition whitespace-nowrap"
        >
          Tamam
        </button>
      </div>
    </div>
  );
}
