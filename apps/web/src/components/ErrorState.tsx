"use client";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export default function ErrorState({
  title = "Bir hata oluştu",
  message = "Veriler yüklenirken bir sorun oluştu. Lütfen tekrar deneyin.",
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="bg-[#111113] border border-[#1F1F23] rounded-2xl p-12 text-center">
      <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <svg
          className="w-8 h-8 text-red-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h2 className="text-lg font-bold text-white mb-2">{title}</h2>
      <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black px-6 py-2.5 rounded-xl font-semibold text-sm transition"
        >
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
          Tekrar Dene
        </button>
      )}
    </div>
  );
}
