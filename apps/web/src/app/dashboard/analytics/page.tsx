"use client";

import { useState, useEffect, useCallback } from "react";
import { StatCardSkeleton, CardSkeleton } from "@/components/Skeleton";
import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";
import { getMarketplaceInfo } from "@competehive/shared";

interface MarketplaceStat {
  marketplace: string;
  totalProducts: number;
  activeProducts: number;
  errorProducts: number;
  pausedProducts: number;
  competitorCount: number;
  avgMatchScore: number | null;
  priceUpdates7d: number;
  lastScrapedAt: string | null;
  successRate: number;
  errorRate: number;
}

interface Summary {
  totalProducts: number;
  totalCompetitors: number;
  totalPriceUpdates7d: number;
  activeMarketplaces: number;
  overallSuccessRate: number;
  overallAvgMatchScore: number | null;
}

export default function AnalyticsPage() {
  const [marketplaces, setMarketplaces] = useState<MarketplaceStat[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analytics/marketplace-stats");
      if (!res.ok) throw new Error("İstatistikler yüklenemedi");
      const data = await res.json();
      setMarketplaces(data.marketplaces || []);
      setSummary(data.summary || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  function timeAgo(dateStr: string | null): string {
    if (!dateStr) return "Henüz taranmadı";
    const now = new Date();
    const date = new Date(dateStr);
    const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
    if (diffMin < 1) return "Az önce";
    if (diffMin < 60) return `${diffMin} dk önce`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour} sa önce`;
    const diffDay = Math.floor(diffHour / 24);
    return `${diffDay} gün önce`;
  }

  function getScoreColor(score: number | null): string {
    if (score === null) return "text-gray-500";
    if (score >= 90) return "text-green-400";
    if (score >= 70) return "text-amber-400";
    if (score >= 40) return "text-orange-400";
    return "text-red-400";
  }

  function getSuccessRateColor(rate: number): string {
    if (rate >= 90) return "text-green-400";
    if (rate >= 70) return "text-amber-400";
    if (rate >= 50) return "text-orange-400";
    return "text-red-400";
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-0.5 sm:mb-1">Analitik</h1>
        <p className="text-gray-500 text-sm">
          Marketplace performansı ve güvenilirlik istatistikleri.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <ErrorState title="İstatistikler yüklenemedi" message={error} onRetry={fetchStats} />
      )}

      {/* Empty */}
      {!loading && !error && marketplaces.length === 0 && (
        <EmptyState
          icon={
            <svg
              className="w-8 h-8 text-amber-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          }
          title="Henüz veri yok"
          description="Ürün ekleyip tarama yaptıktan sonra marketplace istatistikleri burada görünecek."
          actionLabel="Ürün Ekle"
          actionHref="/dashboard/products"
        />
      )}

      {/* Content */}
      {!loading && !error && summary && marketplaces.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl sm:rounded-2xl p-4 sm:p-5">
              <p className="text-gray-500 text-xs sm:text-sm mb-1">Toplam Ürün</p>
              <p className="text-2xl sm:text-3xl font-bold text-white">{summary.totalProducts}</p>
              <p className="text-gray-600 text-[10px] sm:text-xs mt-0.5 sm:mt-1">
                {summary.activeMarketplaces} marketplace
              </p>
            </div>
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl sm:rounded-2xl p-4 sm:p-5">
              <p className="text-gray-500 text-xs sm:text-sm mb-1">Toplam Rakip</p>
              <p className="text-2xl sm:text-3xl font-bold text-white">
                {summary.totalCompetitors}
              </p>
              <p className="text-gray-600 text-[10px] sm:text-xs mt-0.5 sm:mt-1">
                tüm marketplace&apos;lerde
              </p>
            </div>
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl sm:rounded-2xl p-4 sm:p-5">
              <p className="text-gray-500 text-xs sm:text-sm mb-1">Başarı Oranı</p>
              <p
                className={`text-2xl sm:text-3xl font-bold ${getSuccessRateColor(summary.overallSuccessRate)}`}
              >
                %{summary.overallSuccessRate}
              </p>
              <p className="text-gray-600 text-[10px] sm:text-xs mt-0.5 sm:mt-1">aktif / toplam</p>
            </div>
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl sm:rounded-2xl p-4 sm:p-5">
              <p className="text-gray-500 text-xs sm:text-sm mb-1">Ort. Eşleşme</p>
              <p
                className={`text-2xl sm:text-3xl font-bold ${getScoreColor(summary.overallAvgMatchScore)}`}
              >
                {summary.overallAvgMatchScore !== null ? `%${summary.overallAvgMatchScore}` : "—"}
              </p>
              <p className="text-gray-600 text-[10px] sm:text-xs mt-0.5 sm:mt-1">güven skoru</p>
            </div>
          </div>

          {/* Per-Marketplace Cards */}
          <h2 className="text-lg font-semibold text-white mb-4">Marketplace Detayları</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {marketplaces.map((mp) => {
              const info = getMarketplaceInfo(mp.marketplace);

              return (
                <div
                  key={mp.marketplace}
                  className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-5 hover:border-[#2F2F33] transition"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold"
                        style={{
                          backgroundColor: `${info.color}15`,
                          color: info.color,
                        }}
                      >
                        {info.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-white font-semibold">{info.name}</h3>
                        <p className="text-gray-600 text-xs">{timeAgo(mp.lastScrapedAt)}</p>
                      </div>
                    </div>
                    {/* Success rate */}
                    <div className="text-center">
                      <p className={`text-xl font-bold ${getSuccessRateColor(mp.successRate)}`}>
                        %{mp.successRate}
                      </p>
                      <p className="text-gray-600 text-[10px]">başarı</p>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="bg-[#0A0A0B] rounded-xl p-3 text-center">
                      <p className="text-white font-bold text-lg">{mp.totalProducts}</p>
                      <p className="text-gray-600 text-[10px]">Ürün</p>
                    </div>
                    <div className="bg-[#0A0A0B] rounded-xl p-3 text-center">
                      <p className="text-white font-bold text-lg">{mp.competitorCount}</p>
                      <p className="text-gray-600 text-[10px]">Rakip</p>
                    </div>
                    <div className="bg-[#0A0A0B] rounded-xl p-3 text-center">
                      <p className={`font-bold text-lg ${getScoreColor(mp.avgMatchScore)}`}>
                        {mp.avgMatchScore !== null ? `%${mp.avgMatchScore}` : "—"}
                      </p>
                      <p className="text-gray-600 text-[10px]">Eşleşme</p>
                    </div>
                  </div>

                  {/* Status Bar */}
                  <div className="mt-4">
                    <div className="flex justify-between text-xs text-gray-600 mb-1.5">
                      <span>{mp.activeProducts} aktif</span>
                      {mp.errorProducts > 0 && (
                        <span className="text-red-400">{mp.errorProducts} hata</span>
                      )}
                      {mp.pausedProducts > 0 && <span>{mp.pausedProducts} durdurulmuş</span>}
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 bg-[#1F1F23] rounded-full overflow-hidden flex">
                      {mp.activeProducts > 0 && (
                        <div
                          className="h-full bg-green-500 rounded-full"
                          style={{
                            width: `${(mp.activeProducts / mp.totalProducts) * 100}%`,
                          }}
                        />
                      )}
                      {mp.errorProducts > 0 && (
                        <div
                          className="h-full bg-red-500 rounded-full"
                          style={{
                            width: `${(mp.errorProducts / mp.totalProducts) * 100}%`,
                          }}
                        />
                      )}
                      {mp.pausedProducts > 0 && (
                        <div
                          className="h-full bg-gray-500 rounded-full"
                          style={{
                            width: `${(mp.pausedProducts / mp.totalProducts) * 100}%`,
                          }}
                        />
                      )}
                    </div>
                  </div>

                  {/* 7-day activity */}
                  <div className="mt-3 pt-3 border-t border-[#1F1F23]">
                    <p className="text-gray-600 text-xs">
                      Son 7 gün:{" "}
                      <span className="text-gray-400 font-medium">
                        {mp.priceUpdates7d} fiyat güncellemesi
                      </span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
