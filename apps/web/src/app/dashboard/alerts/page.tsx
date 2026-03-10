"use client";

import { useState, useEffect } from "react";

const RULE_TYPE_LABELS: Record<string, string> = {
  PRICE_DROP: "Fiyat Düşüşü",
  PRICE_INCREASE: "Fiyat Artışı",
  PRICE_THRESHOLD: "Fiyat Eşiği",
  PERCENTAGE_CHANGE: "Yüzde Değişim",
  COMPETITOR_CHEAPER: "Rakip Daha Ucuz",
  OUT_OF_STOCK: "Stoktan Çıkış",
  BACK_IN_STOCK: "Stoğa Giriş",
};

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: "E-posta",
  TELEGRAM: "Telegram",
  WEBHOOK: "Webhook",
};

interface AlertRule {
  id: string;
  ruleType: string;
  rule_type?: string;
  thresholdValue: number | null;
  threshold_value?: number | null;
  direction: string | null;
  notifyVia: string[];
  notify_via?: string[];
  isActive: boolean;
  is_active?: boolean;
  cooldownMinutes: number;
  cooldown_minutes?: number;
  trackedProductId: string | null;
  tracked_product_id?: string | null;
  trackedProduct?: { productName: string; marketplace: string; currentPrice: number | null };
  product_name?: string;
  marketplace?: string;
  createdAt: string;
  created_at?: string;
}

interface Product {
  id: string;
  product_name: string;
  marketplace: string;
  current_price: number | null;
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [selectedProduct, setSelectedProduct] = useState("");
  const [ruleType, setRuleType] = useState("PRICE_DROP");
  const [thresholdValue, setThresholdValue] = useState("");
  const [direction, setDirection] = useState("below");
  const [notifyVia, setNotifyVia] = useState<string[]>(["EMAIL"]);
  const [cooldownMinutes, setCooldownMinutes] = useState("60");

  const fetchRules = async () => {
    try {
      const res = await fetch("/api/alerts");
      const data = await res.json();
      if (data.rules) setRules(data.rules);
    } catch (err) {
      console.error("Fetch alerts error:", err);
    }
  };

  const fetchProducts = async () => {
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      if (data.products) setProducts(data.products);
    } catch (err) {
      console.error("Fetch products error:", err);
    }
  };

  useEffect(() => {
    Promise.all([fetchRules(), fetchProducts()]).finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    try {
      const body: any = {
        trackedProductId: selectedProduct || undefined,
        ruleType,
        notifyVia,
        cooldownMinutes: parseInt(cooldownMinutes) || 60,
      };

      if (ruleType === "PRICE_THRESHOLD" || ruleType === "PERCENTAGE_CHANGE") {
        body.thresholdValue = parseFloat(thresholdValue);
        if (isNaN(body.thresholdValue)) {
          setError("Eşik değeri geçerli bir sayı olmalıdır.");
          setSaving(false);
          return;
        }
      }

      if (ruleType === "PRICE_THRESHOLD") {
        body.direction = direction;
      }

      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setShowModal(false);
      resetForm();
      await fetchRules();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await fetch(`/api/alerts?id=${ruleId}`, { method: "DELETE" });
      setRules(rules.filter(r => r.id !== ruleId));
    } catch (err) {
      console.error("Delete alert error:", err);
    }
  };

  const toggleChannel = (channel: string) => {
    setNotifyVia(prev =>
      prev.includes(channel)
        ? prev.filter(c => c !== channel)
        : [...prev, channel]
    );
  };

  const resetForm = () => {
    setSelectedProduct("");
    setRuleType("PRICE_DROP");
    setThresholdValue("");
    setDirection("below");
    setNotifyVia(["EMAIL"]);
    setCooldownMinutes("60");
    setError("");
  };

  const needsThreshold = ruleType === "PRICE_THRESHOLD" || ruleType === "PERCENTAGE_CHANGE";

  if (loading) {
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
          <h1 className="text-2xl font-bold text-white mb-1">Uyarılar</h1>
          <p className="text-dark-500 text-sm">Fiyat değişikliği uyarı kurallarınızı yönetin.</p>
        </div>
        {products.length > 0 && (
          <button
            onClick={() => { resetForm(); setShowModal(true); }}
            className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-5 py-2.5 rounded-xl font-semibold text-sm transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Uyarı Ekle
          </button>
        )}
      </div>

      {rules.length > 0 ? (
        <div className="space-y-3">
          {rules.map((rule) => {
            const rt = rule.ruleType || rule.rule_type || "";
            const channels = rule.notifyVia || rule.notify_via || [];
            const active = rule.isActive ?? rule.is_active ?? true;
            const productName = rule.trackedProduct?.productName || rule.product_name || "Tüm ürünler";
            const tv = rule.thresholdValue ?? rule.threshold_value;

            return (
              <div key={rule.id} className="bg-dark-900 border border-dark-800 rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${active ? "bg-hive-500/10" : "bg-dark-800"}`}>
                      <svg className={`w-5 h-5 ${active ? "text-hive-500" : "text-dark-500"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-white font-medium text-sm">{RULE_TYPE_LABELS[rt] || rt}</h3>
                        {!active && (
                          <span className="text-xs bg-dark-800 text-dark-500 px-2 py-0.5 rounded-full">Pasif</span>
                        )}
                      </div>
                      <p className="text-dark-500 text-xs mt-0.5 truncate">{productName}</p>
                      {tv != null && (
                        <p className="text-dark-500 text-xs">
                          Eşik: {Number(tv)}{ruleType === "PERCENTAGE_CHANGE" ? "%" : " TL"}
                          {rule.direction ? ` (${rule.direction === "above" ? "üstünde" : "altında"})` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex gap-1">
                      {channels.map((ch: string) => (
                        <span key={ch} className="text-xs bg-dark-800 text-dark-400 px-2 py-0.5 rounded">
                          {CHANNEL_LABELS[ch] || ch}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-dark-600 hover:text-red-400 transition p-1"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-dark-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">🔔</span>
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Henüz uyarı kuralı yok</h2>
          <p className="text-dark-500 text-sm mb-6 max-w-md mx-auto">
            {products.length === 0
              ? "Önce bir ürün takibe alın, sonra o ürün için fiyat değişikliği uyarısı oluşturun."
              : "Takip ettiğiniz ürünler için fiyat değişikliği uyarısı oluşturun."}
          </p>
          {products.length > 0 && (
            <button
              onClick={() => { resetForm(); setShowModal(true); }}
              className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-6 py-3 rounded-xl font-semibold text-sm transition"
            >
              İlk Uyarıyı Oluştur
            </button>
          )}
        </div>
      )}

      {/* Create Alert Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => !saving && setShowModal(false)} />
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 w-full max-w-lg relative z-10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-white">Uyarı Kuralı Oluştur</h2>
              <button onClick={() => !saving && setShowModal(false)} className="text-dark-500 hover:text-white transition">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              {/* Ürün Seçimi */}
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Ürün</label>
                <select
                  value={selectedProduct}
                  onChange={e => setSelectedProduct(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-hive-500/50 transition text-sm appearance-none"
                  required
                >
                  <option value="">Ürün seçin...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.product_name}</option>
                  ))}
                </select>
              </div>

              {/* Kural Tipi */}
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Uyarı Tipi</label>
                <select
                  value={ruleType}
                  onChange={e => setRuleType(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-hive-500/50 transition text-sm appearance-none"
                >
                  {Object.entries(RULE_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Eşik Değeri */}
              {needsThreshold && (
                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-2">
                    Eşik Değeri {ruleType === "PERCENTAGE_CHANGE" ? "(%)" : "(TL)"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={thresholdValue}
                    onChange={e => setThresholdValue(e.target.value)}
                    className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
                    placeholder={ruleType === "PERCENTAGE_CHANGE" ? "Ör: 10" : "Ör: 500"}
                    required
                  />
                </div>
              )}

              {/* Yön */}
              {ruleType === "PRICE_THRESHOLD" && (
                <div>
                  <label className="block text-sm font-medium text-dark-300 mb-2">Yön</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setDirection("below")}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition ${direction === "below" ? "bg-hive-500/10 text-hive-500 border border-hive-500/30" : "bg-dark-950 text-dark-400 border border-dark-800"}`}
                    >
                      Altına Düştüğünde
                    </button>
                    <button
                      type="button"
                      onClick={() => setDirection("above")}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition ${direction === "above" ? "bg-hive-500/10 text-hive-500 border border-hive-500/30" : "bg-dark-950 text-dark-400 border border-dark-800"}`}
                    >
                      Üstüne Çıktığında
                    </button>
                  </div>
                </div>
              )}

              {/* Bildirim Kanalları */}
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Bildirim Kanalları</label>
                <div className="flex gap-2">
                  {(["EMAIL", "TELEGRAM", "WEBHOOK"] as const).map(ch => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => toggleChannel(ch)}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition ${notifyVia.includes(ch) ? "bg-hive-500/10 text-hive-500 border border-hive-500/30" : "bg-dark-950 text-dark-400 border border-dark-800"}`}
                    >
                      {CHANNEL_LABELS[ch]}
                    </button>
                  ))}
                </div>
                {notifyVia.length === 0 && (
                  <p className="text-red-400 text-xs mt-1">En az bir kanal seçin</p>
                )}
              </div>

              {/* Cooldown */}
              <div>
                <label className="block text-sm font-medium text-dark-300 mb-2">Bekleme Süresi (dakika)</label>
                <input
                  type="number"
                  min="5"
                  max="1440"
                  value={cooldownMinutes}
                  onChange={e => setCooldownMinutes(e.target.value)}
                  className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
                  placeholder="60"
                />
                <p className="text-dark-600 text-xs mt-1">Aynı uyarının tekrar tetiklenmesi için minimum bekleme süresi</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => !saving && setShowModal(false)}
                  className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 transition"
                  disabled={saving}
                >
                  İptal
                </button>
                <button
                  type="submit"
                  disabled={saving || notifyVia.length === 0}
                  className="flex-1 bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 py-2.5 rounded-xl text-sm font-semibold transition"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="30 70" /></svg>
                      Kaydediliyor...
                    </span>
                  ) : "Oluştur"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
