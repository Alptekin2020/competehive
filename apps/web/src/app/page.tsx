import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function Home() {
  const { userId } = await auth();
  const summaryStats = [
    { label: "Takip Edilen Ürünler", value: "148", detail: "+12 bu hafta" },
    { label: "Son 24 Saat Değişim", value: "36", detail: "12 kritik hareket" },
    { label: "Aktif Uyarılar", value: "7", detail: "3 yüksek öncelik" },
  ];
  const trackedProducts = [
    { name: "Philips Airfryer", marketplace: "Trendyol", price: "₺5.499", trend: "-3.2%" },
    { name: "Stanley Termos", marketplace: "Hepsiburada", price: "₺1.849", trend: "+1.8%" },
    { name: "Nike Sırt Çantası", marketplace: "Amazon TR", price: "₺1.199", trend: "-1.1%" },
  ];
  const trendBars = [42, 58, 36, 68, 50, 72, 63, 78, 69];

  return (
    <main className="min-h-screen bg-dark-1000">
      {/* Navbar */}
      <nav className="fixed top-0 w-full z-50 bg-dark-1000/80 backdrop-blur-xl border-b border-dark-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/competehive-logo.png" alt="CompeteHive" className="w-8 h-8" />
            <span className="text-lg font-bold text-white">CompeteHive</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            {userId ? (
              <>
                <Link
                  href="/dashboard"
                  className="border border-dark-700 hover:border-hive-500/60 hover:text-hive-300 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold transition"
                >
                  Panele Devam Et
                </Link>
                <div className="flex items-center justify-center rounded-full ring-1 ring-dark-700/80 bg-dark-900/80 p-1">
                  <UserButton
                    appearance={{
                      elements: {
                        avatarBox: "h-8 w-8",
                        userButtonPopoverCard: "bg-dark-900 border border-dark-700 shadow-xl",
                        userButtonPopoverActionButton: "text-dark-200 hover:bg-dark-800",
                        userButtonPopoverActionButtonText: "text-dark-200",
                        userButtonPopoverFooter: "hidden",
                      },
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-dark-400 hover:text-white transition text-sm px-2 py-1"
                >
                  Giriş Yap
                </Link>
                <Link
                  href="/register"
                  className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold transition"
                >
                  Ücretsiz Başla
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-24 sm:pt-32 pb-12 sm:pb-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto grid gap-8 lg:gap-12 lg:grid-cols-[1.1fr_0.9fr] items-center">
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 bg-hive-500/10 border border-hive-500/20 rounded-full px-4 py-1.5 mb-8">
              <div className="w-2 h-2 bg-hive-500 rounded-full animate-pulse" />
              <span className="text-hive-400 text-sm font-medium">Hive Ekosistemi Ürünü</span>
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight mb-4 sm:mb-6">
              Rakip fiyat değişimlerini anında görün, <br className="hidden sm:block" />
              <span className="text-hive-500">fiyat kararlarınızı veriyle yönetin</span>
            </h1>
            <p className="text-base sm:text-lg text-dark-400 mb-6 sm:mb-10 max-w-3xl lg:max-w-2xl mx-auto lg:mx-0 px-2 lg:px-0">
              CompeteHive; Trendyol, Hepsiburada, Amazon TR ve diğer marketplace&apos;lerde rakip
              ürünleri otomatik izler, değişimleri kaydeder ve size anında bildirir. Böylece manuel
              kontrol yerine hızlı ve veriye dayalı fiyat kararları alırsınız.
            </p>
            <div className="flex flex-col sm:flex-row justify-center lg:justify-start gap-3 sm:gap-4 px-4 lg:px-0">
              <Link
                href={userId ? "/dashboard/products" : "/register"}
                className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-8 py-3.5 rounded-xl font-semibold transition inline-flex items-center justify-center gap-2"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {userId ? "İlk Ürünü Ekle" : "Ücretsiz Başla"}
              </Link>
              <Link
                href={userId ? "/dashboard" : "#features"}
                className="border border-dark-700 hover:border-dark-500 text-white px-8 py-3.5 rounded-xl font-medium transition text-center"
              >
                {userId ? "Başlangıç Akışını Aç →" : "Nasıl Çalışır →"}
              </Link>
            </div>
            {userId && (
              <p className="text-xs text-hive-300/80 mt-4 px-2 lg:px-0">
                İpucu: Ürün ekleyin → rakipleri tarayın → ilk uyarıyı kurun. İlk değerli içgörüyü
                genellikle birkaç dakika içinde görürsünüz.
              </p>
            )}
          </div>

          <div className="relative">
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-b from-hive-500/20 via-hive-500/5 to-transparent blur-xl" />
            <div className="relative bg-dark-900/90 border border-dark-700/80 rounded-3xl p-4 sm:p-5 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-hive-400/90">
                    Canlı görünüm
                  </p>
                  <p className="text-white font-semibold">Örnek panel</p>
                </div>
                <span className="text-[11px] text-dark-400 bg-dark-800 px-2.5 py-1 rounded-full border border-dark-700">
                  Son tarama: 5 dk önce
                </span>
              </div>

              <div className="grid sm:grid-cols-3 gap-2 mb-4">
                {summaryStats.map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-dark-950/70 border border-dark-800 rounded-xl p-3"
                  >
                    <p className="text-[11px] text-dark-500 mb-1">{stat.label}</p>
                    <p className="text-lg font-semibold text-white">{stat.value}</p>
                    <p className="text-[11px] text-hive-400">{stat.detail}</p>
                  </div>
                ))}
              </div>

              <div className="bg-dark-950/70 border border-dark-800 rounded-2xl p-3 sm:p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-white">Takip edilen ürünler</p>
                  <span className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-full px-2 py-0.5">
                    Rakip sizden daha düşük
                  </span>
                </div>
                <div className="space-y-2.5">
                  {trackedProducts.map((product) => {
                    const isNegative = product.trend.startsWith("-");
                    return (
                      <div key={product.name} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-white truncate">{product.name}</p>
                          <p className="text-xs text-dark-500">{product.marketplace}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-white">{product.price}</p>
                          <p
                            className={`text-xs font-medium ${
                              isNegative ? "text-emerald-400" : "text-amber-300"
                            }`}
                          >
                            {product.trend}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-dark-950/70 border border-dark-800 rounded-2xl p-3 sm:p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium text-white">Fiyat trendi (7 gün)</p>
                  <p className="text-xs text-dark-500">Son 24 saatte 3 alarm üretildi</p>
                </div>
                <div className="h-20 flex items-end gap-1.5">
                  {trendBars.map((bar, index) => (
                    <div
                      key={bar + index}
                      className={`flex-1 rounded-t-md ${
                        index > trendBars.length - 3 ? "bg-hive-400/70" : "bg-hive-500/35"
                      }`}
                      style={{ height: `${bar}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What is CompeteHive */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 border-t border-dark-900/60">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-6">CompeteHive Nedir?</h2>
          <div className="space-y-4 text-dark-300 leading-relaxed">
            <p>
              CompeteHive, e-ticaret satıcıları ve markalar için geliştirilmiş bir rakip fiyat
              takibi ve fiyat istihbaratı platformudur.
            </p>
            <p>
              Marketplace&apos;lerdeki rakip ürünleri ve fiyat değişimlerini otomatik olarak izler,
              geçmiş veriyi kaydeder ve kritik hareketleri tek panelde görünür hale getirir.
            </p>
            <p>
              Böylece ekipler manuel kontrol süreçlerinden çıkar; daha hızlı, daha tutarlı ve veriye
              dayalı fiyatlandırma kararları alır.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-12 sm:py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">Nasıl Çalışır?</h2>
          <p className="text-dark-400 text-center mb-12 max-w-2xl mx-auto">
            Dakikalar içinde kurulum yapın, rakip hareketlerini otomatik izleyin ve fiyat
            değişimlerine zaman kaybetmeden aksiyon verin.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "Ürünlerinizi ekleyin",
                desc: "Takip etmek istediğiniz ürünleri ve rakip ürün linklerini panele ekleyin.",
              },
              {
                step: "2",
                title: "CompeteHive otomatik izlesin",
                desc: "Sistem seçtiğiniz marketplace&apos;leri düzenli aralıklarla tarayarak fiyat değişimlerini toplar.",
              },
              {
                step: "3",
                title: "Uyarı alın ve aksiyon verin",
                desc: "Fiyat değiştiğinde anında bildirim alın, stratejinizi hızlıca güncelleyin.",
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-dark-900 border border-dark-800 rounded-2xl p-6 hover:border-hive-500/30 transition"
              >
                <div className="w-8 h-8 rounded-full bg-hive-500/15 border border-hive-500/30 text-hive-400 text-sm font-semibold flex items-center justify-center mb-4">
                  {item.step}
                </div>
                <h3 className="text-white font-semibold mb-2">{item.title}</h3>
                <p className="text-dark-400 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 border-y border-dark-900/60 bg-dark-950/40">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">Nasıl Fayda Sağlar?</h2>
          <p className="text-dark-400 text-center mb-12 max-w-2xl mx-auto">
            Teknik detaylardan öte, doğrudan iş sonuçlarını iyileştiren içgörülerle daha kontrollü
            fiyat yönetimi yapın.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                title: "Satış kaybını azaltır",
                desc: "Rakiplerin fiyat kırdığı anları hızlıca görün, geç kalmadan karşı hamle planlayın.",
              },
              {
                title: "Kâr marjını korur",
                desc: "Gereksiz indirimleri azaltın; fiyat düşürmeden önce piyasa verisiyle karar verin.",
              },
              {
                title: "Zaman kazandırır",
                desc: "Manuel fiyat kontrolünü otomasyona bırakın, ekiplerin operasyon yükünü hafifletin.",
              },
              {
                title: "Karar kalitesini artırır",
                desc: "Geçmiş fiyat hareketlerini görerek kısa vadeli değil, sürdürülebilir stratejiler oluşturun.",
              },
            ].map((benefit) => (
              <div
                key={benefit.title}
                className="bg-dark-900 border border-dark-800 rounded-2xl p-6 hover:border-dark-700 transition"
              >
                <h3 className="text-white font-semibold mb-2">{benefit.title}</h3>
                <p className="text-dark-400 text-sm leading-relaxed">{benefit.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-12 sm:py-20 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">Neden CompeteHive?</h2>
          <p className="text-dark-400 text-center mb-16 max-w-2xl mx-auto">
            Rakip hareketlerini tek panelde izleyin, fiyat değişimlerini kaçırmayın ve stratejinizi
            daha hızlı güncelleyin.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[
              {
                icon: "📊",
                title: "Anlık Fiyat Takibi",
                desc: "Seçili marketplace&apos;lerdeki fiyatları düzenli aralıklarla otomatik tarayın ve tek ekranda görün.",
              },
              {
                icon: "🔔",
                title: "Akıllı Uyarılar",
                desc: "Kritik fiyat değişimlerinde Telegram ve e-posta üzerinden gecikmeden bilgilendirilin.",
              },
              {
                icon: "📈",
                title: "Fiyat Geçmişi",
                desc: "Geçmiş fiyat verilerini grafiklerle inceleyin, eğilimleri net biçimde analiz edin.",
              },
              {
                icon: "🏪",
                title: "Çoklu Marketplace",
                desc: "Trendyol, Hepsiburada, Amazon TR, N11, Teknosa, Vatan, Decathlon ve MediaMarkt&apos;ı tek panelden yönetin.",
              },
            ].map((f, i) => (
              <div
                key={i}
                className="bg-dark-900 border border-dark-800 rounded-2xl p-4 sm:p-6 hover:border-hive-500/30 transition group"
              >
                <div className="text-2xl sm:text-3xl mb-3 sm:mb-4">{f.icon}</div>
                <h3 className="text-white font-semibold text-sm sm:text-base mb-1.5 sm:mb-2 group-hover:text-hive-400 transition">
                  {f.title}
                </h3>
                <p className="text-dark-500 text-xs sm:text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who is it for */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 border-t border-dark-900/60">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">Kimler İçin Uygun?</h2>
          <p className="text-dark-400 text-center mb-12 max-w-2xl mx-auto">
            Fiyat rekabetini yakından takip etmek ve karar hızını artırmak isteyen tüm e-ticaret
            ekipleri için tasarlandı.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                title: "Marketplace satıcıları",
                desc: "Rakip fiyatlarını düzenli izleyerek ürün bazında daha hızlı konumlanmak isteyen satıcılar.",
              },
              {
                title: "Kendi markasını yöneten firmalar",
                desc: "Farklı kanallardaki fiyat görünürlüğünü koruyup marka değerini sürdürülebilir yönetmek isteyen ekipler.",
              },
              {
                title: "E-ticaret operasyon ekipleri",
                desc: "Manuel kontrol yükünü azaltıp operasyonu otomatik ve ölçeklenebilir hale getirmek isteyen takımlar.",
              },
              {
                title: "Fiyatlandırma ve kategori yöneticileri",
                desc: "Kategori performansını veriye dayalı fiyat kararlarıyla iyileştirmeyi hedefleyen profesyoneller.",
              },
            ].map((audience) => (
              <div
                key={audience.title}
                className="bg-dark-900 border border-dark-800 rounded-2xl p-6 hover:border-dark-700 transition"
              >
                <h3 className="text-white font-semibold mb-2">{audience.title}</h3>
                <p className="text-dark-400 text-sm leading-relaxed">{audience.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-12 sm:py-20 px-4 sm:px-6 bg-dark-950">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-white text-center mb-4">Basit Fiyatlandırma</h2>
          <p className="text-dark-400 text-center mb-16">Her ölçekte e-ticaret satıcıları için</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {[
              {
                plan: "Ücretsiz",
                price: "₺0",
                features: ["5 ürün", "Günde 1 tarama", "1 marketplace", "E-posta bildirimi"],
                hl: false,
              },
              {
                plan: "Başlangıç",
                price: "₺299",
                features: ["50 ürün", "Saatte 1 tarama", "2 marketplace", "Telegram + E-posta"],
                hl: true,
              },
              {
                plan: "Profesyonel",
                price: "₺799",
                features: ["500 ürün", "15 dk tarama", "Tüm marketplace", "Oto-fiyat kuralları"],
                hl: false,
              },
              {
                plan: "Kurumsal",
                price: "₺1.999",
                features: ["Sınırsız ürün", "5 dk tarama", "API erişimi", "Webhook + Özel"],
                hl: false,
              },
            ].map((p, i) => (
              <div
                key={i}
                className={`rounded-2xl p-6 border transition ${p.hl ? "bg-hive-500/10 border-hive-500/40" : "bg-dark-900 border-dark-800 hover:border-dark-700"}`}
              >
                <div
                  className={`text-sm font-medium mb-1 ${p.hl ? "text-hive-400" : "text-dark-400"}`}
                >
                  {p.plan}
                </div>
                <div className="text-3xl font-bold text-white mb-1">
                  {p.price}
                  <span className="text-sm font-normal text-dark-500">/ay</span>
                </div>
                {p.hl && <div className="text-xs text-hive-500 font-medium mb-4">En Popüler</div>}
                {!p.hl && <div className="mb-4" />}
                <ul className="space-y-2.5">
                  {p.features.map((f, j) => (
                    <li key={j} className="text-sm text-dark-300 flex items-center gap-2">
                      <svg
                        className={`w-4 h-4 flex-shrink-0 ${p.hl ? "text-hive-500" : "text-dark-600"}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={`block text-center mt-6 py-2.5 rounded-xl text-sm font-semibold transition ${p.hl ? "bg-hive-500 text-dark-1000 hover:bg-hive-600" : "border border-dark-700 text-white hover:border-dark-500"}`}
                >
                  Başla
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-12 sm:py-20 px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Rakipleriniz fiyat değiştirdiğinde ilk siz bilin
          </h2>
          <p className="text-dark-400 mb-8">Ücretsiz başlayın, kredi kartı gerekmez.</p>
          <Link
            href="/register"
            className="bg-hive-500 hover:bg-hive-600 text-dark-1000 px-8 py-3.5 rounded-xl font-semibold transition inline-block"
          >
            Ücretsiz Dene →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-dark-800 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <img src="/competehive-logo.png" alt="CompeteHive" className="w-8 h-8" />
            <span className="text-sm text-dark-400">© 2026 CompeteHive. Hive Ecosystem.</span>
          </div>
          <div className="flex gap-6 text-sm text-dark-500">
            <Link href="/privacy" className="hover:text-white transition">
              Gizlilik
            </Link>
            <Link href="/terms" className="hover:text-white transition">
              Kullanım Şartları
            </Link>
            <a href="mailto:support@competehive.com" className="hover:text-white transition">
              İletişim
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
