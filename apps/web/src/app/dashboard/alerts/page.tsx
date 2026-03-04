export default function AlertsPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Uyarılar</h1>
        <p className="text-dark-500 text-sm">Fiyat değişikliği uyarı kurallarınızı yönetin.</p>
      </div>

      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
        <div className="w-16 h-16 bg-dark-800 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">🔔</span>
        </div>
        <h2 className="text-lg font-bold text-white mb-2">Henüz uyarı kuralı yok</h2>
        <p className="text-dark-500 text-sm mb-6 max-w-md mx-auto">
          Önce bir ürün takibe alın, sonra o ürün için fiyat değişikliği uyarısı oluşturun.
        </p>
      </div>
    </div>
  );
}
