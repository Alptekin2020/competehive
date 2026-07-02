"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
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
import {
  MIN_MATCH_SCORE,
  THIN_MARGIN_PCT,
  getMarketplaceInfo,
  assessCompetitor,
  computeMargin,
  priceForMargin,
  type CompetitorAssessment,
  type MarginBand,
} from "@competehive/shared";
import RefreshButton from "@/components/RefreshButton";
import { MarketplaceBadge } from "@/components/ui/MarketplaceBadge";
import InfoTip from "@/components/ui/InfoTip";
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
  cost: string | null;
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

// Marj bandı → rozet etiketi + renkleri. margin.ts'teki MarginBand ile senkron.
const MARGIN_BAND_UI: Record<
  MarginBand,
  { label: string; text: string; bg: string; border: string }
> = {
  loss: {
    label: "Zarar",
    text: "text-rose-300",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
  },
  thin: {
    label: "İnce marj",
    text: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  healthy: {
    label: "Sağlıklı",
    text: "text-emerald-300",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  strong: {
    label: "Güçlü",
    text: "text-emerald-300",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
};

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
  } else if (score >= MIN_MATCH_SCORE) {
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
  const router = useRouter();
  const [product, setProduct] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareStatus, setCompareStatus] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [competitorSort, setCompetitorSort] = useState<CompetitorSort>("lowest");
  const [competitorFilter, setCompetitorFilter] = useState<CompetitorFilter>("all");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);
  const [competitorUrlInput, setCompetitorUrlInput] = useState("");
  const [addCompetitorLoading, setAddCompetitorLoading] = useState(false);
  const [addCompetitorError, setAddCompetitorError] = useState<string | null>(null);
  const [competitorDeleteId, setCompetitorDeleteId] = useState<string | null>(null);
  const [competitorDeleteLoading, setCompetitorDeleteLoading] = useState(false);
  const [competitorDeleteError, setCompetitorDeleteError] = useState<string | null>(null);
  const [costInput, setCostInput] = useState("");
  const [savingCost, setSavingCost] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);
  const [costSaved, setCostSaved] = useState(false);

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

  // Maliyet input'unu yalnızca ürün KİMLİĞİ değiştiğinde (ilk yükleme) sunucu
  // değeriyle senkronla; kaydetme sonrası refetch'te (aynı id) kullanıcının
  // girdisini ezmesin.
  const syncedCostProductIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (product && product.id !== syncedCostProductIdRef.current) {
      syncedCostProductIdRef.current = product.id;
      setCostInput(product.cost != null ? String(Number(product.cost)) : "");
    }
  }, [product]);

  const handleSaveCost = useCallback(async () => {
    if (!product || savingCost) return;
    setCostError(null);
    setCostSaved(false);

    const trimmed = costInput.trim();
    // Boş = maliyeti temizle (null). type="text" olduğu için ham metin gelir:
    // virgül (TR ondalık) noktaya çevrilir, virgül varsa binlik ayıracı noktalar
    // atılır. Geçersiz girişte sessizce temizlemek yerine kullanıcıya hata gösterilir.
    let cost: number | null = null;
    if (trimmed !== "") {
      const normalized = trimmed.includes(",")
        ? trimmed.replace(/\./g, "").replace(",", ".")
        : trimmed;
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setCostError("Geçerli bir maliyet girin (0 veya daha büyük).");
        return;
      }
      cost = parsed;
    }

    setSavingCost(true);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cost }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setCostError(data?.error || "Maliyet kaydedilemedi.");
        return;
      }
      setCostSaved(true);
      await fetchProduct();
    } catch {
      setCostError("Maliyet kaydedilemedi.");
    } finally {
      setSavingCost(false);
    }
  }, [product, costInput, savingCost, fetchProduct]);

  // Stats — currentPrice null'sa priceHistory'deki en güncel öz-fiyatı kullan.
  // Erken return'lerden önce çağrılmalı; product yoksa null değer üretir.
  const { ownPrice, ownPriceIsStale } = useMemo<{
    ownPrice: number | null;
    ownPriceIsStale: boolean;
  }>(() => {
    if (!product) return { ownPrice: null, ownPriceIsStale: false };

    const directOwnPrice = safePrice(product.currentPrice);
    if (directOwnPrice !== null) {
      return { ownPrice: directOwnPrice, ownPriceIsStale: false };
    }

    const hints = ["Benim Ürünüm", "Kendi Mağazam", product.marketplace].map((h) =>
      h.toLowerCase(),
    );
    const history = product.priceHistory || [];
    const fallbackEntry = history.reduce<PriceHistoryEntry | null>((latest, current) => {
      const seller = (current.sellerName || "").toLowerCase();
      if (!seller || !hints.some((h) => seller.includes(h))) return latest;
      if (safePrice(current.price) === null) return latest;
      if (!latest) return current;
      return new Date(current.scrapedAt).getTime() > new Date(latest.scrapedAt).getTime()
        ? current
        : latest;
    }, null);

    const fallbackPrice = fallbackEntry ? safePrice(fallbackEntry.price) : null;
    return { ownPrice: fallbackPrice, ownPriceIsStale: fallbackPrice !== null };
  }, [product]);

  const handleCompare = async () => {
    if (!product || isComparing) return;

    setIsComparing(true);
    setCompareError(null);
    setCompareStatus("Rakip taraması başlatıldı...");

    // Tarama WORKER'da çalışır (güçlü hat: kademeli arama + fiyat kurtarma +
    // Puppeteer + ambalaj filtresi). Vercel'deki eski web hattı pazaryerlerinin
    // datacenter-IP engellerine takıldığı için terk edildi. Worker, iş bitince
    // refreshCompletedAt/refreshError yazar — onu yoklayarak sonucu gösteririz.
    const startedAtMs = Date.now();
    const competitorsBefore = product.competitors?.length ?? 0;

    try {
      const res = await fetch(`/api/products/${product.id}/search-competitors`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setCompareStatus(null);
        setCompareError(
          res.status === 429
            ? "Çok sık tarama denediniz — birkaç dakika sonra tekrar deneyin."
            : data?.error || "Rakip taraması başlatılamadı",
        );
        return;
      }

      // 3 sn aralıkla, en fazla 90 sn yokla.
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const productRes = await fetch(`/api/products/${product.id}`);
        if (!productRes.ok) continue;
        const productData = await productRes.json();
        const fresh: ProductData = productData.product || productData;

        const completedAtMs = fresh.refreshCompletedAt
          ? new Date(fresh.refreshCompletedAt).getTime()
          : 0;
        if (completedAtMs > startedAtMs) {
          setProduct(fresh);
          const competitorsAfter = fresh.competitors?.length ?? 0;
          if (fresh.refreshStatus === "failed" && fresh.refreshError) {
            setCompareStatus(null);
            setCompareError(`Tarama hatası: ${fresh.refreshError}`);
          } else if (competitorsAfter > competitorsBefore) {
            setCompareStatus(
              `Tarama tamamlandı · ${competitorsAfter - competitorsBefore} yeni rakip eklendi (toplam ${competitorsAfter})`,
            );
          } else {
            setCompareStatus(
              "Tarama tamamlandı — yeni eşleşen rakip bulunamadı. Niş üründe normaldir; 'Rakip Ekle' ile elle ekleyebilirsiniz.",
            );
          }
          return;
        }
      }

      setCompareStatus(
        "Tarama arka planda sürüyor — sonuçlar hazır olduğunda bu sayfada görünecek.",
      );
    } catch {
      setCompareStatus(null);
      setCompareError("Rakip taraması sırasında bağlantı hatası oluştu");
    } finally {
      setIsComparing(false);
    }
  };

  const handleAddCompetitor = async () => {
    if (!product || addCompetitorLoading) return;
    setAddCompetitorError(null);
    setAddCompetitorLoading(true);
    try {
      const res = await fetch(`/api/products/${product.id}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitorUrl: competitorUrlInput.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setAddCompetitorError(data?.error || "Rakip eklenemedi. Lütfen tekrar deneyin.");
        return;
      }
      setShowAddCompetitor(false);
      setCompetitorUrlInput("");
      setCompareStatus(data?.message || "Rakip eklendi.");
      await fetchProduct();
    } catch {
      setAddCompetitorError("Bağlantı hatası — lütfen tekrar deneyin.");
    } finally {
      setAddCompetitorLoading(false);
    }
  };

  const handleDeleteCompetitor = async () => {
    if (!product || !competitorDeleteId || competitorDeleteLoading) return;
    setCompetitorDeleteLoading(true);
    setCompetitorDeleteError(null);
    try {
      const res = await fetch(`/api/products/${product.id}/competitors/${competitorDeleteId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setCompetitorDeleteError(data?.error || "Rakip silinemedi. Lütfen tekrar deneyin.");
        return;
      }
      setCompetitorDeleteId(null);
      setCompareStatus("Rakip listeden kaldırıldı.");
      await fetchProduct();
    } catch {
      setCompetitorDeleteError("Bağlantı hatası — lütfen tekrar deneyin.");
    } finally {
      setCompetitorDeleteLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!product || deleteLoading) return;

    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/products?id=${product.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "Ürün silinirken bir hata oluştu.");
      }
      router.push("/dashboard/products");
    } catch (err: unknown) {
      setDeleteError(
        err instanceof Error ? err.message : "Ürün silinemedi. Lütfen tekrar deneyin.",
      );
    } finally {
      setDeleteLoading(false);
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

  // Merkezi kalite politikası (packages/shared/competitor-quality): fiyat var mı,
  // AI skoru yeterli mi, fiyat kendi fiyatımızın 0.3x–3x bandında mı, veri 72 saatten
  // taze mi? Politikadan geçemeyen rakipler listede görünmeye devam eder ama piyasa
  // pozisyonu, sıralama ve fiyat önerisi hesaplarına GİRMEZ — ₺11'lik bir koli kaydı
  // ₺2.500'lük ürünün "en düşük rakibi" olamaz.
  const competitorAssessments = new Map<string, CompetitorAssessment>();
  for (const c of competitors) {
    competitorAssessments.set(
      c.id,
      assessCompetitor(
        {
          price: safePrice(c.currentPrice),
          matchScore: c.matchScore ?? null,
          lastScrapedAt: c.lastScrapedAt,
        },
        { ownPrice, now },
      ),
    );
  }
  const validCompetitors = competitors.filter(
    (c) => competitorAssessments.get(c.id)?.usable === true,
  );
  const competitorPrices = validCompetitors
    .map((c) => safePrice(c.currentPrice))
    .filter((p): p is number => p !== null);
  const allPrices = [...(ownPrice && ownPrice > 0 ? [ownPrice] : []), ...competitorPrices];
  const lowestPrice = allPrices.length > 0 ? Math.min(...allPrices) : null;
  const highestPrice = allPrices.length > 0 ? Math.max(...allPrices) : null;
  const avgPrice =
    allPrices.length > 0 ? allPrices.reduce((a, b) => a + b, 0) / allPrices.length : null;
  const hasOwnPrice = ownPrice !== null;
  const positionBadge: { text: string; tone: "amber" | "rose" } | null =
    validCompetitors.length === 0
      ? competitors.length === 0
        ? { text: "Rakip verisi bekleniyor", tone: "amber" }
        : { text: "Geçerli rakip yok", tone: "rose" }
      : !hasOwnPrice
        ? { text: "Kendi fiyatınız alınamadı", tone: "amber" }
        : null;
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
    validCompetitors.length === 0
      ? "Rakip verisi bekleniyor"
      : ownRankAmongAll !== null && validCompetitors.length >= 2
        ? `${validCompetitors.length} rakip içinde ${ownRankAmongAll}. en ucuz`
        : `${validCompetitors.length} rakibe göre`;

  // Şüpheli = düşük AI skoru VEYA fiyat bandı dışı (skorsuz legacy koliler dahil).
  const suspiciousCompetitors = competitors.filter((c) => {
    const issues = competitorAssessments.get(c.id)?.issues ?? [];
    return issues.includes("low-score") || issues.includes("out-of-band");
  });
  const staleCompetitors = competitors.filter((c) =>
    (competitorAssessments.get(c.id)?.issues ?? []).includes("stale"),
  );
  const hasSuspiciousSignal = suspiciousCompetitors.length > 0;
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

  // Kârlılık (maliyet girilmişse): mevcut marj, en ucuz rakibi geçme fiyatındaki
  // marj ve %10 ince-marj tabanı. Maliyet yoksa hepsi null kalır ve kart "maliyet
  // girin" durumunu gösterir.
  const ownCostNum = product.cost != null ? Number(product.cost) : null;
  const hasCost = ownCostNum !== null && Number.isFinite(ownCostNum);
  const currentMargin = computeMargin(ownPrice, ownCostNum);
  const undercutMargin = computeMargin(undercutSuggestion, ownCostNum);
  const marginFloorPrice = priceForMargin(ownCostNum, THIN_MARGIN_PCT);
  // Rakibi geçmek ince-marj tabanının altına inmeyi gerektiriyor mu?
  const undercutBreachesFloor =
    undercutSuggestion !== null &&
    marginFloorPrice !== null &&
    undercutSuggestion < marginFloorPrice;
  // Marj-korumalı öneri: rakibi geç ama %10 marj tabanının altına inme. Taban
  // en ucuz rakibin üstündeyse kârlı şekilde geçilemez → taban fiyatı önerilir.
  const marginProtectedPrice =
    hasCost && marginFloorPrice !== null
      ? undercutSuggestion !== null
        ? Math.max(undercutSuggestion, marginFloorPrice)
        : marginFloorPrice
      : null;
  const marginProtectedMargin = computeMargin(marginProtectedPrice, ownCostNum);
  const marginProtectedBeatsCheapest =
    marginProtectedPrice !== null &&
    cheapestCompetitorPrice !== null &&
    marginProtectedPrice < cheapestCompetitorPrice;

  const qualityRatio = competitors.length > 0 ? validCompetitors.length / competitors.length : 0;
  const staleRatio = competitors.length > 0 ? staleCompetitors.length / competitors.length : 0;
  const qualityLabel =
    competitors.length === 0
      ? "Rakip verisi bekleniyor"
      : validCompetitors.length === 0
        ? "Düşük güven"
        : qualityRatio >= 0.8 && isFresh && staleRatio <= 0.5
          ? "Aksiyon için güçlü"
          : qualityRatio >= 0.5
            ? "Temkinli değerlendir"
            : "Düşük güven";

  const filteredCompetitors = competitors
    .filter((competitor) => {
      if (competitorFilter === "priced") return safePrice(competitor.currentPrice) !== null;
      if (competitorFilter === "suspicious") {
        const issues = competitorAssessments.get(competitor.id)?.issues ?? [];
        return issues.includes("low-score") || issues.includes("out-of-band");
      }
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
                <p className="text-xs text-gray-500 mb-0.5 sm:mb-1">
                  Benim Fiyatım
                  {ownPriceIsStale && (
                    <span className="ml-1 text-[10px] text-amber-500/80">(son bilinen)</span>
                  )}
                </p>
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
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 text-red-300 hover:text-red-200 hover:bg-red-500/10 transition"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
                Ürünü Sil
              </button>
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
              <button
                onClick={() => {
                  setAddCompetitorError(null);
                  setShowAddCompetitor(true);
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dark-700 text-gray-300 hover:text-white hover:border-hive-500/40 text-sm font-medium transition"
                title="Bildiğiniz bir rakibin linkini elle ekleyin"
              >
                <svg
                  className="w-4 h-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Rakip Ekle
              </button>
              {compareStatus && (
                <span className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-md">
                  {compareStatus}
                </span>
              )}
              {compareError && (
                <span className="text-xs text-red-300 bg-red-500/10 border border-red-500/25 px-2 py-1 rounded-md">
                  {compareError}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {validCompetitors.length === 0 && (
        <div className="mb-4 sm:mb-6 bg-[#111113] border border-[#1F1F23] rounded-lg p-4">
          {competitors.length === 0 ? (
            <p className="text-sm text-zinc-400">
              Rakip verisi bekleniyor — ilk tarama tamamlanmadı
            </p>
          ) : (
            <p className="text-sm text-rose-400">Geçerli rakip yok — eşleşmeler düşük güvenli</p>
          )}
        </div>
      )}

      {/* Karar Kartları */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <div className="bg-gradient-to-br from-[#151518] to-[#101012] border border-[#2A2A2F] rounded-2xl p-5 sm:p-6 lg:col-span-2">
          <div className="flex items-start justify-between gap-3 mb-4">
            <h2 className="text-white font-semibold text-lg inline-flex items-center gap-2">
              Piyasa Pozisyonu
              <InfoTip
                align="left"
                text="Fark ve sıralama yalnızca 'karara uygun' rakiplerle hesaplanır: geçerli fiyatı olan, eşleşme güveni yeterli, fiyatı sizin fiyatınızın 0.3x–3x bandında ve son 72 saat içinde doğrulanmış rakipler."
              />
            </h2>
            {positionBadge && (
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  positionBadge.tone === "amber"
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-rose-500/40 bg-rose-500/10 text-rose-400"
                }`}
              >
                {positionBadge.text}
              </span>
            )}
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
          {!hasOwnPrice && validCompetitors.length > 0 && (
            <p className="mt-2 text-xs text-zinc-500">
              Kendi fiyatınız alınamadığı için fark hesaplanamıyor.{" "}
              {getMarketplaceInfo(product.marketplace).name} taraması başarılı olduğunda otomatik
              dolacak.
            </p>
          )}
        </div>
        <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-5">
          <h3 className="text-white font-semibold mb-3 inline-flex items-center gap-2">
            Veri Kalitesi / Güven
            <InfoTip
              align="right"
              text="Fiyat kararı vermeden önce rakip verisinin ne kadar güvenilir olduğunu özetler. 'Aksiyon için güçlü' rozetini görmeden agresif fiyat değişikliği önermeyiz."
            />
          </h3>
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
              <span className="inline-flex items-center gap-1.5">
                Karara uygun rakip
                <InfoTip
                  align="right"
                  text="Dört kalite kontrolünden geçen rakipler: geçerli fiyat, yeterli eşleşme güveni, fiyat bandında (0.3x–3x) ve son 72 saatte doğrulanmış. Piyasa pozisyonu ve fiyat önerisi yalnızca bunlarla hesaplanır."
                />
              </span>
              <span className="text-white">{validCompetitors.length}</span>
            </li>
            <li className="flex justify-between text-gray-300">
              <span className="inline-flex items-center gap-1.5">
                Şüpheli eşleşme
                <InfoTip
                  align="right"
                  text="Eşleşme güveni düşük veya fiyatı sizinkiyle kıyaslanamayacak kadar farklı kayıtlar. Listede görünür ama hesaplamalara girmez. 'Şüpheli olanlar' filtresiyle inceleyebilirsiniz."
                />
              </span>
              <span className="text-white">{suspiciousCompetitors.length}</span>
            </li>
            <li className="flex justify-between text-gray-300">
              <span className="inline-flex items-center gap-1.5">
                Eski / eksik rakip verisi
                <InfoTip
                  align="right"
                  text="Fiyatı 72 saatten önce alınmış veya hiç alınamamış rakipler. Güncel olmayabilecekleri için hesaplamalara dahil edilmezler — 'Fiyatları Yenile' ile tazeleyin."
                />
              </span>
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

      {/* Maliyet & Kâr — satıcının birim maliyetinden kâr/marj türetir */}
      <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-white font-semibold inline-flex items-center gap-2">
            Maliyet & Kâr
            <InfoTip
              align="left"
              text="Ürünün size birim maliyetini (alış + kargo + komisyon dahil) girin. Kâr, marj ve marj-korumalı fiyat önerisi bundan hesaplanır. Bu veri yalnızca sizin hesabınıza özeldir ve rakiplere gösterilmez."
            />
          </h3>
          {currentMargin && (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${MARGIN_BAND_UI[currentMargin.band].text} ${MARGIN_BAND_UI[currentMargin.band].bg} ${MARGIN_BAND_UI[currentMargin.band].border}`}
            >
              {MARGIN_BAND_UI[currentMargin.band].label}
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label htmlFor="product-cost" className="block text-xs text-gray-500 mb-1">
              Birim maliyet ({product.currency})
            </label>
            <input
              id="product-cost"
              type="text"
              inputMode="decimal"
              value={costInput}
              onChange={(e) => {
                setCostInput(e.target.value);
                setCostSaved(false);
                setCostError(null);
              }}
              placeholder="Örn: 850"
              className="w-full bg-dark-900 border border-dark-800 rounded-xl px-4 py-2.5 text-white text-sm placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition"
            />
          </div>
          <button
            type="button"
            onClick={handleSaveCost}
            disabled={savingCost}
            className="bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 px-5 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            {savingCost ? "Kaydediliyor..." : "Kaydet"}
          </button>
        </div>
        {costError && <p className="mt-2 text-xs text-rose-400">{costError}</p>}
        {costSaved && !costError && (
          <p className="mt-2 text-xs text-emerald-400">Maliyet kaydedildi.</p>
        )}

        {hasCost ? (
          currentMargin ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <div className="bg-[#0D0D10] rounded-xl border border-[#1F1F23] p-3">
                <p className="text-gray-500 text-xs mb-1">Birim kâr</p>
                <p
                  className={`font-semibold ${currentMargin.profit < 0 ? "text-rose-300" : "text-white"}`}
                >
                  {formatPrice(currentMargin.profit, product.currency)}
                </p>
              </div>
              <div className="bg-[#0D0D10] rounded-xl border border-[#1F1F23] p-3">
                <p className="text-gray-500 text-xs mb-1">Kâr marjı</p>
                <p className={`font-semibold ${MARGIN_BAND_UI[currentMargin.band].text}`}>
                  %{currentMargin.marginPct.toFixed(1)}
                </p>
              </div>
              <div className="bg-[#0D0D10] rounded-xl border border-[#1F1F23] p-3">
                <p className="text-gray-500 text-xs mb-1 inline-flex items-center gap-1.5">
                  %{THIN_MARGIN_PCT} marj tabanı
                  <InfoTip
                    align="right"
                    text="Bu satış fiyatının altına inerseniz kâr marjınız %10'un altına düşer. Rakibi geçmeden önce bu tabanla kıyaslayın."
                  />
                </p>
                <p className="text-white font-semibold">
                  {marginFloorPrice ? formatPrice(marginFloorPrice, product.currency) : "—"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-500">
              Kâr hesaplamak için güncel satış fiyatınız gerekli — tarama tamamlanınca otomatik
              dolacak.
            </p>
          )
        ) : (
          <p className="mt-3 text-xs text-gray-500">
            Maliyet girince birim kâr, marj rozeti ve zarar/düşük-marj uyarısı (LOW_MARGIN) devreye
            girer.
          </p>
        )}
      </div>

      <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-4 sm:p-5 mb-4 sm:mb-6">
        <h3 className="text-white font-semibold mb-2 inline-flex items-center gap-2">
          Önerilen Fiyat
          <InfoTip
            align="left"
            text="Öneriler yalnızca karara uygun rakip fiyatlarından üretilir; şüpheli veya eski kayıtlar dahil edilmez. Nihai karar sizindir — kâr marjınızı ve stok durumunuzu da hesaba katın."
          />
        </h3>
        {validCompetitors.length === 0 ? (
          <p className="text-sm text-gray-400">Öneri üretmek için yeterli rakip verisi yok.</p>
        ) : (
          <>
            {marginProtectedPrice !== null && marginProtectedMargin && (
              <div className="mb-3 rounded-xl border border-hive-500/30 bg-hive-500/5 p-3">
                <p className="text-xs text-hive-300 mb-1 inline-flex items-center gap-1.5">
                  ⭐ Marj-korumalı önerilen fiyat
                  <InfoTip
                    align="left"
                    text="Rakibi geçmeye çalışır ama kâr marjınızı %10 tabanının altına düşürmez. Taban en ucuz rakibin üstündeyse kârlı şekilde geçemezsiniz; bu durumda en düşük kârlı fiyatınız önerilir."
                  />
                </p>
                <p className="text-xl font-bold text-white">
                  {formatPrice(marginProtectedPrice, product.currency)}
                  <span className="text-sm font-medium text-emerald-300 ml-2">
                    %{marginProtectedMargin.marginPct.toFixed(1)} marj
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-gray-400">
                  {marginProtectedBeatsCheapest
                    ? "En ucuz rakibin altında kalır ve marjınızı korur."
                    : `Rakibi geçmek %${THIN_MARGIN_PCT} marjın altına iner; bu sizin en düşük kârlı fiyatınız.`}
                </p>
              </div>
            )}
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
                {undercutSuggestion && undercutMargin && (
                  <p
                    className={`text-[11px] mt-1.5 font-medium ${
                      undercutMargin.profit < 0
                        ? "text-rose-400"
                        : undercutBreachesFloor
                          ? "text-amber-400"
                          : "text-emerald-400"
                    }`}
                  >
                    {undercutMargin.profit < 0
                      ? `⚠️ Maliyetinizin altında — birim zarar ${formatPrice(Math.abs(undercutMargin.profit), product.currency)}.`
                      : `Bu fiyatta marjınız %${undercutMargin.marginPct.toFixed(1)}${
                          undercutBreachesFloor ? ` — %${THIN_MARGIN_PCT} tabanının altında.` : "."
                        }`}
                  </p>
                )}
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
          </>
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
              {product.refreshStatus === "failed" && product.refreshError ? (
                <p className="text-rose-300 text-sm mb-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  Son tarama hata aldı: {product.refreshError}
                </p>
              ) : product.refreshError ? (
                <p className="text-amber-300 text-sm mb-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  {product.refreshError}
                </p>
              ) : null}
              <p className="text-gray-500 text-sm mb-4">
                {product.refreshStatus === "failed"
                  ? "Tarama servisi geçici olarak erişilemedi — birazdan yeniden deneyin veya bildiğiniz bir rakibin linkini elle ekleyin."
                  : "Otomatik tarama birebir aynı ürünü satan rakip bulamadı — niş veya markasız ürünlerde bu normaldir. Bildiğiniz bir rakibin linkini elle ekleyebilir veya taramayı yeniden başlatabilirsiniz."}
              </p>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => {
                    setAddCompetitorError(null);
                    setShowAddCompetitor(true);
                  }}
                  className="inline-flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-dark-1000 px-4 py-2 rounded-lg text-sm font-semibold transition"
                >
                  Rakip Linki Ekle
                </button>
                <button
                  onClick={handleCompare}
                  disabled={isComparing}
                  className="inline-flex items-center justify-center gap-2 border border-dark-700 hover:border-amber-500/40 disabled:opacity-60 text-gray-300 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                >
                  {isComparing ? "Taranıyor..." : "Taramayı Yeniden Başlat"}
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6">
              <div className="mb-4">
                <h2 className="text-base font-semibold text-white inline-flex items-center gap-2 flex-wrap">
                  Rakip Fiyatları
                  <span className="text-gray-500 font-normal text-sm">
                    ({competitors.length} rakip)
                  </span>
                  <InfoTip
                    align="left"
                    text="🎯 rozeti yapay zekânın eşleşme güvenini (0–100) gösterir. 'Eski' = fiyat 72 saatten önce alındı; 'Bant dışı' = fiyat sizinkiyle kıyaslanamayacak kadar farklı. Bu kayıtlar listede görünür ama hesaplamalara girmez."
                  />
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
                        <MarketplaceBadge
                          marketplace={competitor.marketplace}
                          overrideName={competitor.marketplace === "CUSTOM" ? "Diğer" : undefined}
                        />
                        <MatchScoreBadge score={competitor.matchScore} />
                        {(competitorAssessments.get(competitor.id)?.issues ?? []).includes(
                          "out-of-band",
                        ) && (
                          <span
                            className="text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/25 px-1.5 py-0.5 rounded"
                            title="Fiyatı sizin fiyatınızın 0.3x–3x bandının dışında — büyük olasılıkla farklı ürün; hesaplara dahil edilmez"
                          >
                            Bant dışı
                          </span>
                        )}
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
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <p className="text-[11px] text-gray-500">
                                  {timeAgo(competitor.lastScrapedAt)}
                                </p>
                                {(() => {
                                  const hours =
                                    (Date.now() - new Date(competitor.lastScrapedAt).getTime()) /
                                    (1000 * 60 * 60);
                                  if (hours > 72)
                                    return (
                                      <span
                                        className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded"
                                        title="Bu fiyat 72+ saat önce alındı, güncel olmayabilir"
                                      >
                                        Eski
                                      </span>
                                    );
                                  if (hours > 24)
                                    return (
                                      <span
                                        className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded"
                                        title="Bu fiyat 24+ saat önce alındı"
                                      >
                                        {Math.floor(hours)}sa
                                      </span>
                                    );
                                  return null;
                                })()}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">Fiyat yok</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCompetitorDeleteError(null);
                          setCompetitorDeleteId(competitor.id);
                        }}
                        className="p-1.5 text-gray-600 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition flex-shrink-0"
                        title="Bu rakibi listeden kaldır (yanlış eşleşme için)"
                        aria-label="Rakibi kaldır"
                      >
                        <svg
                          className="w-3.5 h-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddCompetitor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!addCompetitorLoading) setShowAddCompetitor(false);
            }}
          />
          <div className="bg-dark-900 border border-dark-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-md relative z-10 safe-bottom">
            <h2 className="text-lg font-bold text-white mb-1">Rakip Ekle</h2>
            <p className="text-dark-500 text-sm mb-4">
              Rakip ürünün marketplace linkini yapıştırın. Fiyatı hemen alınamazsa en geç 30 dakika
              içinde otomatik güncellenir.
            </p>
            <input
              type="url"
              value={competitorUrlInput}
              onChange={(e) => setCompetitorUrlInput(e.target.value)}
              placeholder="https://www.trendyol.com/..."
              autoFocus
              className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white text-sm placeholder:text-dark-600 focus:outline-none focus:border-hive-500/50 transition mb-3"
            />
            {addCompetitorError && (
              <p className="text-sm text-red-300 mb-3">{addCompetitorError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => setShowAddCompetitor(false)}
                disabled={addCompetitorLoading}
                className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 disabled:opacity-60 transition"
              >
                İptal
              </button>
              <button
                onClick={handleAddCompetitor}
                disabled={addCompetitorLoading || !competitorUrlInput.trim()}
                className="flex-1 bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 py-2.5 rounded-xl text-sm font-semibold transition"
              >
                {addCompetitorLoading ? "Ekleniyor..." : "Ekle"}
              </button>
            </div>
          </div>
        </div>
      )}

      {competitorDeleteId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!competitorDeleteLoading) {
                setCompetitorDeleteId(null);
                setCompetitorDeleteError(null);
              }
            }}
          />
          <div className="bg-dark-900 border border-dark-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-sm relative z-10 safe-bottom">
            <h2 className="text-lg font-bold text-white mb-2">Rakibi Kaldır</h2>
            <p className="text-dark-500 text-sm mb-3">
              Bu rakip ve fiyat geçmişi listeden silinecek. Yanlış eşleşmeleri kaldırmak piyasa
              pozisyonu ve fiyat önerisi hesaplarını temiz tutar. Otomatik tarama aynı ürünü ileride
              yeniden bulabilir.
            </p>
            {competitorDeleteError && (
              <p className="text-sm text-red-300 mb-4">{competitorDeleteError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setCompetitorDeleteId(null);
                  setCompetitorDeleteError(null);
                }}
                disabled={competitorDeleteLoading}
                className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 disabled:opacity-60 transition"
              >
                İptal
              </button>
              <button
                onClick={handleDeleteCompetitor}
                disabled={competitorDeleteLoading}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-semibold transition"
              >
                {competitorDeleteLoading ? "Kaldırılıyor..." : "Kaldır"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              if (!deleteLoading) {
                setShowDeleteConfirm(false);
                setDeleteError(null);
              }
            }}
          />
          <div className="bg-dark-900 border border-dark-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-sm relative z-10 safe-bottom">
            <h2 className="text-lg font-bold text-white mb-2">Ürünü Sil</h2>
            <p className="text-dark-500 text-sm mb-3">
              Bu ürünü silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
            </p>
            {deleteError && <p className="text-sm text-red-300 mb-4">{deleteError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteError(null);
                }}
                disabled={deleteLoading}
                className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 disabled:opacity-60 transition"
              >
                İptal
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="flex-1 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white py-2.5 rounded-xl text-sm font-semibold transition"
              >
                {deleteLoading ? "Siliniyor..." : "Sil"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
