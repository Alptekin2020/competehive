"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { getPlanById } from "@/lib/plans";

interface TelegramStatus {
  botUsername: string | null;
  status: "awaiting_start" | "connected" | "stopped" | null;
  hasChatId: boolean;
  connectedAt: string | null;
  deepLink: string | null;
}

interface PlanData {
  plan: string;
  maxProducts: number;
  hasWhopMembership?: boolean;
  memberSince: string;
  usage: {
    products: number;
    competitors: number;
    alertRules: number;
    notifications: number;
    marketplaces: number;
  };
}

export default function SettingsPage() {
  const [tgStatus, setTgStatus] = useState<TelegramStatus | null>(null);
  const [botToken, setBotToken] = useState("");
  const [showBotSetupGuide, setShowBotSetupGuide] = useState(false);
  const [tgLoading, setTgLoading] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSaving, setWebhookSaving] = useState(false);

  const [email, setEmail] = useState("");
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTgStatus = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/telegram/status");
      const json = await res.json();
      const data = json.data || json;
      const newStatus: TelegramStatus = {
        botUsername: data.botUsername,
        status: data.status,
        hasChatId: Boolean(data.hasChatId),
        connectedAt: data.connectedAt,
        deepLink: data.deepLink,
      };
      setTgStatus(newStatus);
      return newStatus.status;
    } catch (err) {
      console.error("Failed to fetch telegram status:", err);
      return null;
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/user/plan").then((r) => r.json()),
      fetchTgStatus(),
    ])
      .then(([settings, plan]) => {
        const s = settings.data || settings;
        const p = plan.data || plan;
        if (!s.error) {
          setWebhookUrl(s.webhookUrl || "");
          setEmail(s.email || "");
        }
        if (!p.error) {
          setPlanData(p);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [fetchTgStatus]);

  // Poll while awaiting /start
  useEffect(() => {
    if (tgStatus?.status !== "awaiting_start") {
      return;
    }
    pollRef.current = setInterval(async () => {
      const newStatus = await fetchTgStatus();
      if (newStatus === "connected") {
        setSuccess("Telegram bağlantısı tamamlandı.");
        setTimeout(() => setSuccess(""), 4000);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    }, 2500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [tgStatus?.status, fetchTgStatus]);

  const handleConnectBot = async () => {
    setError("");
    setSuccess("");
    const trimmed = botToken.trim();
    if (!trimmed) {
      setError("Bot tokenı gerekli.");
      return;
    }
    setTgLoading(true);
    try {
      const res = await fetch("/api/telegram/bot-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ botToken: trimmed }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Bot bağlanamadı");
      }
      setBotToken("");
      await fetchTgStatus();
      setSuccess("Bot doğrulandı. Şimdi son adım: bot'una /start yaz.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setTgLoading(false);
    }
  };

  const handleTestTg = async () => {
    setError("");
    setSuccess("");
    setTgLoading(true);
    try {
      const res = await fetch("/api/telegram/test", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Test mesajı gönderilemedi");
      }
      setSuccess("Test mesajı gönderildi. Telegram'ı kontrol et.");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setTgLoading(false);
    }
  };

  const handleDisconnectTg = async () => {
    if (!confirm("Telegram bağlantısı tamamen kaldırılacak. Devam edilsin mi?")) return;
    setError("");
    setSuccess("");
    setTgLoading(true);
    try {
      const res = await fetch("/api/telegram/disconnect", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Bağlantı kaldırılamadı");
      }
      await fetchTgStatus();
      setSuccess("Telegram bağlantısı kaldırıldı.");
      setTimeout(() => setSuccess(""), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setTgLoading(false);
    }
  };

  const handleSaveWebhook = async () => {
    setError("");
    setSuccess("");
    setWebhookSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || "Kaydedilemedi");
      }
      setSuccess("Webhook kaydedildi.");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setWebhookSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-hive-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const isConnected = tgStatus?.status === "connected";
  const isAwaiting = tgStatus?.status === "awaiting_start";
  const isStopped = tgStatus?.status === "stopped";
  const isUnconnected = !tgStatus?.status;

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
        {/* Bildirim Kanalları */}
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
                  <p className="text-xs text-dark-500">Kendi botun üzerinden anlık bildirim al</p>
                  {isConnected && tgStatus?.botUsername && (
                    <p className="text-xs text-hive-500 mt-1">@{tgStatus.botUsername}</p>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    isConnected
                      ? "text-green-400 bg-green-400/10"
                      : isAwaiting
                        ? "text-amber-400 bg-amber-400/10"
                        : isStopped
                          ? "text-red-400 bg-red-400/10"
                          : "text-dark-500 bg-dark-800"
                  }`}
                >
                  {isConnected
                    ? "Aktif"
                    : isAwaiting
                      ? "/start bekleniyor"
                      : isStopped
                        ? "Durduruldu"
                        : "Pasif"}
                </span>
              </div>

              {isConnected && (
                <div className="space-y-3">
                  <p className="text-xs text-dark-500">
                    Bildirimler @{tgStatus?.botUsername} üzerinden Telegram&apos;ına gönderilecek.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleTestTg}
                      disabled={tgLoading}
                      className="px-4 py-2 text-xs font-medium bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 rounded-lg transition"
                    >
                      Test mesajı gönder
                    </button>
                    <button
                      onClick={handleDisconnectTg}
                      disabled={tgLoading}
                      className="px-4 py-2 text-xs font-medium bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-red-400 rounded-lg transition"
                    >
                      Bağlantıyı kaldır
                    </button>
                  </div>
                </div>
              )}

              {isAwaiting && tgStatus?.deepLink && (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                    <p className="text-xs text-amber-400 font-medium mb-1">
                      Son adım: Bot&apos;una /start yaz
                    </p>
                    <p className="text-xs text-dark-500">
                      Aşağıdaki butonla bot&apos;unu aç → <b>Start</b> butonuna bas. Bağlantı
                      otomatik tamamlanacak.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={tgStatus.deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center px-4 py-2 text-xs font-medium bg-hive-500 hover:bg-hive-600 text-dark-1000 rounded-lg transition"
                    >
                      @{tgStatus.botUsername} &apos;u aç →
                    </a>
                    <button
                      onClick={handleDisconnectTg}
                      disabled={tgLoading}
                      className="px-4 py-2 text-xs font-medium bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-red-400 rounded-lg transition"
                    >
                      İptal
                    </button>
                  </div>
                </div>
              )}

              {isStopped && (
                <div className="space-y-3">
                  <p className="text-xs text-dark-500">
                    Bot&apos;una /stop yazdığın için bildirimler durduruldu. Tekrar aktifleştirmek
                    için bot&apos;una /start yaz.
                  </p>
                  <button
                    onClick={handleDisconnectTg}
                    disabled={tgLoading}
                    className="px-4 py-2 text-xs font-medium bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-red-400 rounded-lg transition"
                  >
                    Bağlantıyı kaldır
                  </button>
                </div>
              )}

              {isUnconnected && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowBotSetupGuide(!showBotSetupGuide)}
                    className="text-xs text-hive-500 hover:text-hive-400 transition"
                  >
                    {showBotSetupGuide ? "▾" : "▸"} Bot nasıl oluşturulur?
                  </button>

                  {showBotSetupGuide && (
                    <div className="p-3 bg-dark-900 border border-dark-800 rounded-lg space-y-2 text-xs text-dark-400">
                      <p>
                        <b className="text-white">1.</b> Telegram&apos;da{" "}
                        <a
                          href="https://t.me/BotFather"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-hive-500 hover:underline"
                        >
                          @BotFather
                        </a>
                        &apos;ı aç.
                      </p>
                      <p>
                        <b className="text-white">2.</b>{" "}
                        <code className="text-hive-500">/newbot</code> yaz.
                      </p>
                      <p>
                        <b className="text-white">3.</b> İstediğin bir bot adı gir (örn.
                        &quot;CompeteHive Bildirim&quot;).
                      </p>
                      <p>
                        <b className="text-white">4.</b> Kullanıcı adı sorulunca{" "}
                        <code className="text-hive-500">_bot</code> ile bitecek müsait bir isim gir
                        (örn. <code className="text-hive-500">benim_competehive_bot</code>).
                      </p>
                      <p>
                        <b className="text-white">5.</b> BotFather sana bir <b>token</b> verir (örn.{" "}
                        <code className="text-hive-500">7891234567:AAE...</code>). Kopyala ve
                        aşağıya yapıştır.
                      </p>
                    </div>
                  )}

                  <input
                    type="password"
                    value={botToken}
                    onChange={(e) => setBotToken(e.target.value)}
                    className="w-full bg-dark-900 border border-dark-800 rounded-xl px-4 py-2.5 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm font-mono"
                    placeholder="7891234567:AAE..."
                  />
                  <button
                    onClick={handleConnectBot}
                    disabled={tgLoading || !botToken.trim()}
                    className="w-full px-4 py-2.5 text-sm font-semibold bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 rounded-xl transition"
                  >
                    {tgLoading ? "Bağlanıyor..." : "Bot'u bağla"}
                  </button>
                </div>
              )}
            </div>

            {/* Webhook */}
            <div className="p-4 bg-dark-950 rounded-xl">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xl">🔗</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-white">Webhook</p>
                  <p className="text-xs text-dark-500">
                    Fiyat değişikliklerinde webhook çağrısı al
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    webhookUrl ? "text-green-400 bg-green-400/10" : "text-dark-500 bg-dark-800"
                  }`}
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
              <button
                onClick={handleSaveWebhook}
                disabled={webhookSaving}
                className="mt-3 px-4 py-2 text-xs font-medium bg-dark-800 hover:bg-dark-700 disabled:opacity-50 text-white rounded-lg transition"
              >
                {webhookSaving ? "Kaydediliyor..." : "Webhook kaydet"}
              </button>
            </div>
          </div>
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
                {planData.hasWhopMembership && (
                  <a
                    href="https://whop.com/orders"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-400 hover:text-white transition"
                  >
                    Aboneliği Yönet (Whop) →
                  </a>
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
          {current} / {max >= 99999 ? "∞" : max}
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
          <Link href="/dashboard/pricing" className="underline hover:text-red-300">
            Planı yükseltin
          </Link>
        </p>
      )}
    </div>
  );
}
