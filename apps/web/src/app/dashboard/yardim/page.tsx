import Link from "next/link";
import {
  PLAN_LIMITS,
  MARKETPLACES,
  SUPPORTED_SCRAPER_MARKETPLACES,
  MIN_MATCH_SCORE,
  COMPETITOR_STALE_HOURS,
} from "@competehive/shared";

export const metadata = {
  title: "Nasıl Kullanılır — CompeteHive",
  description:
    "CompeteHive kullanım rehberi: ürün ekleme, rakip analizi, veri kalitesi ve bildirim kuralları.",
};

const SECTIONS = [
  { id: "hizli-baslangic", label: "Hızlı Başlangıç" },
  { id: "urun-ekleme", label: "Ürün Ekleme" },
  { id: "rakip-analizi", label: "Rakip Analizi" },
  { id: "veri-kalitesi", label: "Veri Kalitesi" },
  { id: "bildirimler", label: "Bildirim Kuralları" },
  { id: "planlar", label: "Tarama Sıklığı ve Planlar" },
  { id: "sss", label: "Sık Sorulan Sorular" },
];

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: "E-posta",
  TELEGRAM: "Telegram",
  WEBHOOK: "Webhook",
};

function humanizeInterval(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "24 saatte bir" : `${days} günde bir`;
  }
  if (minutes % 60 === 0) return `${minutes / 60} saatte bir`;
  return `${minutes} dakikada bir`;
}

function humanizeHistory(days: number): string {
  if (days >= 99999) return "Sınırsız";
  if (days % 365 === 0) return `${days / 365} yıl`;
  return `${days} gün`;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-lg sm:text-xl font-bold text-white mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-dark-300 leading-relaxed">{children}</div>
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-dark-900 border border-dark-800 rounded-xl p-4 sm:p-5">{children}</div>;
}

export default function YardimPage() {
  const dedicatedMarketplaces = SUPPORTED_SCRAPER_MARKETPLACES.map(
    (key) => MARKETPLACES[key]?.name ?? key,
  );
  // PLAN_LIMITS'te tanımı olmayan bir plan (ileride yapı değişirse) tabloyu
  // çökertmesin — eksik satırlar sessizce atlanır.
  const planRows = (["FREE", "STARTER", "PRO", "ENTERPRISE"] as const)
    .map((plan) => ({ plan, limits: PLAN_LIMITS[plan] }))
    .filter((row): row is { plan: typeof row.plan; limits: NonNullable<typeof row.limits> } =>
      Boolean(row.limits),
    );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold text-white mb-1">Nasıl Kullanılır</h1>
        <p className="text-dark-500 text-xs sm:text-sm">
          CompeteHive&apos;ı verimli kullanmak için ihtiyacınız olan her şey — 5 dakikalık okuma.
        </p>
      </div>

      {/* İçindekiler */}
      <div className="flex flex-wrap gap-2 mb-8">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="px-3 py-1.5 rounded-full text-xs border border-dark-800 text-dark-400 hover:text-white hover:border-hive-500/40 transition"
          >
            {s.label}
          </a>
        ))}
      </div>

      <div className="space-y-10">
        <Section id="hizli-baslangic" title="🚀 Hızlı Başlangıç (3 adım)">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                step: "1",
                title: "Ürün ekleyin",
                body: "Ürünler sayfasından sattığınız ürünün marketplace linkini yapıştırın. Fiyat, görsel ve satıcı bilgisi otomatik çekilir.",
              },
              {
                step: "2",
                title: "Rakipleri tarayın",
                body: "Ürün detayındaki “Rakipleri Tara” butonu, aynı ürünü satan diğer satıcıları bulur ve yapay zekâ ile eşleştirir.",
              },
              {
                step: "3",
                title: "Bildirimleri açın",
                body: "İlk ürününüzle birlikte hesap geneli bildirim kuralları otomatik kurulur. Fiyat düşünce, rakip ucuzlayınca veya stok değişince haber alırsınız.",
              },
            ].map((item) => (
              <div key={item.step} className="bg-dark-900 border border-dark-800 rounded-xl p-4">
                <div className="w-7 h-7 rounded-full bg-hive-500/15 text-hive-400 text-sm font-bold flex items-center justify-center mb-2">
                  {item.step}
                </div>
                <p className="text-white font-medium mb-1">{item.title}</p>
                <p className="text-xs text-dark-400 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="urun-ekleme" title="📦 Ürün Ekleme">
          <Card>
            <p>
              <span className="text-white font-medium">Tek ürün:</span> Ürünler →{" "}
              <span className="text-hive-400">Ürün Ekle</span> ile ürün sayfasının tam linkini
              yapıştırın (ör.{" "}
              <code className="text-xs bg-dark-950 px-1.5 py-0.5 rounded">
                https://www.trendyol.com/...-p-12345
              </code>
              ). Sistem fiyatı çeker, ürünü analiz eder ve arka planda rakip aramasını başlatır.
            </p>
            <p className="mt-2">
              <span className="text-white font-medium">Toplu içe aktarma:</span> STARTER ve üzeri
              planlarda, Ürünler sayfasındaki &quot;Toplu Ekle&quot; ile tek seferde birden çok link
              ekleyebilirsiniz.
            </p>
          </Card>
          <Card>
            <p className="text-white font-medium mb-2">Desteklenen pazaryerleri</p>
            <p className="text-xs text-dark-400 mb-2">
              Aşağıdaki pazaryerleri için özel olarak optimize edilmiş veri çekme kullanılır; diğer
              siteler genel yöntemle (sayfadaki yapılandırılmış veri) desteklenir:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {dedicatedMarketplaces.map((name) => (
                <span
                  key={name}
                  className="px-2 py-0.5 rounded text-xs bg-dark-950 border border-dark-800 text-dark-300"
                >
                  {name}
                </span>
              ))}
            </div>
          </Card>
          <Card>
            <p className="text-white font-medium mb-1">Ürün durumları</p>
            <ul className="text-xs text-dark-400 space-y-1 list-disc list-inside">
              <li>
                <span className="text-emerald-400">ACTIVE</span> — düzenli taranıyor.
              </li>
              <li>
                <span className="text-amber-400">OUT_OF_STOCK</span> — son taramada stokta yoktu;
                stok dönüşü izlenmeye devam eder.
              </li>
              <li>
                <span className="text-dark-300">PAUSED</span> — tarama durduruldu (plan limiti
                aşımında en eski ürünler aktif kalır).
              </li>
              <li>
                <span className="text-red-400">ERROR</span> — ürün sayfasına ulaşılamıyor; linki
                kontrol edin veya &quot;Fiyatları Yenile&quot; deneyin.
              </li>
            </ul>
          </Card>
        </Section>

        <Section id="rakip-analizi" title="⚔️ Rakip Analizi Nasıl Çalışır?">
          <Card>
            <p>
              &quot;Rakipleri Tara&quot; dediğinizde sistem ürününüzü web genelinde arar, bulduğu
              her adayı yapay zekâ ile ürününüzle karşılaştırır ve{" "}
              <span className="text-white font-medium">0–100 arası bir eşleşme skoru</span> verir.
              Skoru %{MIN_MATCH_SCORE} ve üzeri olanlar &quot;aynı ürün&quot; kabul edilir.
              Aksesuar, kılıf, ambalaj/koli ürünleri ve farklı modeller otomatik elenir.
            </p>
          </Card>
          <Card>
            <p className="text-white font-medium mb-2">Rakip kartındaki rozetler</p>
            <ul className="text-xs text-dark-400 space-y-2">
              <li>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border bg-green-500/10 text-green-400 border-green-500/30 mr-1.5">
                  🎯 %90
                </span>
                Eşleşme güveni. Yeşil (90+) kesin aynı ürün, sarı ({MIN_MATCH_SCORE}–89) büyük
                olasılıkla aynı, turuncu/kırmızı (%{MIN_MATCH_SCORE} altı) şüpheli — hesaplamalara
                katılmaz.
              </li>
              <li>
                <span className="text-[11px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded mr-1.5">
                  Eski
                </span>
                Fiyat {COMPETITOR_STALE_HOURS} saatten önce alındı; güncel olmayabilir. Eski veriler
                piyasa pozisyonu ve öneri hesaplarına dahil edilmez.
              </li>
              <li>
                <span className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/25 px-1.5 py-0.5 rounded mr-1.5">
                  Bant dışı
                </span>
                Rakip fiyatı sizin fiyatınızın 0.3x–3x aralığının dışında — büyük olasılıkla farklı
                bir ürün (ör. aksesuar). Hesaplamalara dahil edilmez.
              </li>
              <li>
                <span className="text-[11px] text-emerald-300 mr-1.5">En düşük rakip</span>
                Karara uygun rakipler içinde en ucuz olan.
              </li>
            </ul>
          </Card>
          <Card>
            <p>
              <span className="text-white font-medium">Önemli:</span> Bir rakip listede görünse bile{" "}
              <span className="text-white">
                yalnızca geçerli fiyatı olan, eşleşme güveni yeterli, fiyat bandında ve taze
              </span>{" "}
              rakipler &quot;Piyasa Pozisyonu&quot;, &quot;Önerilen Fiyat&quot; ve &quot;Rakip Daha
              Ucuz&quot; bildirimi hesaplarına girer. Böylece tek bir hatalı eşleşme kararlarınızı
              bozamaz.
            </p>
          </Card>
        </Section>

        <Section id="veri-kalitesi" title="🛡️ Veri Kalitesi Kartını Okumak">
          <Card>
            <ul className="text-xs text-dark-400 space-y-2">
              <li>
                <span className="text-white">Rakip sayısı</span> — bulunan toplam rakip kaydı.
              </li>
              <li>
                <span className="text-white">Karara uygun rakip</span> — yukarıdaki dört kalite
                kontrolünden geçen ve hesaplamalarda kullanılan rakipler.
              </li>
              <li>
                <span className="text-white">Şüpheli eşleşme</span> — eşleşme güveni düşük veya
                fiyatı kıyaslanamayacak kadar farklı kayıtlar. &quot;Şüpheli olanlar&quot;
                filtresiyle inceleyip alakasız olanları görmezden gelebilirsiniz.
              </li>
              <li>
                <span className="text-white">Eski / eksik rakip verisi</span> — fiyatı{" "}
                {COMPETITOR_STALE_HOURS} saatten eski veya hiç alınamamış kayıtlar. &quot;Fiyatları
                Yenile&quot; ile tazeleyin.
              </li>
            </ul>
            <p className="text-xs text-dark-400 mt-3">
              Alttaki durum rozeti özetler:{" "}
              <span className="text-emerald-300">Aksiyon için güçlü</span> = veri taze ve rakiplerin
              büyük kısmı karara uygun; <span className="text-amber-300">Temkinli değerlendir</span>{" "}
              = kısmen güvenilir; <span className="text-rose-300">Düşük güven</span> = önce veriyi
              tazeleyin/temizleyin, fiyat kararını sonra verin.
            </p>
          </Card>
        </Section>

        <Section id="bildirimler" title="🔔 Bildirim Kuralları">
          <Card>
            <p className="text-white font-medium mb-1">Genel kural ve ürün kuralı</p>
            <p>
              <span className="text-sky-300">🌐 Genel kural</span> tüm ürünlerinize (sonradan
              ekleyecekleriniz dahil) uygulanır — 100 ürün için 100 kural kurmanız gerekmez. Belirli
              bir üründe farklı davranış isterseniz o ürüne{" "}
              <span className="text-white">aynı türde özel bir kural</span> ekleyin: ürün kuralı o
              üründe genel kuralın yerine geçer. Ürün kuralını{" "}
              <span className="text-white">pasif</span> bırakırsanız o ürün o bildirim türü için
              tamamen sessize alınır.
            </p>
          </Card>
          <Card>
            <p className="text-white font-medium mb-2">Kural türleri</p>
            <ul className="text-xs text-dark-400 space-y-1.5">
              <li>
                📉 <span className="text-white">Fiyat Düşüşü</span> — kendi ürününüzün fiyatı
                düştüğünde.
              </li>
              <li>
                📈 <span className="text-white">Fiyat Artışı</span> — fiyat yükseldiğinde.
              </li>
              <li>
                🎯 <span className="text-white">Fiyat Eşiği</span> — belirlediğiniz tutarın
                altına/üstüne geçtiğinde.
              </li>
              <li>
                📊 <span className="text-white">Yüzde Değişim</span> — tek seferde %X üzeri
                değişimde.
              </li>
              <li>
                ⚡ <span className="text-white">Rakip Daha Ucuz</span> — karara uygun bir rakip
                sizden ucuza düştüğünde.
              </li>
              <li>
                🚫 <span className="text-white">Stoktan Çıktı</span> / ✅{" "}
                <span className="text-white">Stoğa Girdi</span> — stok durumu değiştiğinde.
              </li>
            </ul>
            <p className="text-xs text-dark-500 mt-2">
              <span className="text-white">Bekleme süresi (cooldown)</span>: aynı kuralın aynı ürün
              için kısa aralıkta tekrar bildirim göndermesini engeller. Ayarlar sayfasındaki{" "}
              <span className="text-white">genel eşik (%)</span> ise bu yüzdenin altındaki küçük
              fiyat oynamalarını tamamen sessize alır.
            </p>
          </Card>
          <Card>
            <p className="text-white font-medium mb-2">Bildirim kanalları</p>
            <ul className="text-xs text-dark-400 space-y-2">
              <li>
                <span className="text-white">📧 E-posta</span> — varsayılan kanal; Ayarlar&apos;dan
                kapatabilirsiniz.
              </li>
              <li>
                <span className="text-white">💬 Telegram</span> — Ayarlar → Telegram →
                &quot;Bağla&quot; ile çıkan linke tıklayıp bota{" "}
                <code className="bg-dark-950 px-1 rounded">/start</code> gönderin; bağlantı otomatik
                tamamlanır. Bot komutları: <code className="bg-dark-950 px-1 rounded">/status</code>
                , <code className="bg-dark-950 px-1 rounded">/test</code>,{" "}
                <code className="bg-dark-950 px-1 rounded">/stop</code>.
              </li>
              <li>
                <span className="text-white">🔗 Webhook</span> (PRO+) — Ayarlar&apos;a kendi HTTPS
                adresinizi girin; her bildirimde ürün, fiyat ve değişim bilgisi içeren bir JSON POST
                alırsınız. Kendi sisteminizle (ERP, Slack, otomasyon) entegrasyon için idealdir.
              </li>
            </ul>
          </Card>
        </Section>

        <Section id="planlar" title="⏱️ Tarama Sıklığı ve Planlar">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-dark-500 border-b border-dark-800">
                    <th className="py-2 pr-3 font-medium">Plan</th>
                    <th className="py-2 pr-3 font-medium">Ürün</th>
                    <th className="py-2 pr-3 font-medium">Tarama sıklığı</th>
                    <th className="py-2 pr-3 font-medium">Fiyat geçmişi</th>
                    <th className="py-2 font-medium">Kanallar</th>
                  </tr>
                </thead>
                <tbody>
                  {planRows.map(({ plan, limits }) => (
                    <tr key={plan} className="border-b border-dark-800/60 text-dark-300">
                      <td className="py-2 pr-3 font-semibold text-white">{plan}</td>
                      <td className="py-2 pr-3">
                        {limits.maxProducts >= 99999 ? "Sınırsız" : limits.maxProducts}
                      </td>
                      <td className="py-2 pr-3">
                        {humanizeInterval(limits.scrapeIntervalMinutes)}
                      </td>
                      <td className="py-2 pr-3">{humanizeHistory(limits.priceHistoryDays)}</td>
                      <td className="py-2">
                        {limits.channels.map((c) => CHANNEL_LABELS[c] ?? c).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-dark-500 mt-3">
              Fiyatlar plana göre belirtilen sıklıkta otomatik taranır; ürün detayındaki
              &quot;Fiyatları Yenile&quot; ile dilediğiniz an elle tetikleyebilirsiniz. Planınızı{" "}
              <Link href="/dashboard/pricing" className="text-hive-400 hover:underline">
                Plan sayfasından
              </Link>{" "}
              yükseltebilirsiniz.
            </p>
          </Card>
        </Section>

        <Section id="sss" title="❓ Sık Sorulan Sorular">
          <div className="space-y-3">
            <details className="bg-dark-900 border border-dark-800 rounded-xl p-4">
              <summary className="cursor-pointer text-white font-medium text-sm">
                Fiyat neden güncellenmiyor?
              </summary>
              <p className="text-xs text-dark-400 mt-2 leading-relaxed">
                Tarama sıklığı planınıza bağlıdır (yukarıdaki tablo). Hemen güncellemek için ürün
                detayında &quot;Fiyatları Yenile&quot;ye basın. Ürün ERROR durumundaysa link
                değişmiş veya sayfa kaldırılmış olabilir — linki kontrol edin.
              </p>
            </details>
            <details className="bg-dark-900 border border-dark-800 rounded-xl p-4">
              <summary className="cursor-pointer text-white font-medium text-sm">
                Listede alakasız bir rakip görüyorum, ne yapmalıyım?
              </summary>
              <p className="text-xs text-dark-400 mt-2 leading-relaxed">
                Düşük skorlu veya bant dışı kayıtlar zaten hesaplamalara girmez; yalnızca şeffaflık
                için listelenir. &quot;Şüpheli olanlar&quot; filtresiyle görebilirsiniz. Tamamen
                kaldırmak isterseniz &quot;Rakipleri Tara&quot; ile listeyi tazeleyin — kalite
                filtreleri her taramada yeniden uygulanır.
              </p>
            </details>
            <details className="bg-dark-900 border border-dark-800 rounded-xl p-4">
              <summary className="cursor-pointer text-white font-medium text-sm">
                Bildirim gelmiyor, neyi kontrol etmeliyim?
              </summary>
              <p className="text-xs text-dark-400 mt-2 leading-relaxed">
                1) Uyarılar sayfasında ilgili kuralın <span className="text-white">Aktif</span>{" "}
                olduğunu, 2) kuralın kanalının (e-posta/Telegram) hesabınızda bağlı olduğunu, 3)
                Ayarlar&apos;daki genel eşiğin (%) değişimden büyük olmadığını, 4) kuralın bekleme
                süresinin dolduğunu kontrol edin. Ayarlar&apos;dan test bildirimi gönderebilirsiniz.
              </p>
            </details>
            <details className="bg-dark-900 border border-dark-800 rounded-xl p-4">
              <summary className="cursor-pointer text-white font-medium text-sm">
                Tek bir ürünün bildirimini nasıl kapatırım?
              </summary>
              <p className="text-xs text-dark-400 mt-2 leading-relaxed">
                Uyarılar → Yeni Uyarı ile o ürünü seçip aynı türde bir kural oluşturun ve kuralı
                pasif bırakın. Ürün kuralı genel kuralı ezdiği için o ürün o bildirim türünde
                sessize alınır; diğer ürünleriniz etkilenmez.
              </p>
            </details>
          </div>
        </Section>
      </div>

      <div className="mt-10 bg-hive-500/5 border border-hive-500/20 rounded-xl p-4 text-sm text-dark-300">
        Aradığınızı bulamadınız mı?{" "}
        <a href="mailto:support@competehive.com" className="text-hive-400 hover:underline">
          support@competehive.com
        </a>{" "}
        adresine yazın veya{" "}
        <Link href="/destek" className="text-hive-400 hover:underline">
          Destek sayfasına
        </Link>{" "}
        göz atın.
      </div>
    </div>
  );
}
