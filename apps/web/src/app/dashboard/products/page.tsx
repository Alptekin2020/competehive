"use client";

import { useState, useEffect } from "react";

const MARKETPLACE_LABELS: Record<string, { name: string; color: string }> = {
  TRENDYOL: { name: "Trendyol", color: "#F27A1A" },
  HEPSIBURADA: { name: "Hepsiburada", color: "#FF6000" },
  AMAZON_TR: { name: "Amazon TR", color: "#FF9900" },
  N11: { name: "N11", color: "#7B2D8E" },
  CICEKSEPETI: { name: "Çiçeksepeti", color: "#E91E63" },
  PTTAVM: { name: "PTT AVM", color: "#FFD600" },
  AKAKCE: { name: "Akakçe", color: "#00BCD4" },
  CIMRI: { name: "Cimri", color: "#4CAF50" },
  EPEY: { name: "Epey", color: "#2196F3" },
  BOYNER: { name: "Boyner", color: "#1A1A1A" },
  GRATIS: { name: "Gratis", color: "#FF4081" },
  WATSONS: { name: "Watsons", color: "#00A19A" },
  KITAPYURDU: { name: "Kitapyurdu", color: "#FF5722" },
  DECATHLON: { name: "Decathlon", color: "#0082C3" },
  TEKNOSA: { name: "Teknosa", color: "#ED1C24" },
  SEPHORA: { name: "Sephora", color: "#000000" },
  KOCTAS: { name: "Koçtaş", color: "#FF6F00" },
  MEDIAMARKT: { name: "MediaMarkt", color: "#DF0000" },
  VATAN: { name: "Vatan Bilgisayar", color: "#003399" },
  ITOPYA: { name: "İtopya", color: "#00C853" },
  CUSTOM: { name: "Diğer", color: "#9CA3AF" },
};

export default function ProductsPage() {
  const [showModal, setShowModal] = useState(false);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [products, setProducts] = useState<any[]>([]);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  const fetchProducts = () => {
    return fetch("/api/products")
      .then(res => res.json())
      .then(data => {
        if (data.products) setProducts(data.products);
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchProducts().finally(() => setPageLoading(false));
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

      setUrl("");
      setShowModal(false);

      // Re-fetch the full product list to get latest DB data (including scrape trigger updates)
      await fetchProducts();
      setExpandedProduct(data.product.id);

      // Arka planda rakip araması başlat
      fetch("/api/products/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: data.product.id }),
      }).then(res => res.json()).then(compareData => {
        if (compareData.competitors?.length > 0) {
          setProducts(prev => prev.map(p =>
            p.id === data.product.id
              ? { ...p, competitors: compareData.competitors.map((c: any) => ({ marketplace: c.marketplace, competitor_name: c.name, current_price: c.price, competitor_url: c.url })) }
              : p
          ));
        }
      }).catch(console.error);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (productId: string) => {
    try {
      await fetch(`/api/products?id=${productId}`, { method: "DELETE" });
      setProducts(products.filter(p => p.id !== productId));
    } catch (err) {
      console.error("Delete error:", err);
    }
  };

  const getLowestPrice = (product: any) => {
    const prices = [
      product.current_price ? Number(product.current_price) : null,
      ...(product.competitors || []).map((c: any) => c.current_price ? Number(c.current_price) : null)
    ].filter(Boolean) as number[];
    return prices.length > 0 ? Math.min(...prices) : null;
  };

  const getHighestPrice = (product: any) => {
    const prices = [
      product.current_price ? Number(product.current_price) : null,
      ...(product.competitors || []).map((c: any) => c.current_price ? Number(c.current_price) : null)
    ].filter(Boolean) as number[];
    return prices.length > 0 ? Math.max(...prices) : null;
  };

  if (pageLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-hive-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Urunler</h1>
          <p className="text-dark-500 text-sm">Takip ettiginiz urunleri ve rakip fiyatlarini yonetin.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-5 py-2.5 rounded-xl font-semibold text-sm transition"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Urun Ekle
        </button>
      </div>

      {products.length > 0 ? (
        <div className="space-y-4">
          {products.map((product) => {
            const lowest = getLowestPrice(product);
            const highest = getHighestPrice(product);
            const isExpanded = expandedProduct === product.id;
            const competitorCount = product.competitors?.length || 0;
            const myPrice = product.current_price ? Number(product.current_price) : null;
            const isCheapest = myPrice !== null && lowest !== null && myPrice <= lowest;

            return (
              <div key={product.id} className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden">
                <div
                  className="p-5 flex items-center gap-4 cursor-pointer hover:bg-dark-800/30 transition"
                  onClick={() => setExpandedProduct(isExpanded ? null : product.id)}
                >
                  <div className="w-14 h-14 bg-dark-800 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0">
                    {product.product_image ? (
                      <img src={product.product_image} alt="" className="w-full h-full object-cover rounded-xl" />
                    ) : (
                      <span className="text-dark-500 text-xl">📦</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-medium text-sm truncate">{product.product_name}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${(MARKETPLACE_LABELS[product.marketplace]?.color || "#666")}20`,
                          color: MARKETPLACE_LABELS[product.marketplace]?.color || "#999",
                        }}
                      >
                        {MARKETPLACE_LABELS[product.marketplace]?.name || product.marketplace}
                      </span>
                      {competitorCount > 0 && (
                        <span className="text-xs text-dark-500">
                          {competitorCount} rakip bulundu
                        </span>
                      )}
                      {myPrice && !isCheapest && lowest && (
                        <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                          En dusuk: {lowest.toLocaleString("tr-TR")} TL
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <div className={`font-semibold ${isCheapest ? "text-green-400" : "text-white"}`}>
                      {myPrice ? `${myPrice.toLocaleString("tr-TR")} TL` : "\u2014"}
                    </div>
                    <div className="text-dark-600 text-xs">
                      {product.last_scraped_at
                        ? new Date(product.last_scraped_at).toLocaleDateString("tr-TR")
                        : "Taraniyor..."}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <svg className={`w-5 h-5 text-dark-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(product.id); }}
                      className="text-dark-600 hover:text-red-400 transition p-1"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-dark-800 px-5 py-4 bg-dark-950/50">
                    <h4 className="text-sm font-medium text-dark-300 mb-3">
                      Marketplace Fiyat Karsilastirmasi
                    </h4>

                    <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-xl mb-2 border border-hive-500/30">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: `${(MARKETPLACE_LABELS[product.marketplace]?.color || "#666")}20`,
                          color: MARKETPLACE_LABELS[product.marketplace]?.color || "#999",
                        }}
                      >
                        {MARKETPLACE_LABELS[product.marketplace]?.name || product.marketplace}
                      </span>
                      <span className="text-sm text-white flex-1 truncate">{product.product_name}</span>
                      <span className="text-sm font-semibold text-hive-500">
                        {myPrice ? `${myPrice.toLocaleString("tr-TR")} TL` : "\u2014"}
                      </span>
                      <span className="text-xs text-hive-500/60 bg-hive-500/10 px-2 py-0.5 rounded">Senin ununun</span>
                    </div>

                    {product.competitors && product.competitors.length > 0 ? (
                      <div className="space-y-2">
                        {product.competitors
                          .sort((a: any, b: any) => (Number(a.current_price) || 999999) - (Number(b.current_price) || 999999))
                          .map((comp: any, idx: number) => {
                            const compPrice = comp.current_price ? Number(comp.current_price) : null;
                            const diff = myPrice && compPrice ? compPrice - myPrice : null;
                            const isLower = diff !== null && diff < 0;
                            const isHigher = diff !== null && diff > 0;

                            return (
                              <a
                                key={idx}
                                href={comp.competitor_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-3 p-3 bg-dark-900 rounded-xl hover:bg-dark-800 transition"
                              >
                                <span
                                  className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                                  style={{
                                    backgroundColor: `${(MARKETPLACE_LABELS[comp.marketplace]?.color || "#666")}20`,
                                    color: MARKETPLACE_LABELS[comp.marketplace]?.color || "#999",
                                  }}
                                >
                                  {MARKETPLACE_LABELS[comp.marketplace]?.name || comp.marketplace}
                                </span>
                                <span className="text-sm text-dark-300 flex-1 truncate">{comp.competitor_name}</span>
                                <span className={`text-sm font-semibold ${isLower ? "text-green-400" : isHigher ? "text-red-400" : "text-white"}`}>
                                  {compPrice ? `${compPrice.toLocaleString("tr-TR")} TL` : "\u2014"}
                                </span>
                                {diff !== null && (
                                  <span className={`text-xs px-2 py-0.5 rounded ${isLower ? "bg-green-400/10 text-green-400" : "bg-red-400/10 text-red-400"}`}>
                                    {isLower ? "" : "+"}{diff.toLocaleString("tr-TR")} TL
                                  </span>
                                )}
                                <svg className="w-4 h-4 text-dark-600 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              </a>
                            );
                          })}
                      </div>
                    ) : (
                      <div className="text-center py-6">
                        <p className="text-dark-500 text-sm mb-3">
                          Rakipler araniyor veya bulunamadi...
                        </p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            fetch("/api/products/compare", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ productId: product.id }),
                            })
                              .then(res => res.json())
                              .then(compareData => {
                                if (compareData.competitors?.length > 0) {
                                  setProducts(prev =>
                                    prev.map(p =>
                                      p.id === product.id
                                        ? { ...p, competitors: compareData.competitors.map((c: any) => ({ marketplace: c.marketplace, competitor_name: c.name, current_price: c.price, competitor_url: c.url })) }
                                        : p
                                    )
                                  );
                                }
                              })
                              .catch(console.error);
                          }}
                          className="text-xs bg-hive-500/10 text-hive-500 px-4 py-2 rounded-lg hover:bg-hive-500/20 transition"
                        >
                          Diger Marketplace&apos;lerde Ara
                        </button>
                      </div>
                    )}

                    {product.competitors && product.competitors.length > 0 && lowest && highest && (
                      <div className="mt-4 p-3 bg-dark-900 rounded-xl border border-dark-800">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-dark-500">Fiyat araligi:</span>
                          <span className="text-white font-medium">
                            {lowest.toLocaleString("tr-TR")} TL &mdash; {highest.toLocaleString("tr-TR")} TL
                          </span>
                          <span className="text-dark-500">Fark:</span>
                          <span className={`font-medium ${(highest - lowest) > 0 ? "text-hive-500" : "text-white"}`}>
                            {(highest - lowest).toLocaleString("tr-TR")} TL ({((highest - lowest) / lowest * 100).toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-dark-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">📦</span>
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Henuz urun eklenmedi</h2>
          <p className="text-dark-500 text-sm mb-6">Bir marketplace linkini yapistirin &mdash; diger sitelerdeki fiyatlar otomatik bulunacak.</p>
          <button onClick={() => setShowModal(true)} className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-6 py-3 rounded-xl font-semibold text-sm transition">
            Ilk Urunu Ekle
          </button>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !loading && setShowModal(false)} />
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 w-full max-w-lg relative z-10">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">Urun Ekle</h2>
              <button onClick={() => !loading && setShowModal(false)} className="text-dark-500 hover:text-white transition">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
            )}

            <form onSubmit={handleAdd}>
              <label className="block text-sm font-medium text-dark-300 mb-2">Urun URL&apos;si</label>
              <input
                type="url" value={url} onChange={e => setUrl(e.target.value)}
                className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm mb-2"
                placeholder="https://www.trendyol.com/... veya baska marketplace"
                required disabled={loading}
              />
              <p className="text-dark-600 text-xs mb-6">Herhangi bir e-ticaret sitesinin urun linkini yapistirin. Diger marketplace&apos;lerdeki fiyatlar otomatik bulunacak.</p>

              <div className="flex gap-3">
                <button type="button" onClick={() => !loading && setShowModal(false)}
                  className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 transition" disabled={loading}>
                  Iptal
                </button>
                <button type="submit" disabled={loading}
                  className="flex-1 bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 py-2.5 rounded-xl text-sm font-semibold transition">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" /></svg>
                      AI analiz ediyor...
                    </span>
                  ) : "Takibe Al"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
