"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

type NotificationFilter = "all" | "unread" | "critical" | "price" | "stock";

const RULE_TYPE_META: Record<
  string,
  { icon: string; label: string; category: "price" | "stock" | "other"; critical?: boolean }
> = {
  PRICE_DROP: { icon: "📉", label: "Fiyat Düşüşü", category: "price" },
  PRICE_INCREASE: { icon: "📈", label: "Fiyat Artışı", category: "price" },
  PRICE_THRESHOLD: { icon: "🎯", label: "Fiyat Eşiği", category: "price", critical: true },
  PERCENTAGE_CHANGE: { icon: "📊", label: "Yüzde Değişim", category: "price" },
  COMPETITOR_CHEAPER: { icon: "⚡", label: "Rakip Daha Ucuz", category: "price", critical: true },
  OUT_OF_STOCK: { icon: "🚫", label: "Stoktan Çıktı", category: "stock", critical: true },
  BACK_IN_STOCK: { icon: "✅", label: "Stoğa Girdi", category: "stock" },
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
  const [filter, setFilter] = useState<NotificationFilter>("all");

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

  const filteredNotifications = useMemo(() => {
    return notifications.filter((notification) => {
      const meta = notification.rule_type ? RULE_TYPE_META[notification.rule_type] : undefined;

      if (filter === "all") return true;
      if (filter === "unread") return !notification.is_read;
      if (filter === "critical") {
        return Boolean(
          meta?.critical ||
          /acil|kritik|urgent/i.test(`${notification.title} ${notification.message}`),
        );
      }
      if (filter === "price") return meta?.category === "price";
      if (filter === "stock") return meta?.category === "stock";
      return true;
    });
  }, [notifications, filter]);

  const counts = useMemo(() => {
    return {
      all: total,
      unread: unreadCount,
      critical: notifications.filter((n) => {
        const meta = n.rule_type ? RULE_TYPE_META[n.rule_type] : undefined;
        return Boolean(meta?.critical || /acil|kritik|urgent/i.test(`${n.title} ${n.message}`));
      }).length,
      price: notifications.filter((n) => {
        const meta = n.rule_type ? RULE_TYPE_META[n.rule_type] : undefined;
        return meta?.category === "price";
      }).length,
      stock: notifications.filter((n) => {
        const meta = n.rule_type ? RULE_TYPE_META[n.rule_type] : undefined;
        return meta?.category === "stock";
      }).length,
    };
  }, [notifications, total, unreadCount]);

  const groupedNotifications = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const groups = {
      today: [] as Notification[],
      thisWeek: [] as Notification[],
      older: [] as Notification[],
    };

    filteredNotifications.forEach((notification) => {
      const sentAt = new Date(notification.sent_at);
      if (sentAt >= todayStart) groups.today.push(notification);
      else if (sentAt >= weekStart) groups.thisWeek.push(notification);
      else groups.older.push(notification);
    });

    return groups;
  }, [filteredNotifications]);

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

  const filterTabs: Array<{ key: NotificationFilter; label: string }> = [
    { key: "all", label: "Tümü" },
    { key: "unread", label: "Okunmamış" },
    { key: "critical", label: "Kritikler" },
    { key: "price", label: "Fiyat" },
    { key: "stock", label: "Stok" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 sm:mb-8">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white mb-0.5 sm:mb-1">Bildirimler</h1>
          <p className="text-dark-500 text-xs sm:text-sm">
            {unreadCount > 0
              ? `${unreadCount} okunmamış bildiriminiz var`
              : "Bildirim kutunuz güncel ve temiz görünüyor"}
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

      <div className="mb-4 sm:mb-6 bg-dark-900 border border-dark-800 rounded-2xl p-3 sm:p-4">
        <div className="flex flex-wrap gap-1 bg-dark-950 border border-dark-800 rounded-xl p-1 w-fit">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition ${
                filter === tab.key
                  ? "bg-hive-500/12 text-hive-400"
                  : "text-dark-500 hover:text-white"
              }`}
            >
              {tab.label} ({counts[tab.key]})
            </button>
          ))}
        </div>
        <p className="text-[11px] sm:text-xs text-dark-600 mt-2">
          Kritik ve kategori filtreleri görünürlüğü artırır; backend akışını değiştirmez.
        </p>
      </div>

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

      {!loading && !error && filteredNotifications.length === 0 && (
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
            {filter === "unread" ? "Okunmamış bildirim yok" : "Bu filtrede bildirim bulunamadı"}
          </h2>
          <p className="text-dark-500 text-sm max-w-md mx-auto mb-6">
            Filtreyi genişletin veya uyarı kurallarınızın bekleme sürelerini düzenleyerek daha
            dengeli bir akış kurun.
          </p>
          <Link
            href="/dashboard/alerts"
            className="inline-flex items-center gap-2 text-sm font-semibold text-dark-1000 bg-hive-500 hover:bg-hive-600 px-4 py-2 rounded-lg transition"
          >
            Uyarıları Düzenle
          </Link>
        </div>
      )}

      {!loading && !error && filteredNotifications.length > 0 && (
        <div className="space-y-5">
          {[
            { key: "today", label: "Bugün", items: groupedNotifications.today },
            { key: "week", label: "Bu Hafta", items: groupedNotifications.thisWeek },
            { key: "older", label: "Daha Eski", items: groupedNotifications.older },
          ]
            .filter((section) => section.items.length > 0)
            .map((section) => (
              <section key={section.key}>
                <h2 className="text-xs font-semibold tracking-wide uppercase text-dark-500 mb-2 px-1">
                  {section.label}
                </h2>
                <div className="space-y-2">
                  {section.items.map((notification) => {
                    const meta = notification.rule_type
                      ? RULE_TYPE_META[notification.rule_type]
                      : undefined;
                    const icon = meta?.icon || "🔔";
                    const marketplace = notification.marketplace
                      ? MARKETPLACE_LABELS[notification.marketplace]
                      : null;
                    const isCritical =
                      Boolean(meta?.critical) ||
                      /acil|kritik|urgent/i.test(`${notification.title} ${notification.message}`);

                    return (
                      <article
                        key={notification.id}
                        className={`bg-dark-900 border rounded-xl sm:rounded-2xl p-3 sm:p-4 transition cursor-pointer hover:border-dark-700 ${
                          !notification.is_read
                            ? "border-hive-500/30 bg-hive-500/[0.03]"
                            : "border-dark-800"
                        } ${isCritical ? "ring-1 ring-red-500/20" : ""}`}
                        onClick={() => {
                          if (!notification.is_read) markAsRead(notification.id);
                        }}
                      >
                        <div className="flex gap-3 sm:gap-4">
                          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-hive-500/10 flex items-center justify-center shrink-0 text-sm sm:text-lg">
                            {icon}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3
                                    className={`text-sm ${!notification.is_read ? "text-white font-semibold" : "text-dark-300"}`}
                                  >
                                    {notification.title}
                                  </h3>
                                  {!notification.is_read && (
                                    <span className="w-2 h-2 bg-hive-500 rounded-full shrink-0" />
                                  )}
                                  {isCritical && (
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">
                                      Kritik
                                    </span>
                                  )}
                                </div>
                                <p className="text-dark-500 text-sm mt-1 leading-relaxed">
                                  {notification.message}
                                </p>
                              </div>
                              <span className="text-dark-600 text-[10px] sm:text-xs shrink-0 whitespace-nowrap hidden sm:block">
                                {formatDate(notification.sent_at)}
                              </span>
                            </div>

                            <span className="text-dark-600 text-[10px] mt-1 block sm:hidden">
                              {formatDate(notification.sent_at)}
                            </span>

                            <div className="flex flex-wrap items-center gap-2 mt-2.5">
                              {meta?.label && (
                                <span className="text-[11px] text-hive-400 bg-hive-500/10 px-2 py-1 rounded-full">
                                  {meta.label}
                                </span>
                              )}
                              {notification.product_name && (
                                <span className="text-xs text-dark-400 truncate max-w-[220px]">
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

                            {notification.product_name && (
                              <div className="mt-3">
                                <Link
                                  href={`/dashboard/products?search=${encodeURIComponent(notification.product_name)}`}
                                  className="inline-flex items-center gap-1 text-xs text-hive-400 hover:text-hive-300"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Ürünü aç
                                  <svg
                                    className="w-3 h-3"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <path d="M7 17L17 7" />
                                    <path d="M7 7h10v10" />
                                  </svg>
                                </Link>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}

          {hasMore && (
            <div className="text-center py-2">
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
