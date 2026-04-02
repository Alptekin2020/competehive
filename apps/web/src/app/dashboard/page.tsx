"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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

type ReportingRange = "today" | "7d" | "30d";

interface ReportingSnapshot {
  priceChangesDetected: number;
  productsWithMovement: number;
  staleProducts: number;
  competitorPressureSignals: number;
}

interface ReportingData {
  periods: {
    today: ReportingSnapshot;
    "7d": ReportingSnapshot;
    "30d": ReportingSnapshot;
  };
  executive: {
    mostMoving: Array<{
      productId: string;
      productName: string;
      marketplace: string;
      movementCount: number;
      absoluteMovePct: number;
    }>;
    mostPressure: Array<{
      productId: string;
      productName: string;
      marketplace: string;
      cheaperCount: number;
      gapPct: number;
    }>;
    dataIssues: Array<{
      productId: string;
      productName: string;
      marketplace: string;
      stale: boolean;
      missingPrice: boolean;
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
  const [reporting, setReporting] = useState<ReportingData | null>(null);
  const [reportingLoading, setReportingLoading] = useState(true);
  const [reportingRange, setReportingRange] = useState<ReportingRange>("7d");
  const [selectedMarketplace, setSelectedMarketplace] = useState("ALL");
  const [selectedTagId, setSelectedTagId] = useState("ALL");

  const fetchReporting = useCallback(async () => {
    setReportingLoading(true);
    const params = new URLSearchParams({
      range: reportingRange,
      marketplace: selectedMarketplace,
      tagId: selectedTagId,
    });
    try {
      const response = await fetch(`/api/dashboard/reporting?${params}`);
      const data = await response.json();
      if (!data.error) setReporting(data);
    } catch {
      // no-op
    } finally {
      setReportingLoading(false);
    }
  }, [reportingRange, selectedMarketplace, selectedTagId]);

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

  useEffect(() => {
    fetchReporting();
  }, [fetchReporting]);

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

  const onboardingChecklist = useMemo(() => {
    const hasFirstProduct = (stats?.trackedProducts ?? 0) > 0;
    const hasCompetitorScan = products.some(
      (product) => (product.competitorCount ?? product.competitors?.length ?? 0) > 0,
    );
    const hasFirstAlert = (stats?.activeAlerts ?? 0) > 0;
    const reviewedNotifications = (stats?.unreadNotifications ?? 0) === 0;
    const hasPriceMovement =
      movers.length > 0 ||
      products.some((product) => Boolean(product.trend && product.trend.priceChange));

    return [
      {
        key: "first-product",
        title: "İlk ürünü ekle",
        description: "Takibin başlangıcı için en az 1 ürün ekleyin.",
        done: hasFirstProduct,
        href: "/dashboard/products",
        cta: "Ürün ekle",
      },
      {
        key: "scan-competitors",
        title: "Rakipleri tara",
        description: "En az bir ürün için rakip verisi çekin.",
        done: hasCompetitorScan,
        href: "/dashboard/products",
        cta: "Rakipleri gör",
      },
      {
        key: "first-alert",
        title: "İlk uyarıyı oluştur",
        description: "Kritik hareketleri kaçırmamak için alarm kurun.",
        done: hasFirstAlert,
        href: "/dashboard/alerts",
        cta: "Uyarı kur",
      },
      {
        key: "review-notifications",
        title: "Bildirimleri gözden geçir",
        description: "Gelenleri okuyup akışı temiz tutun.",
        done: reviewedNotifications,
        href: "/dashboard/notifications",
        cta: "Bildirimleri aç",
      },
      {
        key: "first-price-move",
        title: "İlk fiyat hareketini incele",
        description: "Trendleri inceleyip ilk aksiyonunuzu belirleyin.",
        done: hasPriceMovement,
        href: "/dashboard/products",
        cta: "Fiyat hareketleri",
      },
    ];
  }, [
    movers.length,
    products,
    stats?.activeAlerts,
    stats?.trackedProducts,
    stats?.unreadNotifications,
  ]);

  const completedChecklistCount = onboardingChecklist.filter((step) => step.done).length;
  const showOnboardingChecklist =
    !loading &&
    stats &&
    (completedChecklistCount < onboardingChecklist.length || stats.trackedProducts < 3);

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

  const periodCards: Array<{ key: "today" | "7d" | "30d"; label: string; helper: string }> = [
    { key: "today", label: "Bugün", helper: "Son 24 saat" },
    { key: "7d", label: "Son 7 Gün", helper: "Haftalık görünüm" },
    { key: "30d", label: "Son 30 Gün", helper: "Aylık eğilim" },
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

      <section className="mb-6 sm:mb-8 rounded-2xl border border-[#1F1F23] bg-[#111113] p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Raporlama</p>
            <h2 className="text-white font-semibold mt-1">Kısa dönem performans özeti</h2>
            <p className="text-xs text-gray-500 mt-1">
              Bugün, son 7 gün ve son 30 gün için güvenli veri türetimleri.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={selectedMarketplace}
              onChange={(e) => setSelectedMarketplace(e.target.value)}
              className="bg-[#151519] border border-[#2A2A2F] rounded-lg px-3 py-2 text-xs text-white"
            >
              <option value="ALL">Tüm marketplace</option>
              {reporting?.filters.marketplaces?.map((marketplace) => (
                <option key={marketplace} value={marketplace}>
                  {marketplace}
                </option>
              ))}
            </select>
            <select
              value={selectedTagId}
              onChange={(e) => setSelectedTagId(e.target.value)}
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
          {periodCards.map((period) => {
            const metrics = reporting?.periods?.[period.key];
            return (
              <div
                key={period.key}
                className="rounded-xl border border-[#1F1F23] bg-[#141418] p-3.5 sm:p-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-white text-sm font-medium">{period.label}</h3>
                  <span className="text-[10px] text-gray-500">{period.helper}</span>
                </div>

                {reportingLoading ? (
                  <p className="text-xs text-gray-600 mt-4">Özet yükleniyor...</p>
                ) : !metrics ? (
                  <p className="text-xs text-gray-600 mt-4">Bu kapsam için veri yok.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="rounded-lg border border-[#24242A] bg-[#16161A] px-2.5 py-2">
                      <p className="text-[10px] text-gray-500">Fiyat değişimi</p>
                      <p className="text-white text-sm font-semibold mt-1">
                        {metrics.priceChangesDetected}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#24242A] bg-[#16161A] px-2.5 py-2">
                      <p className="text-[10px] text-gray-500">Hareket eden ürün</p>
                      <p className="text-white text-sm font-semibold mt-1">
                        {metrics.productsWithMovement}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#24242A] bg-[#16161A] px-2.5 py-2">
                      <p className="text-[10px] text-gray-500">Verisi eski</p>
                      <p className="text-white text-sm font-semibold mt-1">
                        {metrics.staleProducts}
                      </p>
                    </div>
                    <div className="rounded-lg border border-[#24242A] bg-[#16161A] px-2.5 py-2">
                      <p className="text-[10px] text-gray-500">Rakip baskısı</p>
                      <p className="text-white text-sm font-semibold mt-1">
                        {metrics.competitorPressureSignals}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-6 sm:mb-8 rounded-2xl border border-[#1F1F23] bg-[#111113] p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-gray-500">Yönetici Özeti</p>
            <h2 className="text-white font-semibold mt-1">Haftalık toplantı için hızlı özet</h2>
          </div>
          <div className="inline-flex rounded-lg border border-[#2A2A2F] overflow-hidden w-fit">
            {[
              { key: "today", label: "Bugün" },
              { key: "7d", label: "7 Gün" },
              { key: "30d", label: "30 Gün" },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => setReportingRange(item.key as ReportingRange)}
                className={`px-3 py-1.5 text-xs ${reportingRange === item.key ? "bg-amber-500/15 text-amber-400" : "bg-[#151519] text-gray-400 hover:text-white"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {[
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
          ].map((block) => (
            <div
              key={block.title}
              className="rounded-xl border border-[#1F1F23] bg-[#141418] p-3.5"
            >
              <h3 className="text-sm font-medium text-white">{block.title}</h3>
              {reportingLoading ? (
                <p className="text-xs text-gray-600 mt-3">Özet hazırlanıyor...</p>
              ) : block.items.length === 0 ? (
                <p className="text-xs text-gray-600 mt-3">Seçilen filtrelerde sinyal bulunamadı.</p>
              ) : (
                <div className="space-y-2 mt-3">
                  {block.items.map((item) => (
                    <Link
                      key={item.id}
                      href={`/dashboard/products/${item.id}`}
                      className="flex items-center justify-between rounded-lg px-2.5 py-2 hover:bg-[#1A1A1E]"
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-white truncate">{item.name}</p>
                        <p className="text-[10px] text-gray-500 mt-0.5">{item.marketplace}</p>
                      </div>
                      <span className="text-[11px] text-amber-300">{item.metric || "İncele"}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {showOnboardingChecklist && (
        <section className="mb-6 sm:mb-8 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/8 to-transparent p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-amber-300/80">
                Başlangıç Kontrol Listesi
              </p>
              <h2 className="text-white font-semibold mt-1">İlk değeri dakikalar içinde görün</h2>
              <p className="text-xs sm:text-sm text-gray-400 mt-1">
                Temel kurulumu tamamladığınızda fiyat hareketlerini ve kritik riskleri çok daha net
                görürsünüz.
              </p>
            </div>
            <span className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 rounded-full px-2.5 py-1 w-fit">
              {completedChecklistCount}/{onboardingChecklist.length} tamamlandı
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {onboardingChecklist.map((step) => (
              <div
                key={step.key}
                className={`rounded-xl border px-3.5 py-3 flex items-start justify-between gap-3 ${
                  step.done
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-[#26262B] bg-[#151519]"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                        step.done
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-[#1E1E23] text-gray-500"
                      }`}
                    >
                      {step.done ? "✓" : "•"}
                    </span>
                    <p
                      className={`text-sm font-medium ${step.done ? "text-emerald-200" : "text-white"}`}
                    >
                      {step.title}
                    </p>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{step.description}</p>
                </div>
                {!step.done && (
                  <Link
                    href={step.href}
                    className="text-xs text-amber-400 hover:text-amber-300 transition whitespace-nowrap"
                  >
                    {step.cta} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

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
