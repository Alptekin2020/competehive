import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-dark-1000">
      <nav className="fixed top-0 w-full z-50 bg-dark-1000/80 backdrop-blur-xl border-b border-dark-800">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/competehive-logo.png" alt="CompeteHive" className="w-8 h-8" />
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

      <div className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-white mb-8">Gizlilik Politikası</h1>

          <div className="space-y-8 text-dark-300 text-sm leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3">1. Toplanan Veriler</h2>
              <p>
                CompeteHive, hizmetlerimizi sunabilmek için aşağıdaki verileri toplar:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-dark-400">
                <li>E-posta adresi ve ad bilgisi (hesap oluşturma için)</li>
                <li>Takip ettiğiniz ürün URL&apos;leri ve fiyat verileri</li>
                <li>Bildirim tercihleri (Telegram Chat ID, webhook URL)</li>
                <li>Kullanım istatistikleri ve oturum bilgileri</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">2. Verilerin Kullanımı</h2>
              <p>
                Topladığımız veriler yalnızca aşağıdaki amaçlarla kullanılır:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-dark-400">
                <li>Fiyat takip hizmetinin sağlanması</li>
                <li>Fiyat değişikliği bildirimlerinin gönderilmesi</li>
                <li>Hesap yönetimi ve müşteri desteği</li>
                <li>Hizmet kalitesinin iyileştirilmesi</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">3. Veri Güvenliği</h2>
              <p>
                Verileriniz endüstri standardı güvenlik önlemleriyle korunmaktadır. Şifrelenmiş bağlantılar (SSL/TLS) kullanılmakta
                ve verileriniz güvenli sunucularda saklanmaktadır.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">4. Üçüncü Taraflarla Paylaşım</h2>
              <p>
                Kişisel verileriniz, yasal zorunluluklar dışında üçüncü taraflarla paylaşılmaz.
                Hizmet sağlayıcılarımız (kimlik doğrulama, e-posta gönderimi) yalnızca hizmet sunumu
                için gerekli minimum veriyi işler.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">5. Haklarınız</h2>
              <p>
                Verilerinize erişim, düzeltme veya silme talebinde bulunabilirsiniz. Hesabınızı
                sildiğinizde tüm verileriniz kalıcı olarak kaldırılır.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">6. İletişim</h2>
              <p>
                Gizlilik ile ilgili sorularınız için{" "}
                <a href="mailto:support@competehive.com" className="text-hive-500 hover:underline">
                  support@competehive.com
                </a>{" "}
                adresinden bize ulaşabilirsiniz.
              </p>
            </section>

            <p className="text-dark-500 text-xs pt-4 border-t border-dark-800">
              Son güncelleme: Mart 2026
            </p>
          </div>
        </div>
      </div>

      <footer className="border-t border-dark-800 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <img src="/competehive-logo.png" alt="CompeteHive" className="w-8 h-8" />
            <span className="text-sm text-dark-400">&copy; 2026 CompeteHive. Hive Ecosystem.</span>
          </div>
          <div className="flex gap-6 text-sm text-dark-500">
            <Link href="/privacy" className="hover:text-white transition text-white">Gizlilik</Link>
            <Link href="/terms" className="hover:text-white transition">Kullanım Şartları</Link>
            <a href="mailto:support@competehive.com" className="hover:text-white transition">İletişim</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
