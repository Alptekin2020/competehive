interface AddProductModalProps {
  url: string;
  onUrlChange: (url: string) => void;
  loading: boolean;
  error: string;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function AddProductModal({
  url,
  onUrlChange,
  loading,
  error,
  onSubmit,
  onClose,
}: AddProductModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !loading && onClose()}
      />
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 w-full max-w-lg relative z-10">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Urun Ekle</h2>
          <button
            onClick={() => !loading && onClose()}
            className="text-dark-500 hover:text-white transition"
          >
            <svg
              className="w-5 h-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-4">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <label className="block text-sm font-medium text-dark-300 mb-2">Urun URL&apos;si</label>
          <input
            type="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            className="w-full bg-dark-950 border border-dark-800 rounded-xl px-4 py-3 text-white placeholder-dark-600 focus:outline-none focus:border-hive-500/50 transition text-sm mb-2"
            placeholder="https://www.trendyol.com/... veya baska marketplace"
            required
            disabled={loading}
          />
          <p className="text-dark-600 text-xs mb-6">
            Herhangi bir e-ticaret sitesinin urun linkini yapistirin. Diger marketplace&apos;lerdeki
            fiyatlar otomatik bulunacak.
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => !loading && onClose()}
              className="flex-1 border border-dark-700 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-dark-800 transition"
              disabled={loading}
            >
              Iptal
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-hive-500 hover:bg-hive-600 disabled:opacity-50 text-dark-1000 py-2.5 rounded-xl text-sm font-semibold transition"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeDasharray="30 70"
                    />
                  </svg>
                  AI analiz ediyor...
                </span>
              ) : (
                "Takibe Al"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
