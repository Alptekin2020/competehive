import Link from "next/link";

export const metadata = {
  title: "KVKK Aydınlatma Metni — CompeteHive",
  description:
    "6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında kişisel veri işleme aydınlatma metni.",
};

export default function KvkkPage() {
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
            <Link
              href="/register"
              className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-4 py-2 rounded-lg text-sm font-semibold transition"
            >
              Ücretsiz Başla
            </Link>
          </div>
        </div>
      </nav>

      <div className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-4xl font-bold text-white mb-8">KVKK Aydınlatma Metni</h1>

          <div className="space-y-8 text-dark-300 text-sm leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3">1. Veri Sorumlusu</h2>
              <p>
                6698 sayılı Kişisel Verilerin Korunması Kanunu (&quot;KVKK&quot;) uyarınca kişisel
                verileriniz, veri sorumlusu sıfatıyla{" "}
                <span className="text-white">CompeteHive</span> tarafından aşağıda açıklanan kapsamda
                işlenmektedir.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">2. İşlenen Kişisel Veriler</h2>
              <ul className="list-disc list-inside mt-2 space-y-1 text-dark-400">
                <li>Kimlik ve iletişim verileri: ad, e-posta adresi</li>
                <li>
                  Hesap ve kullanım verileri: takip edilen ürün URL&apos;leri, fiyat verileri,
                  bildirim tercihleri (Telegram, webhook)
                </li>
                <li>İşlem güvenliği verileri: oturum ve log kayıtları</li>
              </ul>
              <p className="mt-2">
                Ödeme işlemleri Whop üzerinden yürütülür; kredi kartı bilgileriniz CompeteHive
                tarafından saklanmaz.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">3. İşleme Amaçları</h2>
              <ul className="list-disc list-inside mt-2 space-y-1 text-dark-400">
                <li>Fiyat takip hizmetinin sunulması ve hesabınızın yönetilmesi</li>
                <li>Fiyat değişikliği bildirimlerinin iletilmesi</li>
                <li>Müşteri desteği sağlanması</li>
                <li>Hizmet kalitesinin ölçülmesi ve iyileştirilmesi</li>
                <li>Yasal yükümlülüklerin yerine getirilmesi</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">4. Hukuki Sebepler</h2>
              <p>
                Kişisel verileriniz KVKK m.5 kapsamında; sözleşmenin kurulması ve ifası, veri
                sorumlusunun meşru menfaati, hukuki yükümlülüğün yerine getirilmesi ve gerekli
                hallerde açık rızanız hukuki sebeplerine dayanılarak işlenir.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">5. Aktarım</h2>
              <p>
                Verileriniz; kimlik doğrulama, e-posta gönderimi, ödeme ve barındırma gibi hizmet
                sağlayıcılarla, yalnızca hizmetin sunumu için gerekli ölçüde paylaşılır. Yurt dışına
                aktarım söz konusu olduğunda KVKK&apos;daki şartlara uyulur.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">6. Saklama Süresi</h2>
              <p>
                Kişisel verileriniz, hesabınız aktif olduğu süre boyunca ve ilgili mevzuatta
                öngörülen süreler kadar saklanır. Hesabınızı sildiğinizde, yasal saklama
                yükümlülükleri saklı kalmak kaydıyla verileriniz kalıcı olarak silinir.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">7. Haklarınız (KVKK m.11)</h2>
              <p>KVKK&apos;nın 11. maddesi uyarınca aşağıdaki haklara sahipsiniz:</p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-dark-400">
                <li>Kişisel verilerinizin işlenip işlenmediğini öğrenme</li>
                <li>İşlenmişse buna ilişkin bilgi talep etme</li>
                <li>İşlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme</li>
                <li>Yurt içinde/yurt dışında aktarıldığı üçüncü kişileri bilme</li>
                <li>Eksik veya yanlış işlenmişse düzeltilmesini isteme</li>
                <li>Silinmesini veya yok edilmesini isteme</li>
                <li>Yapılan işlemlerin aktarıldığı üçüncü kişilere bildirilmesini isteme</li>
                <li>
                  Münhasıran otomatik sistemlerle analiz sonucu aleyhinize bir sonuç çıkmasına itiraz
                  etme ve zarara uğramanız halinde tazminini talep etme
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">8. Başvuru</h2>
              <p>
                Haklarınıza ilişkin taleplerinizi{" "}
                <a href="mailto:support@competehive.com" className="text-hive-500 hover:underline">
                  support@competehive.com
                </a>{" "}
                adresine iletebilirsiniz. Başvurularınız en geç 30 gün içinde sonuçlandırılır.
              </p>
            </section>

            <p className="text-dark-500 text-xs pt-4 border-t border-dark-800">
              Son güncelleme: Mayıs 2026
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
            <Link href="/privacy" className="hover:text-white transition">
              Gizlilik
            </Link>
            <Link href="/terms" className="hover:text-white transition">
              Kullanım Şartları
            </Link>
            <Link href="/kvkk" className="hover:text-white transition text-white">
              KVKK
            </Link>
            <Link href="/cerez" className="hover:text-white transition">
              Çerez
            </Link>
            <Link href="/destek" className="hover:text-white transition">
              Destek
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
