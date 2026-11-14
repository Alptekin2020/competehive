"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatCardSkeleton } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import PriceTrend from "@/components/PriceTrend";
import { MarketplaceBadge } from "@/components/ui/MarketplaceBadge";
import MaintenanceNotice from "@/components/MaintenanceNotice";
import DetailedReports from "@/components/dashboard/DetailedReports";
import {
  MarketPositionCard,
  OnboardingGuide,
  OpportunityList,
  TodoCards,
  type GuideStep,
  type TodoItem,
} from "@/components/dashboard/OverviewCards";
import {
  computeProductInsight,
  findOpportunity,
  formatTimeAgo,
  toInsightInput,
  type ApiProductLike,
  type MarketPosition,
  type Opportunity,
} from "@/lib/product-insights";

interface Stats {
  trackedProducts: number;
  priceChanges24h: number;
  activeAlerts: number;
  unreadNotifications: number;
}

interface Mover {
  productId: string;
  productName: string;
  marketplace: string;
  productImage: string | null;
  currentPrice: number;
  priceChange: number;
  priceChangePct: number;
  updatedAt: string;
}

interface DashboardProduct extends ApiProductLike {
  marketplace: string;
  competitorCount?: number;
}

const MAX_OPPORTUNITIES = 5;

function StatIcon({ name }: { name: "box" | "pulse" | "trophy" | "inbox" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    box: (
      <>
        <path d="M21 16V8l-9-5-9 5v8l9 5z" />
        <path d="M3.3 7L12 12l8.7-5M12 22V12" />
      </>
    ),
    pulse: <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />,
    trophy: (
      <>
        <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z" />
        <path d="M17 6h3a3 3 0 01-3 4M7 6H4a3 3 0 003 4" />
      </>
    ),
    inbox: (
      <>
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [products, setProducts] = useState<DashboardProduct[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  // Rapor verisi yalnızca bölüm açıldığında çekilir.
  const [reportsOpen, setReportsOpen] = useState(false);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setStats(data);
      })
      .catch((error) => console.error("Dashboard stats fetch failed", error))
      .finally(() => setLoading(false));

    fetch("/api/dashboard/movers")
      .then((res) => res.json())
      .then((data) => {
        if (data.movers) setMovers(data.movers);
      })
      .catch((error) => console.error("Dashboard movers fetch failed", error));

    fetch("/api/products")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.products)) setProducts(data.products);
      })
      .catch((error) => console.error("Dashboard products fetch failed", error))
      .finally(() => setProductsLoaded(true));
  }, []);

  // Her ürün için pazar konumu, tazelik, marj ve fırsat — tek geçişte.
  const analysis = useMemo(() => {
    const now = new Date();
    const counts: Record<MarketPosition, number> = {
      cheapest: 0,
      middle: 0,
      "most-expensive": 0,
      "no-data": 0,
    };
    let cheaperCompetitor = 0;
    let stale = 0;
    let noCompetitor = 0;
    let loss = 0;
    let lastSuccess: Date | null = null;
    const opportunities: Opportunity[] = [];

    for (const product of products) {
      const input = toInsightInput(product);
      const insight = computeProductInsight(input, now);
      counts[insight.position] += 1;
      if (insight.cheaperCount > 0) cheaperCompetitor += 1;
      if (insight.isStale && !insight.neverScraped && product.status !== "PAUSED") stale += 1;
      if ((product.competitorCount ?? product.competitors?.length ?? 0) === 0) noCompetitor += 1;
      if (insight.margin?.band === "loss") loss += 1;
      if (product.last_success_at) {
        const at = new Date(product.last_success_at);
        if (!lastSuccess || at > lastSuccess) lastSuccess = at;
      }
      const op = findOpportunity(input, insight);
      if (op) opportunities.push(op);
    }

    opportunities.sort((a, b) => b.weight - a.weight);
    return {
      counts,
      cheaperCompetitor,
      stale,
      noCompetitor,
      loss,
      lastSuccess,
      opportunities: opportunities.slice(0, MAX_OPPORTUNITIES),
      hasCompetitors: products.some((p) => (p.competitorCount ?? p.competitors?.length ?? 0) > 0),
    };
  }, [products]);

  const todos = useMemo<TodoItem[]>(() => {
    const items: TodoItem[] = [
      {
        key: "loss",
        count: analysis.loss,
        title: "Zararına satılan ürün",
        description: "Satış fiyatı girdiğiniz maliyetin altında kalıyor.",
        cta: "Ürünleri gör",
        href: "/dashboard/products?filter=LOSS",
        tone: "rose",
      },
      {
        key: "cheaper",
        count: analysis.cheaperCompetitor,
        title: "Rakip sizden ucuz",
        description: "En az bir rakip fiyatınızın altında satıyor.",
        cta: "Ürünleri gör",
        href: "/dashboard/products?filter=CHEAPER_COMPETITOR",
        tone: "orange",
      },
      {
        key: "stale",
        count: analysis.stale,
        title: "Verisi eski ürün",
        description: "Son 24 saatte fiyatı güncellenemedi.",
        cta: "Yenile",
        href: "/dashboard/products?filter=STALE",
        tone: "amber",
      },
      {
        key: "no-competitor",
        count: analysis.noCompetitor,
        title: "Rakibi olmayan ürün",
        description: "Rakip eklerseniz fiyat önerisi alırsınız.",
        cta: "Rakip bul",
        href: "/dashboard/products?filter=NO_COMPETITOR",
        tone: "blue",
      },
    ];
    return items.filter((item) => item.count > 0);
  }, [analysis]);

  const guideSteps = useMemo<GuideStep[]>(
    () => [
      {
        key: "add",
        title: "Ürün ekle",
        description: "Pazaryeri veya kendi sitenizdeki ürün linkini yapıştırın.",
        done: (stats?.trackedProducts ?? 0) > 0,
        href: "/dashboard/products?add=1",
        cta: "Ürün ekle",
      },
      {
        key: "competitors",
        title: "Rakipleri gör",
        description: "Rakipler otomatik bulunur; ürün detayından kontrol edin.",
        done: analysis.hasCompetitors,
        href: "/dashboard/products",
        cta: "Ürünlere git",
      },
      {
        key: "alert",
        title: "Uyarı kur",
        description: "Rakip ucuzlayınca e-posta veya Telegram ile haber alın.",
        done: (stats?.activeAlerts ?? 0) > 0,
        href: "/dashboard/alerts",
        cta: "Uyarı kur",
      },
    ],
    [analysis.hasCompetitors, stats?.activeAlerts, stats?.trackedProducts],
  );

  const statCards = [
    {
      label: "Takip edilen ürün",
      value: stats?.trackedProducts ?? 0,
      sub: "Toplam ürününüz",
      href: "/dashboard/products",
      icon: "box" as const,
      iconClass: "bg-amber-500/10 text-amber-400",
    },
    {
      label: "24 saatte değişen",
      value: stats?.priceChanges24h ?? 0,
      sub: "Fiyatı hareket eden ürün",
      href: "/dashboard/products?filter=CHANGED",
      icon: "pulse" as const,
      iconClass: "bg-blue-500/10 text-blue-300",
    },
    {
      label: "En ucuz olduğunuz",
      value: analysis.counts.cheapest,
      sub: "Rakiplerin altında satan ürün",
      href: "/dashboard/products?filter=CHEAPEST",
      icon: "trophy" as const,
      iconClass: "bg-emerald-500/10 text-emerald-300",
    },
    {
      label: "Okunmamış bildirim",
      value: stats?.unreadNotifications ?? 0,
      sub: `${stats?.activeAlerts ?? 0} aktif uyarı kuralı`,
      href: "/dashboard/notifications",
      icon: "inbox" as const,
      iconClass: "bg-rose-500/10 text-rose-300",
    },
  ];

  const hasProducts = (stats?.trackedProducts ?? 0) > 0;
  const subtitle = !productsLoaded
    ? "Ürünleriniz yükleniyor..."
    : todos.length > 0
      ? `Bugün ${todos.length} konu ilginizi bekliyor.`
      : hasProducts
        ? "Bugün ilginizi bekleyen bir konu yok."
        : "Rakiplerinizi takip etmeye ilk ürününüzle başlayın.";

  return (
    <div className="space-y-6 sm:space-y-8">
      <MaintenanceNotice />

      <header className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[240px]">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-1">
            Genel Bakış
          </h1>
          <p className="text-gray-400 text-sm">
            {subtitle}
            {analysis.lastSuccess && (
              <span className="text-gray-500">
                {" "}
                Son fiyat güncellemesi {formatTimeAgo(analysis.lastSuccess)}.
              </span>
            )}
          </p>
        </div>
        <Link
          href="/dashboard/products?add=1"
          className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold transition"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Ürün ekle
        </Link>
      </header>

      {!loading && stats && <OnboardingGuide steps={guideSteps} />}

      {hasProducts && productsLoaded && (
        <section aria-labelledby="todo-h" className="space-y-3">
          <h2 id="todo-h" className="text-white font-semibold text-base sm:text-lg">
            Bugün yapmanız gerekenler
          </h2>
          <TodoCards items={todos} />
        </section>
      )}

      <section aria-label="Özet" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          statCards.map((stat) => (
            <Link
              key={stat.label}
              href={stat.href}
              className="group rounded-2xl border border-[#1F1F23] bg-[#111113] p-4 sm:p-5 transition hover:border-amber-500/40"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-400 text-xs sm:text-sm">{stat.label}</span>
                <span
                  className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${stat.iconClass}`}
                >
                  <StatIcon name={stat.icon} />
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-bold text-white mt-1 leading-none">
                {stat.value}
              </div>
              <div className="text-gray-500 text-xs mt-2">{stat.sub}</div>
            </Link>
          ))
        )}
      </section>

      {!loading && stats && stats.trackedProducts === 0 && (
        <EmptyState
          title="İlk ürününüzü takibe alın"
          description="Trendyol, Hepsiburada veya kendi sitenizdeki ürün linkini yapıştırarak rakip fiyatlarını takip etmeye başlayın."
          actionLabel="Ürün ekle"
          actionHref="/dashboard/products?add=1"
        />
      )}

      {hasProducts && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <MarketPositionCard counts={analysis.counts} />
          <OpportunityList items={analysis.opportunities} />
        </div>
      )}

      {movers.length > 0 && (
        <section
          aria-labelledby="movers-h"
          className="rounded-2xl border border-[#1F1F23] bg-[#111113] p-4 sm:p-6"
        >
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <h2 id="movers-h" className="text-white font-semibold text-base sm:text-lg">
              Son fiyat hareketleri
            </h2>
            <Link
              href="/dashboard/products?filter=CHANGED"
              className="text-sm font-semibold text-amber-400 hover:text-amber-300"
            >
              Tümü
            </Link>
          </div>
          <ul className="divide-y divide-[#1F1F23]">
            {movers.map((mover) => (
              <li key={mover.productId}>
                <Link
                  href={`/dashboard/products/${mover.productId}`}
                  className="flex items-center gap-3 py-3 group"
                >
                  <div className="w-10 h-10 bg-[#1F1F23] rounded-xl flex items-center justify-center overflow-hidden shrink-0">
                    {mover.productImage ? (
                      <img src={mover.productImage} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-semibold text-gray-400">
                        {mover.productName.slice(0, 2).toLocaleUpperCase("tr-TR")}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm truncate group-hover:text-amber-400 transition">
                      {mover.productName}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                      <MarketplaceBadge marketplace={mover.marketplace} />
                      <span>{formatTimeAgo(mover.updatedAt)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-white text-sm font-semibold">
                      ₺{mover.currentPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                    </p>
                    <PriceTrend
                      priceChange={mover.priceChange}
                      priceChangePct={mover.priceChangePct}
                      size="sm"
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasProducts && (
        <details
          className="group rounded-2xl border border-[#1F1F23] bg-[#111113] p-4 sm:p-6"
          onToggle={(e) => setReportsOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer list-none flex items-center justify-between gap-3">
            <div>
              <h2 className="text-white font-semibold text-base sm:text-lg">Detaylı raporlar</h2>
              <p className="text-sm text-gray-400 mt-1">
                Dönemsel özet ve haftalık toplantı için yönetici özeti.
              </p>
            </div>
            <svg
              aria-hidden="true"
              className="w-5 h-5 text-gray-400 transition group-open:rotate-180"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          {reportsOpen && (
            <div className="mt-5">
              <DetailedReports />
            </div>
          )}
        </details>
      )}
    </div>
  );
}
