"use client";

import { useState, useEffect, useCallback } from "react";

interface RefreshButtonProps {
  productId: string;
  initialStatus: string | null;
  onRefreshComplete: () => void;
}

export default function RefreshButton({
  productId,
  initialStatus,
  onRefreshComplete,
}: RefreshButtonProps) {
  const [status, setStatus] = useState<string | null>(initialStatus);
  const [error, setError] = useState<string | null>(null);

  const isActive = status === "pending" || status === "processing";

  // Poll for status updates
  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/status`);
      if (!res.ok) return;
      const data = await res.json();
      const refreshStatus = data.refreshStatus ?? data.data?.refreshStatus;
      setStatus(refreshStatus);

      if (refreshStatus === "completed") {
        setError(null);
        onRefreshComplete();
      } else if (refreshStatus === "failed") {
        const refreshError = data.refreshError ?? data.data?.refreshError;
        setError(refreshError || "Yenileme başarısız oldu");
      }
    } catch {
      // silently fail polling — will retry
    }
  }, [productId, onRefreshComplete]);

  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [isActive, pollStatus]);

  // Start polling immediately if initial status is active
  useEffect(() => {
    if (initialStatus === "pending" || initialStatus === "processing") {
      pollStatus();
    }
  }, [initialStatus, pollStatus]);

  const handleRefresh = async () => {
    setError(null);
    setStatus("pending");

    try {
      const res = await fetch(`/api/products/${productId}/refresh`, {
        method: "POST",
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus(null);
        setError(data.error || "Bir hata oluştu");
        return;
      }

      setStatus("pending");
    } catch {
      setStatus(null);
      setError("Bağlantı hatası");
    }
  };

  return (
    <div className="flex items-center gap-3">
      {/* Refresh Button */}
      <button
        onClick={handleRefresh}
        disabled={isActive}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
          isActive
            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 cursor-not-allowed"
            : "bg-amber-500 hover:bg-amber-400 text-black"
        }`}
      >
        {/* Spinner or Refresh Icon */}
        {isActive ? (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="opacity-25"
            />
            <path
              d="M4 12a8 8 0 018-8"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0115-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 01-15 6.7L3 16" />
          </svg>
        )}

        {isActive ? (status === "pending" ? "Sırada..." : "Yenileniyor...") : "Fiyatları Yenile"}
      </button>

      {/* Status Badge */}
      {status && <StatusBadge status={status} />}

      {/* Error Message */}
      {error && <span className="text-sm text-red-400">{error}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending: {
      label: "Sırada",
      className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
    },
    processing: {
      label: "İşleniyor",
      className: "bg-blue-500/10 text-blue-400 border-blue-500/30",
    },
    completed: {
      label: "Tamamlandı",
      className: "bg-green-500/10 text-green-400 border-green-500/30",
    },
    failed: {
      label: "Başarısız",
      className: "bg-red-500/10 text-red-400 border-red-500/30",
    },
  };

  const { label, className } = config[status] || {
    label: status,
    className: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${className}`}
    >
      {status === "processing" && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mr-1.5 animate-pulse" />
      )}
      {label}
    </span>
  );
}
