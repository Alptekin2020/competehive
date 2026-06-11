"use client";

import { ReactNode } from "react";

// Hafif, bağımlılıksız açıklama balonu. Fare ile üzerine gelince (hover) ve
// klavye/dokunmatik odakta (focus-within) görünür — JS state gerekmez.
// Kavramın geçtiği yerde kısa açıklama vermek için kullanılır; uzun anlatım
// /dashboard/yardim sayfasına bırakılmalıdır.
//
// align: balonun yatay hizası. Ekranın sağ kenarındaki kartlarda "right",
// sol kenardakilerde "left" kullanarak taşmayı önleyin.

export interface InfoTipProps {
  text: ReactNode;
  side?: "top" | "bottom";
  align?: "center" | "left" | "right";
  className?: string;
}

export default function InfoTip({
  text,
  side = "top",
  align = "center",
  className = "",
}: InfoTipProps) {
  const vertical = side === "top" ? "bottom-full mb-2" : "top-full mt-2";
  const horizontal =
    align === "center" ? "left-1/2 -translate-x-1/2" : align === "left" ? "left-0" : "right-0";

  return (
    <span className={`relative inline-flex group align-middle ${className}`}>
      <button
        type="button"
        aria-label="Açıklama"
        className="w-4 h-4 inline-flex items-center justify-center rounded-full border border-dark-600 text-[10px] leading-none text-dark-400 hover:text-white hover:border-dark-400 focus:text-white focus:border-hive-500/60 focus:outline-none transition cursor-help"
      >
        ?
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 w-60 ${vertical} ${horizontal} rounded-lg border border-[#2F2F33] bg-[#1A1A1E] p-2.5 text-left text-xs leading-relaxed text-gray-200 shadow-xl opacity-0 invisible transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100`}
      >
        {text}
      </span>
    </span>
  );
}
