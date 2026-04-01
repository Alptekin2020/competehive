"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatCardSkeleton } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";
import PriceTrend from "@/components/PriceTrend";
import { MarketplaceBadge } from "@/components/ui/MarketplaceBadge";

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

interface DashboardProduct {
  id: string;
  product_name: string;
  marketplace: string;
  current_price: string | null;
  last_scraped_at: string | null;
  status?: string;
  competitorCount?: number;
  competitors?: { current_price: string | null }[];
  trend?: {
    priceChange: number | null;
  } | null;
}

const STALE_HOURS = 24;

function formatRelativeTime(date: Date) {
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (Number.isNaN(diffMs) || diffMs < 0) return null;

  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "az önce";

  const minutes = Math.floor(diffMs / minute);
  if (minutes < 60) return `${minutes} dk önce`;

  const hours = Math.floor(diffMs / hour);
  if (hours < 24) return `${hours} sa önce`;

  const days = Math.floor(diffMs / day);
  return `${days} gün önce`;
}

function isStale(lastScrapedAt: string | null): boolean {
  if (!lastScrapedAt) return true;
  const ts = new Date(lastScrapedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > STALE_HOURS * 60 * 60 * 1000;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [products, setProducts] = useState<DashboardProduct[]>([]);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setStats(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    fetch("/api/dashboard/movers")
      .then((res) => res.json())
      .then((data) => {
        if (data.movers) setMovers(data.movers);
      })
      .catch(() => {});

    fetch("/api/products")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data.products)) setProducts(data.products);
      })
      .catch(() => {});
  }, []);

  const latestMoverUpdate = useMemo(() => {
    if (!movers.length) return null;

    const timestamps = movers
      .map((mover) => new Date(mover.updatedAt))
      .filter((date) => !Number.isNaN(date.getTime()));

    if (!timestamps.length) return null;

    const latest = new Date(Math.max(...timestamps.map((date) => date.getTime())));
    const relative = formatRelativeTime(latest);

    if (!relative) return null;

    return {
      relative,
      exact: latest.toLocaleString("tr-TR", {
        dateStyle: "short",
        timeStyle: "short",
      }),
    };
  }, [movers]);

  const actionGroups = useMemo(() => {
    const withMeta = products.map((product) => {
      const competitorCount = product.competitorCount ?? product.competitors?.length ?? 0;
      const hasPriceChange = Boolean(product.trend && product.trend.priceChange);
      const hasCriticalIssue = product.status === "ERROR" || !product.current_price;
      return {
        ...product,
        competitorCount,
        isStale: isStale(product.last_scraped_at),
        hasPriceChange,
        hasCriticalIssue,
      };
    });

    return [
      {
        key: "rakipsiz",
        title: "Rakipsiz ürünler",
        subtitle: "Yeni rakip taraması başlatın",
        items: withMeta.filter((product) => product.competitorCount === 0).slice(0, 4),
      },
      {
        key: "stale",
        title: "Verisi eski ürünler",
        subtitle: `Son ${STALE_HOURS} saatte güncellenmeyenler`,
        items: withMeta.filter((product) => product.isStale).slice(0, 4),
      },
      {
        key: "changes",
        title: "Yeni fiyat değişimi",
        subtitle: "Hızlı aksiyon için son hareketler",
        items: withMeta.filter((product) => product.hasPriceChange).slice(0, 4),
      },
      {
        key: "issues",
        title: "Eksik / hatalı veri",
        subtitle: "İnceleme gerektiren kayıtlar",
        items: withMeta.filter((product) => product.hasCriticalIssue).slice(0, 4),
      },
    ];
  }, [products]);

  const statCards = [
    {
      label: "Takip Edilen Ürünler",
      value: stats?.trackedProducts ?? 0,
      sub: "Operasyondaki toplam ürün",
      href: "/dashboard/products",
    },
    {
      label: "24 Saatte Değişen",
      value: stats?.priceChanges24h ?? 0,
      sub: "Fiyatı hareket eden ürün",
      href: "/dashboard/products",
    },
    {
      label: "Aktif Uyarılar",
      value: stats?.activeAlerts ?? 0,
      sub: "Takip edilen alarm kuralı",
      href: "/dashboard/alerts",
    },
    {
      label: "Okunmamış Bildirim",
      value: stats?.unreadNotifications ?? 0,
      sub: "Operasyon akışında bekleyen",
      href: "/dashboard/notifications",
    },
  ];

  return (
    <div>
      <div className="mb-5 sm:mb-7">
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-1">
          Genel Bakış
        </h1>
        <p className="text-gray-500 text-xs sm:text-sm">
          Bugün müdahale gerektiren ürünleri hızlıca bulun ve aksiyon alın.
        </p>
      </div>

      <div className="mb-6 sm:mb-8 bg-[#111113] border border-[#1F1F23] rounded-xl sm:rounded-2xl p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <p className="text-[11px] sm:text-xs text-gray-500 uppercase tracking-wide">
              Sistem durumu
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]" />
              <p className="text-sm sm:text-base text-emerald-300 font-medium">İzleme aktif</p>
            </div>
          </div>

          <div className="sm:text-right">
            <p className="text-[11px] sm:text-xs text-gray-500 uppercase tracking-wide">
              Veri güncelliği
            </p>
            {latestMoverUpdate ? (
              <>
                <p className="text-sm sm:text-base text-white font-medium mt-1">
                  Son hareket: {latestMoverUpdate.relative}
                </p>
                <p
                  className="text-[11px] sm:text-xs text-gray-500 mt-0.5"
                  title={latestMoverUpdate.exact}
                >
                  Panele yansıyan son güncelleme zamanı
                </p>
              </>
            ) : (
              <>
                <p className="text-sm sm:text-base text-white font-medium mt-1">
                  Yeni hareketler bekleniyor
                </p>
                <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">
                  Yeni fiyat değişimleri geldikçe güncellenir
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          statCards.map((stat, i) => (
            <Link key={i} href={stat.href} className="block group">
              <div className="bg-gradient-to-b from-[#141418] to-[#111113] border border-[#1F1F23] rounded-xl sm:rounded-2xl p-4 sm:p-5 transition duration-200 hover:border-amber-500/40 hover:-translate-y-0.5">
                <div className="text-gray-500 text-[11px] sm:text-xs uppercase tracking-wide">
                  {stat.label}
                </div>
                <div className="text-2xl sm:text-3xl font-semibold text-white mt-2 leading-none">
                  {stat.value}
                </div>
                <div className="text-gray-500 text-[11px] sm:text-xs mt-2 group-hover:text-gray-400 transition">
                  {stat.sub}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {!loading && stats && stats.trackedProducts === 0 && (
        <EmptyState
          title="İlk ürününüzü takibe alın"
          description="Trendyol veya Hepsiburada ürün linkini yapıştırarak rakip fiyatlarını takip etmeye başlayın."
          actionLabel="Ürün Ekle"
          actionHref="/dashboard/products"
        />
      )}

      {!loading && stats && stats.trackedProducts > 0 && (
        <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Hızlı Erişim</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Link
              href="/dashboard/products"
              className="flex items-center gap-3 p-4 rounded-xl border border-[#1F1F23] hover:border-amber-500/30 transition group"
            >
              <div className="h-10 w-10 rounded-lg bg-[#1A1A1E] border border-[#2A2A2F] flex items-center justify-center text-gray-300">
                Ü
              </div>
              <div>
                <p className="text-white font-medium group-hover:text-amber-400 transition">
                  Ürünlerim
                </p>
                <p className="text-gray-500 text-sm">{stats.trackedProducts} ürün takip ediliyor</p>
              </div>
            </Link>
            <Link
              href="/dashboard/products"
              className="flex items-center gap-3 p-4 rounded-xl border border-[#1F1F23] hover:border-amber-500/30 transition group"
            >
              <div className="h-10 w-10 rounded-lg bg-[#1A1A1E] border border-[#2A2A2F] flex items-center justify-center text-amber-400">
                +
              </div>
              <div>
                <p className="text-white font-medium group-hover:text-amber-400 transition">
                  Yeni Ürün Ekle
                </p>
                <p className="text-gray-500 text-sm">Rakip fiyatlarını keşfet</p>
              </div>
            </Link>
          </div>
        </div>
      )}

      {products.length > 0 && (
        <section className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base sm:text-lg font-semibold text-white">
                Aksiyon Gerektiren Ürünler
              </h2>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Önceliklendirilmiş listelerle hızlı müdahale edin.
              </p>
            </div>
            <Link
              href="/dashboard/products"
              className="text-xs sm:text-sm text-amber-500 hover:text-amber-400 transition"
            >
              Tüm ürünleri aç →
            </Link>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {actionGroups.map((group) => (
              <div
                key={group.key}
                className="rounded-xl border border-[#1F1F23] bg-[#141418] p-3 sm:p-4"
              >
                <div className="mb-3">
                  <h3 className="text-sm font-medium text-white">{group.title}</h3>
                  <p className="text-[11px] text-gray-500 mt-1">{group.subtitle}</p>
                </div>

                {group.items.length === 0 ? (
                  <p className="text-xs text-gray-600">
                    Şu anda bu kategori için aksiyon gerektiren ürün bulunmuyor.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <Link
                        key={item.id}
                        href={`/dashboard/products/${item.id}`}
                        className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-[#1A1A1E] transition"
                      >
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm text-white truncate">
                            {item.product_name || "İsimsiz Ürün"}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                            <MarketplaceBadge marketplace={item.marketplace} />
                            <span>
                              {item.competitorCount ?? item.competitors?.length ?? 0} rakip
                            </span>
                          </div>
                        </div>
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {item.last_scraped_at
                            ? (formatRelativeTime(new Date(item.last_scraped_at)) ?? "-")
                            : "güncel değil"}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {movers.length > 0 && (
        <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-4 sm:p-6 mt-4 sm:mt-6">
          <h2 className="text-base sm:text-lg font-semibold text-white mb-3 sm:mb-4">
            Son 24 Saat Fiyat Hareketleri
          </h2>
          <div className="space-y-3">
            {movers.map((mover, i) => (
              <Link
                key={mover.productId}
                href={`/dashboard/products/${mover.productId}`}
                className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-xl hover:bg-[#1A1A1E] transition group"
              >
                <span className="text-gray-600 text-xs sm:text-sm font-mono w-4 sm:w-5 text-center">
                  {i + 1}
                </span>

                <div className="w-8 h-8 sm:w-9 sm:h-9 bg-[#1F1F23] rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                  {mover.productImage ? (
                    <img
                      src={mover.productImage}
                      alt=""
                      className="w-full h-full object-cover rounded-lg"
                    />
                  ) : (
                    <span className="text-xs text-gray-500">Ü</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs sm:text-sm truncate group-hover:text-amber-400 transition">
                    {mover.productName}
                  </p>
                  <span className="hidden sm:inline-block">
                    <MarketplaceBadge marketplace={mover.marketplace} />
                  </span>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-white text-xs sm:text-sm font-semibold">
                    ₺
                    {mover.currentPrice.toLocaleString("tr-TR", {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                  <PriceTrend
                    priceChange={mover.priceChange}
                    priceChangePct={mover.priceChangePct}
                    size="sm"
                  />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
