import type { Metadata } from "next";
import Link from "next/link";

import LegalEntityBlock from "@/components/LegalEntityBlock";
import { LEGAL_ENTITY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Mesafeli Satış Sözleşmesi — CompeteHive",
  description:
    "CompeteHive abonelik hizmetleri için ön bilgilendirme formu, mesafeli satış sözleşmesi ve cayma hakkı / iade politikası.",
};

export default function MesafeliSatisPage() {
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
          <h1 className="text-4xl font-bold text-white mb-2">
            Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi
          </h1>
          <p className="text-dark-500 text-sm mb-8">
            Bu metin, 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler
            Yönetmeliği uyarınca dijital abonelik hizmeti satın alan kullanıcıları bilgilendirmek
            amacıyla hazırlanmıştır. Ödeme adımında bu metni onaylamanız istenir.
          </p>

          <div className="space-y-8 text-dark-300 text-sm leading-relaxed">
            <section>
              <h2 className="text-xl font-semibold text-white mb-3">1. Taraflar</h2>
              <div className="space-y-3">
                <LegalEntityBlock title="Satıcı / Hizmet Sağlayıcı" />
                <p>
                  <span className="text-white">Alıcı:</span> Platforma üye olurken bildirdiği
                  ad-soyad ve e-posta adresi ile abonelik satın alan gerçek veya tüzel kişi
                  (&quot;Kullanıcı&quot;).
                </p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">2. Sözleşmenin Konusu</h2>
              <p>
                Sözleşmenin konusu, Kullanıcı&apos;nın CompeteHive platformu üzerinden elektronik
                ortamda satın aldığı dijital abonelik planına (Başlangıç, Profesyonel veya Kurumsal)
                ilişkin tarafların hak ve yükümlülüklerinin belirlenmesidir. Plan kapsamları, ürün
                limitleri, tarama sıklıkları ve güncel fiyatlar{" "}
                <Link href="/#pricing" className="text-hive-500 hover:underline">
                  fiyatlandırma sayfasında
                </Link>{" "}
                ilan edilir; sipariş anında gösterilen fiyat esastır.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">3. Hizmetin İfası</h2>
              <p>
                Hizmet dijital niteliktedir ve fiziksel teslimat yoktur. Ödemenin onaylanmasıyla
                birlikte seçilen plan Kullanıcı&apos;nın hesabına derhal tanımlanır ve hizmetin
                ifasına anında başlanır. Hizmet; ürün fiyatlarının otomatik izlenmesini, rakip fiyat
                karşılaştırmalarını ve fiyat değişikliği bildirimlerini kapsar. Fiyat verileri
                üçüncü taraf pazaryerlerinden otomatik toplanır ve %100 doğruluk veya kesintisizlik
                garantisi verilmez (bkz. Kullanım Şartları).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">4. Ödeme ve Yenileme</h2>
              <ul className="list-disc list-inside space-y-1 text-dark-400">
                <li>
                  Ödemeler, ödeme altyapısı sağlayıcısı <span className="text-white">Whop</span>{" "}
                  üzerinden kredi/banka kartı ile tahsil edilir; kart bilgileri CompeteHive
                  tarafından saklanmaz.
                </li>
                <li>
                  Abonelik, seçilen döneme göre (aylık veya yıllık) iptal edilmediği sürece dönem
                  sonunda otomatik olarak yenilenir ve dönem ücreti tahsil edilir.
                </li>
                <li>
                  Fiyatlar Türk Lirası (₺) olarak ilan edilir. Ödeme sağlayıcısının çalıştığı para
                  birimine bağlı olarak kart ekstresinde döviz karşılığı ve bankanızın kur/komisyon
                  farkları yansıyabilir.
                </li>
                <li>
                  Kullanıcı, aboneliğini uygulama içindeki &quot;Aboneliğinizi yönetin&quot;
                  bağlantısından veya Whop hesabı üzerinden dilediği zaman iptal edebilir; iptal,
                  içinde bulunulan ödenmiş dönemin sonunda yürürlüğe girer ve o tarihe kadar hizmet
                  kullanılmaya devam edilebilir.
                </li>
              </ul>
            </section>

            <section id="cayma">
              <h2 className="text-xl font-semibold text-white mb-3">
                5. Cayma Hakkı ve İade Politikası
              </h2>
              <p>
                Kullanıcı, sözleşmenin kurulduğu tarihten itibaren{" "}
                <span className="text-white">14 (on dört) gün</span> içinde herhangi bir gerekçe
                göstermeksizin cayma hakkına sahiptir. Cayma bildirimi{" "}
                <a href={`mailto:${LEGAL_ENTITY.email}`} className="text-hive-500 hover:underline">
                  {LEGAL_ENTITY.email}
                </a>{" "}
                adresine açık bir beyanla iletilebilir.
              </p>
              <p className="mt-2">
                <span className="text-white">Önemli istisna:</span> Mesafeli Sözleşmeler
                Yönetmeliği&apos;nin 15. maddesi uyarınca, elektronik ortamda anında ifa edilen
                hizmetlerde ve Kullanıcı&apos;nın onayı ile ifasına derhal başlanan hizmetlerde
                cayma hakkı kullanılamaz. Ödeme adımında hizmetin derhal başlatılmasına açıkça onay
                verdiğinizde, ifasına başlanmış dönem için cayma hakkınızın bu kapsamda
                sınırlanacağını kabul etmiş olursunuz.
              </p>
              <p className="mt-2">
                Cayma hakkının geçerli şekilde kullanılması hâlinde tahsil edilen bedel, bildirimi
                izleyen 14 gün içinde ödemenin yapıldığı araçla iade edilir. Otomatik yenileme
                sonrasında hizmetin hiç kullanılmadığı durumlarda iade talepleri iyi niyet
                çerçevesinde değerlendirilir — talepler için destek adresine yazmanız yeterlidir.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">6. Uyuşmazlık Çözümü</h2>
              <p>
                Bu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığı&apos;nca ilan edilen parasal
                sınırlar dahilinde Kullanıcı&apos;nın yerleşim yerindeki Tüketici Hakem Heyetleri ve
                Tüketici Mahkemeleri yetkilidir.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-white mb-3">7. Yürürlük</h2>
              <p>
                Kullanıcı, ödeme adımında bu Ön Bilgilendirme Formu ve Mesafeli Satış
                Sözleşmesi&apos;ni okuduğunu ve kabul ettiğini elektronik ortamda onaylar; onayla
                birlikte sözleşme kurulmuş sayılır. Sözleşme metnine bu sayfadan her zaman
                erişilebilir.
              </p>
            </section>

            <p className="text-dark-500 text-xs pt-4 border-t border-dark-800">
              Son güncelleme: Temmuz 2026
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
          <div className="flex gap-6 text-sm text-dark-500 flex-wrap justify-center">
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
            <Link href="/mesafeli-satis" className="hover:text-white transition text-white">
              Mesafeli Satış
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
