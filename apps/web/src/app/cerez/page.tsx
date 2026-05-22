import Link from "next/link";

export const metadata = {
  title: "Çerez Aydınlatma Metni — CompeteHive",
  description: "CompeteHive web sitesinde kullanılan çerezler ve çerez tercihleri hakkında bilgi.",
};

export default function CerezPage() {
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
          <h1 className="text-4xl font-bold text-white mb-8">Çerez Aydınlatma Metni</h1>

          <div className="space-y-8 text-dark-300 text-sm leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3">1. Çerez Nedir?</h2>
              <p>
                Çerezler, web sitelerini ziyaret ettiğinizde tarayıcınıza kaydedilen küçük metin
                dosyalarıdır. CompeteHive, hizmetin çalışması ve deneyiminizi iyileştirmek için
                çerezlerden yararlanır.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">2. Kullandığımız Çerezler</h2>
              <ul className="list-disc list-inside mt-2 space-y-1 text-dark-400">
                <li>
                  <span className="text-white">Zorunlu çerezler:</span> Oturum açma ve güvenlik gibi
                  temel işlevler için gereklidir; devre dışı bırakılamaz.
                </li>
                <li>
                  <span className="text-white">İşlevsel çerezler:</span> Tercihlerinizi (ör. çerez
                  onayı) hatırlamak için kullanılır.
                </li>
                <li>
                  <span className="text-white">Analitik çerezler:</span> Sitenin nasıl kullanıldığını
                  anlamak ve hizmeti iyileştirmek için anonim istatistikler toplar.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">3. Çerez Tercihleriniz</h2>
              <p>
                Tarayıcınızın ayarlarından çerezleri silebilir veya engelleyebilirsiniz. Zorunlu
                çerezleri engellemeniz halinde sitenin bazı bölümleri düzgün çalışmayabilir.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">4. İlgili Metinler</h2>
              <p>
                Kişisel verilerinizin işlenmesi hakkında ayrıntılı bilgi için{" "}
                <Link href="/kvkk" className="text-hive-500 hover:underline">
                  KVKK Aydınlatma Metni
                </Link>{" "}
                ve{" "}
                <Link href="/privacy" className="text-hive-500 hover:underline">
                  Gizlilik Politikası
                </Link>{" "}
                sayfalarımızı inceleyebilirsiniz.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">5. İletişim</h2>
              <p>
                Çerezlerle ilgili sorularınız için{" "}
                <a href="mailto:kvkk@competehive.com" className="text-hive-500 hover:underline">
                  kvkk@competehive.com
                </a>{" "}
                adresine yazabilirsiniz.
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
            <Link href="/kvkk" className="hover:text-white transition">
              KVKK
            </Link>
            <Link href="/cerez" className="hover:text-white transition text-white">
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
