"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

interface PriceHistoryEntry {
  id: string;
  retailer: string;
  price: number;
  currency: string;
  recordedAt: string;
}

interface Competitor {
  id: string;
  title: string;
  price: number;
  currency: string;
  link: string;
  retailer: string;
  imageUrl?: string;
}

interface Product {
  id: string;
  title: string;
  url: string;
  imageUrl?: string;
  price?: number;
  currency: string;
  createdAt: string;
  competitors: Competitor[];
  priceHistory: PriceHistoryEntry[];
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

// Mock price history üret (gerçek veri yoksa fallback)
function generateMockHistory(basePrice: number, retailer: string): PriceHistoryEntry[] {
  const entries: PriceHistoryEntry[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const variation = (Math.random() - 0.5) * 0.16; // ±8%
    entries.push({
      id: `mock-${i}`,
      retailer,
      price: Math.round(basePrice * (1 + variation)),
      currency: "TRY",
      recordedAt: date.toISOString(),
    });
  }
  return entries;
}

// price_history'yi Recharts için hazırla
// { date: string, [retailer]: number }[] formatına dönüştür
function prepareChartData(history: PriceHistoryEntry[]) {
  const byDate: Record<string, Record<string, number>> = {};

  for (const entry of history) {
    const date = new Date(entry.recordedAt).toLocaleDateString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
    });
    if (!byDate[date]) byDate[date] = {};
    // Aynı gün içinde birden fazla kayıt varsa en son fiyatı al
    byDate[date][entry.retailer] = entry.price;
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

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function fetchProduct() {
    try {
      const res = await fetch(`/api/products/${id}`);
      if (!res.ok) throw new Error("Ürün yüklenemedi");
      const data = await res.json();
      setProduct(data.product);
    } catch {
      setError("Ürün bilgileri yüklenirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
        <div className="text-gray-400 text-sm animate-pulse">Yükleniyor...</div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error ?? "Ürün bulunamadı"}</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="text-amber-400 hover:text-amber-300 text-sm underline"
          >
            Dashboard&apos;a dön
          </button>
        </div>
      </div>
    );
  }

  // Gerçek priceHistory varsa kullan, yoksa mock üret
  const hasRealHistory = product.priceHistory.length > 0;
  let historyToUse: PriceHistoryEntry[] = product.priceHistory;

  if (!hasRealHistory) {
    // Mock fallback — ürünün kendi fiyatı + her competitor için
    if (product.price) {
      historyToUse = generateMockHistory(product.price, "Benim Ürünüm");
    }
    for (const competitor of product.competitors.slice(0, 3)) {
      historyToUse = [...historyToUse, ...generateMockHistory(competitor.price, competitor.retailer)];
    }
  }

  const chartData = prepareChartData(historyToUse);
  const retailers = [...new Set(historyToUse.map((h) => h.retailer))];

  // Stats
  const allPrices = [
    ...(product.price ? [product.price] : []),
    ...product.competitors.map((c) => c.price),
  ];
  const lowestPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
  const highestPrice = allPrices.length > 0 ? Math.max(...allPrices) : null;
  const avgPrice =
    allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : null;

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <button
            onClick={() => router.push("/dashboard")}
            className="hover:text-amber-400 transition-colors"
          >
            Dashboard
          </button>
          <span>/</span>
          <span className="text-gray-300 truncate max-w-xs">{product.title}</span>
        </div>

        {/* Ürün Başlık Kartı */}
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6 mb-6">
          <div className="flex items-start gap-4">
            {product.imageUrl && (
              <img
                src={product.imageUrl}
                alt={product.title}
                className="w-16 h-16 object-cover rounded-lg border border-[#1F1F23] flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-white truncate">{product.title}</h1>
              <a
                href={product.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:text-amber-300 text-sm mt-1 inline-block truncate max-w-md"
              >
                {product.url}
              </a>
            </div>
            {product.price && (
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-gray-500 mb-1">Benim Fiyatım</p>
                <p className="text-2xl font-bold text-amber-400">
                  {formatPrice(product.price, product.currency)}
                </p>
              </div>
            )}
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
            <p className="text-lg font-bold text-white">
              {avgPrice ? formatPrice(avgPrice) : "—"}
            </p>
          </div>
          <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">Rakip Sayısı</p>
            <p className="text-lg font-bold text-amber-400">{product.competitors.length}</p>
          </div>
        </div>

        {/* Fiyat Geçmişi Grafiği */}
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white">Fiyat Geçmişi</h2>
            {!hasRealHistory && (
              <span className="text-xs text-gray-500 bg-[#1F1F23] px-2 py-1 rounded">
                Örnek veri — henüz gerçek kayıt yok
              </span>
            )}
          </div>
          {chartData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-gray-500 text-sm">
              Henüz fiyat verisi bulunmuyor
            </div>
          ) : (
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
          )}
        </div>

        {/* Rakip Fiyatları */}
        <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6">
          <h2 className="text-base font-semibold text-white mb-4">
            Rakip Fiyatları
            <span className="text-gray-500 font-normal text-sm ml-2">
              ({product.competitors.length} rakip)
            </span>
          </h2>
          {product.competitors.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">
              Henüz rakip bulunamadı. Arama otomatik olarak devam ediyor.
            </div>
          ) : (
            <div className="space-y-3">
              {product.competitors.map((competitor, index) => {
                const color = retailerColor(competitor.retailer);
                const diff = product.price
                  ? ((competitor.price - product.price) / product.price) * 100
                  : null;

                return (
                  <div
                    key={competitor.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-[#0A0A0B] border border-[#1F1F23] hover:border-[#2F2F33] transition-colors"
                  >
                    <span className="text-gray-500 text-xs w-5 text-center">{index + 1}</span>
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded border flex-shrink-0"
                      style={{
                        color,
                        backgroundColor: `${color}18`,
                        borderColor: `${color}40`,
                      }}
                    >
                      {competitor.retailer}
                    </span>
                    <a
                      href={competitor.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-sm text-gray-300 hover:text-white truncate transition-colors"
                    >
                      {competitor.title}
                    </a>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-white">
                        {formatPrice(competitor.price, competitor.currency)}
                      </p>
                      {diff !== null && (
                        <p
                          className={`text-xs ${
                            diff < 0 ? "text-green-400" : diff > 0 ? "text-red-400" : "text-gray-400"
                          }`}
                        >
                          {diff > 0 ? "+" : ""}
                          {diff.toFixed(1)}%
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
