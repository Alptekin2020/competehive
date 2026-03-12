# CompeteHive - Development Guide

## Project Overview

E-commerce dynamic price tracking and competitor analysis platform for Turkish marketplaces. Monorepo with npm workspaces.

## Architecture

```
competehive/
├── apps/
│   ├── web/           # Next.js 15 (App Router) + API Routes → Vercel
│   └── worker/        # BullMQ job processor + scrapers → Railway (Docker)
├── packages/
│   ├── database/      # Prisma 6.4 schema + migrations → PostgreSQL (Railway)
│   └── shared/        # Shared types, plan limits, marketplace config
```

## Tech Stack

- **Framework**: Next.js 15, React 19, TypeScript 5.7
- **Database**: PostgreSQL (Prisma ORM), Redis (ioredis)
- **Auth**: Clerk (@clerk/nextjs)
- **Queue**: BullMQ (scrape + alert queues)
- **Scraping**: Cheerio (web), Puppeteer (worker)
- **Styling**: Tailwind CSS 3.4 (dark theme, custom `hive-*` colors)
- **Validation**: Zod
- **Logging**: Pino (worker)
- **Notifications**: Nodemailer (SMTP), node-telegram-bot-api, Webhooks

## Common Commands

```bash
# Development
npm run dev:web          # Start Next.js dev server
npm run dev:worker       # Start worker with tsx watch

# Database
npm run db:generate      # Generate Prisma client
npm run db:migrate       # Run migrations (dev)
npm run db:deploy        # Deploy migrations (prod)
npm run db:studio        # Open Prisma Studio

# Quality
npm run typecheck        # TypeScript check across all workspaces
npm run lint             # Lint across all workspaces
npm run format:check     # Check formatting (Prettier)

# Build
npm run build            # Build web + worker
npm run build:web        # Build web only
npm run build:worker     # Build worker only
```

## Key Patterns

### Database Access

- Use **Prisma ORM** for all database queries (not raw SQL or pg Pool)
- Prisma client singleton: `apps/web/src/lib/prisma.ts`
- Schema: `packages/database/prisma/schema.prisma`

### Authentication

- Clerk middleware protects `/dashboard/*` routes
- `getCurrentUser()` from `apps/web/src/lib/current-user.ts` resolves Clerk → DB user
- All API queries must filter by authenticated user's ID

### API Routes

- Located in `apps/web/src/app/api/`
- Use standardized response helpers from `apps/web/src/lib/api-response.ts`
- User-facing error messages in Turkish, internal logs in English
- All POST/PUT endpoints validate input with Zod schemas

### Marketplace Configuration

- Single source of truth: `packages/shared/src/index.ts` (`MARKETPLACES` object)
- 21 supported Turkish marketplaces
- Never duplicate marketplace labels/colors in component files

### Worker Jobs

- Scrape queue: 5 concurrency, rate limited (10/10s), exponential backoff
- Alert queue: 10 concurrency, 3 retries
- Structured logging with Pino
- Custom `ScraperError` class for error classification

### Components

- Reusable UI components: `apps/web/src/components/ui/`
- Feature components: `apps/web/src/components/{feature}/`
- Custom hooks: `apps/web/src/hooks/`

## Environment Variables

Required variables are validated at startup via Zod (`packages/shared/src/env.ts`).

**Required**: `DATABASE_URL`, `REDIS_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
**Optional**: `TELEGRAM_BOT_TOKEN`, `SMTP_*`, `OPENAI_API_KEY`, `SERPER_API_KEY`, `SENTRY_DSN`

See `.env.example` for full list.

## Code Conventions

- TypeScript strict mode enabled
- No `any` types — define proper interfaces
- Prefer Prisma ORM over raw SQL
- Error handling: never silently swallow errors (no empty `catch {}`)
- Pre-commit hooks enforce linting and formatting
