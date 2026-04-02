"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { CardSkeleton } from "@/components/Skeleton";
import ErrorState from "@/components/ErrorState";
import EmptyState from "@/components/EmptyState";

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
    recommended: string;
  }
> = {
  PRICE_DROP: {
    label: "Fiyat Düşüşü",
    description: "Fiyat düştüğünde bildirim al",
    icon: "📉",
    needsThreshold: false,
    needsDirection: false,
    recommended: "Öneri: 60 dk bekleme ile gereksiz tekrarları azaltın.",
  },
  PRICE_INCREASE: {
    label: "Fiyat Artışı",
    description: "Fiyat arttığında bildirim al",
    icon: "📈",
    needsThreshold: false,
    needsDirection: false,
    recommended: "Öneri: Operasyon ekipleri için 30-60 dk bekleme idealdir.",
  },
  PRICE_THRESHOLD: {
    label: "Fiyat Eşiği",
    description: "Belirli bir fiyatın altına veya üstüne geçtiğinde",
    icon: "🎯",
    needsThreshold: true,
    needsDirection: true,
    recommended: "Öneri: Hedef kâr marjınıza göre eşik belirleyin.",
  },
  PERCENTAGE_CHANGE: {
    label: "Yüzde Değişim",
    description: "Belirli bir yüzde değişim olduğunda",
    icon: "📊",
    needsThreshold: true,
    needsDirection: false,
    recommended: "Öneri: %5 iyi bir başlangıç hassasiyetidir.",
  },
  COMPETITOR_CHEAPER: {
    label: "Rakip Daha Ucuz",
    description: "Bir rakip daha ucuz fiyat sunduğunda",
    icon: "⚡",
    needsThreshold: false,
    needsDirection: false,
    recommended: "Öneri: Bu kuralı hızlı kanal (Telegram) ile kullanın.",
  },
  OUT_OF_STOCK: {
    label: "Stoktan Çıktı",
    description: "Ürün stoktan çıktığında",
    icon: "🚫",
    needsThreshold: false,
    needsDirection: false,
    recommended: "Öneri: 120+ dk bekleme stok dalgalanma gürültüsünü azaltır.",
  },
  BACK_IN_STOCK: {
    label: "Stoğa Girdi",
    description: "Ürün tekrar stoğa girdiğinde",
    icon: "✅",
    needsThreshold: false,
    needsDirection: false,
    recommended: "Öneri: Stoğa dönüşte hızlı aksiyon için düşük bekleme kullanın.",
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
  TEKNOSA: { name: "Teknosa", color: "#005CA9" },
  VATAN: { name: "Vatan", color: "#E30613" },
  DECATHLON: { name: "Decathlon", color: "#0082C3" },
  MEDIAMARKT: { name: "MediaMarkt", color: "#DF0000" },
};

type AlertFilter = "all" | "active" | "inactive" | "recent";

interface PlanFeaturesData {
  plan: string;
  features: {
    maxAlertRules: number;
    allowedChannels: string[];
    [key: string]: unknown;
  };
  usage: {
    alertRules: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface AlertModalPrefill {
  ruleType: string;
  direction?: string;
  thresholdValue?: string;
  cooldownMinutes?: string;
}

const QUICK_CREATE_SUGGESTIONS: Array<{
  title: string;
  description: string;
  prefill: AlertModalPrefill;
}> = [
  {
    title: "Rakip benden ucuzsa bildir",
    description: "Fiyat yarışını kaçırmamak için ideal.",
    prefill: { ruleType: "COMPETITOR_CHEAPER", cooldownMinutes: "30" },
  },
  {
    title: "%5 fiyat düşüşünde bildir",
    description: "Ani indirimleri hızlı fark edin.",
    prefill: { ruleType: "PERCENTAGE_CHANGE", thresholdValue: "5", cooldownMinutes: "60" },
  },
  {
    title: "Stoğa girince bildir",
    description: "Stok dönüşlerini kaçırmayın.",
    prefill: { ruleType: "BACK_IN_STOCK", cooldownMinutes: "15" },
  },
  {
    title: "Fiyat ₺500 altına düşünce bildir",
    description: "Hedef fiyatı yakaladığında aksiyon alın.",
    prefill: {
      ruleType: "PRICE_THRESHOLD",
      direction: "below",
      thresholdValue: "500",
      cooldownMinutes: "60",
    },
  },
];

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [planFeatures, setPlanFeatures] = useState<PlanFeaturesData | null>(null);
  const [activeFilter, setActiveFilter] = useState<AlertFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [modalPrefill, setModalPrefill] = useState<AlertModalPrefill | null>(null);
  const [showFirstAlertSuccess, setShowFirstAlertSuccess] = useState(false);

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

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/products");
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    fetchRules();
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
  }, [fetchRules, fetchProducts]);

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

  const filteredRules = useMemo(() => {
    const text = searchTerm.trim().toLocaleLowerCase("tr-TR");
    const sorted = [...rules].sort((a, b) => {
      const aTime = a.lastTriggered ? new Date(a.lastTriggered).getTime() : 0;
      const bTime = b.lastTriggered ? new Date(b.lastTriggered).getTime() : 0;
      return bTime - aTime;
    });

    return sorted.filter((rule) => {
      if (activeFilter === "active" && !rule.isActive) return false;
      if (activeFilter === "inactive" && rule.isActive) return false;
      if (activeFilter === "recent" && !rule.lastTriggered) return false;

      if (!text) return true;
      const haystack = [
        RULE_TYPE_LABELS[rule.ruleType]?.label,
        rule.trackedProduct?.productName,
        MARKETPLACE_LABELS[rule.trackedProduct?.marketplace || ""]?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("tr-TR");

      return haystack.includes(text);
    });
  }, [rules, activeFilter, searchTerm]);

  const openCreateModal = (prefill?: AlertModalPrefill) => {
    setModalPrefill(prefill ?? null);
    setShowCreateModal(true);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-0.5 sm:mb-1">Uyarılar</h1>
          <p className="text-dark-500 text-xs sm:text-sm">
            Daha az gürültü, daha net aksiyon için uyarılarınızı optimize edin.
          </p>
        </div>
        <button
          onClick={() => openCreateModal()}
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
      </div>

      {!loading && !error && (
        <div className="mb-5 sm:mb-7 space-y-4">
          {showFirstAlertSuccess && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
              <div>
                <p className="text-sm text-emerald-300 font-medium">İlk uyarınız aktif.</p>
                <p className="text-xs text-emerald-100/80 mt-0.5">
                  Şimdi bildirimler sayfasından akışı izleyerek eşik ve bekleme süresini optimize
                  edebilirsiniz.
                </p>
              </div>
              <button
                onClick={() => setShowFirstAlertSuccess(false)}
                className="text-xs text-emerald-200/80 hover:text-emerald-100 transition"
              >
                Kapat
              </button>
            </div>
          )}

          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-white font-semibold text-sm sm:text-base">Hızlı Kurulum</h2>
                <p className="text-dark-500 text-xs sm:text-sm">
                  Popüler senaryolardan başlayın, detayları modal içinde düzenleyin.
                </p>
              </div>
              <span className="text-[11px] px-2 py-1 rounded-full bg-hive-500/10 text-hive-400">
                Hızlı başlangıç
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {QUICK_CREATE_SUGGESTIONS.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  onClick={() => openCreateModal(item.prefill)}
                  className="text-left p-3 rounded-xl border border-dark-800 bg-dark-950 hover:border-hive-500/40 hover:bg-hive-500/5 transition"
                >
                  <p className="text-sm text-white font-medium">{item.title}</p>
                  <p className="text-xs text-dark-500 mt-1">{item.description}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-3 sm:p-4">
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-1 bg-dark-950 border border-dark-800 rounded-xl p-1 w-fit">
                {[
                  { key: "all", label: "Tümü" },
                  { key: "active", label: "Aktif" },
                  { key: "inactive", label: "Pasif" },
                  { key: "recent", label: "Son tetiklenenler" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveFilter(tab.key as AlertFilter)}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition ${
                      activeFilter === tab.key
                        ? "bg-hive-500/15 text-hive-400"
                        : "text-dark-500 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Ürün veya kural ara..."
                className="w-full lg:w-72 bg-dark-950 border border-dark-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-dark-600 focus:outline-none focus:border-hive-500/50"
              />
            </div>
            <p className="text-[11px] sm:text-xs text-dark-600 mt-2">
              Neden bu bildirimi alıyorum? Kural kartlarındaki kanal ve bekleme süresi bilgileri
              aynı olayın tekrarını azaltmak için gösterilir.
            </p>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      )}

      {!loading && error && (
        <ErrorState title="Uyarılar yüklenemedi" message={error} onRetry={fetchRules} />
      )}

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
          description="İlk kuralınızı birkaç saniyede oluşturun. Özellikle “Rakip daha ucuz” veya “Yüzde değişim” ile başlayarak ilk değerli sinyali hızlıca yakalayabilirsiniz."
          actionLabel="İlk Uyarıyı Oluştur"
          onAction={() => openCreateModal()}
        />
      )}

      {!loading && !error && rules.length > 0 && filteredRules.length === 0 && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 text-center">
          <p className="text-white font-semibold">Filtreye uygun kural bulunamadı</p>
          <p className="text-dark-500 text-sm mt-2">
            Filtreleri temizleyin veya yeni bir kural oluşturun.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveFilter("all");
              setSearchTerm("");
            }}
            className="mt-4 text-sm text-hive-400 hover:text-hive-300"
          >
            Filtreleri sıfırla
          </button>
        </div>
      )}

      {!loading && !error && filteredRules.length > 0 && (
        <div className="space-y-3">
          {filteredRules.map((rule) => {
            const ruleConfig = RULE_TYPE_LABELS[rule.ruleType];
            const marketplace = rule.trackedProduct?.marketplace
              ? MARKETPLACE_LABELS[rule.trackedProduct.marketplace]
              : null;

            return (
              <div
                key={rule.id}
                className={`bg-dark-900 border rounded-2xl p-4 sm:p-5 transition ${
                  rule.isActive ? "border-dark-800" : "border-dark-800/70 opacity-65"
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className="w-11 h-11 bg-hive-500/10 rounded-xl flex items-center justify-center text-lg shrink-0">
                      {ruleConfig?.icon || "🔔"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <h3 className="text-white font-semibold text-sm sm:text-base">
                          {ruleConfig?.label || rule.ruleType}
                        </h3>
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full ${
                            rule.isActive
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-dark-800 text-dark-500"
                          }`}
                        >
                          {rule.isActive ? "Aktif" : "Pasif"}
                        </span>
                      </div>

                      <p className="text-sm text-dark-400 truncate">
                        {rule.trackedProduct?.productName || "Tüm ürünler"}
                        {marketplace && (
                          <span
                            className="ml-2 text-[11px] font-medium px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: `${marketplace.color}20`,
                              color: marketplace.color,
                            }}
                          >
                            {marketplace.name}
                          </span>
                        )}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-xs">
                        <div className="rounded-lg bg-dark-950 border border-dark-800 p-2">
                          <p className="text-dark-600">Eşik Özeti</p>
                          <p className="text-dark-300 mt-0.5">
                            {rule.thresholdValue != null
                              ? rule.ruleType === "PERCENTAGE_CHANGE"
                                ? `%${rule.thresholdValue} değişim`
                                : `${rule.direction === "below" ? "↓" : "↑"} ₺${Number(rule.thresholdValue).toLocaleString("tr-TR")}`
                              : "Koşul tabanlı"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-dark-950 border border-dark-800 p-2">
                          <p className="text-dark-600">Kanallar</p>
                          <p className="text-dark-300 mt-0.5 flex items-center gap-1.5">
                            {rule.notifyVia.map((ch) => (
                              <span key={ch} title={CHANNEL_LABELS[ch]?.label}>
                                {CHANNEL_LABELS[ch]?.icon || "📨"}
                              </span>
                            ))}
                          </p>
                        </div>
                        <div className="rounded-lg bg-dark-950 border border-dark-800 p-2">
                          <p className="text-dark-600">Bekleme Süresi</p>
                          <p className="text-dark-300 mt-0.5">{rule.cooldownMinutes} dakika</p>
                        </div>
                        <div className="rounded-lg bg-dark-950 border border-dark-800 p-2">
                          <p className="text-dark-600">Son Tetiklenme</p>
                          <p className="text-dark-300 mt-0.5">
                            {rule.lastTriggered
                              ? new Date(rule.lastTriggered).toLocaleString("tr-TR", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "Henüz tetiklenmedi"}
                          </p>
                        </div>
                      </div>

                      <p className="text-[11px] text-dark-600 mt-2">
                        Bu bildirimi, seçtiğiniz kural koşulu gerçekleştiği için alırsınız. Bekleme
                        süresi, aynı olayın kısa sürede tekrar bildirilmesini engeller.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:gap-2 shrink-0 self-end sm:self-auto">
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

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDeleteConfirmId(null)}
          />
          <div className="bg-dark-900 border border-dark-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-sm relative z-10 safe-bottom">
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

      {showCreateModal && (
        <CreateAlertModal
          products={products}
          planFeatures={planFeatures}
          initialValues={modalPrefill}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            const wasFirstAlert = rules.length === 0;
            setShowCreateModal(false);
            setModalPrefill(null);
            if (wasFirstAlert) setShowFirstAlertSuccess(true);
            fetchRules();
          }}
        />
      )}
    </div>
  );
}

function CreateAlertModal({
  products,
  planFeatures,
  initialValues,
  onClose,
  onCreated,
}: {
  products: Product[];
  planFeatures: PlanFeaturesData | null;
  initialValues: AlertModalPrefill | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [selectedProduct, setSelectedProduct] = useState("");
  const [ruleType, setRuleType] = useState(initialValues?.ruleType || "PRICE_DROP");
  const [thresholdValue, setThresholdValue] = useState(initialValues?.thresholdValue || "");
  const [direction, setDirection] = useState(initialValues?.direction || "below");
  const [notifyVia, setNotifyVia] = useState<string[]>(["EMAIL"]);
  const [cooldownMinutes, setCooldownMinutes] = useState(initialValues?.cooldownMinutes || "60");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const ruleConfig = RULE_TYPE_LABELS[ruleType];

  const toggleChannel = (channel: string) => {
    setNotifyVia((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
    );
  };

  const thresholdPresets =
    ruleType === "PERCENTAGE_CHANGE"
      ? ["3", "5", "10"]
      : ruleType === "PRICE_THRESHOLD"
        ? ["100", "500", "1000"]
        : [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!selectedProduct) {
      setError("Lütfen bir ürün seçin.");
      return;
    }

    if (notifyVia.length === 0) {
      setError("En az bir bildirim kanalı seçin.");
      return;
    }

    if (ruleConfig.needsThreshold && !thresholdValue) {
      setError("Lütfen eşik değeri girin.");
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
      if (!res.ok) {
        if (res.status === 403 && data.upgradeRequired) {
          setError(
            `${data.error} Daha fazla kural/kanal ile kritik değişimleri daha hızlı yakalamak için Ayarlar > Plan sayfasından yükseltebilirsiniz.`,
          );
        } else {
          setError(data.error || "Uyarı oluşturulamadı");
        }
        return;
      }

      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-0 sm:px-6">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="bg-dark-900 border border-dark-800 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 w-full sm:max-w-2xl relative z-10 max-h-[90vh] overflow-y-auto safe-bottom">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-white">Yeni Uyarı Kuralı</h2>
            <p className="text-xs text-dark-500 mt-1">
              Doğru kurgu ile daha az bildirim, daha net aksiyon.
            </p>
          </div>
          <button onClick={onClose} className="text-dark-500 hover:text-white transition p-2 -m-1">
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

        {error && (
          <div className="bg-red-500/10 border border-red-500/25 text-red-300 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        {planFeatures?.features?.allowedChannels &&
          planFeatures.features.allowedChannels.length < Object.keys(CHANNEL_LABELS).length && (
            <div className="bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs rounded-xl px-4 py-3 mb-4">
              Bazı bildirim kanalları mevcut planınızda kapalı olabilir. Daha hızlı ekip
              koordinasyonu için Telegram/Webhook kanallarını Plan sayfasından açabilirsiniz.
            </div>
          )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <section className="rounded-xl border border-dark-800 bg-dark-950 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">1) Ürün ve Kural</h3>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">Ürün</label>
              {products.length === 0 ? (
                <p className="text-dark-500 text-sm">Önce bir ürün takibe alın.</p>
              ) : (
                <select
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                  className="w-full bg-dark-900 border border-dark-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-hive-500/50 transition appearance-none"
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

            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">Uyarı Türü</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                    <span className="font-medium leading-tight">{config.label}</span>
                  </button>
                ))}
              </div>
              <p className="text-dark-500 text-xs mt-2">{ruleConfig.description}</p>
              <p className="text-hive-400/90 text-xs mt-1">{ruleConfig.recommended}</p>
            </div>
          </section>

          <section className="rounded-xl border border-dark-800 bg-dark-950 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">2) Koşul ve Eşik</h3>
            {ruleConfig.needsThreshold ? (
              <>
                <label className="block text-sm font-medium text-dark-300 mb-2">
                  {ruleType === "PERCENTAGE_CHANGE" ? "Yüzde Değer (%)" : "Fiyat Eşiği (₺)"}
                </label>
                <input
                  type="number"
                  step={ruleType === "PERCENTAGE_CHANGE" ? "1" : "0.01"}
                  min="0"
                  value={thresholdValue}
                  onChange={(e) => setThresholdValue(e.target.value)}
                  className="w-full bg-dark-900 border border-dark-800 rounded-xl px-4 py-3 text-white text-sm placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition"
                  placeholder={ruleType === "PERCENTAGE_CHANGE" ? "Örn: 5" : "Örn: 500"}
                />
                {thresholdPresets.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {thresholdPresets.map((preset) => (
                      <button
                        type="button"
                        key={preset}
                        onClick={() => setThresholdValue(preset)}
                        className="text-xs px-3 py-1.5 rounded-full border border-dark-700 text-dark-400 hover:text-white hover:border-hive-500/40"
                      >
                        {ruleType === "PERCENTAGE_CHANGE" ? `%${preset}` : `₺${preset}`}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-dark-500">
                Bu kural türünde manuel eşik gerekmez, sistem olay gerçekleştiğinde tetikler.
              </p>
            )}

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
          </section>

          <section className="rounded-xl border border-dark-800 bg-dark-950 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-white">3) Kanal ve Gürültü Kontrolü</h3>
            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">
                Bildirim Kanalları
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CHANNEL_LABELS).map(([key, config]) => {
                  const isAllowed = planFeatures?.features?.allowedChannels?.includes(key) ?? true;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => isAllowed && toggleChannel(key)}
                      disabled={!isAllowed}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${
                        !isAllowed
                          ? "border-[#1F1F23] text-gray-600 cursor-not-allowed opacity-50"
                          : notifyVia.includes(key)
                            ? "border-hive-500/50 bg-hive-500/10 text-white"
                            : "border-dark-800 text-dark-400 hover:text-white"
                      }`}
                      title={!isAllowed ? `${config.label} üst plan gerektirir` : undefined}
                    >
                      <span>{config.icon}</span>
                      {config.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-dark-300 mb-2">Bekleme Süresi</label>
              <select
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(e.target.value)}
                className="w-full bg-dark-900 border border-dark-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-hive-500/50 transition appearance-none"
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
                Cooldown, aynı kuralın kısa aralıkta tekrar tetiklenmesini engeller. Daha uzun süre
                = daha az spam.
              </p>
            </div>
          </section>

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
