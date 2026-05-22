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
  const [data, setData] = useState(null);
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
      
        
        
      
    );
  }

  if (!data?.hasActivePlan) {
    return (
      
        Aktif Plan Yok
        Ürün takibine başlamak için bir plan seçin.
        
          href="/dashboard/checkout"
          className="inline-block mt-3 bg-amber-500 hover:bg-amber-400 text-black font-semibold px-3 py-1.5 rounded-lg text-sm transition-colors"
        >
          Plan Seç
        
      
    );
  }

  const percent =
    data.maxProducts > 0
      ? Math.min(100, Math.round((data.currentProductCount / data.maxProducts) * 100))
      : 0;
  const isNearLimit = percent >= 80;
  const isAtLimit = percent >= 100;

  return (
    
      
        
          Plan: {data.planDisplayName}
        
        {data.expiresAt && (
          
            Bitiş: {new Date(data.expiresAt).toLocaleDateString("tr-TR")}
          
        )}
      

      
        
          {data.currentProductCount}
           / {data.maxProducts >= 99999 ? "Sınırsız" : data.maxProducts} ürün
        
        {(isNearLimit || isAtLimit) && (
          
            Yükselt →
          
        )}
      

      
        
          className={`h-1.5 rounded-full transition-all ${
            isAtLimit ? "bg-red-500" : isNearLimit ? "bg-amber-500" : "bg-amber-500/60"
          }`}
          style={{ width: `${percent}%` }}
        >
      

      {isAtLimit && (
        
          Ürün limitinize ulaştınız. Yeni ürün ekleyemezsiniz.
        
      )}
    
  );
}
