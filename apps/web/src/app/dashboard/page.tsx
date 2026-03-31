"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
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

  const formatPercent = (value: number) => {
    const absValue = Math.abs(value);
    return `${value > 0 ? "+" : "-"}%${absValue.toLocaleString("tr-TR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })}`;
  };

  const buildSummary = () => {
    if (loading) {
      return {
        main: "Gösterge paneli hazırlanıyor...",
        detail: "Son 24 saat özeti yükleniyor.",
      };
    }

    if (!stats || stats.trackedProducts === 0) {
      return {
        main: "Henüz takip edilen ürün yok.",
        detail: "İlk ürününüzü ekleyerek fiyat değişimlerini izlemeye başlayın.",
      };
    }

    const main = `Şu anda ${stats.trackedProducts} ürün takip ediliyor. Son 24 saatte ${stats.priceChanges24h} fiyat değişimi tespit edildi ve ${stats.activeAlerts} aktif uyarı bulunuyor.`;

    const topMover = movers[0];
    const detail = topMover
      ? `En dikkat çeken hareket: ${topMover.productName} ürününde ${formatPercent(topMover.priceChangePct)} fiyat değişimi.`
      : "Son 24 saatte öne çıkan fiyat hareketi bulunmuyor.";

    return { main, detail };
  };

  const summary = buildSummary();

  const statCards = [
    {
      label: "Takip Edilen",
      value: stats?.trackedProducts ?? 0,
      sub: "ürün",
      icon: "📦",
      href: "/dashboard/products",
    },
    {
      label: "Fiyat Değişimi",
      value: stats?.priceChanges24h ?? 0,
      sub: "son 24 saat",
      icon: "📊",
      href: "/dashboard/products",
    },
    {
      label: "Rakip Sayısı",
      value: stats?.trackedProducts ?? 0,
      sub: "toplam",
      icon: "🏪",
      href: "/dashboard/products",
    },
    {
      label: "Aktif Uyarı",
      value: stats?.activeAlerts ?? 0,
      sub: "kural",
      icon: "🔔",
      href: "/dashboard/alerts",
    },
  ];

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-2 mb-1.5">
          <h1 className="text-xl sm:text-2xl font-bold text-white">Genel Bakış</h1>
          {!loading && stats && stats.trackedProducts > 0 && (
            <span className="text-[10px] sm:text-xs text-emerald-300 bg-emerald-400/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">
              Takip aktif
            </span>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            <div className="h-3.5 sm:h-4 bg-[#1A1A1E] border border-[#232327] rounded w-full max-w-4xl animate-pulse" />
            <div className="h-3.5 sm:h-4 bg-[#1A1A1E] border border-[#232327] rounded w-[75%] max-w-3xl animate-pulse" />
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-gray-300 text-xs sm:text-sm leading-relaxed">{summary.main}</p>
            <p className="text-gray-500 text-[11px] sm:text-xs leading-relaxed">{summary.detail}</p>
            {stats && stats.trackedProducts > 0 && (
              <p className="text-[10px] sm:text-xs text-gray-600">
                Son 24 saat özeti baz alınmıştır.
              </p>
            )}
          </div>
        )}
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
