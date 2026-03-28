"use client";

import { useState, useEffect, useCallback } from "react";
import { CardSkeleton } from "@/components/Skeleton";
import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";

// ============================================
// Types & Constants
// ============================================

interface AlertRule {
  id: string;
  trackedProductId: string | null;
  ruleType: string;
  thresholdValue: number | null;
  direction: string | null;
  notifyVia: string[];
  isActive: boolean;
  lastTriggered: string | null;
  cooldownMinutes: number;
  createdAt: string;
  trackedProduct?: {
    productName: string;
    marketplace: string;
    currentPrice: number | null;
  } | null;
}

interface Product {
  id: string;
  product_name: string;
  marketplace: string;
  current_price: number | null;
}

const RULE_TYPE_LABELS: Record<
  string,
  {
    label: string;
    description: string;
    icon: string;
    needsThreshold: boolean;
    needsDirection: boolean;
  }
> = {
  PRICE_DROP: {
    label: "Fiyat Düşüşü",
    description: "Fiyat düştüğünde bildirim al",
    icon: "📉",
    needsThreshold: false,
    needsDirection: false,
  },
  PRICE_INCREASE: {
    label: "Fiyat Artışı",
    description: "Fiyat arttığında bildirim al",
    icon: "📈",
    needsThreshold: false,
    needsDirection: false,
  },
  PRICE_THRESHOLD: {
    label: "Fiyat Eşiği",
    description: "Belirli bir fiyatın altına veya üstüne geçtiğinde",
    icon: "🎯",
    needsThreshold: true,
    needsDirection: true,
  },
  PERCENTAGE_CHANGE: {
    label: "Yüzde Değişim",
    description: "Belirli bir yüzde değişim olduğunda",
    icon: "📊",
    needsThreshold: true,
    needsDirection: false,
  },
  COMPETITOR_CHEAPER: {
    label: "Rakip Daha Ucuz",
    description: "Bir rakip daha ucuz fiyat sunduğunda",
    icon: "⚡",
    needsThreshold: false,
    needsDirection: false,
  },
  OUT_OF_STOCK: {
    label: "Stoktan Çıktı",
    description: "Ürün stoktan çıktığında",
    icon: "🚫",
    needsThreshold: false,
    needsDirection: false,
  },
  BACK_IN_STOCK: {
    label: "Stoğa Girdi",
    description: "Ürün tekrar stoğa girdiğinde",
    icon: "✅",
    needsThreshold: false,
    needsDirection: false,
  },
};

const CHANNEL_LABELS: Record<string, { label: string; icon: string }> = {
  EMAIL: { label: "E-posta", icon: "📧" },
  TELEGRAM: { label: "Telegram", icon: "💬" },
  WEBHOOK: { label: "Webhook", icon: "🔗" },
};

const MARKETPLACE_LABELS: Record<string, { name: string; color: string }> = {
  TRENDYOL: { name: "Trendyol", color: "#F27A1A" },
  HEPSIBURADA: { name: "Hepsiburada", color: "#FF6000" },
  AMAZON_TR: { name: "Amazon TR", color: "#FF9900" },
  N11: { name: "N11", color: "#7B2D8E" },
};

// ============================================
// Main Component
// ============================================

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ---- Fetch Rules ----
  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/alerts");
      if (!res.ok) throw new Error("Uyarı kuralları yüklenemedi");
      const data = await res.json();
      setRules(data.rules || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }, []);

  // ---- Fetch Products (for create modal) ----
  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch {
      // silently fail — products dropdown will be empty
    }
  }, []);

  useEffect(() => {
    fetchRules();
    fetchProducts();
  }, [fetchRules, fetchProducts]);

  // ---- Toggle Rule ----
  const handleToggle = async (ruleId: string) => {
    setTogglingId(ruleId);
    try {
      const res = await fetch(`/api/alerts/${ruleId}/toggle`, { method: "PATCH" });
      if (res.ok) {
        setRules((prev) =>
          prev.map((r) => (r.id === ruleId ? { ...r, isActive: !r.isActive } : r)),
        );
      }
    } catch {
      // silently fail
    } finally {
      setTogglingId(null);
    }
  };

  // ---- Delete Rule ----
  const handleDelete = async (ruleId: string) => {
    try {
      const res = await fetch(`/api/alerts?id=${ruleId}`, { method: "DELETE" });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
      }
    } catch {
      // silently fail
    } finally {
      setDeleteConfirmId(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Uyarılar</h1>
          <p className="text-dark-500 text-sm">Fiyat değişikliği uyarı kurallarınızı yönetin.</p>
        </div>
        {rules.length > 0 && (
          <button
            onClick={() => setShowCreateModal(true)}
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
            Yeni Uyarı
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <ErrorState title="Uyarılar yüklenemedi" message={error} onRetry={fetchRules} />
      )}

      {/* Empty State */}
      {!loading && !error && rules.length === 0 && (
        <EmptyState
          icon={
            <svg
              className="w-8 h-8 text-hive-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
          }
          title="Henüz uyarı kuralı yok"
          description="Ürünleriniz için fiyat değişikliği uyarıları oluşturun. Fiyat düşüşü, artışı veya belirli bir eşik değerine ulaştığında bildirim alın."
          actionLabel="İlk Uyarıyı Oluştur"
          onAction={() => setShowCreateModal(true)}
        />
      )}

      {/* Rules List */}
      {!loading && !error && rules.length > 0 && (
        <div className="space-y-3">
          {rules.map((rule) => {
            const ruleConfig = RULE_TYPE_LABELS[rule.ruleType];
            const marketplace = rule.trackedProduct?.marketplace
              ? MARKETPLACE_LABELS[rule.trackedProduct.marketplace]
              : null;

            return (
              <div
                key={rule.id}
                className={`bg-dark-900 border border-dark-800 rounded-2xl p-5 transition ${
                  rule.isActive ? "" : "opacity-50"
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className="w-10 h-10 bg-hive-500/10 rounded-xl flex items-center justify-center text-lg shrink-0">
                    {ruleConfig?.icon || "🔔"}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-medium text-sm">
                        {ruleConfig?.label || rule.ruleType}
                      </h3>
                      {!rule.isActive && (
                        <span className="text-xs text-dark-500 bg-dark-800 px-2 py-0.5 rounded-full">
                          Devre dışı
                        </span>
                      )}
                    </div>

                    {/* Product info */}
                    <p className="text-dark-500 text-sm truncate">
                      {rule.trackedProduct?.productName || "Tüm ürünler"}
                      {marketplace && (
                        <span
                          className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `${marketplace.color}20`,
                            color: marketplace.color,
                          }}
                        >
                          {marketplace.name}
                        </span>
                      )}
                    </p>

                    {/* Rule details */}
                    <div className="flex items-center gap-3 mt-2 text-xs text-dark-600">
                      {/* Threshold */}
                      {rule.thresholdValue != null && (
                        <span>
                          {rule.ruleType === "PERCENTAGE_CHANGE"
                            ? `%${rule.thresholdValue}`
                            : `${rule.direction === "below" ? "↓" : "↑"} ₺${Number(rule.thresholdValue).toLocaleString("tr-TR")}`}
                        </span>
                      )}

                      {/* Channels */}
                      <span className="flex items-center gap-1">
                        {rule.notifyVia.map((ch) => (
                          <span key={ch} title={CHANNEL_LABELS[ch]?.label}>
                            {CHANNEL_LABELS[ch]?.icon || "📨"}
                          </span>
                        ))}
                      </span>

                      {/* Cooldown */}
                      <span>{rule.cooldownMinutes} dk bekleme</span>

                      {/* Last triggered */}
                      {rule.lastTriggered && (
                        <span>Son: {new Date(rule.lastTriggered).toLocaleDateString("tr-TR")}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Toggle */}
                    <button
                      onClick={() => handleToggle(rule.id)}
                      disabled={togglingId === rule.id}
                      className="relative w-11 h-6 rounded-full transition-colors"
                      style={{
                        backgroundColor: rule.isActive
                          ? "var(--color-hive-500, #F59E0B)"
                          : "var(--color-dark-800, #1F1F23)",
                      }}
                      title={rule.isActive ? "Devre dışı bırak" : "Etkinleştir"}
                    >
                      <span
                        className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform"
                        style={{
                          transform: rule.isActive ? "translateX(20px)" : "translateX(0)",
                        }}
                      />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => setDeleteConfirmId(rule.id)}
                      className="p-2 text-dark-600 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                      title="Sil"
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
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteConfirmId(null)}
          />
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 w-full max-w-sm relative z-10">
            <h2 className="text-lg font-bold text-white mb-2">Uyarıyı Sil</h2>
            <p className="text-dark-500 text-sm mb-6">
              Bu uyarı kuralını silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 transition"
              >
                İptal
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2.5 rounded-xl text-sm font-semibold transition"
              >
                Sil
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Alert Modal */}
      {showCreateModal && (
        <CreateAlertModal
          products={products}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            fetchRules();
          }}
        />
      )}
    </div>
  );
}

// ============================================
// Create Alert Modal Component
// ============================================

function CreateAlertModal({
  products,
  onClose,
  onCreated,
}: {
  products: Product[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [selectedProduct, setSelectedProduct] = useState("");
  const [ruleType, setRuleType] = useState("PRICE_DROP");
  const [thresholdValue, setThresholdValue] = useState("");
  const [direction, setDirection] = useState("below");
  const [notifyVia, setNotifyVia] = useState<string[]>(["EMAIL"]);
  const [cooldownMinutes, setCooldownMinutes] = useState("60");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const ruleConfig = RULE_TYPE_LABELS[ruleType];

  const toggleChannel = (channel: string) => {
    setNotifyVia((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!selectedProduct) {
      setError("Lütfen bir ürün seçin");
      return;
    }

    if (notifyVia.length === 0) {
      setError("En az bir bildirim kanalı seçin");
      return;
    }

    if (ruleConfig.needsThreshold && !thresholdValue) {
      setError("Lütfen eşik değeri girin");
      return;
    }

    setSubmitting(true);

    try {
      const body: Record<string, unknown> = {
        trackedProductId: selectedProduct,
        ruleType,
        notifyVia,
        cooldownMinutes: parseInt(cooldownMinutes) || 60,
      };

      if (ruleConfig.needsThreshold) {
        body.thresholdValue = parseFloat(thresholdValue);
      }

      if (ruleConfig.needsDirection) {
        body.direction = direction;
      }

      const res = await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Uyarı oluşturulamadı");

      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 w-full max-w-lg relative z-10 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Yeni Uyarı Kuralı</h2>
          <button onClick={onClose} className="text-dark-500 hover:text-white transition">
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Product Select */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">Ürün</label>
            {products.length === 0 ? (
              <p className="text-dark-500 text-sm">Önce bir ürün takibe alın.</p>
            ) : (
              <select
                value={selectedProduct}
                onChange={(e) => setSelectedProduct(e.target.value)}
                className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-hive-500/50 transition appearance-none"
              >
                <option value="">Ürün seçin...</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.product_name} ({MARKETPLACE_LABELS[p.marketplace]?.name || p.marketplace})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Rule Type */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">Uyarı Türü</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(RULE_TYPE_LABELS).map(([key, config]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRuleType(key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-left transition border ${
                    ruleType === key
                      ? "border-hive-500/50 bg-hive-500/10 text-white"
                      : "border-dark-800 text-dark-400 hover:border-dark-700 hover:text-white"
                  }`}
                >
                  <span>{config.icon}</span>
                  <span className="font-medium">{config.label}</span>
                </button>
              ))}
            </div>
            <p className="text-dark-600 text-xs mt-2">{ruleConfig.description}</p>
          </div>

          {/* Threshold (conditional) */}
          {ruleConfig.needsThreshold && (
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">
                {ruleType === "PERCENTAGE_CHANGE" ? "Yüzde Değer (%)" : "Fiyat Eşiği (₺)"}
              </label>
              <input
                type="number"
                step={ruleType === "PERCENTAGE_CHANGE" ? "1" : "0.01"}
                min="0"
                value={thresholdValue}
                onChange={(e) => setThresholdValue(e.target.value)}
                className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white text-sm placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition"
                placeholder={ruleType === "PERCENTAGE_CHANGE" ? "Örn: 5" : "Örn: 500"}
              />
            </div>
          )}

          {/* Direction (conditional) */}
          {ruleConfig.needsDirection && (
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">Yön</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDirection("below")}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${
                    direction === "below"
                      ? "border-hive-500/50 bg-hive-500/10 text-white"
                      : "border-dark-800 text-dark-400 hover:text-white"
                  }`}
                >
                  ↓ Altına düştüğünde
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("above")}
                  className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${
                    direction === "above"
                      ? "border-hive-500/50 bg-hive-500/10 text-white"
                      : "border-dark-800 text-dark-400 hover:text-white"
                  }`}
                >
                  ↑ Üstüne çıktığında
                </button>
              </div>
            </div>
          )}

          {/* Notification Channels */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">
              Bildirim Kanalları
            </label>
            <div className="flex gap-2">
              {Object.entries(CHANNEL_LABELS).map(([key, config]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleChannel(key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${
                    notifyVia.includes(key)
                      ? "border-hive-500/50 bg-hive-500/10 text-white"
                      : "border-dark-800 text-dark-400 hover:text-white"
                  }`}
                >
                  <span>{config.icon}</span>
                  {config.label}
                </button>
              ))}
            </div>
          </div>

          {/* Cooldown */}
          <div>
            <label className="block text-sm font-medium text-dark-300 mb-2">Bekleme Süresi</label>
            <select
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(e.target.value)}
              className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-hive-500/50 transition appearance-none"
            >
              <option value="15">15 dakika</option>
              <option value="30">30 dakika</option>
              <option value="60">1 saat</option>
              <option value="120">2 saat</option>
              <option value="360">6 saat</option>
              <option value="720">12 saat</option>
              <option value="1440">24 saat</option>
            </select>
            <p className="text-dark-600 text-xs mt-1">
              Aynı kural tekrar tetiklenmeden önce beklenecek süre.
            </p>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 transition"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={submitting || products.length === 0}
              className="flex-1 bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              {submitting ? "Oluşturuluyor..." : "Uyarı Oluştur"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
