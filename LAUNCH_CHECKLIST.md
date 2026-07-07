# CompeteHive — Yayın Öncesi Kontrol Listesi

Bu doküman, lansmana hazırlık denetiminde tespit edilen tüm kritik engellerin
kod tarafındaki çözümlerini ve **sizin panellerden yapmanız gereken**
yapılandırma adımlarını özetler. Kod değişiklikleri 5 PR ile tamamlandı
(#183–#187).

---

## ✅ Kodda tamamlananlar (5 aşama)

**Aşama 1 — Para akışı (#183)**

- Whop yükseltmede çifte tahsilat + yanlış plan düşürme düzeltildi
- Abonelik yenilemesinde `planExpiresAt` güvenilir uzatılıyor (+ 3 gün tolerans)
- Plan değişikliği ürünlerin tarama aralığına yansıyor
- Resend hataları artık FAILED kaydediliyor; prod'da doğrulanmış gönderici zorunlu
- Fiyat sayfasındaki yanlış tarama-sıklığı vaadi ve olmayan özellikler kaldırıldı
- Uygulama içi abonelik yönetim linki eklendi

**Aşama 2 — Veri doğruluğu + operasyon (#184)**

- Başarısız taramalar artık "taze" görünmüyor (`last_success_at`)
- 5 ardışık hatada ürün ERROR durumuna geçiyor + kendini iyileştiriyor
- Sentry (web + worker) hata takibi
- Worker heartbeat → `/api/health` ölü worker'ı raporluyor
- Prisma migration hattı onarıldı

**Aşama 3 — Yasal (#185)**

- Mesafeli satış sözleşmesi + cayma/iade sayfası
- Checkout'ta zorunlu sözleşme onayı
- Tek kaynak yasal kimlik altyapısı

**Aşama 4 — Güvenlik + maliyet (#186)**

- SSRF koruması (özel IP + DNS rebinding) scraper ve webhook'larda
- Rakip keşfi + manuel yenileme için plana göre günlük kota
- Ölü/maliyetli endpoint temizliği

**Aşama 5 — Uyarı kalitesi + reklam altyapısı (#187)**

- Uyarı yorgunluğu önleme (edge detection) + teslimat retry + Telegram blocked
- Plan bazlı fiyat geçmişi saklama
- Onay-kapılı reklam pixel altyapısı (Meta/TikTok)

---

## ⚠️ Yayına almadan ÖNCE sizin yapmanız gerekenler

Bu adımlar koddan yapılamaz — panellerden ve dış hizmetlerden ayarlanmalı.

### 1. Ödeme (ZORUNLU — bunlar olmadan kimse ödeme yapamaz)

- [ ] **Vercel** ortam değişkenlerinde 6 Whop plan ID'sini doğrula:
      `NEXT_PUBLIC_WHOP_STARTER_PLAN_ID`, `..._PRO_...`, `..._ENTERPRISE_...`
      ve `..._STARTER_YEARLY_...`, `..._PRO_YEARLY_...`, `..._ENTERPRISE_YEARLY_...`
- [ ] **Vercel**'de 3 Whop product ID'sini doğrula: `WHOP_STARTER_PRODUCT_ID`,
      `WHOP_PRO_PRODUCT_ID`, `WHOP_ENTERPRISE_PRODUCT_ID` (webhook plan eşlemesi)
- [ ] `WHOP_API_KEY` ve `WHOP_WEBHOOK_SECRET` ayarlı mı?
- [ ] **Whop panosunda webhook URL'i `https://www.competehive.com/api/webhooks/whop`
      olmalı (www ile!)** — apex `competehive.com` tüm istekleri www'ye 307 ile
      yönlendirir ve webhook göndericileri yönlendirme takip etmez; apex ile
      kayıtlı bir webhook hiç teslim edilmez
- [ ] `NEXT_PUBLIC_APP_URL` Vercel'de `https://www.competehive.com` olarak ayarlı
      mı? (ödeme sonrası dönüş adresi bundan üretilir; apex ayarlanırsa dönüş
      fazladan bir 307 üzerinden geçer)
- [ ] **Canlı bir yenileme testi yap:** Bir test aboneliği alıp bir sonraki
      fatura döneminin `planExpiresAt`'i uzattığını doğrula (bu, otomatik test
      edilemeyen tek kritik akış)

### 2. E-posta (ZORUNLU — FREE planın tek bildirim kanalı)

- [ ] **Resend**'de kendi alan adını doğrula (SPF/DKIM DNS kayıtları)
- [ ] **Railway** (worker) `RESEND_FROM_EMAIL`'i doğrulanmış alan adına ayarla
      — örn. `CompeteHive <bildirim@senindomainin.com>`
      (⚠️ ayarlanmazsa worker prod'da bilinçli olarak boot ETMEZ)

### 3. Yasal kimlik (Türkiye'de ödeme almak için ZORUNLU)

- [ ] `apps/web/src/lib/legal.ts` dosyasını doldur: `legalName` (şahıs
      şirketiyse ad-soyad), `address`, varsa `mersis` / `taxInfo`
      (dev ortamında sayfalarda kırmızı uyarı gösterir; boşken ödeme almayın)
- [ ] Yasal metinleri (mesafeli satış, KVKK, şartlar) bir hukukçuya okutmanız
      önerilir — şablonlar standart SaaS pratiğine göre hazırlandı

### 4. Scraping altyapısı (ürünün çalışması için KRİTİK)

- [ ] **Railway**'de residential proxy ayarla: `PROXY_HOST/PORT/USER/PASS`
      (datacenter IP'leri pazaryerlerince saatler içinde bloklanır)
- [ ] `SERPER_API_KEY` (fonlu) ve `OPENAI_API_KEY` ayarlı mı? (rakip keşfi +
      Akamai-korumalı sitelerde kendi-fiyat kurtarma bunlara bağlı)

### 5. İzleme (üretimde bir şey bozulduğunda haberdar olmak için)

- [ ] **Sentry** projesi aç, `SENTRY_DSN`'i Vercel + Railway'e ekle
- [ ] `/api/health` adresine bir uptime servisi (örn. UptimeRobot) bağla —
      `checks.worker` "error" dönerse tarama motoru durmuş demektir
- [ ] **Railway** veritabanı yedekleme (backup) ayarını doğrula

### 6. Reklam (sosyal medya kampanyası ÖNCESİ)

- [ ] **Vercel**'e `NEXT_PUBLIC_META_PIXEL_ID` ve/veya
      `NEXT_PUBLIC_TIKTOK_PIXEL_ID` ekle (yoksa pixel yüklenmez)
- [ ] Reklam bütçesini yakmadan önce dönüşüm olaylarını (satın alma) pixel'e
      bağla — şu an sadece PageView takibi hazır
- [ ] `NEXT_PUBLIC_APP_URL`'i canlı alan adına ayarla (Telegram bot linkleri
      ve OG meta bunları kullanır)

---

## Özet

Kod tarafında lansman engellerinin tamamı kapatıldı. Yukarıdaki **1–3.
maddeler ödeme almak için zorunlu**; **4–5 ürünün güvenilir çalışması için
kritik**; **6 reklam kampanyası için**. Bu yapılandırma adımları tamamlanınca
ödeme almaya ve reklam vermeye hazır olursunuz.
