# API Smoke / Contract Test Plan

Bu plan, kritik API yüzeyleri için düşük eforlu ama hızlı güvence veren smoke/contract test yaklaşımını tanımlar.

## Kapsam

- `GET /api/products`
- `POST /api/products`
- `GET /api/alerts`
- `POST /api/alerts`
- `POST /api/products/compare` (compare flow)

## Hedefler

1. **Smoke:** Endpoint'lerin temel request/response davranışını korumak.
2. **Contract:** JSON shape ve kritik alan tiplerini sabitlemek.
3. **Regression:** Compare flow ve listeleme endpoint'lerinde sessiz bozulmaları erken yakalamak.

## Önerilen test katmanları

### 1) Contract tests (CI'da her PR)

- Test runner: `vitest` veya `jest` + `supertest`.
- Schema assertion: `zod` ile response contract doğrulama.
- Mocking:
  - DB erişimi için Prisma client mock.
  - Dış servisler (scraper/AI/notification) için stub.

### 2) Smoke tests (PR + nightly)

- Local test DB (SQLite veya disposable Postgres container).
- Minimum seed data ile endpoint canlı çağrıları.
- HTTP status + kritik alan varlığı kontrolü.

## Endpoint bazlı minimum senaryolar

### `/api/products`

- `GET` başarılı liste döner (`200`, array).
- Auth yoksa beklenen hata kodu döner (`401/403`).
- `POST` valid payload ile ürün oluşturur (`201/200`, `id`, `name`, `url`).
- `POST` invalid payload ile validasyon hatası döner (`400`).

### `/api/alerts`

- `GET` kullanıcıya ait alert listesini döner.
- `POST` valid payload ile alert oluşturur.
- Eşik/threshold alanlarında tip ve range validasyonu yapılır.

### `compare flow` (`/api/products/compare`)

- Geçerli ürün/URL ile karşılaştırma sonucu döner (`summary`, `score` benzeri temel alanlar).
- Eksik/bozuk input ile `400` döner.
- Dış servis timeout/failure durumunda kontrollü hata gövdesi döner (`5xx` + error code/message).

## CI entegrasyon planı

1. İlk faz: Contract testleri PR pipeline'a `npm run test:contract` olarak ekle.
2. İkinci faz: Smoke testleri ayrı job veya nightly schedule'a taşı (`npm run test:smoke`).
3. Üçüncü faz: Compare flow için fixture tabanlı snapshot/contract testi ekle.

## Çıktı kriterleri

- PR'da kırılan contract değişiklikleri CI'da fail olmalı.
- Endpoint response shape değişimleri bilinçli ise test fixture/schema güncellemesi zorunlu olmalı.
- Compare flow için en az 1 happy-path + 1 failure-path testi her PR'da çalışmalı.
