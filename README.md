# 🐝 CompeteHive

Dinamik fiyat takip ve rakip analiz platformu. E-ticaret satıcıları için.

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + Tailwind CSS (Vercel)
- **Backend API**: Next.js API Routes (Vercel)
- **Worker**: Node.js + BullMQ + Cheerio (Railway)
- **Database**: PostgreSQL (Railway)
- **Cache & Queue**: Redis (Railway)
- **Automation**: n8n (Railway)

## Proje Yapısı

```
competehive/
├── apps/
│   ├── web/           # Next.js frontend + API
│   └── worker/        # Scraping engine + job processor
├── packages/
│   ├── database/      # Prisma schema & client
│   └── shared/        # Shared types & utils
├── .env.example       # Environment variables template
└── package.json       # Monorepo root
```

## Hızlı Başlangıç

### 1. Repo'yu klonla
```bash
git clone https://github.com/YOUR_USERNAME/competehive.git
cd competehive
```

### 2. Environment variables
```bash
cp .env.example .env
# .env dosyasını düzenle - Railway bağlantı bilgilerini ekle
```

### 3. Bağımlılıkları yükle
```bash
npm install
```

### 4. Prisma client
```bash
npm run db:generate
```

### 5. Web uygulamasını başlat
```bash
npm run dev:web
```

### 6. Worker'ı başlat (ayrı terminal)
```bash
npm run dev:worker
```

## Railway Kurulumu

1. Railway'de yeni proje oluştur
2. PostgreSQL servisi ekle → `DATABASE_URL` al
3. Redis servisi ekle → `REDIS_URL` al
4. Worker servisi ekle → GitHub repo bağla (apps/worker)
5. Environment variables'ları Railway'e ekle

## Vercel Kurulumu

1. Vercel'de yeni proje oluştur
2. GitHub repo bağla
3. Root Directory: `apps/web`
4. Environment variables ekle
5. Deploy!

## Desteklenen Marketplace'ler

- ✅ Trendyol
- ✅ Hepsiburada
- 🔜 Amazon TR
- 🔜 N11


## Veritabanı Disiplini

- Şema değişiklikleri sadece `packages/database/prisma/schema.prisma` üzerinden yapılır.
- Production deploy sırasında migration otomatik olarak build akışında uygulanır (`apps/web` build => managed `prisma migrate deploy`).
- Vercel preview deploylarında migration adımı güvenli şekilde atlanır; production deploy migration uygular.
- Geliştirme ortamında şema değişikliği için Prisma CLI kullanılabilir (`prisma migrate dev`).
- HTTP endpoint üzerinden tablo/enum oluşturma veya ALTER işlemi yapılmaz.

## Debug Endpoint Güvenlik Politikası

- `GET /api/debug-search` endpointi **public route değildir** ve kimlik doğrulama katmanından geçer.
- Endpoint yalnızca local/development amaçlıdır; `NODE_ENV === "production"` olduğunda `404` döndürerek erişimi kapatır.
- API key, secret veya bu değerlere ait prefix/türetilmiş bilgiler response içinde asla döndürülmez.
- Bu endpoint internetten herkese açık şekilde yayınlanmamalı, yalnızca güvenli geliştirme ortamlarında kullanılmalıdır.
