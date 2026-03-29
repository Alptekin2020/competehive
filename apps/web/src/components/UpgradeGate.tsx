"use client";

import Link from "next/link";

interface UpgradeGateProps {
  feature: string;
  requiredPlan: string;
  description?: string;
  currentPlan?: string;
  children?: React.ReactNode;
  compact?: boolean;
}

export default function UpgradeGate({
  feature,
  requiredPlan,
  description,
  compact = false,
}: UpgradeGateProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/20 rounded-xl">
        <svg
          className="w-4 h-4 text-amber-500 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        <span className="text-amber-400 text-xs font-medium">{feature}</span>
        <Link
          href="/dashboard/pricing"
          className="text-amber-500 text-xs font-semibold hover:text-amber-400 transition ml-auto"
        >
          {requiredPlan} →
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-[#111113] border border-amber-500/20 rounded-2xl p-8 text-center">
      <div className="w-14 h-14 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
        <svg
          className="w-7 h-7 text-amber-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
      </div>
      <h3 className="text-white font-semibold text-lg mb-2">{feature}</h3>
      <p className="text-gray-500 text-sm mb-5 max-w-sm mx-auto">
        {description || `Bu özellik ${requiredPlan} ve üzeri planlarda kullanılabilir.`}
      </p>
      <Link
        href="/dashboard/pricing"
        className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black px-6 py-2.5 rounded-xl font-semibold text-sm transition"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
        {requiredPlan} Planına Yükselt
      </Link>
    </div>
  );
}
