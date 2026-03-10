import Link from "next/link";

export default function TermsPage() {
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
          <h1 className="text-4xl font-bold text-white mb-8">Kullanım Şartları</h1>

          <div className="space-y-8 text-dark-300 text-sm leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3">1. Hizmet Tanımı</h2>
              <p>
                CompeteHive, e-ticaret satıcıları için otomatik fiyat takibi ve rakip analizi hizmeti
                sunan bir platformdur. Platformumuz; ürün fiyatlarını izleme, rakip fiyatlarını karşılaştırma
                ve fiyat değişikliği bildirimleri gönderme hizmetlerini kapsar.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">2. Hesap Oluşturma</h2>
              <p>
                Hizmeti kullanabilmek için geçerli bir e-posta adresi ile hesap oluşturmanız gerekmektedir.
                Hesap bilgilerinizin güvenliğinden siz sorumlusunuz. Hesabınızda gerçekleşen tüm işlemlerden
                siz sorumlu tutulursunuz.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">3. Kullanım Kuralları</h2>
              <ul className="list-disc list-inside space-y-1 text-dark-400">
                <li>Platformu yalnızca yasal amaçlarla kullanabilirsiniz</li>
                <li>Otomatik botlar veya scraper&apos;lar ile platforma erişim yasaktır</li>
                <li>Diğer kullanıcıların hizmetini engelleyecek faaliyetlerde bulunamazsınız</li>
                <li>Yanıltıcı veya sahte bilgi paylaşamazsınız</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">4. Abonelik ve Ödeme</h2>
              <p>
                Ücretsiz plan ile sınırlı sayıda ürün takip edebilirsiniz. Ücretli planlar aylık
                faturalandırılır. İptal etmediğiniz sürece aboneliğiniz otomatik olarak yenilenir.
                İptal işlemi mevcut dönemin sonunda geçerli olur.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">5. Veri Doğruluğu</h2>
              <p>
                Fiyat verileri otomatik olarak toplanmaktadır ve %100 doğruluk garantisi verilmemektedir.
                CompeteHive, fiyat verilerindeki olası hatalardan kaynaklanan zararlardan sorumlu tutulamaz.
                Önemli iş kararları vermeden önce fiyat bilgilerini doğrulamanızı öneririz.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">6. Hizmet Değişiklikleri</h2>
              <p>
                CompeteHive, hizmette değişiklik yapma, fiyatları güncelleme veya hizmeti sonlandırma
                hakkını saklı tutar. Önemli değişiklikler önceden bildirilecektir.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">7. Sorumluluk Sınırı</h2>
              <p>
                CompeteHive, hizmetin kesintisiz veya hatasız çalışacağını garanti etmez. Platform
                kullanımından doğabilecek doğrudan veya dolaylı zararlardan sorumlu tutulamaz.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">8. İletişim</h2>
              <p>
                Kullanım şartları ile ilgili sorularınız için{" "}
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
            <Link href="/privacy" className="hover:text-white transition">Gizlilik</Link>
            <Link href="/terms" className="hover:text-white transition text-white">Kullanım Şartları</Link>
            <a href="mailto:support@competehive.com" className="hover:text-white transition">İletişim</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
