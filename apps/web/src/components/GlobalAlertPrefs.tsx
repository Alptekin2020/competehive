"use client";

import { useEffect, useMemo, useState } from "react";

// Hesap geneli bildirim tercihleri — "basit mod".
//
// Kural motoru esnek (tür + eşik + kanal + cooldown + kapsam) ama çoğu
// kullanıcının istediği şey üç tıklık bir şey: "fiyat düşünce ve rakip
// ucuzlayınca haber ver". Bu panel, genel (trackedProductId=null) kuralları
// aç/kapat anahtarlarına ve tek bir kanal seçimine indirger; altta yatan
// kurallar aynı API'lerle (POST /api/alerts, PATCH /api/alerts/[id])
// yönetildiği için gelişmiş görünümle tam uyumlu kalır.

interface GlobalRule {
  id: string;
  trackedProductId: string | null;
  ruleType: string;
  thresholdValue: number | null;
  notifyVia: string[];
  isActive: boolean;
}

interface GlobalAlertPrefsProps {
  rules: GlobalRule[];
  allowedChannels: string[];
  onChanged: () => void;
}

// PRICE_THRESHOLD bilinçli olarak panelde yok: hedef fiyat ürüne özgüdür,
// hesap geneli bir eşik anlamsız olur. O kural "Yeni Uyarı" ile kurulur.
const PANEL_TYPES: Array<{
  type: string;
  icon: string;
  label: string;
  hint: string;
  defaultCooldown: number;
  needsThreshold?: boolean;
}> = [
  {
    type: "PRICE_DROP",
    icon: "📉",
    label: "Fiyatım düşünce",
    hint: "Kendi ürününüzün fiyatı düştüğünde",
    defaultCooldown: 60,
  },
  {
    type: "COMPETITOR_CHEAPER",
    icon: "⚡",
    label: "Rakip benden ucuz olunca",
    hint: "Güvenilir bir rakip sizden ucuza düştüğünde",
    defaultCooldown: 30,
  },
  {
    type: "OUT_OF_STOCK",
    icon: "🚫",
    label: "Stok bitince",
    hint: "Ürününüz stoktan düştüğünde",
    defaultCooldown: 120,
  },
  {
    type: "BACK_IN_STOCK",
    icon: "✅",
    label: "Stoğa dönünce",
    hint: "Ürününüz tekrar satışa çıktığında",
    defaultCooldown: 15,
  },
  {
    type: "PRICE_INCREASE",
    icon: "📈",
    label: "Fiyatım artınca",
    hint: "Kendi ürününüzün fiyatı yükseldiğinde",
    defaultCooldown: 60,
  },
  {
    type: "PERCENTAGE_CHANGE",
    icon: "📊",
    label: "Büyük değişimde",
    hint: "Tek seferde belirlediğiniz yüzdenin üzeri değişimde",
    defaultCooldown: 60,
    needsThreshold: true,
  },
];

const CHANNEL_OPTIONS = [
  { key: "EMAIL", label: "E-posta", icon: "📧" },
  { key: "TELEGRAM", label: "Telegram", icon: "💬" },
  { key: "WEBHOOK", label: "Webhook", icon: "🔗" },
];

export default function GlobalAlertPrefs({
  rules,
  allowedChannels,
  onChanged,
}: GlobalAlertPrefsProps) {
  const globalByType = useMemo(() => {
    const map = new Map<string, GlobalRule>();
    for (const rule of rules) {
      if (rule.trackedProductId === null && !map.has(rule.ruleType)) {
        map.set(rule.ruleType, rule);
      }
    }
    return map;
  }, [rules]);

  // Kanal seçimi: mevcut genel kurallardan devralınır; hiç kural yoksa E-posta.
  const initialChannels = useMemo(() => {
    for (const rule of globalByType.values()) {
      if (rule.notifyVia?.length) return rule.notifyVia;
    }
    return ["EMAIL"];
  }, [globalByType]);

  const [channels, setChannels] = useState<string[]>(initialChannels);
  const [busyType, setBusyType] = useState<string | null>(null);
  const [channelsBusy, setChannelsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pctThreshold, setPctThreshold] = useState<string>(() => {
    const rule = globalByType.get("PERCENTAGE_CHANGE");
    return rule?.thresholdValue != null ? String(rule.thresholdValue) : "5";
  });

  useEffect(() => {
    setChannels(initialChannels);
  }, [initialChannels]);

  useEffect(() => {
    const rule = globalByType.get("PERCENTAGE_CHANGE");
    if (rule?.thresholdValue != null) setPctThreshold(String(rule.thresholdValue));
  }, [globalByType]);

  const showError = (message: string) => {
    setError(message);
    setTimeout(() => setError(null), 4000);
  };

  const toggleType = async (type: (typeof PANEL_TYPES)[number]) => {
    if (busyType) return;
    setBusyType(type.type);
    setError(null);
    try {
      const existing = globalByType.get(type.type);
      if (existing) {
        const res = await fetch(`/api/alerts/${existing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !existing.isActive }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          showError(data?.error || "Tercih güncellenemedi.");
          return;
        }
      } else {
        const body: Record<string, unknown> = {
          ruleType: type.type,
          notifyVia: channels.length ? channels : ["EMAIL"],
          cooldownMinutes: type.defaultCooldown,
        };
        if (type.needsThreshold) {
          body.thresholdValue = parseFloat(pctThreshold) || 5;
        }
        const res = await fetch("/api/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          showError(data?.error || "Tercih kaydedilemedi.");
          return;
        }
      }
      onChanged();
    } catch {
      showError("Bağlantı hatası — lütfen tekrar deneyin.");
    } finally {
      setBusyType(null);
    }
  };

  const applyChannels = async (nextChannels: string[]) => {
    setChannels(nextChannels);
    const globalRules = [...globalByType.values()];
    if (globalRules.length === 0) return; // ilk kural oluşturulurken kullanılacak
    setChannelsBusy(true);
    setError(null);
    try {
      for (const rule of globalRules) {
        const res = await fetch(`/api/alerts/${rule.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notifyVia: nextChannels }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          showError(data?.error || "Kanallar güncellenemedi.");
          onChanged();
          return;
        }
      }
      onChanged();
    } catch {
      showError("Bağlantı hatası — kanallar güncellenemedi.");
    } finally {
      setChannelsBusy(false);
    }
  };

  const toggleChannel = (key: string) => {
    if (channelsBusy) return;
    const next = channels.includes(key) ? channels.filter((c) => c !== key) : [...channels, key];
    if (next.length === 0) {
      showError("En az bir bildirim kanalı seçili kalmalı.");
      return;
    }
    applyChannels(next);
  };

  const commitPctThreshold = async () => {
    const rule = globalByType.get("PERCENTAGE_CHANGE");
    const value = parseFloat(pctThreshold);
    if (!rule || !Number.isFinite(value) || value <= 0) return;
    if (rule.thresholdValue != null && Math.abs(rule.thresholdValue - value) < 0.001) return;
    try {
      const res = await fetch(`/api/alerts/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdValue: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        showError(data?.error || "Eşik güncellenemedi.");
        return;
      }
      onChanged();
    } catch {
      showError("Bağlantı hatası — eşik güncellenemedi.");
    }
  };

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-white font-semibold text-sm sm:text-base">
          🔔 Bildirim Tercihleri{" "}
          <span className="text-dark-500 font-normal">— tüm ürünlerinize uygulanır</span>
        </h2>
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>
      <p className="text-xs text-dark-500 mb-4">
        Anahtarı açmanız yeterli; mevcut ve sonradan ekleyeceğiniz her ürün kapsanır. Tek bir ürüne
        özel davranış için &quot;Yeni Uyarı&quot;dan o ürünü seçin.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
        {PANEL_TYPES.map((type) => {
          const rule = globalByType.get(type.type);
          const isOn = Boolean(rule?.isActive);
          const isBusy = busyType === type.type;
          return (
            <div
              key={type.type}
              className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition ${
                isOn ? "border-hive-500/30 bg-hive-500/5" : "border-dark-800 bg-dark-950"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm text-white font-medium flex items-center gap-1.5">
                  <span>{type.icon}</span>
                  {type.label}
                </p>
                <p className="text-[11px] text-dark-500 mt-0.5 truncate" title={type.hint}>
                  {type.hint}
                </p>
                {type.needsThreshold && isOn && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[11px] text-dark-400">Eşik: %</span>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={pctThreshold}
                      onChange={(e) => setPctThreshold(e.target.value)}
                      onBlur={commitPctThreshold}
                      className="w-16 bg-dark-900 border border-dark-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-hive-500/50"
                    />
                  </div>
                )}
              </div>
              <button
                onClick={() => toggleType(type)}
                disabled={isBusy}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  isBusy ? "opacity-50" : ""
                }`}
                style={{ backgroundColor: isOn ? "#F59E0B" : "#1F1F23" }}
                title={isOn ? "Kapat" : "Aç"}
              >
                <span
                  className="absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform"
                  style={{ transform: isOn ? "translateX(20px)" : "translateX(0)" }}
                />
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-dark-800">
        <span className="text-xs text-dark-400 mr-1">Bildirim kanalı:</span>
        {CHANNEL_OPTIONS.map((channel) => {
          const isAllowed = allowedChannels.includes(channel.key);
          const isSelected = channels.includes(channel.key);
          return (
            <button
              key={channel.key}
              onClick={() => isAllowed && toggleChannel(channel.key)}
              disabled={!isAllowed || channelsBusy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                !isAllowed
                  ? "border-dark-800 text-dark-600 cursor-not-allowed opacity-50"
                  : isSelected
                    ? "border-hive-500/50 bg-hive-500/10 text-white"
                    : "border-dark-800 text-dark-400 hover:text-white"
              }`}
              title={!isAllowed ? `${channel.label} üst plan gerektirir` : undefined}
            >
              <span>{channel.icon}</span>
              {channel.label}
            </button>
          );
        })}
        <span className="text-[11px] text-dark-600 ml-auto">
          Seçim tüm genel kurallara anında uygulanır.
        </span>
      </div>
    </div>
  );
}
