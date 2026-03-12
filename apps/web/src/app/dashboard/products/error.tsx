"use client";

export default function ProductsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 text-center max-w-md">
        <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-red-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-white mb-2">Urunler yuklenemedi</h2>
        <p className="text-dark-500 text-sm mb-6">
          {error.message || "Urunler yuklenirken bir hata olustu."}
        </p>
        <button
          onClick={reset}
          className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-6 py-2.5 rounded-xl font-semibold text-sm transition"
        >
          Tekrar Dene
        </button>
      </div>
    </div>
  );
}
