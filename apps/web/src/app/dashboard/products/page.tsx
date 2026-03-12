"use client";

import { useState } from "react";
import { useProducts } from "@/hooks/useProducts";
import { ProductCard } from "@/components/products/ProductCard";
import { AddProductModal } from "@/components/products/AddProductModal";
import { EmptyState } from "@/components/products/EmptyState";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

export default function ProductsPage() {
  const {
    products,
    pageLoading,
    addLoading,
    addError,
    setAddError,
    addProduct,
    deleteProduct,
    updateCompetitors,
  } = useProducts();

  const [showModal, setShowModal] = useState(false);
  const [url, setUrl] = useState("");
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const productId = await addProduct(url);
    if (productId) {
      setUrl("");
      setShowModal(false);
      setExpandedProduct(productId);
    }
  };

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Urunler</h1>
          <p className="text-dark-500 text-sm">
            Takip ettiginiz urunleri ve rakip fiyatlarini yonetin.
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
          Urun Ekle
        </button>
      </div>

      {products.length > 0 ? (
        <div className="space-y-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              isExpanded={expandedProduct === product.id}
              onToggle={() =>
                setExpandedProduct(expandedProduct === product.id ? null : product.id)
              }
              onDelete={() => deleteProduct(product.id)}
              onCompareResults={(competitors) => updateCompetitors(product.id, competitors)}
            />
          ))}
        </div>
      ) : (
        <EmptyState onAddProduct={() => setShowModal(true)} />
      )}

      {showModal && (
        <AddProductModal
          url={url}
          onUrlChange={setUrl}
          loading={addLoading}
          error={addError}
          onSubmit={handleAdd}
          onClose={() => {
            if (!addLoading) {
              setShowModal(false);
              setAddError("");
            }
          }}
        />
      )}
    </div>
  );
}
