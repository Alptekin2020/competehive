"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getPlanById } from "@/lib/plans";

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
  const [planData, setPlanData] = useState<{
    plan: string;
    maxProducts: number;
    memberSince: string;
    usage: {
      products: number;
      competitors: number;
      alertRules: number;
      notifications: number;
      marketplaces: number;
    };
  } | null>(null);

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

    fetch("/api/user/plan")
      .then((res) => res.json())
      .then((data) => {
        const d = data.data || data;
        if (!d.error) {
          setPlanData(d);
        }
      })
      .catch(console.error);
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

        {/* Plan & Usage */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Abonelik</h2>
            <Link
              href="/dashboard/pricing"
              className="text-sm text-hive-500 hover:text-hive-400 font-medium transition"
            >
              Planları Gör →
            </Link>
          </div>

          {planData ? (
            <div>
              {/* Current plan badge */}
              <div className="flex items-center gap-3 p-4 bg-dark-950 rounded-xl mb-4">
                <div className="w-10 h-10 bg-hive-500/10 rounded-xl flex items-center justify-center">
                  <span className="text-hive-500 text-lg font-bold">
                    {getPlanById(planData.plan)?.name.charAt(0) || "F"}
                  </span>
                </div>
                <div className="flex-1">
                  <p className="text-white font-medium">
                    {getPlanById(planData.plan)?.name || planData.plan} Plan
                  </p>
                  <p className="text-dark-500 text-xs">
                    {new Date(planData.memberSince).toLocaleDateString("tr-TR")} tarihinden beri üye
                  </p>
                </div>
                {planData.plan !== "ENTERPRISE" && (
                  <Link
                    href="/dashboard/pricing"
                    className="bg-hive-500 hover:bg-hive-400 text-dark-1000 px-4 py-2 rounded-xl text-sm font-semibold transition"
                  >
                    Yükselt
                  </Link>
                )}
              </div>

              {/* Usage bars */}
              <div className="space-y-4">
                <UsageBar
                  label="Ürün Takibi"
                  current={planData.usage.products}
                  max={planData.maxProducts}
                />

                <div className="flex items-center justify-between">
                  <span className="text-dark-400 text-sm">Kullanılan Marketplace</span>
                  <span className="text-white text-sm font-medium">
                    {planData.usage.marketplaces}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-dark-400 text-sm">Aktif Uyarı Kuralı</span>
                  <span className="text-white text-sm font-medium">
                    {planData.usage.alertRules}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-dark-400 text-sm">Tespit Edilen Rakip</span>
                  <span className="text-white text-sm font-medium">
                    {planData.usage.competitors}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="animate-pulse space-y-3">
              <div className="h-16 bg-dark-800 rounded-xl" />
              <div className="h-4 bg-dark-800 rounded w-2/3" />
              <div className="h-4 bg-dark-800 rounded w-1/2" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UsageBar({ label, current, max }: { label: string; current: number; max: number }) {
  const percentage = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0;
  const isNearLimit = percentage >= 80;
  const isAtLimit = percentage >= 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-dark-400 text-sm">{label}</span>
        <span
          className={`text-sm font-medium ${isAtLimit ? "text-red-400" : isNearLimit ? "text-amber-400" : "text-white"}`}
        >
          {current} / {max >= 99999 ? "\u221E" : max}
        </span>
      </div>
      <div className="h-2 bg-dark-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isAtLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-green-500"
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {isNearLimit && !isAtLimit && (
        <p className="text-amber-400 text-xs mt-1">Limitinize yaklaşıyorsunuz</p>
      )}
      {isAtLimit && (
        <p className="text-red-400 text-xs mt-1">
          Limitinize ulaştınız.{" "}
          <Link
            href="/dashboard/pricing"
            className="underline hover:text-red-300"
          >
            Planı yükseltin
          </Link>
        </p>
      )}
    </div>
  );
}
