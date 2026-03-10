"use client";

import { useState, useEffect } from "react";

interface Notification {
  id: string;
  title: string;
  message: string;
  channel: string;
  is_read: boolean;
  sent_at: string;
  rule_type?: string;
  product_name?: string;
  marketplace?: string;
}

const RULE_TYPE_ICONS: Record<string, string> = {
  PRICE_DROP: "📉",
  PRICE_INCREASE: "📈",
  PRICE_THRESHOLD: "🎯",
  PERCENTAGE_CHANGE: "📊",
  COMPETITOR_CHEAPER: "⚡",
  OUT_OF_STOCK: "❌",
  BACK_IN_STOCK: "✅",
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      if (data.notifications) setNotifications(data.notifications);
    } catch (err) {
      console.error("Fetch notifications error:", err);
    }
  };

  useEffect(() => {
    fetchNotifications().finally(() => setLoading(false));
  }, []);

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAllRead: true }),
      });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error("Mark all read error:", err);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds: [id] }),
      });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) {
      console.error("Mark read error:", err);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

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
          <h1 className="text-2xl font-bold text-white mb-1">Bildirimler</h1>
          <p className="text-dark-500 text-sm">
            {unreadCount > 0 ? `${unreadCount} okunmamış bildiriminiz var.` : "Tüm bildirimleriniz okundu."}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-hive-500 hover:text-hive-400 transition font-medium"
          >
            Tümünü Okundu İşaretle
          </button>
        )}
      </div>

      {notifications.length > 0 ? (
        <div className="space-y-2">
          {notifications.map(notif => (
            <div
              key={notif.id}
              className={`bg-dark-900 border rounded-xl p-4 transition cursor-pointer ${
                notif.is_read ? "border-dark-800 opacity-60" : "border-hive-500/20 hover:border-hive-500/40"
              }`}
              onClick={() => !notif.is_read && markAsRead(notif.id)}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0 mt-0.5">
                  {RULE_TYPE_ICONS[notif.rule_type || ""] || "🔔"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-white">{notif.title}</h3>
                    {!notif.is_read && (
                      <span className="w-2 h-2 bg-hive-500 rounded-full flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-dark-400 text-xs mt-1">{notif.message}</p>
                  {notif.product_name && (
                    <p className="text-dark-500 text-xs mt-1">{notif.product_name}</p>
                  )}
                  <p className="text-dark-600 text-xs mt-2">
                    {new Date(notif.sent_at).toLocaleString("tr-TR")}
                  </p>
                </div>
                <span className="text-xs text-dark-600 bg-dark-800 px-2 py-0.5 rounded flex-shrink-0">
                  {notif.channel}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
          <div className="w-16 h-16 bg-dark-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">💬</span>
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Henüz bildirim yok</h2>
          <p className="text-dark-500 text-sm max-w-md mx-auto">
            Uyarı kuralları oluşturduğunuzda ve fiyat değişiklikleri tespit edildiğinde bildirimleriniz burada görünecek.
          </p>
        </div>
      )}
    </div>
  );
}
