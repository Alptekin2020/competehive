"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import RefreshButton from "@/components/RefreshButton";
import PriceTrend from "@/components/PriceTrend";
import { ProductDetailSkeleton } from "@/components/Skeleton";
import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";

interface PriceHistoryEntry {
  id: string;
  trackedProductId: string;
  price: string;
  previousPrice: string | null;
  currency: string;
  priceChange: string | null;
  priceChangePct: string | null;
  inStock: boolean;
  sellerName: string | null;
  scrapedAt: string;
}

interface CompetitorEntry {
  id: string;
  competitorUrl: string;
  competitorName: string | null;
  marketplace: string;
  currentPrice: string | null;
  lastScrapedAt: string | null;
  matchScore: number | null;
  matchReason: string | null;
}

interface ProductData {
  id: string;
  productName: string;
  marketplace: string;
  productUrl: string;
  productImage: string | null;
  currentPrice: string | null;
  currency: string;
  status: string;
  refreshStatus: string | null;
  refreshRequestedAt: string | null;
  refreshCompletedAt: string | null;
  refreshError: string | null;
  lastScrapedAt: string | null;
  priceHistory: PriceHistoryEntry[];
  competitors: CompetitorEntry[];
}

type CompetitorSort = "lowest" | "highest" | "closest";
type CompetitorFilter = "all" | "priced" | "suspicious";
type TimeRange = "7d" | "30d" | "all";

// Retailer renklerini döndür
function retailerColor(name: string): string {
  const map: Record<string, string> = {
    Trendyol: "#F27A1A",
    Hepsiburada: "#FF6000",
    "Amazon TR": "#FF9900",
    N11: "#6F3FAB",
    MediaMarkt: "#CC071E",
    Teknosa: "#005CA9",
    Vatan: "#E30613",
    Decathlon: "#0082C3",
    "Benim Ürünüm": "#F59E0B",
  };
  return map[name] ?? "#6B7280";
}

// price_history'yi Recharts için hazırla
function prepareChartData(history: PriceHistoryEntry[], ownSellerHints: string[]) {
  const byDate: Record<
    string,
    { _timestamp: number; _prices: Record<string, number> } & Record<
      string,
      number | Record<string, number>
    >
  > = {};
  const ownHints = ownSellerHints.map((hint) => hint.toLowerCase());

  for (const entry of history) {
    const seller = entry.sellerName || "Bilinmeyen";
    const entryDate = new Date(entry.scrapedAt);
    const date = entryDate.toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
    });
    if (!byDate[date])
      byDate[date] = { _timestamp: entryDate.getTime(), _prices: {} as Record<string, number> };
    byDate[date][seller] = Number(entry.price);
    byDate[date]._prices[seller] = Number(entry.price);
  }

  return Object.entries(byDate)
    .map(([date, row]) => {
      const sellerEntries = Object.entries(row._prices);
      const competitorEntries = sellerEntries.filter(([seller]) => {
        const normalizedSeller = seller.toLowerCase();
        return !ownHints.some((hint) => normalizedSeller.includes(hint));
      });

      const lowestCompetitor =
        competitorEntries.length > 0
          ? Math.min(...competitorEntries.map(([, price]) => price))
          : null;
      const avgCompetitor =
        competitorEntries.length > 0
          ? competitorEntries.reduce((acc, [, price]) => acc + price, 0) / competitorEntries.length
          : null;

      const ownEntries = sellerEntries.filter(([seller]) => {
        const normalizedSeller = seller.toLowerCase();
        return ownHints.some((hint) => normalizedSeller.includes(hint));
      });
      const ownPriceLine = ownEntries.length > 0 ? ownEntries[ownEntries.length - 1][1] : null;

      return {
        ...row,
        date,
        ownPriceLine,
        lowestCompetitor,
        avgCompetitor,
      };
    })
    .sort((a, b) => a._timestamp - b._timestamp);
}

function formatPrice(price: number, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
}

function safePrice(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function MatchScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null;

  let colorClass: string;

  if (score >= 90) {
    colorClass = "bg-green-500/10 text-green-400 border-green-500/30";
  } else if (score >= 70) {
    colorClass = "bg-amber-500/10 text-amber-400 border-amber-500/30";
  } else if (score >= 40) {
    colorClass = "bg-orange-500/10 text-orange-400 border-orange-500/30";
  } else {
    colorClass = "bg-red-500/10 text-red-400 border-red-500/30";
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}
      title={`Eşleşme güveni: %${score}`}
    >
      <span className="text-[10px]">🎯</span>%{score}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (diffMin < 1) return "az önce";
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} sa önce`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} gün önce`;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareStatus, setCompareStatus] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [competitorSort, setCompetitorSort] = useState<CompetitorSort>("lowest");
  const [competitorFilter, setCompetitorFilter] = useState<CompetitorFilter>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${id}`);
      if (res.status === 404) {
        setError("not_found");
        return;
      }
      if (!res.ok) throw new Error("Ürün bilgileri yüklenemedi");
      const data = await res.json();
      setProduct(data.product || data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchProduct();
  }, [id, fetchProduct]);

  const handleCompare = async () => {
    if (!product || isComparing) return;

    setIsComparing(true);
    setCompareError(null);
    setCompareStatus("Rakipler taranıyor...");

    try {
      const res = await fetch("/api/products/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCompareStatus(null);
        setCompareError(data?.error || "Rakip taraması başlatılamadı");
        return;
      }

      setCompareStatus("Rakip taraması tamamlandı");
      await fetchProduct();
    } catch {
      setCompareStatus(null);
      setCompareError("Rakip taraması sırasında bağlantı hatası oluştu");
    } finally {
      setIsComparing(false);
    }
  };

  // Full-page loading state
  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <Link
            href="/dashboard/products"
            className="text-gray-500 hover:text-white text-sm transition"
          >
            ← Ürünlere Dön
          </Link>
        </div>
        <ProductDetailSkeleton />
      </div>
    );
  }

  // Not found state
  if (error === "not_found") {
    return (
      <div>
        <div className="mb-6">
          <Link
            href="/dashboard/products"
            className="text-gray-500 hover:text-white text-sm transition"
          >
            ← Ürünlere Dön
          </Link>
        </div>
        <EmptyState
          icon={
            <svg
              className="w-8 h-8 text-gray-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
              <line x1="9" y1="9" x2="9.01" y2="9" />
              <line x1="15" y1="9" x2="15.01" y2="9" />
            </svg>
          }
          title="Ürün bulunamadı"
          description="Bu ürün silinmiş veya size ait değil olabilir."
          actionLabel="Ürünlere Dön"
          actionHref="/dashboard/products"
        />
      </div>
    );
  }

  // Generic error state
  if (error) {
    return (
      <div>
        <div className="mb-6">
          <Link
            href="/dashboard/products"
            className="text-gray-500 hover:text-white text-sm transition"
          >
            ← Ürünlere Dön
          </Link>
        </div>
        <ErrorState title="Ürün yüklenemedi" message={error} onRetry={fetchProduct} />
      </div>
    );
  }

  if (!product) return null;

  const priceHistory = product.priceHistory || [];
  const competitors = product.competitors || [];
  const ownSellerHints = ["Benim Ürünüm", "Kendi Mağazam", product.marketplace];
  const now = new Date();
  const rangeStart =
    timeRange === "7d"
      ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      : timeRange === "30d"
        ? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        : null;
  const filteredHistory = rangeStart
    ? priceHistory.filter((entry) => new Date(entry.scrapedAt) >= rangeStart)
    : priceHistory;
  const chartData = prepareChartData(filteredHistory, ownSellerHints);
  const retailers = [...new Set(filteredHistory.map((h) => h.sellerName || "Bilinmeyen"))];

  // Stats
  const ownPrice = product.currentPrice ? Number(product.currentPrice) : null;
  const competitorPrices = competitors
    .map((c) => safePrice(c.currentPrice))
    .filter((p): p is number => p !== null);
  const allPrices = [...(ownPrice && ownPrice > 0 ? [ownPrice] : []), ...competitorPrices];
  const lowestPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
  const highestPrice = allPrices.length > 0 ? Math.max(...allPrices) : null;
  const avgPrice =
    allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : null;
  const validCompetitors = competitors.filter((c) => safePrice(c.currentPrice) !== null);
  const cheapestCompetitor = validCompetitors
    .map((c) => ({ ...c, parsedPrice: Number(c.currentPrice) }))
    .sort((a, b) => a.parsedPrice - b.parsedPrice)[0];
  const cheapestCompetitorPrice = cheapestCompetitor?.parsedPrice ?? null;
  const absoluteDiffToCheapest =
    ownPrice !== null && ownPrice > 0 && cheapestCompetitorPrice !== null
      ? ownPrice - cheapestCompetitorPrice
      : null;
  const percentageDiffToCheapest =
    absoluteDiffToCheapest !== null && cheapestCompetitorPrice && cheapestCompetitorPrice > 0
      ? (absoluteDiffToCheapest / cheapestCompetitorPrice) * 100
      : null;
  const ownRankAmongAll =
    ownPrice !== null && ownPrice > 0
      ? [...validCompetitors.map((c) => Number(c.currentPrice)), ownPrice]
          .sort((a, b) => a - b)
          .indexOf(ownPrice) + 1
      : null;
  const rankLabel =
    ownRankAmongAll !== null && validCompetitors.length >= 2
      ? `${validCompetitors.length} rakip içinde ${ownRankAmongAll}. en ucuz`
      : "Yeterli rakip verisi yok";

  const weakCompetitors = competitors.filter((c) => c.matchScore !== null && c.matchScore < 70);
  const staleCompetitors = competitors.filter((c) => {
    if (!c.lastScrapedAt) return true;
    const ageHours = (now.getTime() - new Date(c.lastScrapedAt).getTime()) / (1000 * 60 * 60);
    return ageHours > 72;
  });
  const hasSuspiciousSignal = weakCompetitors.length > 0;
  const freshnessBaseDate = product.refreshCompletedAt || product.lastScrapedAt;
  const freshnessHours = freshnessBaseDate
    ? (now.getTime() - new Date(freshnessBaseDate).getTime()) / (1000 * 60 * 60)
    : null;
  const isFresh = freshnessHours !== null ? freshnessHours <= 24 : false;
  const freshnessLabel =
    freshnessHours === null
      ? "Yenileme zamanı bilinmiyor"
      : freshnessHours <= 24
        ? "Veri güncel (24s içinde)"
        : freshnessHours <= 72
          ? "Kısmen güncel (72s içinde)"
          : "Veri eski olabilir";

  const marketPositionLabel = (() => {
    if (!ownPrice || validCompetitors.length === 0) return "Rakip verisi yetersiz";
    if (absoluteDiffToCheapest === null) return "Rakip verisi yetersiz";
    if (absoluteDiffToCheapest === 0) return "En düşük fiyat";
    if (absoluteDiffToCheapest < 0) return "Piyasa altında";
    return "Rakipten pahalı";
  })();
  const marketPositionClass = (() => {
    if (marketPositionLabel === "En düşük fiyat")
      return "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
    if (marketPositionLabel === "Piyasa altında")
      return "text-green-300 bg-green-500/10 border-green-500/30";
    if (marketPositionLabel === "Rakipten pahalı")
      return "text-rose-300 bg-rose-500/10 border-rose-500/30";
    return "text-amber-300 bg-amber-500/10 border-amber-500/30";
  })();

  const undercutSuggestion =
    cheapestCompetitorPrice && cheapestCompetitorPrice > 1 ? cheapestCompetitorPrice - 1 : null;
  const top3AvgSuggestion =
    validCompetitors.length >= 3
      ? validCompetitors
          .map((c) => Number(c.currentPrice))
          .sort((a, b) => a - b)
          .slice(0, 3)
          .reduce((acc, price) => acc + price, 0) / 3
      : null;

  const qualityRatio = competitors.length > 0 ? validCompetitors.length / competitors.length : 0;
  const qualityLabel =
    competitors.length === 0
      ? "Rakip verisi bekleniyor"
      : qualityRatio >= 0.8 && isFresh
        ? "Aksiyon için güçlü"
        : qualityRatio >= 0.5
          ? "Temkinli değerlendir"
          : "Düşük güven";

  const filteredCompetitors = competitors
    .filter((competitor) => {
      if (competitorFilter === "priced") return safePrice(competitor.currentPrice) !== null;
      if (competitorFilter === "suspicious")
        return competitor.matchScore !== null && competitor.matchScore < 70;
      return true;
    })
    .sort((a, b) => {
      const aPrice = safePrice(a.currentPrice);
      const bPrice = safePrice(b.currentPrice);
      if (aPrice === null && bPrice === null) return 0;
      if (aPrice === null) return 1;
      if (bPrice === null) return -1;

      if (competitorSort === "highest") return bPrice - aPrice;
      if (competitorSort === "closest") {
        const base = ownPrice ?? aPrice;
        return Math.abs(aPrice - base) - Math.abs(bPrice - base);
      }
      return aPrice - bPrice;
    });

  return (
    <div className="max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link
          href="/dashboard/products"
          className="text-gray-500 hover:text-white text-sm transition"
        >
          ← Ürünlere Dön
        </Link>
      </div>

      {/* Ürün Başlık Kartı */}
      <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4 sm:p-6 mb-4 sm:mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
          <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
            {product.productImage && (
              <img
                src={product.productImage}
                alt={product.productName}
                className="w-12 h-12 sm:w-16 sm:h-16 object-cover rounded-lg border border-[#1F1F23] flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-white truncate">
                {product.productName}
              </h1>
              <a
                href={product.productUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:text-amber-300 text-xs sm:text-sm mt-1 inline-block truncate max-w-full sm:max-w-md"
              >
                {product.productUrl}
              </a>
              {product.refreshCompletedAt && (
                <p className="text-xs text-gray-500 mt-1">
                  Son yenileme: {new Date(product.refreshCompletedAt).toLocaleString("tr-TR")}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center sm:flex-col sm:items-end gap-3 sm:gap-2 flex-shrink-0">
            {ownPrice && ownPrice > 0 && (
              <div className="text-left sm:text-right">
                <p className="text-xs text-gray-500 mb-0.5 sm:mb-1">Benim Fiyatım</p>
                <p className="text-xl sm:text-2xl font-bold text-amber-400">
                  {formatPrice(ownPrice, product.currency)}
                </p>
              </div>
            )}
            <div className="flex flex-col items-start sm:items-end gap-2">
              <RefreshButton
                productId={product.id}
                initialStatus={product.refreshStatus}
                onRefreshComplete={() => fetchProduct()}
              />
              <button
                onClick={handleCompare}
                disabled={isComparing}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                  isComparing
                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-500 text-white"
                }`}
              >
                {isComparing && (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      className="opacity-25"
                    />
                    <path
                      d="M4 12a8 8 0 018-8"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
                {isComparing ? "Rakipler Taranıyor..." : "Rakipleri Tara"}
              </button>
              {compareStatus && <span className="text-xs text-blue-300">{compareStatus}</span>}
              {compareError && <span className="text-xs text-red-400">{compareError}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 sm:mb-6 bg-gradient-to-r from-amber-500/10 via-[#17171A] to-[#121214] border border-amber-500/20 rounded-2xl p-4 sm:p-5">
        <p className="text-xs uppercase tracking-wide text-amber-300/90 mb-1">Karar Özeti</p>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <p className="text-white text-lg sm:text-xl font-semibold">{marketPositionLabel}</p>
            <p className="text-sm text-gray-300 mt-1">
              {absoluteDiffToCheapest !== null
                ? `En düşük rakibe göre ${absoluteDiffToCheapest > 0 ? "+" : ""}${formatPrice(
                    absoluteDiffToCheapest,
                    product.currency,
                  )} (${percentageDiffToCheapest?.toFixed(1) ?? "0.0"}%).`
                : "Sağlıklı konum analizi için geçerli rakip fiyatı gerekli."}
            </p>
          </div>
          <div className="text-xs text-gray-400">Sıralama: {rankLabel}</div>
        </div>
      </div>

      {/* Karar Kartları */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <div className="bg-gradient-to-br from-[#151518] to-[#101012] border border-[#2A2A2F] rounded-2xl p-5 sm:p-6 lg:col-span-2">
          <div className="flex items-start justify-between gap-3 mb-4">
            <h2 className="text-white font-semibold text-lg">Piyasa Pozisyonu</h2>
            <span className={`text-xs px-2.5 py-1 rounded-full border ${marketPositionClass}`}>
              {marketPositionLabel}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-[#0D0D10] rounded-xl border border-[#1F1F23] p-3">
              <p className="text-gray-500 text-xs mb-1">En düşük rakibe fark (TL)</p>
              <p className="text-white font-semibold">
                {absoluteDiffToCheapest !== null
                  ? `${absoluteDiffToCheapest > 0 ? "+" : ""}${formatPrice(absoluteDiffToCheapest, product.currency)}`
                  : "—"}
              </p>
            </div>
            <div className="bg-[#0D0D10] rounded-xl border border-[#1F1F23] p-3">
              <p className="text-gray-500 text-xs mb-1">En düşük rakibe fark (%)</p>
              <p className="text-white font-semibold">
                {percentageDiffToCheapest !== null
                  ? `${percentageDiffToCheapest > 0 ? "+" : ""}${percentageDiffToCheapest.toFixed(1)}%`
                  : "—"}
              </p>
            </div>
            <div className="bg-[#0D0D10] rounded-xl border border-[#1F1F23] p-3">
              <p className="text-gray-500 text-xs mb-1">Sıralama</p>
              <p className="text-white font-semibold">{rankLabel}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Konum, yalnızca geçerli fiyatı olan rakiplere göre hesaplanır.
          </p>
        </div>
        <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-5">
          <h3 className="text-white font-semibold mb-3">Veri Kalitesi / Güven</h3>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between text-gray-300">
              <span>Son yenileme</span>
              <span className="text-white">
                {freshnessBaseDate
                  ? new Date(freshnessBaseDate).toLocaleString("tr-TR")
                  : "Bilinmiyor"}
              </span>
            </li>
            <li className="flex justify-between text-gray-300">
              <span>Rakip sayısı</span>
              <span className="text-white">{competitors.length}</span>
            </li>
            <li className="flex justify-between text-gray-300">
              <span>Geçerli fiyatı olan</span>
              <span className="text-white">{validCompetitors.length}</span>
            </li>
            <li className="flex justify-between text-gray-300">
              <span>Şüpheli eşleşme</span>
              <span className="text-white">{weakCompetitors.length}</span>
            </li>
            <li className="flex justify-between text-gray-300">
              <span>Eski / eksik rakip verisi</span>
              <span className="text-white">{staleCompetitors.length}</span>
            </li>
            <li className="pt-2 border-t border-[#1F1F23]">
              <span
                className={`inline-flex px-2.5 py-1 rounded-full text-xs border ${
                  isFresh
                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                    : "text-amber-300 bg-amber-500/10 border-amber-500/30"
                }`}
              >
                {freshnessLabel}
              </span>
              <span
                className={`ml-2 inline-flex px-2.5 py-1 rounded-full text-xs border ${
                  qualityLabel === "Aksiyon için güçlü"
                    ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                    : qualityLabel === "Temkinli değerlendir"
                      ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
                      : "text-rose-300 bg-rose-500/10 border-rose-500/30"
                }`}
              >
                {qualityLabel}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6">
        <h3 className="text-white font-semibold mb-2">Önerilen Fiyat</h3>
        {validCompetitors.length === 0 ? (
          <p className="text-sm text-gray-400">Öneri üretmek için yeterli rakip verisi yok.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-[#0D0D10] border border-[#1F1F23] rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">
                En düşük rakibi geçmek için önerilen fiyat
              </p>
              <p className="text-lg font-semibold text-emerald-300">
                {undercutSuggestion
                  ? formatPrice(undercutSuggestion, product.currency)
                  : "Hesaplanamadı"}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                En düşük geçerli rakip fiyatından 1 TL düşük olacak şekilde hesaplanır.
              </p>
            </div>
            <div className="bg-[#0D0D10] border border-[#1F1F23] rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">
                İlk 3 rakip ortalamasına göre önerilen fiyat
              </p>
              <p className="text-lg font-semibold text-amber-300">
                {top3AvgSuggestion
                  ? formatPrice(top3AvgSuggestion, product.currency)
                  : "Öneri için en az 3 rakip gerekli"}
              </p>
              <p className="text-[11px] text-gray-500 mt-1">
                En ucuz 3 geçerli rakip fiyatının aritmetik ortalaması alınır.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Stats Kartları */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">En Düşük Fiyat</p>
          <p className="text-lg font-bold text-green-400">
            {lowestPrice ? formatPrice(lowestPrice) : "—"}
          </p>
        </div>
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">En Yüksek Fiyat</p>
          <p className="text-lg font-bold text-red-400">
            {highestPrice ? formatPrice(highestPrice) : "—"}
          </p>
        </div>
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Ortalama Fiyat</p>
          <p className="text-lg font-bold text-white">{avgPrice ? formatPrice(avgPrice) : "—"}</p>
        </div>
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Rakip Sayısı</p>
          <p className="text-lg font-bold text-amber-400">{competitors.length}</p>
        </div>
        <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-4">
          <p className="text-gray-500 text-sm mb-1">Son Değişim</p>
          <div className="mt-1">
            {priceHistory.length > 0 ? (
              <PriceTrend
                priceChange={Number(priceHistory[0]?.priceChange) || null}
                priceChangePct={Number(priceHistory[0]?.priceChangePct) || null}
                size="lg"
                showAmount={true}
              />
            ) : (
              <p className="text-2xl font-bold text-gray-600">—</p>
            )}
          </div>
          {product.lastScrapedAt && (
            <p className="text-gray-600 text-xs mt-1">{timeAgo(product.lastScrapedAt)}</p>
          )}
        </div>
      </div>

      {/* Chart + Competitors Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Price Chart Section */}
        <div className="lg:col-span-2">
          {priceHistory.length === 0 ? (
            <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-8 text-center">
              <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-amber-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                </svg>
              </div>
              <h3 className="text-white font-semibold mb-1">Fiyat geçmişi henüz yok</h3>
              <p className="text-gray-500 text-sm">
                İlk fiyat verisi toplandıktan sonra grafik burada görünecek. Yukarıdaki
                &quot;Fiyatları Yenile&quot; butonuna tıklayarak başlatabilirsiniz.
              </p>
            </div>
          ) : (
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 gap-2">
                <h2 className="text-base font-semibold text-white">Fiyat Geçmişi</h2>
                <div className="inline-flex items-center gap-1 bg-[#0B0B0D] border border-[#1F1F23] rounded-lg p-1">
                  {[
                    { key: "7d", label: "7G" },
                    { key: "30d", label: "30G" },
                    { key: "all", label: "Tümü" },
                  ].map((option) => (
                    <button
                      key={option.key}
                      onClick={() => setTimeRange(option.key as TimeRange)}
                      className={`px-2 py-1 rounded text-xs transition ${
                        timeRange === option.key
                          ? "bg-amber-500/20 text-amber-300"
                          : "text-gray-400 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-48 sm:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1F1F23" />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#6B7280", fontSize: 11 }}
                      axisLine={{ stroke: "#1F1F23" }}
                    />
                    <YAxis
                      tick={{ fill: "#6B7280", fontSize: 11 }}
                      axisLine={{ stroke: "#1F1F23" }}
                      tickFormatter={(v) =>
                        new Intl.NumberFormat("tr-TR", {
                          notation: "compact",
                          maximumFractionDigits: 0,
                        }).format(v) + "₺"
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111113",
                        border: "1px solid #1F1F23",
                        borderRadius: "8px",
                        color: "#fff",
                      }}
                      formatter={(value: number) => [formatPrice(value), ""]}
                    />
                    <Legend wrapperStyle={{ color: "#9CA3AF", fontSize: 12 }} />
                    {retailers.map((retailer) => (
                      <Line
                        key={retailer}
                        type="monotone"
                        dataKey={retailer}
                        stroke={retailerColor(retailer)}
                        strokeWidth={
                          retailer.toLowerCase().includes(product.marketplace.toLowerCase())
                            ? 3
                            : 1.8
                        }
                        dot={false}
                        connectNulls
                      />
                    ))}
                    <Line
                      type="monotone"
                      dataKey="ownPriceLine"
                      name="Benim Fiyatım"
                      stroke="#F59E0B"
                      strokeWidth={3.5}
                      dot={false}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="lowestCompetitor"
                      name="En Düşük Rakip"
                      stroke="#34D399"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="avgCompetitor"
                      name="Rakip Ortalama"
                      stroke="#60A5FA"
                      strokeWidth={2}
                      strokeDasharray="2 4"
                      dot={false}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Competitors Section */}
        <div>
          {competitors.length === 0 ? (
            <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-8 text-center">
              <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-amber-500"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87" />
                  <path d="M16 3.13a4 4 0 010 7.75" />
                </svg>
              </div>
              <h3 className="text-white font-semibold mb-1">Rakip bulunamadı</h3>
              <p className="text-gray-500 text-sm">
                Bu ürün için henüz rakip tespit edilemedi. Yukarıdaki &quot;Rakipleri Tara&quot;
                butonuyla tekrar deneyebilirsiniz.
              </p>
            </div>
          ) : (
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-white">
                  Rakip Fiyatları
                  <span className="text-gray-500 font-normal text-sm ml-2">
                    ({competitors.length} rakip)
                  </span>
                </h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={competitorSort}
                    onChange={(e) => setCompetitorSort(e.target.value as CompetitorSort)}
                    className="bg-[#0B0B0D] border border-[#1F1F23] rounded-lg px-2.5 py-1.5 text-xs text-gray-200"
                  >
                    <option value="lowest">En düşük fiyat</option>
                    <option value="highest">En yüksek fiyat</option>
                    <option value="closest">Fiyatıma en yakın</option>
                  </select>
                  {[
                    { key: "all", label: "Tümü", show: true },
                    { key: "priced", label: "Fiyatı olanlar", show: true },
                    { key: "suspicious", label: "Şüpheli olanlar", show: hasSuspiciousSignal },
                  ]
                    .filter((f) => f.show)
                    .map((filter) => (
                      <button
                        key={filter.key}
                        onClick={() => setCompetitorFilter(filter.key as CompetitorFilter)}
                        className={`px-2.5 py-1 rounded-full text-xs border transition ${
                          competitorFilter === filter.key
                            ? "text-amber-300 bg-amber-500/10 border-amber-500/30"
                            : "text-gray-400 border-[#2B2B30] hover:text-white"
                        }`}
                      >
                        {filter.label}
                      </button>
                    ))}
                </div>
              </div>
              <div className="space-y-3">
                {filteredCompetitors.length === 0 && (
                  <div className="rounded-lg border border-dashed border-[#2A2A2F] p-5 text-center">
                    <p className="text-sm text-gray-400">
                      Seçili filtre için görüntülenecek rakip bulunamadı.
                    </p>
                  </div>
                )}
                {filteredCompetitors.map((competitor, index) => {
                  const cPrice = competitor.currentPrice ? Number(competitor.currentPrice) : null;
                  const diff = cPrice && ownPrice ? ((cPrice - ownPrice) / ownPrice) * 100 : null;
                  const isCheapest = cheapestCompetitor?.id === competitor.id;
                  const isCheaperThanMe = cPrice !== null && ownPrice !== null && cPrice < ownPrice;
                  const isExpensiveThanMe =
                    cPrice !== null && ownPrice !== null && cPrice > ownPrice;

                  return (
                    <div
                      key={competitor.id}
                      className={`flex items-center gap-3 p-3 rounded-lg bg-[#0A0A0B] border transition-colors ${
                        isCheapest
                          ? "border-emerald-500/40"
                          : isCheaperThanMe
                            ? "border-green-500/25"
                            : isExpensiveThanMe
                              ? "border-red-500/25"
                              : "border-[#1F1F23] hover:border-[#2F2F33]"
                      }`}
                    >
                      <span className="text-gray-500 text-xs w-5 text-center">{index + 1}</span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs font-medium px-2 py-0.5 rounded border border-[#2F2F33] text-gray-400">
                          {competitor.marketplace}
                        </span>
                        <MatchScoreBadge score={competitor.matchScore} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <a
                          href={competitor.competitorUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-gray-300 hover:text-white truncate transition-colors block"
                        >
                          {competitor.competitorName || competitor.competitorUrl}
                        </a>
                        {competitor.matchReason && (
                          <p
                            className="text-xs text-gray-600 mt-0.5 truncate"
                            title={competitor.matchReason}
                          >
                            {competitor.matchReason}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {cPrice ? (
                          <>
                            <p className="text-sm font-bold text-white">
                              {formatPrice(cPrice, product.currency)}
                            </p>
                            {isCheapest && (
                              <p className="text-[11px] text-emerald-300">En düşük rakip</p>
                            )}
                            {diff !== null && (
                              <p
                                className={`text-xs ${
                                  diff < 0
                                    ? "text-green-400"
                                    : diff > 0
                                      ? "text-red-400"
                                      : "text-gray-400"
                                }`}
                              >
                                {diff > 0 ? "+" : ""}
                                {diff.toFixed(1)}%
                              </p>
                            )}
                            {competitor.lastScrapedAt && (
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                {timeAgo(competitor.lastScrapedAt)}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">Fiyat yok</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
