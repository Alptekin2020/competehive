"use client";

import { useState, useEffect, useCallback } from "react";
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
      setUrl("");
      setShowModal(false);

      // Background compare search
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
      setFormError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setFormLoading(false);
    }
  };

  const _handleDelete = async (productId: string) => {
    try {
      await fetch(`/api/products?id=${productId}`, { method: "DELETE" });
      setProducts((prev) => prev.filter((p) => p.id !== productId));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Ürünler</h1>
          <p className="text-dark-500 text-sm">
            Takip ettiğiniz ürünleri ve rakip fiyatlarını yönetin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Bulk Import Button */}
          <button
            onClick={() => setShowBulkModal(true)}
            className="inline-flex items-center gap-2 border border-[#1F1F23] hover:border-amber-500/30 text-gray-400 hover:text-white px-4 py-2.5 rounded-xl font-medium text-sm transition"
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
            Toplu Ekle
          </button>

          {/* Single Add Button */}
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-5 py-2.5 rounded-xl font-semibold text-sm transition"
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
            Ürün Ekle
          </button>
        </div>
      </div>

      {/* Tag Filter Bar */}
      <TagFilterBar
        selectedTagId={selectedTagId}
        onSelectTag={setSelectedTagId}
        onManageTags={() => setShowTagManager(true)}
      />

      {/* Loading State */}
      {loading && (
        <div className="grid gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <ErrorState title="Ürünler yüklenemedi" message={error} onRetry={fetchProducts} />
      )}

      {/* Empty State */}
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

      {/* Product List */}
      {!loading && !error && products.length > 0 && (
        <div className="grid gap-4">
          {products
            .filter((p) =>
              selectedTagId ? p.tags?.some((pt) => pt.tag?.id === selectedTagId) : true,
            )
            .map((product) => {
              const myPrice = product.current_price ? Number(product.current_price) : null;
              const competitorCount = product.competitorCount ?? product.competitors?.length ?? 0;

              return (
                <Link
                  key={product.id}
                  href={`/dashboard/products/${product.id}`}
                  className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-5 flex items-center gap-4 hover:border-amber-500/20 transition group"
                >
                  <div className="w-12 h-12 bg-[#1F1F23] rounded-xl flex items-center justify-center overflow-hidden shrink-0">
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
                      <span className="text-gray-500 text-lg">📦</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-medium text-sm truncate group-hover:text-amber-400 transition">
                      {product.product_name || "İsimsiz Ürün"}
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <MarketplaceBadge marketplace={product.marketplace} />
                      {competitorCount > 0 && (
                        <span className="text-xs text-gray-600">{competitorCount} rakip</span>
                      )}
                      {product.last_scraped_at && (
                        <span className="text-xs text-gray-600">
                          · {timeAgo(product.last_scraped_at)}
                        </span>
                      )}
                      {product.tags?.map((pt) => {
                        const tag = pt.tag;
                        if (!tag) return null;
                        return (
                          <span
                            key={tag.id}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: `${tag.color}15`,
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
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
                    className="w-5 h-5 text-gray-600 group-hover:text-amber-500 transition shrink-0"
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
            })}
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
