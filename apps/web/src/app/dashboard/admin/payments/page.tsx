"use client";

import { useCallback, useEffect, useState } from "react";
import { CardSkeleton, StatCardSkeleton } from "@/components/Skeleton";
import ErrorState from "@/components/ErrorState";

type CheckStatus = "ok" | "warn" | "error";

interface ConfigCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  details?: string[];
}

interface Section {
  id: string;
  title: string;
  checks: ConfigCheck[];
}

interface WhopConfigData {
  generatedAt: string;
  webhookUrl: string;
  summary: Record<CheckStatus, number>;
  sections: Section[];
}

const STATUS_STYLE: Record<CheckStatus, { icon: string; className: string; label: string }> = {
  ok: { icon: "✓", className: "bg-emerald-500/10 text-emerald-400", label: "Doğru" },
  warn: { icon: "!", className: "bg-amber-500/10 text-amber-400", label: "Uyarı" },
  error: { icon: "✕", className: "bg-red-500/10 text-red-400", label: "Hata" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PaymentsAdminPage() {
  const [data, setData] = useState<WhopConfigData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/whop-config", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Kontrol çalıştırılamadı");
        return;
      }
      setData(json as WhopConfigData);
    } catch (err) {
      console.error("Whop config check failed", err);
      setError("Kontrol çalıştırılamadı");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = data
    ? [
        { label: "Doğru", value: data.summary.ok, className: "text-emerald-400" },
        { label: "Uyarı", value: data.summary.warn, className: "text-amber-400" },
        { label: "Hata", value: data.summary.error, className: "text-red-400" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Ödeme Ayarları</h1>
          <p className="text-sm text-dark-400 mt-1">
            Whop yapılandırmasının teşhisi. Gizli değerler gösterilmez; yalnızca tanımlı olup
            olmadıkları ve Whop&apos;taki planların ürün, para birimi ve fiyat eşleşmesi kontrol
            edilir.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="self-start px-4 py-2 rounded-lg text-sm font-semibold bg-hive-500 hover:bg-hive-400 text-black transition disabled:opacity-50"
        >
          {loading ? "Kontrol ediliyor…" : "Yeniden kontrol et"}
        </button>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading || !data ? (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <CardSkeleton />
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-dark-900 border border-dark-800 rounded-xl p-4">
                <p className="text-dark-400 text-sm">{stat.label}</p>
                <p className={`text-2xl font-bold mt-1 ${stat.className}`}>{stat.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-dark-900 border border-dark-800 rounded-xl p-4 space-y-1">
            <p className="text-dark-400 text-sm">Whop panelindeki webhook adresi bu olmalı</p>
            <p className="text-white font-mono text-sm break-all">{data.webhookUrl}</p>
            <p className="text-xs text-dark-500">Son kontrol: {formatDate(data.generatedAt)}</p>
          </div>

          {data.sections.map((section) => (
            <div key={section.id} className="space-y-3">
              <h2 className="text-lg font-semibold text-white">{section.title}</h2>
              <div className="space-y-2">
                {section.checks.map((check) => {
                  const style = STATUS_STYLE[check.status];
                  return (
                    <div
                      key={check.id}
                      className="bg-dark-900 border border-dark-800 rounded-xl p-4 flex gap-3"
                    >
                      <span
                        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${style.className}`}
                        aria-label={style.label}
                      >
                        {style.icon}
                      </span>
                      <div className="min-w-0 space-y-1">
                        <p className="text-white text-sm font-medium break-all">{check.label}</p>
                        <p className="text-dark-300 text-xs break-all">{check.detail}</p>
                        {check.details && check.details.length > 0 && (
                          <ul className="space-y-0.5">
                            {check.details.map((line) => (
                              <li key={line} className="text-xs text-dark-200">
                                • {line}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
