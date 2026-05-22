"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface PlanData {
  hasActivePlan: boolean;
  plan: string | null;
  planDisplayName: string | null;
  maxProducts: number;
  currentProductCount: number;
  expiresAt: string | null;
}

export function PlanUsageCard() {
  const [data, setData] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/account/plan")
      .then((r) => r.json())
      .then((json) => {
        if (json && typeof json === "object" && !json.error) {
          setData(json as PlanData);
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-dark-900 border border-dark-800 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-dark-800 rounded w-32 mb-3"></div>
        <div className="h-6 bg-dark-800 rounded w-48"></div>
      </div>
    );
  }

  if (!data?.hasActivePlan) {
    return (
      <div className="bg-dark-900 border border-amber-500/30 rounded-xl p-4">
        <p className="text-amber-400 text-sm font-semibold">Aktif Plan Yok</p>
        <p className="text-gray-400 text-xs mt-1">Ürün takibine başlamak için bir plan seçin.</p>
        <Link
          href="/dashboard/checkout"
          className="inline-block mt-3 bg-amber-500 hover:bg-amber-400 text-black font-semibold px-3 py-1.5 rounded-lg text-sm transition-colors"
        >
          Plan Seç
        </Link>
      </div>
    );
  }

  const percent =
    data.maxProducts > 0
      ? Math.min(100, Math.round((data.currentProductCount / data.maxProducts) * 100))
      : 0;
  const isNearLimit = percent >= 80;
  const isAtLimit = percent >= 100;

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-sm">
          Plan: <span className="text-white font-medium">{data.planDisplayName}</span>
        </p>
        {data.expiresAt && (
          <p className="text-xs text-gray-500">
            Bitiş: {new Date(data.expiresAt).toLocaleDateString("tr-TR")}
          </p>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <p className="text-white">
          <span className="text-2xl font-bold">{data.currentProductCount}</span>
          <span className="text-gray-400 text-sm"> / {data.maxProducts} ürün</span>
        </p>
        {(isNearLimit || isAtLimit) && (
          <Link href="/dashboard/checkout" className="text-amber-400 text-xs hover:text-amber-300">
            Yükselt →
          </Link>
        )}
      </div>

      <div className="mt-2 w-full bg-dark-800 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all ${
            isAtLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-amber-500/60"
          }`}
          style={{ width: `${percent}%` }}
        ></div>
      </div>

      {isAtLimit && (
        <p className="mt-2 text-xs text-red-400">
          Ürün limitinize ulaştınız. Yeni ürün ekleyemezsiniz.
        </p>
      )}
    </div>
  );
}
