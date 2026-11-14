import type { ProductInsight } from "@/lib/product-insights";
import { formatTRY } from "@/lib/format";

export type PositionTone = "good" | "bad" | "neutral" | "warn" | "info";

export const POSITION_TONE_CLASSES: Record<PositionTone, { chip: string; dot: string }> = {
  good: { chip: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25", dot: "bg-emerald-400" },
  bad: { chip: "bg-orange-500/10 text-orange-300 border-orange-500/30", dot: "bg-orange-400" },
  neutral: { chip: "bg-[#1A1A1E] text-gray-300 border-[#2A2A2F]", dot: "bg-gray-400" },
  warn: { chip: "bg-amber-500/10 text-amber-300 border-amber-500/25", dot: "bg-amber-400" },
  info: { chip: "bg-blue-500/10 text-blue-300 border-blue-500/25", dot: "bg-blue-400" },
};

/** Ürün kartındaki tek bakışta durum etiketi. */
export function positionStatus(insight: ProductInsight): { label: string; tone: PositionTone } {
  if (insight.position === "cheapest") {
    return {
      label: insight.validCompetitorCount > 0 ? "En ucuz sizsiniz" : "Rakip yok",
      tone: "good",
    };
  }
  if (insight.position === "most-expensive") {
    return {
      label:
        insight.cheaperCount === 1 ? "Rakip daha ucuz" : `${insight.cheaperCount} rakip daha ucuz`,
      tone: "bad",
    };
  }
  if (insight.position === "middle") {
    return {
      label:
        insight.cheaperCount === 1
          ? "1 rakip daha ucuz"
          : `${insight.cheaperCount} rakip daha ucuz`,
      tone: "neutral",
    };
  }
  return { label: "Karşılaştırma yok", tone: "neutral" };
}

export function PositionChip({ insight }: { insight: ProductInsight }) {
  const status = positionStatus(insight);
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold whitespace-nowrap ${POSITION_TONE_CLASSES[status.tone].chip}`}
    >
      {status.label}
    </span>
  );
}

/**
 * Fiyatınızın en ucuz ve en pahalı (karara uygun) rakip arasındaki yeri.
 * Sol uç = piyasanın en ucuzu, sağ uç = en pahalısı.
 */
export function PricePositionBar({ insight }: { insight: ProductInsight }) {
  if (insight.positionPct === null || insight.minPrice === null || insight.maxPrice === null) {
    return null;
  }
  const status = positionStatus(insight);
  const left = Math.min(100, Math.max(0, insight.positionPct));
  return (
    <div>
      <div className="flex justify-between text-[11px] text-gray-500 mb-1.5">
        <span>En ucuz {formatTRY(insight.minPrice)}</span>
        <span>En pahalı {formatTRY(insight.maxPrice)}</span>
      </div>
      <div
        role="img"
        aria-label={`Piyasadaki yeriniz: ${status.label}`}
        className="relative h-2 rounded-full bg-gradient-to-r from-emerald-500/30 via-[#2A2A2F] to-orange-500/30"
      >
        <span
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full border-[3px] border-[#111113] ${POSITION_TONE_CLASSES[status.tone].dot}`}
          style={{ left: `${left}%` }}
        />
      </div>
    </div>
  );
}
