import Link from "next/link";

export default function DashboardPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Genel Bakış</h1>
        <p className="text-dark-500 text-sm">CompeteHive hesabınıza hoş geldiniz.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Takip Edilen", value: "0", sub: "ürün", icon: "📦" },
          { label: "Fiyat Değişimi", value: "0", sub: "son 24 saat", icon: "📊" },
          { label: "Aktif Uyarı", value: "0", sub: "kural", icon: "🔔" },
          { label: "Bildirim", value: "0", sub: "okunmamış", icon: "💬" },
        ].map((stat, i) => (
          <div key={i} className="bg-dark-900 border border-dark-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-dark-500 text-sm">{stat.label}</span>
              <span className="text-lg">{stat.icon}</span>
            </div>
            <div className="text-3xl font-bold text-white">{stat.value}</div>
            <div className="text-dark-600 text-xs mt-1">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-12 text-center">
        <div className="w-16 h-16 bg-hive-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-hive-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">İlk ürününüzü takibe alın</h2>
        <p className="text-dark-500 text-sm mb-6 max-w-md mx-auto">
          Trendyol veya Hepsiburada ürün linkini yapıştırarak rakip fiyatlarını takip etmeye başlayın.
        </p>
        <Link
          href="/dashboard/products"
          className="inline-flex items-center gap-2 bg-hive-500 hover:bg-hive-600 text-dark-1000 px-6 py-3 rounded-xl font-semibold text-sm transition"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Ürün Ekle
        </Link>
      </div>
    </div>
  );
}
