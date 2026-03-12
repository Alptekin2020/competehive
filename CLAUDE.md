# CompeteHive - Development Guide

## Project Overview

E-commerce dynamic price tracking and competitor analysis platform for Turkish marketplaces. Monorepo with npm workspaces. Tracks product prices, detects changes, compares competitors, and sends alerts via email, Telegram, and webhooks.

## Architecture

```
competehive/
├── apps/
│   ├── web/           # Next.js 15 (App Router) + API Routes → Vercel
│   └── worker/        # BullMQ job processor + scrapers → Railway (Docker)
├── packages/
│   ├── database/      # Prisma 6.4 schema + migrations → PostgreSQL (Railway)
│   └── shared/        # Shared types, plan limits, marketplace config, env validation
```

### Deployment Targets

- **Web**: Vercel (Next.js)
- **Worker**: Railway (Docker, node:20-slim with Chromium for Puppeteer)
- **Database**: PostgreSQL on Railway
- **Redis**: Railway

## Tech Stack

- **Framework**: Next.js 15.2 (App Router, Turbopack), React 19, TypeScript 5.7
- **Database**: PostgreSQL (Prisma 6.4 ORM), Redis (ioredis)
- **Auth**: Clerk (@clerk/nextjs 7.x) — middleware protects all non-public routes
- **Queue**: BullMQ 5.30 (scrape + alert queues via Redis)
- **Scraping**: Cheerio 1.x (web + worker), Puppeteer 24.2 (worker only)
- **Styling**: Tailwind CSS 3.4 (dark theme, custom `hive-*` colors)
- **UI**: Lucide React (icons), Recharts (charts)
- **Validation**: Zod 3.24
- **Logging**: Pino (worker structured logging)
- **Notifications**: Nodemailer (SMTP), node-telegram-bot-api, Webhooks (JSON POST)
- **Testing**: Vitest 4.x, Testing Library (React + jest-dom)
- **CI/CD**: GitHub Actions (`pr-checks.yml`), Husky + lint-staged

## Common Commands

```bash
# Development
npm run dev:web          # Start Next.js dev server (Turbopack)
npm run dev:worker       # Start worker with tsx watch

# Database
npm run db:generate      # Generate Prisma client
npm run db:migrate       # Run migrations (dev)
npm run db:deploy        # Deploy migrations (prod)
npm run db:push          # Push schema changes (no migration file)
npm run db:studio        # Open Prisma Studio
npm run db:seed          # Seed database

# Quality
npm run typecheck        # TypeScript check across all workspaces
npm run lint             # Lint across all workspaces
npm run format           # Format all files with Prettier
npm run format:check     # Check formatting (Prettier)

# Testing
npm run test             # Run Vitest in watch mode
npm run test:run         # Run Vitest once (CI)

# Build
npm run build            # Build web + worker
npm run build:web        # Build web only
npm run build:worker     # Build worker only

# Deploy
npm run deploy:web       # db:deploy + build web
npm run deploy:worker    # db:deploy + build worker
```

## Database Schema

### Models

| Model               | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| **User**            | Clerk-synced user with plan, limits, notification settings |
| **ApiKey**          | User API key authentication                                |
| **TrackedProduct**  | Core entity: URL, marketplace, pricing, scrape status      |
| **PriceHistory**    | Historical price records with change tracking              |
| **Competitor**      | Competitor product linked to a tracked product             |
| **CompetitorPrice** | Competitor price history                                   |
| **AlertRule**       | Configurable rules (7 types) with cooldowns, channels      |
| **Notification**    | Alert notification delivery records                        |
| **ScrapeJob**       | Job execution status tracking                              |
| **SystemLog**       | Structured application logs                                |

### Key Enums

- **Plan**: FREE, STARTER, PRO, ENTERPRISE (defines product limits, scrape intervals, features)
- **Marketplace**: 23 supported Turkish marketplaces (TRENDYOL, HEPSIBURADA, AMAZON_TR, N11, etc.)
- **ProductStatus**: ACTIVE, PAUSED, ERROR, OUT_OF_STOCK
- **RuleType**: PRICE_DROP, PRICE_INCREASE, PRICE_THRESHOLD, PERCENTAGE_CHANGE, COMPETITOR_CHEAPER, OUT_OF_STOCK, BACK_IN_STOCK
- **NotifyChannel**: EMAIL, TELEGRAM, WEBHOOK

### Schema Location

`packages/database/prisma/schema.prisma`

## Key Patterns

### Database Access

- Use **Prisma ORM** for all database queries (not raw SQL or pg Pool)
- Prisma client singleton: `apps/web/src/lib/prisma.ts`
- Worker also uses Prisma directly (imports `@prisma/client`)
- Schema: `packages/database/prisma/schema.prisma`

### Authentication

- Clerk middleware in `apps/web/src/middleware.ts` protects all non-public routes
- Public routes: `/`, `/login`, `/register`, `/sign-in`, `/sign-up`, `/privacy`, `/terms`
- `getCurrentUser()` from `apps/web/src/lib/current-user.ts` resolves Clerk → DB user (upserts on first login)
- All API queries must filter by authenticated user's ID

### API Routes

Located in `apps/web/src/app/api/`:

| Route               | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `/products`         | CRUD for tracked products                      |
| `/products/compare` | Compare product with competitors               |
| `/alerts`           | CRUD for alert rules                           |
| `/notifications`    | Get user notifications                         |
| `/scrape/trigger`   | Manually trigger product scrape                |
| `/dashboard/stats`  | Dashboard statistics                           |
| `/settings`         | User settings (Telegram, webhook, preferences) |
| `/health`           | Health check                                   |

**Conventions:**

- Use standardized response helpers from `apps/web/src/lib/api-response.ts` (`apiSuccess`, `apiError`, `unauthorized`, `badRequest`, `notFound`, `forbidden`, `serverError`)
- User-facing error messages in Turkish, internal logs in English
- All POST/PUT endpoints validate input with Zod schemas from `apps/web/src/lib/validation.ts`

### Marketplace Configuration

- Single source of truth: `packages/shared/src/index.ts` (`MARKETPLACES` object)
- 23 supported Turkish marketplaces with id, name, domain, icon (emoji), color (hex)
- Helper functions: `getMarketplaceInfo(key)`, `getRetailerInfoFromDomain(domain)`
- Only 4 scrapers currently implemented: TRENDYOL, HEPSIBURADA, AMAZON_TR, N11
- Never duplicate marketplace labels/colors in component files

### Plan Limits

Defined in `packages/shared/src/index.ts` (`PLAN_LIMITS`):

| Plan       | Products | Min Interval | Marketplaces | History   | Channels         |
| ---------- | -------- | ------------ | ------------ | --------- | ---------------- |
| FREE       | 5        | 1440 min     | 1            | 7 days    | EMAIL            |
| STARTER    | 50       | 60 min       | 2            | 30 days   | EMAIL, TELEGRAM  |
| PRO        | 500      | 15 min       | 99           | 365 days  | All + auto rules |
| ENTERPRISE | 99999    | 5 min        | 99           | Unlimited | All features     |

### Worker Jobs

Entry point: `apps/worker/src/index.ts`

- **Scrape queue**: 5 concurrency, rate limited (10 requests/10s), 3 attempts with exponential backoff
- **Alert queue**: 10 concurrency, 3 retries
- **Schedule loop**: Runs every 60 seconds, selects products due for scraping based on `scrapeInterval`
- Structured logging with Pino
- Custom `ScraperError` class with `code`, `retryable`, `softFail` fields
- User-agent rotation (5 browser user agents)
- Graceful shutdown on SIGTERM/SIGINT

### Scrapers

Located in `apps/worker/src/scrapers/`:

- **scrapeTrendyol**: JSON-LD primary, HTML fallback, script tag state extraction
- **scrapeHepsiburada**: JSON-LD + HTML parsing
- **scrapeAmazonTR**: JSON-LD with offer array handling
- **scrapeN11**: JSON-LD + HTML with "stokta yok" detection
- `getScraper()` factory returns appropriate scraper or throws unsupported error
- `fetchWithRetry()`: 3 attempts with exponential backoff, 15s timeout

### Notifications

Located in `apps/worker/src/services/notifications.ts`:

- **Email**: Styled HTML via Nodemailer with responsive design and price comparison
- **Telegram**: Emoji formatting with clickable URLs via node-telegram-bot-api
- **Webhook**: JSON POST with structured event data (product, price, change metadata)

### Components

- Reusable UI components: `apps/web/src/components/ui/` (LoadingSpinner, MarketplaceBadge)
- Feature components: `apps/web/src/components/products/` (AddProductModal, ProductCard, CompetitorList, EmptyState)
- Custom hooks: `apps/web/src/hooks/` (useProducts)

### Dashboard Pages

Located in `apps/web/src/app/dashboard/`:

- `/dashboard` — Overview with stats
- `/dashboard/products` — Product management
- `/dashboard/alerts` — Alert rules management
- `/dashboard/notifications` — Notification history
- `/dashboard/settings` — User settings (Telegram, webhooks, preferences)
- Each page has `loading.tsx` skeleton and `error.tsx` boundary

### Lib Utilities

Located in `apps/web/src/lib/`:

| File                    | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `prisma.ts`             | Prisma client singleton (global reference in dev) |
| `current-user.ts`       | Clerk → DB user resolution with upsert            |
| `api-response.ts`       | Standardized API response helpers                 |
| `validation.ts`         | Zod schemas for API input validation              |
| `redis.ts`              | Redis client singleton (ioredis)                  |
| `logger.ts`             | Pino logger instance                              |
| `rate-limit.ts`         | Rate limiting utility                             |
| `scraper.ts`            | Web-side scraping utilities                       |
| `marketplace-search.ts` | Marketplace search logic                          |
| `marketplaces.ts`       | Marketplace helpers                               |
| `ai-analyzer.ts`        | AI-powered product analysis                       |

## Environment Variables

Validated at startup via Zod schemas in `packages/shared/src/env.ts`.

**Required (all environments):**

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string (default: `redis://localhost:6379`)

**Required (web only):**

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`

**Optional:**

- `TELEGRAM_BOT_TOKEN` — Telegram notification bot
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — Email notifications
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_*_PRICE_ID` — Payment integration
- `PROXY_HOST`, `PROXY_PORT`, `PROXY_USER`, `PROXY_PASS` — Proxy for scraping
- `OPENAI_API_KEY` — AI product analysis
- `SERPER_API_KEY` — Search API for competitor discovery
- `SENTRY_DSN` — Error tracking
- `LOG_LEVEL` — Worker log level (debug|info|warn|error|fatal)

See `.env.example` for full list with defaults.

## Code Conventions

- TypeScript strict mode enabled across all packages
- No `any` types — define proper interfaces (eslint warns on `@typescript-eslint/no-explicit-any`)
- Prefer Prisma ORM over raw SQL
- Error handling: never silently swallow errors (no empty `catch {}`)
- Pre-commit hooks enforce linting (ESLint) and formatting (Prettier)
- Import ordering enforced via eslint-plugin-import
- User-facing strings (errors, UI) in Turkish; logs and internal messages in English

### Formatting (Prettier)

- Semicolons: yes
- Quotes: double
- Trailing commas: all
- Print width: 100
- Tab width: 2
- Line endings: LF

### Testing

- Vitest with globals enabled (no need to import `describe`, `it`, `expect`)
- Test projects: `apps/web`, `packages/shared`
- Test files: colocated in `__tests__/` directories
- CI runs `npm run test:run` (single pass, no watch)

## CI/CD Pipeline

**GitHub Actions** (`.github/workflows/pr-checks.yml`):

- Triggers on PRs to `main` and manual dispatch
- Node 22 with npm cache
- Steps: `npm ci` → `db:generate` → `format:check` → `typecheck` → `lint` → `test:run`
- `PUPPETEER_SKIP_DOWNLOAD=1` in CI (no browser needed for tests)

## Docker (Worker)

The worker runs in Docker (`apps/worker/Dockerfile`):

- Base image: `node:20-slim`
- Installs Chromium and fonts for Puppeteer
- Sets `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`
- Multi-stage build for smaller production image
