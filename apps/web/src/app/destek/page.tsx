import Link from "next/link";

export const metadata = {
  title: "Destek — CompeteHive",
  description: "CompeteHive destek ve sıkça sorulan sorular.",
};

export default function DestekPage() {
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
          <h1 className="text-4xl font-bold text-white mb-4">Destek</h1>
          <p className="text-dark-300 text-sm leading-relaxed mb-8">
            Sorularınız için buradayız. Aşağıdaki sıkça sorulan soruları inceleyebilir veya doğrudan
            bize yazabilirsiniz. Genellikle <span className="text-white font-medium">24 saat</span>{" "}
            içinde yanıt veriyoruz.
          </p>

          <div className="bg-[#111113] border border-[#1F1F23] rounded-xl p-6 mb-10">
            <p className="text-sm text-dark-300">
              E-posta:{" "}
              <a href="mailto:support@competehive.com" className="text-hive-500 hover:underline">
                support@competehive.com
              </a>
            </p>
            <p className="text-xs text-dark-500 mt-2">
              Yanıt süresi: ortalama 24 saat (iş günleri)
            </p>
            <p className="text-xs text-dark-500 mt-2">
              Adım adım kullanım rehberi için panel içindeki{" "}
              <Link href="/dashboard/yardim" className="text-hive-500 hover:underline">
                Yardım sayfasına
              </Link>{" "}
              bakın.
            </p>
          </div>

          <h2 className="text-xl font-semibold text-white mb-4">Sıkça Sorulan Sorular</h2>
          <div className="space-y-3">
            <details className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
              <summary className="cursor-pointer text-white font-medium">
                Nasıl ürün eklerim?
              </summary>
              <p className="text-dark-300 text-sm mt-3 leading-relaxed">
                Panele giriş yaptıktan sonra &quot;İlk Ürünü Ekle&quot; butonuna tıklayın ve takip
                etmek istediğiniz ürünün bağlantısını (Trendyol, Hepsiburada, Amazon TR, N11 veya
                MediaMarkt) yapıştırın. CompeteHive rakip ürünleri otomatik olarak bulup eşleştirir.
              </p>
            </details>
            <details className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
              <summary className="cursor-pointer text-white font-medium">
                Fiyatlar ne sıklıkta güncellenir?
              </summary>
              <p className="text-dark-300 text-sm mt-3 leading-relaxed">
                Tarama sıklığı planınıza göre değişir ve fiyatlar düzenli aralıklarla otomatik
                olarak yenilenir. Ayrıca ürün detay sayfasındaki &quot;Şimdi Yenile&quot; butonuyla
                dilediğiniz an manuel güncelleme yapabilirsiniz.
              </p>
            </details>
            <details className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
              <summary className="cursor-pointer text-white font-medium">
                Planımı nasıl değiştirebilirim?
              </summary>
              <p className="text-dark-300 text-sm mt-3 leading-relaxed">
                Panel üzerinden plan sayfasına giderek aboneliğinizi yükseltebilir veya
                değiştirebilirsiniz. Ödemeler güvenli şekilde Whop üzerinden yönetilir; kart
                bilgileriniz CompeteHive tarafında saklanmaz.
              </p>
            </details>
            <details className="bg-[#111113] border border-[#1F1F23] rounded-xl p-4">
              <summary className="cursor-pointer text-white font-medium">
                Verilerimi nasıl silebilirim?
              </summary>
              <p className="text-dark-300 text-sm mt-3 leading-relaxed">
                Hesabınızı sildiğinizde takip ettiğiniz ürünler ve fiyat geçmişiniz dahil tüm
                verileriniz kalıcı olarak kaldırılır. KVKK kapsamındaki haklarınız için{" "}
                <a href="mailto:support@competehive.com" className="text-hive-500 hover:underline">
                  support@competehive.com
                </a>{" "}
                adresine yazabilirsiniz.
              </p>
            </details>
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
            <Link href="/cerez" className="hover:text-white transition">
              Çerez
            </Link>
            <Link href="/destek" className="hover:text-white transition text-white">
              Destek
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
