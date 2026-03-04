"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [telegramId, setTelegramId] = useState("");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Ayarlar</h1>
        <p className="text-dark-500 text-sm">Hesap ve bildirim ayarlarınızı yönetin.</p>
      </div>

      <div className="space-y-6 max-w-2xl">
        {/* Bildirim Ayarları */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Bildirim Kanalları</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-dark-950 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="text-xl">📧</span>
                <div>
                  <p className="text-sm font-medium text-white">E-posta</p>
                  <p className="text-xs text-dark-500">Fiyat değişikliklerinde e-posta alın</p>
                </div>
              </div>
              <div className="w-10 h-6 bg-hive-500 rounded-full relative cursor-pointer">
                <div className="w-4 h-4 bg-white rounded-full absolute right-1 top-1" />
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-dark-950 rounded-xl">
              <div className="flex items-center gap-3">
                <span className="text-xl">💬</span>
                <div>
                  <p className="text-sm font-medium text-white">Telegram</p>
                  <p className="text-xs text-dark-500">Anlık Telegram bildirimi alın</p>
                </div>
              </div>
              <div className="w-10 h-6 bg-dark-700 rounded-full relative cursor-pointer">
                <div className="w-4 h-4 bg-dark-400 rounded-full absolute left-1 top-1" />
              </div>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-dark-300 mb-2">Telegram Chat ID</label>
            <div className="flex gap-3">
              <input
                type="text"
                value={telegramId}
                onChange={e => setTelegramId(e.target.value)}
                className="flex-1 bg-dark-950 border border-dark-800 rounded-xl px-4 py-2.5 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm"
                placeholder="@CompeteHiveBot ile başlatın"
              />
              <button className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-4 py-2.5 rounded-xl text-sm font-semibold transition">
                Kaydet
              </button>
            </div>
          </div>
        </div>

        {/* Plan Bilgisi */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Abonelik</h2>
          <div className="flex items-center justify-between p-4 bg-dark-950 rounded-xl">
            <div>
              <p className="text-sm font-medium text-white">Mevcut Plan: <span className="text-hive-500">Free</span></p>
              <p className="text-xs text-dark-500 mt-1">5 ürün takibi, günde 1 tarama</p>
            </div>
            <button className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-4 py-2.5 rounded-xl text-sm font-semibold transition">
              Planı Yükselt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
