"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatCardSkeleton } from "@/components/Skeleton";
import EmptyState from "@/components/EmptyState";

interface Stats {
  trackedProducts: number;
  priceChanges24h: number;
  activeAlerts: number;
  unreadNotifications: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setStats(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Genel Bakış</h1>
        <p className="text-gray-500 text-sm">CompeteHive hesabınıza hoş geldiniz.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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
              <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-5 hover:border-amber-500/30 transition cursor-pointer">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-gray-500 text-sm">{stat.label}</span>
                  <span className="text-lg">{stat.icon}</span>
                </div>
                <div className="text-3xl font-bold text-white">{stat.value}</div>
                <div className="text-gray-600 text-xs mt-1">{stat.sub}</div>
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
                <p className="text-gray-500 text-sm">
                  {stats.trackedProducts} ürün takip ediliyor
                </p>
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
    </div>
  );
}
