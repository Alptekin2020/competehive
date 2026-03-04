import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-dark-1000">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-dark-1000/80 backdrop-blur-xl border-b border-dark-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-hive-500 rounded-lg flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="text-lg font-bold text-white">CompeteHive</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link href="/login" className="text-dark-400 hover:text-white transition text-sm">
              Giriş Yap
            </Link>
            <Link href="/register" className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-4 py-2 rounded-lg text-sm font-semibold transition">
              Ücretsiz Başla
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-hive-500/10 border border-hive-500/20 rounded-full px-4 py-1.5 mb-8">
            <div className="w-2 h-2 bg-hive-500 rounded-full animate-pulse" />
            <span className="text-hive-400 text-sm font-medium">Hive Ekosistemi Ürünü</span>
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-white leading-tight mb-6">
            Rakiplerinizin fiyatlarını{" "}
            <span className="text-hive-500">otomatik takip edin</span>
          </h1>
          <p className="text-lg text-dark-400 mb-10 max-w-2xl mx-auto">
            Trendyol, Hepsiburada, Amazon ve N11&apos;deki rakip fiyat değişikliklerinden
            anında haberdar olun. Fiyat stratejinizi veriye dayalı oluşturun.
          </p>
          <div className="flex justify-center gap-4">
            <Link href="/register" className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-8 py-3.5 rounded-xl font-semibold transition inline-flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Ücretsiz Başla
            </Link>
            <Link href="#features" className="border border-dark-700 hover:border-dark-500 text-white px-8 py-3.5 rounded-xl font-medium transition">
              Nasıl Çalışır →
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">Neden CompeteHive?</h2>
          <p className="text-dark-400 text-center mb-16 max-w-xl mx-auto">E-ticaret satıcıları için rakip fiyat istihbaratı</p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { icon: "📊", title: "Anlık Fiyat Takibi", desc: "Marketplace fiyatlarını 5 dk sıklıkla otomatik tarayın." },
              { icon: "🔔", title: "Akıllı Uyarılar", desc: "Fiyat değiştiğinde Telegram ve e-posta ile anında bildirim." },
              { icon: "📈", title: "Fiyat Geçmişi", desc: "Grafiklerle fiyat trendlerini analiz edin." },
              { icon: "🏪", title: "Çoklu Marketplace", desc: "Trendyol, Hepsiburada, Amazon TR ve N11 tek panelden." },
            ].map((f, i) => (
              <div key={i} className="bg-dark-900 border border-dark-800 rounded-2xl p-6 hover:border-hive-500/30 transition group">
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="text-white font-semibold mb-2 group-hover:text-hive-400 transition">{f.title}</h3>
                <p className="text-dark-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 px-6 bg-dark-950">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">Basit Fiyatlandırma</h2>
          <p className="text-dark-400 text-center mb-16">Her ölçekte e-ticaret satıcıları için</p>
          <div className="grid md:grid-cols-4 gap-4">
            {[
              { plan: "Free", price: "$0", features: ["5 ürün", "Günde 1 tarama", "1 marketplace", "E-posta bildirimi"], hl: false },
              { plan: "Starter", price: "$29", features: ["50 ürün", "Saatte 1 tarama", "2 marketplace", "Telegram + E-posta"], hl: true },
              { plan: "Pro", price: "$79", features: ["500 ürün", "15 dk tarama", "Tüm marketplace", "Oto-fiyat kuralları"], hl: false },
              { plan: "Enterprise", price: "$199", features: ["Sınırsız ürün", "5 dk tarama", "API erişimi", "Webhook + Özel"], hl: false },
            ].map((p, i) => (
              <div key={i} className={`rounded-2xl p-6 border transition ${p.hl ? "bg-hive-500/10 border-hive-500/40" : "bg-dark-900 border-dark-800 hover:border-dark-700"}`}>
                <div className={`text-sm font-medium mb-1 ${p.hl ? "text-hive-400" : "text-dark-400"}`}>{p.plan}</div>
                <div className="text-3xl font-bold text-white mb-1">{p.price}<span className="text-sm font-normal text-dark-500">/ay</span></div>
                {p.hl && <div className="text-xs text-hive-500 font-medium mb-4">En Popüler</div>}
                {!p.hl && <div className="mb-4" />}
                <ul className="space-y-2.5">
                  {p.features.map((f, j) => (
                    <li key={j} className="text-sm text-dark-300 flex items-center gap-2">
                      <svg className={`w-4 h-4 flex-shrink-0 ${p.hl ? "text-hive-500" : "text-dark-600"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/register" className={`block text-center mt-6 py-2.5 rounded-xl text-sm font-semibold transition ${p.hl ? "bg-hive-500 text-dark-1000 hover:bg-hive-600" : "border border-dark-700 text-white hover:border-dark-500"}`}>
                  Başla
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Rakipleriniz fiyat değiştirdiğinde ilk siz bilin</h2>
          <p className="text-dark-400 mb-8">Ücretsiz başlayın, kredi kartı gerekmez.</p>
          <Link href="/register" className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-8 py-3.5 rounded-xl font-semibold transition inline-block">
            Ücretsiz Dene →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-dark-800 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-hive-500 rounded flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0A0A0B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/>
                <path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <span className="text-sm text-dark-400">© 2026 CompeteHive. Hive Ecosystem.</span>
          </div>
          <div className="flex gap-6 text-sm text-dark-500">
            <Link href="/privacy" className="hover:text-white transition">Gizlilik</Link>
            <Link href="/terms" className="hover:text-white transition">Kullanım Şartları</Link>
            <a href="mailto:support@competehive.com" className="hover:text-white transition">İletişim</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
