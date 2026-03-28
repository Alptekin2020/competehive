"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Notification {
  id: string;
  title: string;
  message: string;
  channel: string;
  is_read: boolean;
  sent_at: string;
  rule_type?: string | null;
  product_name?: string | null;
  marketplace?: string | null;
}

const RULE_TYPE_ICONS: Record<string, string> = {
  PRICE_DROP: "📉",
  PRICE_INCREASE: "📈",
  PRICE_THRESHOLD: "🎯",
  PERCENTAGE_CHANGE: "📊",
  COMPETITOR_CHEAPER: "⚡",
  OUT_OF_STOCK: "🚫",
  BACK_IN_STOCK: "✅",
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

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const fetchNotifications = useCallback(
    async (reset = true) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const offset = reset ? 0 : notifications.length;
        const params = new URLSearchParams({
          limit: "20",
          offset: offset.toString(),
        });
        if (filter === "unread") params.set("unread", "true");

        const res = await fetch(`/api/notifications?${params}`);
        if (!res.ok) throw new Error("Bildirimler yüklenemedi");
        const data = await res.json();
        const items = data.notifications || [];

        if (reset) {
          setNotifications(items);
        } else {
          setNotifications((prev) => [...prev, ...items]);
        }
        setTotal(data.total ?? 0);
        setUnreadCount(data.unreadCount ?? 0);
        setHasMore(data.hasMore ?? false);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Bilinmeyen hata";
        setError(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [filter, notifications.length],
  );

  useEffect(() => {
    fetchNotifications(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const markAsRead = async (notificationId: string) => {
    try {
      await fetch("/api/notifications/read", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silently fail
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch("/api/notifications/read", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // silently fail
    }
  };

  function formatDate(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return "Az önce";
    if (diffMin < 60) return `${diffMin} dakika önce`;
    if (diffHour < 24) return `${diffHour} saat önce`;
    if (diffDay < 7) return `${diffDay} gün önce`;
    return date.toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Bildirimler</h1>
          <p className="text-dark-500 text-sm">
            {unreadCount > 0 ? `${unreadCount} okunmamış bildiriminiz var` : "Tüm bildirimleriniz"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllAsRead}
            className="text-sm text-hive-500 hover:text-hive-400 transition font-medium"
          >
            Tümünü Okundu İşaretle
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-6 bg-dark-900 border border-dark-800 rounded-xl p-1 w-fit">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            filter === "all" ? "bg-hive-500/10 text-hive-500" : "text-dark-500 hover:text-white"
          }`}
        >
          Tümü ({total})
        </button>
        <button
          onClick={() => setFilter("unread")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            filter === "unread" ? "bg-hive-500/10 text-hive-500" : "text-dark-500 hover:text-white"
          }`}
        >
          Okunmamış ({unreadCount})
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-dark-900 border border-dark-800 rounded-2xl p-4 animate-pulse"
            >
              <div className="flex gap-4">
                <div className="w-10 h-10 rounded-xl bg-dark-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-dark-800 rounded w-1/3" />
                  <div className="h-3 bg-dark-800 rounded w-2/3" />
                  <div className="h-3 bg-dark-800 rounded w-1/4" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-dark-900 border border-red-500/20 rounded-2xl p-8 text-center">
          <h3 className="text-white font-semibold mb-2">Bildirimler yüklenemedi</h3>
          <p className="text-dark-500 text-sm mb-4">{error}</p>
          <button
            onClick={() => fetchNotifications(true)}
            className="text-sm text-hive-500 hover:text-hive-400 font-medium transition"
          >
            Tekrar Dene
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && notifications.length === 0 && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-dark-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <svg
              className="w-8 h-8 text-hive-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white mb-2">
            {filter === "unread" ? "Okunmamış bildirim yok" : "Henüz bildirim yok"}
          </h2>
          <p className="text-dark-500 text-sm max-w-md mx-auto mb-6">
            {filter === "unread"
              ? "Tüm bildirimlerinizi okudunuz."
              : "Uyarı kurallarınız tetiklendiğinde bildirimler burada görünecek."}
          </p>
          {filter !== "unread" && (
            <Link
              href="/dashboard/alerts"
              className="inline-flex items-center gap-2 text-sm font-semibold text-dark-1000 bg-hive-500 hover:bg-hive-600 px-4 py-2 rounded-lg transition"
            >
              Uyarı Kuralı Oluştur
            </Link>
          )}
        </div>
      )}

      {/* Notification List */}
      {!loading && !error && notifications.length > 0 && (
        <div className="space-y-2">
          {notifications.map((notification) => {
            const icon = notification.rule_type
              ? RULE_TYPE_ICONS[notification.rule_type] || "🔔"
              : "🔔";
            const marketplace = notification.marketplace
              ? MARKETPLACE_LABELS[notification.marketplace]
              : null;

            return (
              <div
                key={notification.id}
                className={`bg-dark-900 border rounded-2xl p-4 transition cursor-pointer hover:border-dark-700 ${
                  !notification.is_read
                    ? "border-hive-500/20 bg-hive-500/[0.02]"
                    : "border-dark-800"
                }`}
                onClick={() => {
                  if (!notification.is_read) markAsRead(notification.id);
                }}
              >
                <div className="flex gap-4">
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-xl bg-hive-500/10 flex items-center justify-center shrink-0 text-lg">
                    {icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3
                            className={`text-sm ${!notification.is_read ? "text-white font-semibold" : "text-dark-300"}`}
                          >
                            {notification.title}
                          </h3>
                          {!notification.is_read && (
                            <span className="w-2 h-2 bg-hive-500 rounded-full shrink-0" />
                          )}
                        </div>
                        <p className="text-dark-500 text-sm mt-1">{notification.message}</p>
                      </div>
                      <span className="text-dark-600 text-xs shrink-0 whitespace-nowrap">
                        {formatDate(notification.sent_at)}
                      </span>
                    </div>

                    {/* Meta info */}
                    <div className="flex items-center gap-2 mt-2">
                      {notification.product_name && (
                        <span className="text-xs text-dark-600 truncate max-w-[200px]">
                          {notification.product_name}
                        </span>
                      )}
                      {marketplace && (
                        <span
                          className="text-xs font-medium px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `${marketplace.color}20`,
                            color: marketplace.color,
                          }}
                        >
                          {marketplace.name}
                        </span>
                      )}
                      <span className="text-xs text-dark-600 bg-dark-800 px-1.5 py-0.5 rounded">
                        {notification.channel}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Load More */}
          {hasMore && (
            <div className="text-center py-4">
              <button
                onClick={() => fetchNotifications(false)}
                disabled={loadingMore}
                className="text-sm text-hive-500 hover:text-hive-400 font-medium transition disabled:opacity-50"
              >
                {loadingMore ? "Yükleniyor..." : "Daha fazla göster"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
