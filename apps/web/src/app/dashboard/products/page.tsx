"use client";

import { useState, useEffect } from "react";

const MARKETPLACE_LABELS: Record<string, { name: string; color: string }> = {
  TRENDYOL: { name: "Trendyol", color: "#F27A1A" },
  HEPSIBURADA: { name: "Hepsiburada", color: "#FF6000" },
  AMAZON_TR: { name: "Amazon TR", color: "#FF9900" },
  N11: { name: "N11", color: "#7B2D8E" },
};

export default function ProductsPage() {
  const [showModal, setShowModal] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/products")
      .then(res => res.json())
      .then(data => {
        if (data.products) setProducts(data.products);
      })
      .catch(console.error);
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productUrl: url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setProducts([data.product, ...products]);
      setUrl("");
      setShowModal(false);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Ürünler</h1>
          <p className="text-dark-500 text-sm">Takip ettiğiniz ürünleri yönetin.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-5 py-2.5 rounded-xl font-semibold text-sm transition"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Ürün Ekle
        </button>
      </div>

      {/* Products Grid */}
      {products.length > 0 ? (
        <div className="grid gap-4">
          {products.map((product) => (
            <div key={product.id} className="bg-dark-900 border border-dark-800 rounded-2xl p-5 flex items-center gap-4 hover:border-dark-700 transition">
              <div className="w-12 h-12 bg-dark-800 rounded-xl flex items-center justify-center text-dark-500">
                📦
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium text-sm truncate">{product.productName || product.product_name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${MARKETPLACE_LABELS[product.marketplace]?.color}20`,
                      color: MARKETPLACE_LABELS[product.marketplace]?.color,
                    }}
                  >
                    {MARKETPLACE_LABELS[product.marketplace]?.name || product.marketplace}
                  </span>
                  <span className="text-dark-600 text-xs">Taranıyor...</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-white font-semibold">
                  {product.currentPrice || product.current_price ? `${product.currentPrice || product.current_price} ₺` : "—"}
                </div>
                <div className="text-dark-600 text-xs">{product.status === "ACTIVE" ? "Aktif" : "Bekliyor"}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-dark-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">📦</span>
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Henüz ürün eklenmedi</h2>
          <p className="text-dark-500 text-sm mb-6">Marketplace ürün linkini yapıştırarak takibe başlayın.</p>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-6 py-3 rounded-xl font-semibold text-sm transition"
          >
            İlk Ürünü Ekle
          </button>
        </div>
      )}

      {/* Add Product Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 w-full max-w-lg relative z-10">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">Ürün Ekle</h2>
              <button onClick={() => setShowModal(false)} className="text-dark-500 hover:text-white transition">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
                {error}
              </div>
            )}

            <form onSubmit={handleAdd}>
              <label className="block text-sm font-medium text-dark-300 mb-2">Ürün URL&apos;si</label>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm mb-2"
                placeholder="https://www.trendyol.com/... veya https://www.hepsiburada.com/..."
                required
              />
              <p className="text-dark-600 text-xs mb-6">Trendyol, Hepsiburada, Amazon TR veya N11 ürün linkini yapıştırın.</p>

              <div className="flex gap-3">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 transition">
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 py-2.5 rounded-xl text-sm font-semibold transition"
                >
                  {loading ? "Ekleniyor..." : "Takibe Al"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
