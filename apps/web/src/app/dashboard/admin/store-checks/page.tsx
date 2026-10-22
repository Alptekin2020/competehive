"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CardSkeleton, StatCardSkeleton } from "@/components/Skeleton";
import ErrorState from "@/components/ErrorState";

interface DomainRow {
  domain: string;
  checks: number;
  lastCheckedAt: string;
  latestSupport: string;
  latestIssues: string[];
  latestUrl: string;
  emails: string[];
}

interface StoreChecksData {
  days: number;
  totals: {
    checks: number;
    domains: number;
    waitlistEmails: number;
    bySupport: Record<string, number>;
  };
  domains: DomainRow[];
}

const SUPPORT_BADGE: Record<string, { label: string; className: string }> = {
  full: { label: "Tam", className: "bg-emerald-500/10 text-emerald-400" },
  partial: { label: "Kısmi", className: "bg-amber-500/10 text-amber-400" },
  unsupported: { label: "Desteklenmiyor", className: "bg-red-500/10 text-red-400" },
};

const DAY_OPTIONS = [7, 30, 90, 365];
type SupportFilter = "all" | "unsupported" | "partial" | "full";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StoreChecksAdminPage() {
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<SupportFilter>("unsupported");
  const [data, setData] = useState<StoreChecksData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/store-checks?days=${days}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Veriler yüklenemedi");
        return;
      }
      setData(json as StoreChecksData);
    } catch (err) {
      console.error("Store checks admin load failed", err);
      setError("Veriler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (data?.domains ?? []).filter((row) => filter === "all" || row.latestSupport === filter),
    [data, filter],
  );

  const stats = data
    ? [
        { label: "Toplam kontrol", value: data.totals.checks },
        { label: "Farklı alan adı", value: data.totals.domains },
        { label: "Desteklenmeyen kontrol", value: data.totals.bySupport.unsupported ?? 0 },
        { label: "Haber bekleyen e-posta", value: data.totals.waitlistEmails },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Site Talepleri</h1>
          <p className="text-sm text-dark-400 mt-1">
            Ana sayfadaki &quot;Siteniz uyumlu mu?&quot; kontrolünde denenen siteler. Desteklenmeyen
            ve çok istenen alan adları, hangi altyapıya önce destek ekleneceğini gösterir.
          </p>
        </div>
        <div className="flex gap-1 bg-dark-900 border border-dark-800 rounded-xl p-1 self-start">
          {DAY_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => setDays(option)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                days === option ? "bg-hive-500/10 text-hive-400" : "text-dark-400 hover:text-white"
              }`}
            >
              {option} gün
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : loading || !data ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <StatCardSkeleton key={i} />
            ))}
          </div>
          <CardSkeleton />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-dark-900 border border-dark-800 rounded-xl p-4">
                <p className="text-dark-400 text-sm">{stat.label}</p>
                <p className="text-2xl font-bold text-white mt-1">
                  {stat.value.toLocaleString("tr-TR")}
                </p>
              </div>
            ))}
          </div>

          <div className="flex gap-2 flex-wrap">
            {(["unsupported", "partial", "full", "all"] as SupportFilter[]).map((option) => (
              <button
                key={option}
                onClick={() => setFilter(option)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                  filter === option
                    ? "border-hive-500/40 text-hive-400 bg-hive-500/10"
                    : "border-dark-800 text-dark-400 hover:text-white"
                }`}
              >
                {option === "all" ? "Tümü" : SUPPORT_BADGE[option].label}
              </button>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="bg-dark-900 border border-dark-800 rounded-xl p-8 text-center text-sm text-dark-400">
              Bu aralıkta kayıt yok.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => {
                const badge = SUPPORT_BADGE[row.latestSupport];
                return (
                  <div
                    key={row.domain}
                    className="bg-dark-900 border border-dark-800 rounded-xl p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-white font-semibold truncate">{row.domain}</span>
                        {badge && (
                          <span
                            className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-dark-400">
                        {row.checks} kontrol · son: {formatDate(row.lastCheckedAt)}
                      </div>
                    </div>
                    {row.latestUrl && (
                      <a
                        href={row.latestUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="block text-xs text-hive-400 hover:underline truncate"
                      >
                        {row.latestUrl}
                      </a>
                    )}
                    {row.latestIssues.length > 0 && (
                      <ul className="space-y-0.5">
                        {row.latestIssues.map((issue) => (
                          <li key={issue} className="text-xs text-dark-300">
                            • {issue}
                          </li>
                        ))}
                      </ul>
                    )}
                    {row.emails.length > 0 && (
                      <p className="text-xs text-dark-400">
                        Haber bekleyen ({row.emails.length}):{" "}
                        <span className="text-dark-200 break-all">{row.emails.join(", ")}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
