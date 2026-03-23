"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CardSkeleton } from "@/components/Skeleton";
import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";
import { AddProductModal } from "@/components/products/AddProductModal";
import { MarketplaceBadge } from "@/components/ui/MarketplaceBadge";

interface CompetitorItem {
  id?: string;
  marketplace: string;
  competitor_name: string | null;
  current_price: string | null;
  competitor_url: string;
}

interface ProductItem {
  id: string;
  product_name: string;
  marketplace: string;
  product_url: string;
  product_image: string | null;
  current_price: string | null;
  last_scraped_at: string | null;
  competitors?: CompetitorItem[];
}

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [url, setUrl] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

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
                p.id === data.product.id
                  ? { ...p, competitors: compareData.competitors }
                  : p,
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

  const handleDelete = async (productId: string) => {
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
        <EmptyState
          title="Henüz ürün eklenmedi"
          description="Marketplace ürün linkini yapıştırarak rakip fiyatlarını takip etmeye başlayın."
          actionLabel="İlk Ürünü Ekle"
          onAction={() => setShowModal(true)}
        />
      )}

      {/* Product List */}
      {!loading && !error && products.length > 0 && (
        <div className="grid gap-4">
          {products.map((product) => {
            const myPrice = product.current_price ? Number(product.current_price) : null;
            const competitorCount = product.competitors?.length || 0;

            return (
              <Link
                key={product.id}
                href={`/dashboard/products/${product.id}`}
                className="bg-dark-900 border border-dark-800 rounded-2xl p-5 flex items-center gap-4 hover:border-amber-500/20 transition group"
              >
                <div className="w-14 h-14 bg-dark-800 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0">
                  {product.product_image ? (
                    <img
                      src={product.product_image}
                      alt=""
                      className="w-full h-full object-cover rounded-xl"
                    />
                  ) : (
                    <span className="text-dark-500 text-xl">📦</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-medium text-sm truncate">
                    {product.product_name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <MarketplaceBadge marketplace={product.marketplace} />
                    {competitorCount > 0 && (
                      <span className="text-xs text-dark-500">
                        {competitorCount} rakip bulundu
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="font-semibold text-white">
                    {myPrice ? `${myPrice.toLocaleString("tr-TR")} TL` : "\u2014"}
                  </div>
                  <div className="text-dark-600 text-xs">
                    {product.last_scraped_at
                      ? new Date(product.last_scraped_at).toLocaleDateString("tr-TR")
                      : "Taranıyor..."}
                  </div>
                </div>

                <svg
                  className="w-5 h-5 text-gray-600 group-hover:text-amber-500 transition flex-shrink-0"
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
    </div>
  );
}
