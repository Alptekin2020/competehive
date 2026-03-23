"use client";

import Link from "next/link";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: EmptyStateProps) {
  const defaultIcon = (
    <svg
      className="w-8 h-8 text-amber-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );

  return (
    <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-12 text-center">
      <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
        {icon || defaultIcon}
      </div>
      <h2 className="text-lg font-bold text-white mb-2">{title}</h2>
      <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">{description}</p>
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black px-6 py-2.5 rounded-xl font-semibold text-sm transition"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {actionLabel}
        </Link>
      )}
      {actionLabel && onAction && !actionHref && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black px-6 py-2.5 rounded-xl font-semibold text-sm transition"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
