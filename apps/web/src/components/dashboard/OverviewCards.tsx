import Link from "next/link";
import type { MarketPosition, Opportunity, OpportunityKind } from "@/lib/product-insights";
import { formatTryShort } from "@/lib/product-insights";

// ============================================
// Yeni kullanıcı rehberi
// ============================================

export interface GuideStep {
  key: string;
  title: string;
  description: string;
  done: boolean;
  href: string;
  cta: string;
}

/**
 * İlk girişte "Ürün ekle → Rakipleri gör → Uyarı kur" adımları; tamamlandıkça
 * dolan bir ilerleme çubuğu. Tüm adımlar bitince gösterilmez.
 */
export function OnboardingGuide({ steps }: { steps: GuideStep[] }) {
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const pct = Math.round((done / steps.length) * 100);
  const nextKey = steps.find((s) => !s.done)?.key;

  return (
    <section
      aria-labelledby="guide-h"
      className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 id="guide-h" className="text-white font-semibold">
            Kuruluma {steps.length - done} adım kaldı
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Adımları tamamladığınızda rakiplerinizin her hamlesini görürsünüz.
          </p>
        </div>
        <span className="text-sm font-semibold text-amber-300">%{pct}</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Kurulum ilerlemesi"
        className="h-2 rounded-full bg-[#26262B] overflow-hidden mb-4"
      >
        <div
          className="h-full rounded-full bg-amber-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {steps.map((step, i) => {
          const isNext = step.key === nextKey;
          return (
            <li
              key={step.key}
              className={`rounded-xl border p-3.5 flex gap-3 ${
                step.done
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : isNext
                    ? "border-amber-500/40 bg-[#151519]"
                    : "border-[#26262B] bg-[#151519]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                  step.done
                    ? "bg-emerald-500/20 text-emerald-300"
                    : isNext
                      ? "bg-amber-500 text-black"
                      : "bg-[#26262B] text-gray-400"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <p
                  className={`text-sm font-semibold ${step.done ? "text-emerald-200" : "text-white"}`}
                >
                  {step.title}
                  {step.done && <span className="sr-only"> (tamamlandı)</span>}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{step.description}</p>
                {!step.done && (
                  <Link
                    href={step.href}
                    className="inline-block mt-2 text-xs font-semibold text-amber-400 hover:text-amber-300"
                  >
                    {step.cta} →
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ============================================
// Bugün yapmanız gerekenler
// ============================================

export interface TodoItem {
  key: string;
  count: number;
  title: string;
  description: string;
  cta: string;
  href: string;
  tone: "orange" | "amber" | "blue" | "rose";
}

const TODO_TONES: Record<TodoItem["tone"], { badge: string; cta: string }> = {
  orange: { badge: "bg-orange-500/15 text-orange-300", cta: "text-orange-300" },
  amber: { badge: "bg-amber-500/15 text-amber-300", cta: "text-amber-300" },
  blue: { badge: "bg-blue-500/15 text-blue-300", cta: "text-blue-300" },
  rose: { badge: "bg-rose-500/15 text-rose-300", cta: "text-rose-300" },
};

export function TodoCards({ items }: { items: TodoItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 flex items-center gap-4">
        <span
          aria-hidden="true"
          className="h-11 w-11 shrink-0 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center text-lg font-bold"
        >
          ✓
        </span>
        <div>
          <p className="text-white font-semibold">Her şey yolunda</p>
          <p className="text-sm text-gray-400 mt-0.5">
            Şu an ilginizi bekleyen bir konu yok. Yeni bir hareket olursa burada görünür.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="group rounded-2xl border border-[#1F1F23] bg-[#111113] p-4 sm:p-5 flex gap-4 hover:border-amber-500/40 transition"
        >
          <span
            className={`h-11 w-11 shrink-0 rounded-xl flex items-center justify-center text-lg font-bold ${TODO_TONES[item.tone].badge}`}
          >
            {item.count}
          </span>
          <div className="min-w-0">
            <p className="text-white font-semibold">{item.title}</p>
            <p className="text-sm text-gray-400 mt-0.5 leading-snug">{item.description}</p>
            <p className={`text-sm font-semibold mt-2 ${TODO_TONES[item.tone].cta}`}>
              {item.cta} <span aria-hidden="true">→</span>
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ============================================
// Pazardaki konumunuz
// ============================================

export function MarketPositionCard({ counts }: { counts: Record<MarketPosition, number> }) {
  const compared = counts.cheapest + counts.middle + counts["most-expensive"];
  const rows = [
    {
      key: "cheapest",
      label: "En ucuz sizsiniz",
      count: counts.cheapest,
      color: "bg-emerald-500",
      href: "/dashboard/products?filter=CHEAPEST",
    },
    {
      key: "middle",
      label: "Rakiplerle aynı aralıkta",
      count: counts.middle,
      color: "bg-gray-500",
      href: "/dashboard/products?filter=CHEAPER_COMPETITOR",
    },
    {
      key: "most-expensive",
      label: "En pahalı sizsiniz",
      count: counts["most-expensive"],
      color: "bg-orange-500",
      href: "/dashboard/products?filter=CHEAPER_COMPETITOR",
    },
  ];

  return (
    <section
      aria-labelledby="position-h"
      className="rounded-2xl border border-[#1F1F23] bg-[#111113] p-4 sm:p-6 flex flex-col gap-4"
    >
      <div>
        <h2 id="position-h" className="text-white font-semibold text-base sm:text-lg">
          Pazardaki konumunuz
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          {compared > 0
            ? `${compared} ürününüz rakiplerine göre nerede?`
            : "Rakip verisi geldiğinde ürünlerinizin konumu burada görünür."}
        </p>
      </div>
      {compared > 0 && (
        <>
          <div
            role="img"
            aria-label={rows.map((r) => `${r.label}: ${r.count}`).join(", ")}
            className="flex h-4 rounded-full overflow-hidden gap-1"
          >
            {rows
              .filter((r) => r.count > 0)
              .map((r) => (
                <div key={r.key} className={r.color} style={{ flexGrow: r.count }} />
              ))}
          </div>
          <ul className="space-y-1">
            {rows.map((r) => (
              <li key={r.key}>
                <Link
                  href={r.href}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 -mx-2 hover:bg-[#1A1A1E] transition"
                >
                  <span aria-hidden="true" className={`h-3 w-3 rounded ${r.color}`} />
                  <span className="flex-1 text-sm text-gray-200">{r.label}</span>
                  <span className="text-sm font-semibold text-white">{r.count} ürün</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {counts["no-data"] > 0 && (
        <p className="text-xs text-gray-500">
          {counts["no-data"]} ürün için henüz karşılaştırılabilir rakip fiyatı yok.
        </p>
      )}
    </section>
  );
}

// ============================================
// Fırsatlar
// ============================================

const OPPORTUNITY_STYLE: Record<OpportunityKind, { tag: string; tagClass: string }> = {
  loss: { tag: "Zarar", tagClass: "bg-rose-500/15 text-rose-300" },
  "competitor-out-of-stock": { tag: "Stok fırsatı", tagClass: "bg-blue-500/15 text-blue-300" },
  raise: { tag: "Kârı artır", tagClass: "bg-emerald-500/15 text-emerald-300" },
  undercut: { tag: "En ucuz ol", tagClass: "bg-amber-500/15 text-amber-300" },
};

export function OpportunityList({ items }: { items: Opportunity[] }) {
  return (
    <section
      aria-labelledby="opps-h"
      className="rounded-2xl border border-[#1F1F23] bg-[#111113] p-4 sm:p-6 flex flex-col gap-3"
    >
      <div>
        <h2 id="opps-h" className="text-white font-semibold text-base sm:text-lg">
          Fırsatlar
        </h2>
        <p className="text-sm text-gray-400 mt-1">
          Küçük bir fiyat hamlesiyle kazanabileceğiniz ürünler. Öneriler maliyetinizi girdiyseniz
          kâr marjınızı korur.
        </p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 py-4">
          Şu an öne çıkan bir fırsat yok. Ürün detayından maliyet girerseniz daha isabetli öneriler
          alırsınız.
        </p>
      ) : (
        <ul className="divide-y divide-[#1F1F23]">
          {items.map((op) => (
            <li key={`${op.productId}-${op.kind}`}>
              <Link
                href={`/dashboard/products/${op.productId}`}
                className="flex items-start gap-3 py-3 group"
              >
                <span
                  className={`mt-0.5 shrink-0 text-[11px] font-semibold px-2 py-1 rounded-md ${OPPORTUNITY_STYLE[op.kind].tagClass}`}
                >
                  {OPPORTUNITY_STYLE[op.kind].tag}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white group-hover:text-amber-400 transition">
                    {op.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {op.productName} · {op.detail}
                  </p>
                </div>
                {op.suggestedPrice !== null && (
                  <span className="shrink-0 text-sm font-semibold text-white">
                    {formatTryShort(op.suggestedPrice)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
