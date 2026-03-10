"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
      .then(res => res.json())
      .then(data => {
        if (!data.error) setStats(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statItems = [
    { label: "Takip Edilen", value: stats?.trackedProducts ?? 0, sub: "ürün", icon: "📦", href: "/dashboard/products" },
    { label: "Fiyat Değişimi", value: stats?.priceChanges24h ?? 0, sub: "son 24 saat", icon: "📊", href: "/dashboard/products" },
    { label: "Aktif Uyarı", value: stats?.activeAlerts ?? 0, sub: "kural", icon: "🔔", href: "/dashboard/alerts" },
    { label: "Bildirim", value: stats?.unreadNotifications ?? 0, sub: "okunmamış", icon: "💬", href: "/dashboard/notifications" },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Genel Bakış</h1>
        <p className="text-dark-500 text-sm">CompeteHive hesabınıza hoş geldiniz.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statItems.map((stat, i) => (
          <Link key={i} href={stat.href} className="block">
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 hover:border-hive-500/30 transition cursor-pointer">
              <div className="flex items-center justify-between mb-3">
                <span className="text-dark-500 text-sm">{stat.label}</span>
                <span className="text-lg">{stat.icon}</span>
              </div>
              <div className="text-3xl font-bold text-white">
                {loading ? (
                  <div className="w-8 h-8 bg-dark-800 rounded animate-pulse" />
                ) : (
                  stat.value
                )}
              </div>
              <div className="text-dark-600 text-xs mt-1">{stat.sub}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Empty State or Quick Actions */}
      {!loading && stats && stats.trackedProducts === 0 ? (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-hive-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-hive-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">İlk ürününüzü takibe alın</h2>
          <p className="text-dark-500 text-sm mb-6 max-w-md mx-auto">
            Trendyol veya Hepsiburada ürün linkini yapıştırarak rakip fiyatlarını takip etmeye başlayın.
          </p>
          <Link
            href="/dashboard/products"
            className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-6 py-3 rounded-xl font-semibold text-sm transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Ürün Ekle
          </Link>
        </div>
      ) : !loading && stats && stats.trackedProducts > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href="/dashboard/products" className="block">
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 hover:border-hive-500/30 transition">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-hive-500/10 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-hive-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
                </div>
                <h3 className="text-white font-semibold">Ürünlerim</h3>
              </div>
              <p className="text-dark-500 text-sm">
                {stats.trackedProducts} ürünü yönetin ve rakip fiyatlarını görüntüleyin.
              </p>
            </div>
          </Link>
          <Link href="/dashboard/alerts" className="block">
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 hover:border-hive-500/30 transition">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 bg-hive-500/10 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-hive-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                </div>
                <h3 className="text-white font-semibold">Uyarı Kuralları</h3>
              </div>
              <p className="text-dark-500 text-sm">
                {stats.activeAlerts} aktif uyarı kuralınız var. Yeni kural ekleyin.
              </p>
            </div>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
