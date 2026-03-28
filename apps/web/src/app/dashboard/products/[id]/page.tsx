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
  priceHistory: PriceHistoryEntry[];
  competitors: CompetitorEntry[];
}

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
function prepareChartData(history: PriceHistoryEntry[]) {
  const byDate: Record<string, Record<string, number>> = {};

  for (const entry of history) {
    const seller = entry.sellerName || "Bilinmeyen";
    const date = new Date(entry.scrapedAt).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
    });
    if (!byDate[date]) byDate[date] = {};
    byDate[date][seller] = Number(entry.price);
  }

  return Object.entries(byDate).map(([date, prices]) => ({ date, ...prices }));
}

function formatPrice(price: number, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(price);
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

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const chartData = prepareChartData(priceHistory);
  const retailers = [...new Set(priceHistory.map((h) => h.sellerName || "Bilinmeyen"))];

  // Stats
  const ownPrice = product.currentPrice ? Number(product.currentPrice) : null;
  const competitorPrices = competitors
    .map((c) => (c.currentPrice ? Number(c.currentPrice) : null))
    .filter((p): p is number => p !== null && p > 0);
  const allPrices = [...(ownPrice && ownPrice > 0 ? [ownPrice] : []), ...competitorPrices];
  const lowestPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
  const highestPrice = allPrices.length > 0 ? Math.max(...allPrices) : null;
  const avgPrice =
    allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : null;

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
      <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4">
          {product.productImage && (
            <img
              src={product.productImage}
              alt={product.productName}
              className="w-16 h-16 object-cover rounded-lg border border-[#1F1F23] flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{product.productName}</h1>
            <a
              href={product.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 text-sm mt-1 inline-block truncate max-w-md"
            >
              {product.productUrl}
            </a>
            {product.refreshCompletedAt && (
              <p className="text-xs text-gray-500 mt-1">
                Son yenileme: {new Date(product.refreshCompletedAt).toLocaleString("tr-TR")}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            {ownPrice && ownPrice > 0 && (
              <div className="text-right">
                <p className="text-xs text-gray-500 mb-1">Benim Fiyatım</p>
                <p className="text-2xl font-bold text-amber-400">
                  {formatPrice(ownPrice, product.currency)}
                </p>
              </div>
            )}
            <RefreshButton
              productId={product.id}
              initialStatus={product.refreshStatus}
              onRefreshComplete={() => fetchProduct()}
            />
          </div>
        </div>
      </div>

      {/* Stats Kartları */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
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
      </div>

      {/* Chart + Competitors Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-white">Fiyat Geçmişi</h2>
              </div>
              <ResponsiveContainer width="100%" height={280}>
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
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
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
                Bu ürün için henüz rakip tespit edilemedi. &quot;Fiyatları Yenile&quot; ile tekrar
                tarayabilirsiniz.
              </p>
            </div>
          ) : (
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6">
              <h2 className="text-base font-semibold text-white mb-4">
                Rakip Fiyatları
                <span className="text-gray-500 font-normal text-sm ml-2">
                  ({competitors.length} rakip)
                </span>
              </h2>
              <div className="space-y-3">
                {competitors.map((competitor, index) => {
                  const cPrice = competitor.currentPrice ? Number(competitor.currentPrice) : null;
                  const diff = cPrice && ownPrice ? ((cPrice - ownPrice) / ownPrice) * 100 : null;

                  return (
                    <div
                      key={competitor.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-[#0A0A0B] border border-[#1F1F23] hover:border-[#2F2F33] transition-colors"
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
