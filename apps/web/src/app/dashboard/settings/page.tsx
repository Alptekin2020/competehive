"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import AlertPrefsCard from "@/components/AlertPrefsCard";

interface TelegramStatus {
  botUsername: string | null;
  status: "awaiting_start" | "connected" | "stopped" | null;
  hasChatId: boolean;
  connectedAt: string | null;
  linkExpiresAt: string | null;
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
  const [tgLoading, setTgLoading] = useState(false);
  const [tgDeepLink, setTgDeepLink] = useState<string | null>(null);

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
        linkExpiresAt: data.linkExpiresAt,
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

  // Awaiting /start iken polling
  useEffect(() => {
    if (tgStatus?.status !== "awaiting_start") {
      return;
    }
    pollRef.current = setInterval(async () => {
      const newStatus = await fetchTgStatus();
      if (newStatus === "connected") {
        setSuccess("Telegram bağlantısı tamamlandı.");
        setTgDeepLink(null);
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

  const handleConnect = async () => {
    setError("");
    setSuccess("");
    setTgLoading(true);
    try {
      const res = await fetch("/api/telegram/connect", { method: "POST" });
      const json = await res.json();
      const data = json.data || json;
      if (!res.ok || json.error) {
        throw new Error(json.error || "Bağlantı linki oluşturulamadı");
      }
      // Linki state'e koy — popup blocker engellerse kullanıcı manuel açabilir
      setTgDeepLink(data.deepLink);
      // window.open sync olmadığı için bazı tarayıcılarda pop-up blocker tetiklenebilir;
      // engellenirse aşağıdaki görünür buton fallback olarak çalışır.
      window.open(data.deepLink, "_blank", "noopener,noreferrer");
      await fetchTgStatus();
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
    if (!confirm("Telegram bağlantısı kaldırılacak. Devam edilsin mi?")) return;
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
      setTgDeepLink(null);
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
        <AlertPrefsCard />
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
                  <p className="text-xs text-dark-500">
                    @{tgStatus?.botUsername || "CompeteHive_bot"} üzerinden anlık bildirim al
                  </p>
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
                    Bildirimler Telegram&apos;ına gönderilecek.
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

              {isAwaiting && (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                    <p className="text-xs text-amber-400 font-medium mb-1">
                      Son adım: Telegram&apos;da Start&apos;a bas
                    </p>
                    <p className="text-xs text-dark-500">
                      Telegram penceresinde &quot;Start&quot; butonuna basınca bağlantı otomatik
                      tamamlanır. Pencereyi kapattıysan ya da pop-up engellendiyse aşağıdaki
                      bağlantıya tıkla.
                    </p>
                  </div>
                  {tgDeepLink && (
                    <a
                      href={tgDeepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center px-4 py-2.5 text-sm font-semibold bg-hive-500 hover:bg-hive-600 text-dark-1000 rounded-xl transition"
                    >
                      Telegram&apos;da aç →
                    </a>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleConnect}
                      disabled={tgLoading}
                      className="flex-1 px-4 py-2 text-xs font-medium bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 rounded-lg transition"
                    >
                      Yeni link oluştur
                    </button>
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
                    Bot&apos;una /stop yazdığın için bildirimler durduruldu. Tekrar açmak için
                    bot&apos;a /start yaz.
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
                  <p className="text-xs text-dark-500">
                    Tek tıklamayla bağlan. Telegram açılır, &quot;Start&quot; butonuna basarsın,
                    hazırsın.
                  </p>
                  <button
                    onClick={handleConnect}
                    disabled={tgLoading}
                    className="w-full px-4 py-2.5 text-sm font-semibold bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 rounded-xl transition"
                  >
                    {tgLoading ? "Yönlendiriliyor..." : "Telegram'a Bağla"}
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

        {planData && (
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Hesap & Plan</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-dark-500">Plan</span>
                <span className="text-white font-medium">{planData.plan}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dark-500">Ürün limiti</span>
                <span className="text-white">
                  {planData.usage.products} / {planData.maxProducts}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dark-500">Aktif uyarı kuralı</span>
                <span className="text-white">{planData.usage.alertRules}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-dark-500">Üyelik başlangıcı</span>
                <span className="text-white">
                  {new Date(planData.memberSince).toLocaleDateString("tr-TR")}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
