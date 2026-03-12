interface EmptyStateProps {
  onAddProduct: () => void;
}

export function EmptyState({ onAddProduct }: EmptyStateProps) {
  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
      <div className="w-16 h-16 bg-dark-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <span className="text-3xl">📦</span>
      </div>
      <h2 className="text-lg font-bold text-white mb-2">Henuz urun eklenmedi</h2>
      <p className="text-dark-500 text-sm mb-6">
        Bir marketplace linkini yapistirin &mdash; diger sitelerdeki fiyatlar otomatik bulunacak.
      </p>
      <button
        onClick={onAddProduct}
        className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-6 py-3 rounded-xl font-semibold text-sm transition"
      >
        Ilk Urunu Ekle
      </button>
    </div>
  );
}
