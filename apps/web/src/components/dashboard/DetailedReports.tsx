"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getMarketplaceInfo } from "@competehive/shared";

type ReportingRange = "today" | "7d" | "30d";

interface ReportingSnapshot {
  priceChangesDetected: number;
  productsWithMovement: number;
  staleProducts: number;
  competitorPressureSignals: number;
}

interface ReportingData {
  periods: Record<ReportingRange, ReportingSnapshot>;
  executive: {
    mostMoving: Array<{
      productId: string;
      productName: string;
      marketplace: string;
      movementCount: number;
    }>;
    mostPressure: Array<{
      productId: string;
      productName: string;
      marketplace: string;
      cheaperCount: number;
    }>;
    dataIssues: Array<{
      productId: string;
      productName: string;
      marketplace: string;
      stale: boolean;
      hasError: boolean;
    }>;
    mostAlerts: Array<{
      productId: string;
      productName: string;
      marketplace: string;
      alertCount: number;
    }>;
  };
  filters: {
    marketplaces: string[];
    tags: Array<{ id: string; name: string; color: string }>;
  };
}

const PERIODS: Array<{ key: ReportingRange; label: string; helper: string }> = [
  { key: "today", label: "Bugün", helper: "Son 24 saat" },
  { key: "7d", label: "Son 7 Gün", helper: "Haftalık görünüm" },
  { key: "30d", label: "Son 30 Gün", helper: "Aylık eğilim" },
];

/**
 * Dönemsel özet ve yönetici özeti. Genel Bakış'ın altında, katlanabilir bir
 * "Detaylı raporlar" bölümünde durur: günlük kullanımda gerekmeyen ama haftalık
 * değerlendirmede işe yarayan tablolar ana akışı kalabalıklaştırmasın.
 */
export default function DetailedReports() {
  const [reporting, setReporting] = useState<ReportingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<ReportingRange>("7d");
  const [marketplace, setMarketplace] = useState("ALL");
  const [tagId, setTagId] = useState("ALL");

  const fetchReporting = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ range, marketplace, tagId });
    try {
      const response = await fetch(`/api/dashboard/reporting?${params}`);
      const data = await response.json();
      if (!data.error) setReporting(data);
    } catch (error) {
      console.error("Dashboard reporting fetch failed", error);
    } finally {
      setLoading(false);
    }
  }, [range, marketplace, tagId]);

  useEffect(() => {
    fetchReporting();
  }, [fetchReporting]);

  const blocks = [
    {
      title: "En çok hareket eden ürünler",
      items:
        reporting?.executive.mostMoving.map((item) => ({
          id: item.productId,
          name: item.productName,
          marketplace: item.marketplace,
          metric: `${item.movementCount} hareket`,
        })) ?? [],
    },
    {
      title: "En fazla rakip baskısı olan ürünler",
      items:
        reporting?.executive.mostPressure.map((item) => ({
          id: item.productId,
          name: item.productName,
          marketplace: item.marketplace,
          metric: `${item.cheaperCount} daha ucuz rakip`,
        })) ?? [],
    },
    {
      title: "Veri problemi olan ürünler",
      items:
        reporting?.executive.dataIssues.map((item) => ({
          id: item.productId,
          name: item.productName,
          marketplace: item.marketplace,
          metric: [item.stale ? "veri eski" : null, item.hasError ? "hata" : null]
            .filter(Boolean)
            .join(" · "),
        })) ?? [],
    },
    {
      title: "En çok alarm üreten ürünler",
      items:
        reporting?.executive.mostAlerts.map((item) => ({
          id: item.productId,
          name: item.productName,
          marketplace: item.marketplace,
          metric: `${item.alertCount} alarm`,
        })) ?? [],
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[#2A2A2F] overflow-hidden w-fit">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setRange(item.key)}
              className={`px-3 py-2 text-xs ${range === item.key ? "bg-amber-500/15 text-amber-400" : "bg-[#151519] text-gray-400 hover:text-white"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Pazaryeri"
            value={marketplace}
            onChange={(e) => setMarketplace(e.target.value)}
            className="bg-[#151519] border border-[#2A2A2F] rounded-lg px-3 py-2 text-xs text-white"
          >
            <option value="ALL">Tüm pazaryerleri</option>
            {reporting?.filters.marketplaces?.map((key) => (
              <option key={key} value={key}>
                {getMarketplaceInfo(key).name}
              </option>
            ))}
          </select>
          <select
            aria-label="Etiket"
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            className="bg-[#151519] border border-[#2A2A2F] rounded-lg px-3 py-2 text-xs text-white"
          >
            <option value="ALL">Tüm etiketler</option>
            {reporting?.filters.tags?.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        {PERIODS.map((period) => {
          const metrics = reporting?.periods?.[period.key];
          return (
            <div
              key={period.key}
              className="rounded-xl border border-[#1F1F23] bg-[#141418] p-3.5 sm:p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-white text-sm font-medium">{period.label}</h3>
                <span className="text-[11px] text-gray-500">{period.helper}</span>
              </div>
              {loading ? (
                <p className="text-xs text-gray-500 mt-4">Özet yükleniyor...</p>
              ) : !metrics ? (
                <p className="text-xs text-gray-500 mt-4">Bu kapsam için veri yok.</p>
              ) : (
                <dl className="grid grid-cols-2 gap-2 mt-3">
                  {[
                    { label: "Fiyat değişimi", value: metrics.priceChangesDetected },
                    { label: "Hareket eden ürün", value: metrics.productsWithMovement },
                    { label: "Verisi eski", value: metrics.staleProducts },
                    { label: "Rakip baskısı", value: metrics.competitorPressureSignals },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-lg border border-[#24242A] bg-[#16161A] px-2.5 py-2"
                    >
                      <dt className="text-[11px] text-gray-500">{m.label}</dt>
                      <dd className="text-white text-sm font-semibold mt-1">{m.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {blocks.map((block) => (
          <div key={block.title} className="rounded-xl border border-[#1F1F23] bg-[#141418] p-3.5">
            <h3 className="text-sm font-medium text-white">{block.title}</h3>
            {loading ? (
              <p className="text-xs text-gray-500 mt-3">Özet hazırlanıyor...</p>
            ) : block.items.length === 0 ? (
              <p className="text-xs text-gray-500 mt-3">Seçilen filtrelerde sinyal bulunamadı.</p>
            ) : (
              <div className="space-y-1 mt-3">
                {block.items.map((item) => (
                  <Link
                    key={item.id}
                    href={`/dashboard/products/${item.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-[#1A1A1E]"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-white truncate">{item.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {getMarketplaceInfo(item.marketplace).name}
                      </p>
                    </div>
                    <span className="text-[11px] text-amber-300 whitespace-nowrap">
                      {item.metric || "İncele"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
