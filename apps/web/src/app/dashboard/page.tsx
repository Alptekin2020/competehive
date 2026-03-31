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

function formatRelativeTime(date: Date) {
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (Number.isNaN(diffMs) || diffMs < 0) {
    return null;
  }

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

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [movers, setMovers] = useState<Mover[]>([]);

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

  const statCards = [
    {
      label: "Takip Edilen Ürünler",
      value: stats?.trackedProducts ?? 0,
      sub: "toplam ürün",
      icon: "📦",
      href: "/dashboard/products",
    },
    {
      label: "Son 24 Saat Değişim",
      value: stats?.priceChanges24h ?? 0,
      sub: "fiyat güncellemesi",
      icon: "📈",
      href: "/dashboard/products",
    },
    {
      label: "Aktif Uyarılar",
      value: stats?.activeAlerts ?? 0,
      sub: "çalışan kural",
      icon: "🔔",
      href: "/dashboard/alerts",
    },
    {
      label: "Okunmamış Bildirimler",
      value: stats?.unreadNotifications ?? 0,
      sub: "incelemeyi bekliyor",
      icon: "📬",
      href: "/dashboard/notifications",
    },
  ];

  return (
    <div>
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-0.5 sm:mb-1">Genel Bakış</h1>
        <p className="text-gray-500 text-xs sm:text-sm">CompeteHive hesabınıza hoş geldiniz.</p>
      </div>

      <div className="mb-6 sm:mb-8 bg-[#111113] border border-[#1F1F23] rounded-xl sm:rounded-2xl p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <div>
            <p className="text-[11px] sm:text-xs text-gray-500 uppercase tracking-wide">
              Sistem durumu
            </p>
            <div className="flex items-center gap-2 mt-1">
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
                  Son veri güncellemesi mevcut hareketler üzerinden gösterilir
                </p>
              </>
            ) : (
              <>
                <p className="text-sm sm:text-base text-white font-medium mt-1">
                  Son hareketler mevcut verilerle gösteriliyor
                </p>
                <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">
                  Yeni fiyat değişimleri algılandıkça bu panel güncellenir
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
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
            <Link key={i} href={stat.href} className="block">
              <div className="bg-[#111113] border border-[#1F1F23] rounded-xl sm:rounded-2xl p-4 sm:p-5 hover:border-amber-500/30 transition cursor-pointer">
                <div className="flex items-center justify-between mb-2 sm:mb-3">
                  <span className="text-gray-500 text-xs sm:text-sm">{stat.label}</span>
                  <span className="text-base sm:text-lg">{stat.icon}</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-white">{stat.value}</div>
                <div className="text-gray-600 text-[10px] sm:text-xs mt-0.5 sm:mt-1">
                  {stat.sub}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Empty State or Quick Actions */}
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
              <span className="text-2xl">📦</span>
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
              <span className="text-2xl">➕</span>
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

      {/* Top Movers */}
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
                    <span className="text-xs">📦</span>
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
