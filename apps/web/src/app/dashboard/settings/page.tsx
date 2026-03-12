"use client";

import { useState, useEffect } from "react";

const PLAN_DETAILS: Record<string, { name: string; desc: string; products: number }> = {
  FREE: { name: "Free", desc: "5 ürün takibi, günde 1 tarama", products: 5 },
  STARTER: { name: "Starter", desc: "50 ürün takibi, saatte 1 tarama", products: 50 },
  PRO: { name: "Pro", desc: "500 ürün takibi, 15 dk tarama", products: 500 },
  ENTERPRISE: {
    name: "Enterprise",
    desc: "Sınırsız ürün, 5 dk tarama, API erişimi",
    products: 9999,
  },
};

export default function SettingsPage() {
  const [telegramId, setTelegramId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [plan, setPlan] = useState("FREE");
  const [maxProducts, setMaxProducts] = useState(5);
  const [email, setEmail] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setTelegramId(data.telegramChatId || "");
          setWebhookUrl(data.webhookUrl || "");
          setPlan(data.plan || "FREE");
          setMaxProducts(data.maxProducts || 5);
          setEmail(data.email || "");
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramChatId: telegramId,
          webhookUrl: webhookUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess("Ayarlar başarıyla kaydedildi.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSaving(false);
    }
  };

  const planInfo = PLAN_DETAILS[plan] || PLAN_DETAILS.FREE;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-hive-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Ayarlar</h1>
        <p className="text-dark-500 text-sm">Hesap ve bildirim ayarlarınızı yönetin.</p>
      </div>

      {success && (
        <div className="bg-green-500/10 border border-green-500/20 text-green-400 text-sm rounded-xl px-4 py-3 mb-6">
          {success}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-6">
          {error}
        </div>
      )}

      <div className="space-y-6 max-w-2xl">
        {/* Bildirim Ayarları */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Bildirim Kanalları</h2>

          <div className="space-y-4">
            {/* E-posta */}
            <div className="p-4 bg-dark-950 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="text-xl">📧</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">E-posta</p>
                  <p className="text-xs text-dark-500">Fiyat değişikliklerinde e-posta alın</p>
                  {email && <p className="text-xs text-hive-500 mt-1">{email}</p>}
                </div>
                <span className="text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded-full">
                  Aktif
                </span>
              </div>
            </div>

            {/* Telegram */}
            <div className="p-4 bg-dark-950 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xl">💬</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Telegram</p>
                  <p className="text-xs text-dark-500">Anlık Telegram bildirimi alın</p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${telegramId ? "text-green-400 bg-green-400/10" : "text-dark-500 bg-dark-800"}`}
                >
                  {telegramId ? "Aktif" : "Pasif"}
                </span>
              </div>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={telegramId}
                  onChange={(e) => setTelegramId(e.target.value)}
                  className="flex-1 bg-dark-900 border border-dark-800 rounded-xl px-4 py-2.5 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
                  placeholder="Telegram Chat ID (sayısal)"
                />
              </div>
              <p className="text-dark-600 text-xs mt-2">
                @CompeteHiveBot&apos;a /start yazarak Chat ID&apos;nizi öğrenebilirsiniz.
              </p>
            </div>

            {/* Webhook */}
            <div className="p-4 bg-dark-950 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xl">🔗</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Webhook</p>
                  <p className="text-xs text-dark-500">
                    Fiyat değişikliklerinde webhook çağrısı alın
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${webhookUrl ? "text-green-400 bg-green-400/10" : "text-dark-500 bg-dark-800"}`}
                >
                  {webhookUrl ? "Aktif" : "Pasif"}
                </span>
              </div>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                className="w-full bg-dark-900 border border-dark-800 rounded-xl px-4 py-2.5 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
                placeholder="https://your-webhook-url.com/endpoint"
              />
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 w-full bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeDasharray="30 70"
                  />
                </svg>
                Kaydediliyor...
              </span>
            ) : (
              "Ayarları Kaydet"
            )}
          </button>
        </div>

        {/* Plan Bilgisi */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Abonelik</h2>
          <div className="flex items-center justify-between p-4 bg-dark-950 rounded-xl">
            <div>
              <p className="text-sm font-medium text-white">
                Mevcut Plan: <span className="text-hive-500">{planInfo.name}</span>
              </p>
              <p className="text-xs text-dark-500 mt-1">{planInfo.desc}</p>
              <p className="text-xs text-dark-500 mt-1">
                Ürün limiti: {maxProducts === 9999 ? "Sınırsız" : maxProducts}
              </p>
            </div>
            {plan !== "ENTERPRISE" && (
              <button className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-4 py-2.5 rounded-xl text-sm font-semibold transition">
                Planı Yükselt
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
