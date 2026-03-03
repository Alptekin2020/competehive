export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-900 to-brand-700">
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <nav className="flex justify-between items-center mb-20">
          <h1 className="text-2xl font-bold text-white">🐝 CompeteHive</h1>
          <div className="flex gap-4">
            <a href="/login" className="text-brand-200 hover:text-white transition">Giriş Yap</a>
            <a href="/register" className="bg-brand-500 text-white px-5 py-2 rounded-lg hover:bg-brand-400 transition">Ücretsiz Başla</a>
          </div>
        </nav>
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-5xl font-bold text-white leading-tight mb-6">
            Rakiplerinizin fiyatlarını<span className="text-brand-300"> otomatik takip edin</span>
          </h2>
          <p className="text-xl text-brand-200 mb-10">
            Trendyol, Hepsiburada, Amazon ve N11&apos;deki rakip fiyat değişikliklerinden anında haberdar olun. Fiyat stratejinizi veriye dayalı oluşturun.
          </p>
          <a href="/register" className="bg-white text-brand-700 px-8 py-4 rounded-xl font-semibold text-lg hover:bg-brand-50 transition shadow-lg inline-block">
            Ücretsiz Dene — 5 Ürün Takip Et →
          </a>
          <p className="text-brand-300 text-sm mt-4">Kredi kartı gerekmez • 30 saniyede kayıt olun</p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { icon: "📊", title: "Anlık Fiyat Takibi", desc: "Marketplace fiyatlarını 5 dk sıklıkla otomatik tarayın." },
            { icon: "🔔", title: "Akıllı Uyarılar", desc: "Fiyat değiştiğinde Telegram, e-posta veya webhook ile anında bildirim." },
            { icon: "📈", title: "Fiyat Geçmişi", desc: "Grafiklerle fiyat trendlerini analiz edin." },
            { icon: "🏪", title: "Çoklu Marketplace", desc: "Trendyol, Hepsiburada, Amazon TR ve N11 tek panelden." },
            { icon: "💬", title: "Telegram & E-posta", desc: "Bildirimleri istediğiniz kanaldan alın." },
            { icon: "⚡", title: "30 Saniyede Başla", desc: "URL yapıştırın, ürün otomatik tanınsın." },
          ].map((f, i) => (
            <div key={i} className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-6 hover:bg-white/10 transition">
              <div className="text-3xl mb-4">{f.icon}</div>
              <h4 className="text-lg font-semibold text-white mb-2">{f.title}</h4>
              <p className="text-brand-200 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-16">
        <h3 className="text-3xl font-bold text-white text-center mb-12">Basit & Şeffaf Fiyatlandırma</h3>
        <div className="grid md:grid-cols-4 gap-6">
          {[
            { plan: "Free", price: "$0", features: ["5 ürün", "Günde 1 tarama", "1 marketplace", "E-posta bildirimi"], hl: false },
            { plan: "Starter", price: "$29", features: ["50 ürün", "Saatte 1 tarama", "2 marketplace", "Telegram + E-posta"], hl: true },
            { plan: "Pro", price: "$79", features: ["500 ürün", "15 dk tarama", "Tüm marketplace", "Oto-fiyat kuralları"], hl: false },
            { plan: "Enterprise", price: "$199", features: ["Sınırsız ürün", "5 dk tarama", "API erişimi", "Webhook + Özel"], hl: false },
          ].map((p, i) => (
            <div key={i} className={`rounded-xl p-6 ${p.hl ? "bg-brand-500 border-2 border-brand-300 shadow-lg" : "bg-white/5 border border-white/10"}`}>
              <h4 className={`text-lg font-semibold mb-1 ${p.hl ? "text-white" : "text-brand-200"}`}>{p.plan}</h4>
              <div className="text-3xl font-bold text-white mb-4">{p.price}<span className="text-sm font-normal text-brand-200">/ay</span></div>
              <ul className="space-y-2">
                {p.features.map((f, j) => (
                  <li key={j} className={`text-sm ${p.hl ? "text-brand-100" : "text-brand-200"}`}>✓ {f}</li>
                ))}
              </ul>
              <a href="/register" className={`block text-center mt-6 py-2 rounded-lg font-medium transition ${p.hl ? "bg-white text-brand-700 hover:bg-brand-50" : "bg-brand-500/30 text-white hover:bg-brand-500/50"}`}>Başla</a>
            </div>
          ))}
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-8 border-t border-brand-600">
        <p className="text-center text-brand-300 text-sm">© 2026 CompeteHive. Tüm hakları saklıdır.</p>
      </footer>
    </main>
  );
}
