"use client";

interface PriceTrendProps {
  priceChange: number | null;
  priceChangePct: number | null;
  size?: "sm" | "md" | "lg";
  showAmount?: boolean;
}

export default function PriceTrend({
  priceChange,
  priceChangePct,
  size = "sm",
  showAmount = false,
}: PriceTrendProps) {
  if (priceChange === null || priceChange === undefined || priceChange === 0) {
    return (
      <span className={`inline-flex items-center gap-0.5 text-gray-500 ${sizeClasses(size)}`}>
        <svg
          className={iconSize(size)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <span>Sabit</span>
      </span>
    );
  }

  const isDown = priceChange < 0;
  const colorClass = isDown ? "text-green-400" : "text-red-400";
  const bgClass = isDown ? "bg-green-500/10" : "bg-red-500/10";
  const absChange = Math.abs(priceChange);
  const absPct = Math.abs(priceChangePct || 0);

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md ${bgClass} ${colorClass} ${sizeClasses(size)}`}
    >
      {isDown ? (
        <svg
          className={iconSize(size)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
          <polyline points="17 18 23 18 23 12" />
        </svg>
      ) : (
        <svg
          className={iconSize(size)}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      )}

      <span className="font-semibold">%{absPct.toFixed(1)}</span>

      {showAmount && (
        <span className="opacity-70">
          ({isDown ? "-" : "+"}₺{absChange.toFixed(2)})
        </span>
      )}
    </span>
  );
}

function sizeClasses(size: "sm" | "md" | "lg"): string {
  switch (size) {
    case "sm":
      return "text-xs";
    case "md":
      return "text-sm";
    case "lg":
      return "text-base";
  }
}

function iconSize(size: "sm" | "md" | "lg"): string {
  switch (size) {
    case "sm":
      return "w-3 h-3";
    case "md":
      return "w-4 h-4";
    case "lg":
      return "w-5 h-5";
  }
}
