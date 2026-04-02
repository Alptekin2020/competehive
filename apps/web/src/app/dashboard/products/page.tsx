"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { CardSkeleton } from "@/components/Skeleton";
import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";
import { AddProductModal } from "@/components/products/AddProductModal";
import BulkImportModal from "@/components/BulkImportModal";
import { MarketplaceBadge } from "@/components/ui/MarketplaceBadge";
import PriceTrend from "@/components/PriceTrend";
import TagFilterBar from "@/components/TagFilterBar";
import TagManagerModal from "@/components/TagManagerModal";
import ProductTagSelector from "@/components/ProductTagSelector";

interface PlanFeaturesData {
  plan: string;
  features: {
    maxProducts: number;
    hasBulkImport: boolean;
    hasTagSystem: boolean;
    marketplaceLimit: number;
    [key: string]: unknown;
  };
  usage: {
    products: number;
    alertRules: number;
    tags: number;
    marketplaces: number;
  };
  limits: {
    productsRemaining: number;
    [key: string]: number;
  };
}

interface CompetitorItem {
  id?: string;
  marketplace: string;
  competitor_name: string | null;
  current_price: string | null;
  competitor_url: string;
}

interface TrendData {
  priceChange: number | null;
  priceChangePct: number | null;
  lastUpdated: string | null;
}

interface ProductItem {
  id: string;
  product_name: string;
  marketplace: string;
  product_url: string;
  product_image: string | null;
  current_price: string | null;
  last_scraped_at: string | null;
  status?: string;
  trend?: TrendData | null;
  competitorCount?: number;
  competitors?: CompetitorItem[];
  tags?: { tag: { id: string; name: string; color: string } }[];
}

type QuickFilter = "ALL" | "NO_COMPETITOR" | "STALE" | "CHANGED" | "ACTIVE";
type SortOption =
  | "updated_desc"
  | "updated_asc"
  | "price_desc"
  | "price_asc"
  | "competitors_desc"
  | "biggest_drop";
type ViewMode = "cards" | "table";

const STALE_HOURS = 24;

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

function isStale(lastScrapedAt: string | null): boolean {
  if (!lastScrapedAt) return true;
  const ts = new Date(lastScrapedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > STALE_HOURS * 60 * 60 * 1000;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [url, setUrl] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [showTagManager, setShowTagManager] = useState(false);
  const [planFeatures, setPlanFeatures] = useState<PlanFeaturesData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("ALL");
  const [sortBy, setSortBy] = useState<SortOption>("updated_desc");
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [showFirstProductSuccess, setShowFirstProductSuccess] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("Ürünler yüklenemedi");
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
    async function fetchFeatures() {
      try {
        const res = await fetch("/api/user/features");
        if (res.ok) setPlanFeatures(await res.json());
      } catch {
        // silently fail
      }
    }
    fetchFeatures();
  }, [fetchProducts]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setFormLoading(true);

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setProducts((prev) => [data.product, ...prev]);
      setShowFirstProductSuccess(true);
      setUrl("");
      setShowModal(false);

      fetch("/api/products/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: data.product.id }),
      })
        .then((res) => res.json())
        .then((compareData) => {
          if (compareData.competitors?.length > 0) {
            setProducts((prev) =>
              prev.map((p) =>
                p.id === data.product.id ? { ...p, competitors: compareData.competitors } : p,
              ),
            );
          }
        })
        .catch((err) => console.error("Compare error:", err));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
      setFormError(msg);
    } finally {
      setFormLoading(false);
    }
  };

  const filteredProducts = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const withMeta = products
      .filter((p) => (selectedTagId ? p.tags?.some((pt) => pt.tag?.id === selectedTagId) : true))
      .map((p) => {
        const myPrice = p.current_price ? Number(p.current_price) : null;
        const competitorCount = p.competitorCount ?? p.competitors?.length ?? 0;
        const competitorPrices = (p.competitors ?? [])
          .map((c) => (c.current_price ? Number(c.current_price) : null))
          .filter((price): price is number => price !== null && Number.isFinite(price));
        const minCompetitorPrice = competitorPrices.length ? Math.min(...competitorPrices) : null;
        const stale = isStale(p.last_scraped_at);
        const priceChange = p.trend?.priceChange ?? null;

        return {
          product: p,
          myPrice,
          competitorCount,
          minCompetitorPrice,
          stale,
          priceChange,
        };
      })
      .filter(({ product }) => {
        if (!normalizedQuery) return true;
        return (
          product.product_name?.toLowerCase().includes(normalizedQuery) ||
          product.marketplace?.toLowerCase().includes(normalizedQuery)
        );
      })
      .filter(({ product, competitorCount, stale, priceChange }) => {
        if (quickFilter === "NO_COMPETITOR") return competitorCount === 0;
        if (quickFilter === "STALE") return stale;
        if (quickFilter === "CHANGED") return Boolean(priceChange);
        if (quickFilter === "ACTIVE") return product.status === "ACTIVE";
        return true;
      });

    return withMeta.sort((a, b) => {
      if (sortBy === "updated_desc") {
        return (
          new Date(b.product.last_scraped_at || 0).getTime() -
          new Date(a.product.last_scraped_at || 0).getTime()
        );
      }
      if (sortBy === "updated_asc") {
        return (
          new Date(a.product.last_scraped_at || 0).getTime() -
          new Date(b.product.last_scraped_at || 0).getTime()
        );
      }
      if (sortBy === "price_desc") return (b.myPrice ?? -Infinity) - (a.myPrice ?? -Infinity);
      if (sortBy === "price_asc") return (a.myPrice ?? Infinity) - (b.myPrice ?? Infinity);
      if (sortBy === "competitors_desc") return b.competitorCount - a.competitorCount;
      return (a.priceChange ?? 0) - (b.priceChange ?? 0);
    });
  }, [products, quickFilter, searchQuery, selectedTagId, sortBy]);

  const quickFilters: { key: QuickFilter; label: string }[] = [
    { key: "ALL", label: "Tümü" },
    { key: "NO_COMPETITOR", label: "Rakipsiz" },
    { key: "STALE", label: "Veri Eski" },
    { key: "CHANGED", label: "Fiyat Değişti" },
    { key: "ACTIVE", label: "Aktif" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-1">
            Ürünler
          </h1>
          <p className="text-dark-500 text-xs sm:text-sm">
            Takip ettiğiniz ürünleri yönetin ve önceliklendirin.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {planFeatures?.features?.hasBulkImport ? (
            <button
              onClick={() => setShowBulkModal(true)}
              className="inline-flex items-center gap-2 border border-[#1F1F23] hover:border-amber-500/30 text-gray-400 hover:text-white p-2.5 sm:px-4 sm:py-2.5 rounded-xl font-medium text-sm transition"
              title="Toplu Ekle"
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
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="hidden sm:inline">Toplu Ekle</span>
            </button>
          ) : (
            <button
              onClick={() => (window.location.href = "/dashboard/pricing")}
              className="inline-flex items-center gap-2 border border-amber-500/20 text-amber-500/70 p-2.5 sm:px-4 sm:py-2.5 rounded-xl font-medium text-sm transition hover:bg-amber-500/5"
              title="Toplu URL ekleme ile onlarca ürünü tek seferde takibe alabilirsiniz"
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
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <span className="hidden sm:inline">Toplu Ekle · Üst Plan</span>
            </button>
          )}

          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-3 sm:px-5 py-2.5 rounded-xl font-semibold text-sm transition"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="hidden sm:inline">Ürün Ekle</span>
          </button>
        </div>
      </div>

      {planFeatures?.features?.hasTagSystem && (
        <TagFilterBar
          selectedTagId={selectedTagId}
          onSelectTag={setSelectedTagId}
          onManageTags={() => setShowTagManager(true)}
        />
      )}

      {showFirstProductSuccess && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
          <div>
            <p className="text-sm text-emerald-300 font-medium">İlk ürününüz başarıyla eklendi.</p>
            <p className="text-xs text-emerald-100/80 mt-0.5">
              Sıradaki adım: ürün detayından rakip taramasını başlatıp ilk fiyat sinyalini
              yakalayın.
            </p>
          </div>
          <button
            onClick={() => setShowFirstProductSuccess(false)}
            className="text-xs text-emerald-200/80 hover:text-emerald-100 transition"
          >
            Kapat
          </button>
        </div>
      )}

      {planFeatures && planFeatures.usage.products >= planFeatures.features.maxProducts * 0.8 && (
        <div
          className={`flex items-center justify-between px-4 py-3 rounded-xl mb-4 ${planFeatures.usage.products >= planFeatures.features.maxProducts ? "bg-red-500/10 border border-red-500/20" : "bg-amber-500/10 border border-amber-500/20"}`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-medium ${planFeatures.usage.products >= planFeatures.features.maxProducts ? "text-red-400" : "text-amber-400"}`}
            >
              {planFeatures.usage.products >= planFeatures.features.maxProducts
                ? `Ürün limitine ulaştınız (${planFeatures.usage.products}/${planFeatures.features.maxProducts})`
                : `${planFeatures.usage.products}/${planFeatures.features.maxProducts} ürün kullanılıyor`}
            </span>
          </div>
          <Link
            href="/dashboard/pricing"
            className="text-xs text-amber-500 hover:text-amber-400 font-semibold transition"
          >
            Limiti artır →
          </Link>
        </div>
      )}

      {!loading && !error && products.length > 0 && (
        <div className="mb-4 rounded-2xl border border-[#1F1F23] bg-[#111113] p-3 sm:p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Ürün adı veya marketplace ara"
                className="w-full bg-[#151519] border border-[#2A2A2F] rounded-xl pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              <svg
                className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="bg-[#151519] border border-[#2A2A2F] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            >
              <option value="updated_desc">En yeni güncellenen</option>
              <option value="updated_asc">En eski güncellenen</option>
              <option value="price_desc">En yüksek fiyat</option>
              <option value="price_asc">En düşük fiyat</option>
              <option value="competitors_desc">En çok rakip</option>
              <option value="biggest_drop">En büyük fiyat düşüşü</option>
            </select>

            <div className="inline-flex rounded-xl border border-[#2A2A2F] overflow-hidden">
              <button
                onClick={() => setViewMode("cards")}
                className={`px-3 py-2 text-xs sm:text-sm transition ${viewMode === "cards" ? "bg-amber-500/15 text-amber-400" : "bg-[#151519] text-gray-400 hover:text-white"}`}
              >
                Kart
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`px-3 py-2 text-xs sm:text-sm transition border-l border-[#2A2A2F] ${viewMode === "table" ? "bg-amber-500/15 text-amber-400" : "bg-[#151519] text-gray-400 hover:text-white"}`}
              >
                Tablo
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {quickFilters.map((item) => (
              <button
                key={item.key}
                onClick={() => setQuickFilter(item.key)}
                className={`px-3 py-1.5 rounded-full text-xs border transition ${quickFilter === item.key ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-[#2A2A2F] text-gray-400 hover:text-white hover:border-[#3A3A40]"}`}
              >
                {item.label}
              </button>
            ))}
            <span className="text-xs text-gray-600 ml-auto">
              {filteredProducts.length} ürün gösteriliyor
            </span>
          </div>
        </div>
      )}

      {loading && (
        <div className="grid gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {!loading && error && (
        <ErrorState title="Ürünler yüklenemedi" message={error} onRetry={fetchProducts} />
      )}

      {!loading && !error && products.length === 0 && (
        <div>
          <EmptyState
            title="Henüz ürün eklenmedi"
            description="Marketplace ürün linkini yapıştırarak rakip fiyatlarını takip etmeye başlayın."
            actionLabel="İlk Ürünü Ekle"
            onAction={() => setShowModal(true)}
          />
          <div className="text-center mt-3">
            <button
              onClick={() => setShowBulkModal(true)}
              className="text-sm text-amber-500 hover:text-amber-400 transition"
            >
              veya Toplu URL Ekle
            </button>
          </div>
        </div>
      )}

      {!loading && !error && products.length > 0 && viewMode === "cards" && (
        <div className="grid gap-4">
          {filteredProducts.length === 0 && (
            <div className="rounded-2xl border border-[#1F1F23] bg-[#111113] p-8 text-center">
              <h3 className="text-white font-semibold">Bu görünümde ürün bulunamadı</h3>
              <p className="text-gray-500 text-sm mt-2">
                Arama veya filtreleri sadeleştirin. Özellikle “Rakipsiz” filtresiyle ürün detayına
                geçip rakip taraması başlatabilirsiniz.
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setQuickFilter("ALL");
                }}
                className="mt-4 text-sm text-amber-400 hover:text-amber-300 transition"
              >
                Filtreleri temizle
              </button>
            </div>
          )}
          {filteredProducts.map(
            ({ product, myPrice, competitorCount, minCompetitorPrice, stale }) => {
              const pricePositionHint =
                competitorCount === 0
                  ? "Rakip yok"
                  : myPrice === null || minCompetitorPrice === null
                    ? "Karşılaştırma yok"
                    : myPrice <= minCompetitorPrice
                      ? "Piyasanın altında"
                      : "Rakipten pahalı";

              return (
                <Link
                  key={product.id}
                  href={`/dashboard/products/${product.id}`}
                  className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-4 sm:p-5 flex items-start sm:items-center gap-3 sm:gap-4 hover:border-amber-500/30 transition group"
                >
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#1F1F23] rounded-lg sm:rounded-xl flex items-center justify-center overflow-hidden shrink-0">
                    {product.product_image ? (
                      <img
                        src={product.product_image}
                        alt=""
                        className="w-full h-full object-cover rounded-xl"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="text-gray-500 text-xs font-medium">ÜRN</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-white font-medium text-sm truncate group-hover:text-amber-400 transition">
                        {product.product_name || "İsimsiz Ürün"}
                      </h3>
                      <div className="text-right shrink-0 sm:hidden">
                        <div className="text-white font-semibold text-sm">
                          {myPrice ? `₺${myPrice.toLocaleString("tr-TR")}` : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
                      <MarketplaceBadge marketplace={product.marketplace} />
                      <span className="text-gray-500">{competitorCount} rakip</span>
                      {stale && (
                        <span className="px-2 py-0.5 rounded-full border border-amber-500/25 bg-amber-500/10 text-amber-300">
                          Veri Eski
                        </span>
                      )}
                      {product.last_scraped_at && (
                        <span className="text-gray-600 hidden sm:inline">
                          · {timeAgo(product.last_scraped_at)}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full border ${pricePositionHint === "Piyasanın altında" ? "border-emerald-500/20 text-emerald-300 bg-emerald-500/10" : pricePositionHint === "Rakipten pahalı" ? "border-red-500/20 text-red-300 bg-red-500/10" : "border-[#323239] text-gray-400 bg-[#1A1A1E]"}`}
                      >
                        {pricePositionHint}
                      </span>
                      {minCompetitorPrice !== null && (
                        <span className="text-gray-500">
                          En düşük rakip: ₺{minCompetitorPrice.toLocaleString("tr-TR")}
                        </span>
                      )}
                      {product.tags?.map((pt) => {
                        const tag = pt.tag;
                        if (!tag) return null;
                        return (
                          <span
                            key={tag.id}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: `${tag.color}15`, color: tag.color }}
                          >
                            {tag.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="text-right shrink-0 hidden sm:block">
                    <div className="text-white font-semibold">
                      {myPrice
                        ? `₺${myPrice.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </div>
                    <div className="mt-1">
                      {product.trend ? (
                        <PriceTrend
                          priceChange={product.trend.priceChange}
                          priceChangePct={product.trend.priceChangePct}
                          size="sm"
                        />
                      ) : (
                        <span className="text-xs text-gray-600">
                          {product.status === "ACTIVE"
                            ? "Aktif"
                            : product.status === "ERROR"
                              ? "Hata"
                              : "Bekliyor"}
                        </span>
                      )}
                    </div>
                  </div>

                  <ProductTagSelector
                    productId={product.id}
                    currentTagIds={
                      product.tags
                        ?.map((pt) => pt.tag?.id)
                        .filter((id): id is string => Boolean(id)) || []
                    }
                    onUpdated={fetchProducts}
                  />

                  <svg
                    className="w-5 h-5 text-gray-600 group-hover:text-amber-500 transition shrink-0 hidden sm:block"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              );
            },
          )}
        </div>
      )}

      {!loading && !error && products.length > 0 && viewMode === "table" && (
        <div className="overflow-x-auto rounded-2xl border border-[#1F1F23] bg-[#111113]">
          <table className="min-w-full text-sm">
            <thead className="bg-[#151519] text-gray-400">
              <tr>
                <th className="text-left font-medium px-4 py-3">Ürün</th>
                <th className="text-left font-medium px-4 py-3">Marketplace</th>
                <th className="text-left font-medium px-4 py-3">Fiyatım</th>
                <th className="text-left font-medium px-4 py-3">Rakip</th>
                <th className="text-left font-medium px-4 py-3">Son Güncelleme</th>
                <th className="text-left font-medium px-4 py-3">Trend / Durum</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 && (
                <tr className="border-t border-[#1F1F23]">
                  <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                    Filtreye uygun ürün yok. Arama veya hızlı filtreleri temizleyin.
                  </td>
                </tr>
              )}
              {filteredProducts.map(({ product, myPrice, competitorCount, stale }) => (
                <tr
                  key={product.id}
                  className="border-t border-[#1F1F23] hover:bg-[#151519] transition"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/products/${product.id}`}
                      className="text-white hover:text-amber-400 transition line-clamp-1"
                    >
                      {product.product_name || "İsimsiz Ürün"}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <MarketplaceBadge marketplace={product.marketplace} />
                  </td>
                  <td className="px-4 py-3 text-white">
                    {myPrice ? `₺${myPrice.toLocaleString("tr-TR")}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{competitorCount}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {product.last_scraped_at ? timeAgo(product.last_scraped_at) : "—"}
                    {stale && <span className="ml-2 text-amber-300 text-xs">(Veri Eski)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {product.trend ? (
                      <PriceTrend
                        priceChange={product.trend.priceChange}
                        priceChangePct={product.trend.priceChangePct}
                        size="sm"
                      />
                    ) : (
                      <span className="text-xs text-gray-500">
                        {product.status === "ACTIVE"
                          ? "Aktif"
                          : product.status === "ERROR"
                            ? "Hata"
                            : "Bekliyor"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <AddProductModal
          url={url}
          onUrlChange={setUrl}
          loading={formLoading}
          error={formError}
          onSubmit={handleAdd}
          onClose={() => {
            if (!formLoading) {
              setShowModal(false);
              setFormError("");
            }
          }}
        />
      )}

      {showBulkModal && (
        <BulkImportModal
          onClose={() => setShowBulkModal(false)}
          onComplete={() => {
            fetchProducts();
          }}
        />
      )}

      {showTagManager && (
        <TagManagerModal onClose={() => setShowTagManager(false)} onUpdated={fetchProducts} />
      )}
    </div>
  );
}
