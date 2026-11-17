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
- **Notifications**: Resend (email), Telegram Bot API, Webhooks (JSON POST)
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
- Dedicated scrapers: TRENDYOL, HEPSIBURADA, AMAZON_TR, N11, MEDIAMARKT, PTTAVM; PAZARAMA/TEKNOSA/VATAN use the generic JSON-LD scraper; unknown marketplaces fall back to `scrapeGeneric`
- DECATHLON is intentionally NOT in `SUPPORTED_SCRAPER_MARKETPLACES` (no comparable competitor pool) — legacy rows still render, new adds are rejected
- Independent store sites (the seller's own shop, e.g. seninev.com) are trackable as `CUSTOM` (or `SHOPIFY` on myshopify.com): `isTrackableMarketplace()` = dedicated scraper OR `isGenericStoreMarketplace()`. They are identified by domain (`storeHostFromUrl`, `storeKey`) for badges and the plan's marketplace limit
- Own-store pages are read by `apps/web/src/lib/store-scraper.ts` (JSON-LD → OG/product meta → microdata) which also returns a support level (`full`/`partial`/`unsupported`) + Turkish reasons; `POST /api/products/preview` shows it before adding, and `POST /api/products` rejects own-store URLs whose price can't be read. Bulk import rejects own-store URLs (needs per-URL preview)
- Marketplace detection matches the URL **hostname** on label boundaries (not substring of the whole URL)
- Worker scrapes own-store URLs with `untrustedHost: true`: SSRF check (`utils/url-guard.ts`) on every redirect hop and no Puppeteer fallback
- Worker parses own-store pages with `parseStorePageHtml` (scrapers/index.ts), a mirror of web `parseStorePage` — keep in sync, or products the preview accepted fail their first worker scrape. Stock values go through `parseAvailability` (`packages/shared/src/availability.ts`, worker mirror `utils/availability.ts`); web and worker must agree or every scrape flips stock and fires BACK_IN_STOCK
- Own-store requests identify as `CompeteHive/1.0 (+https://competehive.com)` first (Cloudflare 429s a spoofed Chrome UA with a Node TLS fingerprint), retrying once with a browser UA if blocked. Shopify-style `/products/<handle>` URLs also use the public `/products/<handle>.js` JSON (prices in kuruş; needs `Accept: application/json`)
- Public "Siteniz uyumlu mu?" checker: landing section + `POST /api/public/store-check` (no auth, IP rate limited 5/min & 30/day, 6h Redis cache) and `/notify` (waitlist email). Every check is stored in `store_checks` (`StoreCheck` model) to see which domains are requested/unsupported
- Admin-only "Site Talepleri" view (`/dashboard/admin/store-checks`, `GET /api/admin/store-checks?days=`) summarizes `store_checks` per domain (`lib/store-check-summary.ts`); the sidebar link shows only when `/api/user/features` returns `isAdmin`
- Never duplicate marketplace labels/colors in component files

### Plan Limits

Defined in `packages/shared/src/index.ts` (`PLAN_LIMITS`):

| Plan       | Products | Min Interval | Marketplaces | History   | Channels         |
| ---------- | -------- | ------------ | ------------ | --------- | ---------------- |
| FREE       | 5        | 1440 min     | 1            | 7 days    | EMAIL            |
| STARTER    | 50       | 360 min      | 2            | 30 days   | EMAIL, TELEGRAM  |
| PRO        | 500      | 360 min      | 99           | 365 days  | All + auto rules |
| ENTERPRISE | 99999    | 360 min      | 99           | Unlimited | All features     |

### Worker Jobs

Entry point: `apps/worker/src/index.ts`

- **Scrape queue**: 5 concurrency, rate limited (10 requests/10s), 3 attempts with exponential backoff
- **Alert queue**: 10 concurrency, 3 retries. Rules resolve per product via `resolveApplicableRules`: account-wide global rules (`trackedProductId = null`) apply to every product; a product-specific rule of the same type overrides the global one for that product (an inactive product rule mutes it). Cooldowns are per (rule, product) in Redis (`alert-cooldown:*`), falling back to `lastTriggered` when Redis is unavailable
- **Schedule loop**: Runs every 60 seconds, selects products due for scraping based on `scrapeInterval`
- Structured logging with Pino
- Custom `ScraperError` class with `code`, `retryable`, `softFail` fields
- User-agent rotation (5 browser user agents)
- Puppeteer: one shared Chromium, opened via `openPage()`/`releasePage()` and closed after 2 minutes with no open page (Chromium is most of the worker's memory, which drives the Railway bill); concurrent callers share a single launch
- Graceful shutdown on SIGTERM/SIGINT
- Outbound fetch goes through the scraping proxy (global dispatcher) EXCEPT first-party APIs: Serper and OpenAI use `directFetch` (`utils/direct-fetch.ts`) so a proxy 502 cannot kill competitor discovery; Serper calls retry transient failures (`withRetry`)
- Refresh cadence follows the plan (`utils/plan-cadence.ts`, mirror of web `resolveEffectivePlan`): paid plans every 6h, FREE once a day. The 6-hour refresh-url cycle only covers paid users; the competitor discovery loop uses a 24h cutoff for everyone else; worker boot aligns paid products' `scrapeInterval` to 360
- Competitor discovery has its own clock: `metadata.discoveredAt` (`utils/discovery-schedule.ts`), stamped after every periodic discovery run (also on failure). The 6h refresh-url cycle writes `refreshCompletedAt`, which must never gate discovery (it starved discovery for paid products). Products without `discoveredAt` are due at once, ordered by the legacy `refreshCompletedAt`, spread by the per-tick batch limit (10 per 30 min)
- Search queries (`utils/search-queries.ts`, max 4): brand + full model code first ("Philips EP3347/90"), then the cleaned name (truncation never splits "N'si 1 arada", keeps the product-type head noun, drops power/size specs and commas first), a bare GTIN when `metadata.gtin` exists, brand + product type ("KUSTAR Evye Bataryası"), AI keywords. The second-source `site:` web search runs on the best 2 queries
- AI rejection cache (`utils/match-reject-cache.ts`): AI rejections scoring < 40 are cached per (product, `competitorUrlKey`) in Redis for 7 days and the AI call is skipped on a hit (deterministic accepts still run; pairs sharing a model code bypass it; Redis down/slow = fail open)
- The 6-hour refresh-url cycle keeps its last run time in Redis (`utils/refresh-cycle.ts`) and is checked every 10 minutes — a deploy must not reset the clock
- The refresh-url cycle passes competitor price moves to `maybeEnqueueAlerts` (`detectCompetitorMove`, `utils/stale-competitors.ts`) so COMPETITOR_CHEAPER / COMPETITOR_PRICE_CHANGE fire even when the own price is unchanged (moves pass the full policy: pending, score, match-basis band). Known-row price updates outside the row's match-basis band are not written (no `competitors.current_price`, `competitor_prices` or `price_history`) and are logged. Known competitors Google did not return that are 24h+ stale get a bounded direct `scrape-competitor` job (max 3 per URL, dedicated-scraper marketplaces only)
- Second competitor source (`searchMarketplacePages` in `serper.ts`, policy in `utils/second-source.ts`): when a discovery round ends with fewer than 5 fresh, scrapable trusted competitors (`countFreshDirectCompetitors`: not pending/dead, score ≥ 70 or null, priced within 72h, not a Google card; this round's non-Google saves count too — stale Google cards must never block it), one extra Serper **web** search restricted with `site:` to marketplace domains finds product pages Google Shopping has no feed for. Only product-detail URLs pass (`isMarketplaceProductUrl`). Results usually carry no price: after the AI title gate, a listing whose price the lightweight fetch cannot read is saved priceless and gets a direct `scrape-competitor` job (max 4 per round) instead of being dropped
- Same-listing sellers (`utils/same-listing.ts`, sync in `jobs/processor.ts` `syncSameListingCompetitors`): the own Trendyol scrape reads the listing's other sellers (`otherMerchants`) and stores up to 10 as competitors (`<listing>?merchantId=<id>`, score 100, `matchAttributes.sameListing` + `matchBasis: "model-code"`). The direct API is 403 from Railway, so the Puppeteer path captures the page's own JSON XHRs (`findOtherMerchantsContainer`), then reads the escaped page state: `merchantListing` (`extractMerchantListingFromHtml`: shown `merchant`, `winnerVariant.price`, other sellers in `otherMerchantsVariants`), then a literal `otherMerchants` list, and last calls productDetail from inside the page (CORS-blocked so far) ("Trendyol other sellers" log: source xhr/listing/html/in-page/none, `listed`, `pageMerchant`). These rows are never purged as `own-listing` (`isOtherSellerUrl`/`isSameListingSellerRow`) and never picked for a separate direct scrape; a Puppeteer scrape of a `?merchantId=` URL writes that seller's price from the list (rejected when the seller left the listing)
- Lightweight price recovery (`utils/recover-price.ts`) refuses pages that are not a single product page: a request redirected off the marketplace product URL pattern (`leftProductPage`; Hepsiburada sends dead `-pm-` listings to a category page) or JSON-LD listing several products (`looksLikeListingPage`). A bot-challenge page (Amazon robot check, `detectBotChallenge`) returns source `bot-challenge`, and discovery queues a direct scrape for it like other unreadable results. JSON-LD prices are read only from `Product` nodes
- Direct `scrape-competitor` jobs gate automated rows (scored, not user-confirmed) with the 0.3x–3x band, and delete a discovery-created row that never got a price when the scrape fails; manual rows are never gated or deleted
- Dead listings: scrapers throw `ScraperError` `LISTING_GONE` (retryable false, `isListingGoneError`) on HTTP 404/410 or a same-site redirect off the marketplace product URL (`listingGoneReason`; bot-challenge pages never count), checked on the HTML response and the Puppeteer final URL before parsing. The `scrape-competitor` job writes `matchAttributes.deadAt`/`deadReason` on LISTING_GONE, otherwise counts `scrapeFailures` + `lastAttemptAt` (3 in a row → `deadAt`; `utils/dead-listing.ts`); a fresh price (direct scrape or Google in the refresh-url round) clears them. Manual/confirmed rows are marked, never deleted. Stale picking skips dead rows for 7 days after their last attempt and rows attempted in the last 24h; the quality policy drops `deadAt` rows (`readCompetitorDeadAt`, issue `dead`, both mirrors) and the web treats dead automated rows as dormant. Each refresh-url round logs the trusted competitors older than 72h (`countStaleTrustedCompetitors`)
- Trendyol circuit breaker: when API and HTML both return 403, Redis key `trendyol-direct-blocked` (1h) makes `scrapeTrendyol` go straight to Puppeteer; HTML stops at the first 403. Without Redis it fails open
- Google Shopping results often link to Google's own product card (`google.com/search?ibp=oshop…&prds=…`) instead of the seller page. `resolveRetailer` (`serper.ts`) reads the real seller from the result's `source` field: a known marketplace name sets the `marketplace` enum, any other seller name is stored in `matchAttributes.seller` (`withCompetitorSeller`/`readCompetitorSeller`, web mirror in `lib/match-review.ts`). Google-hosted links are never scraped (no price recovery, no stale/direct `scrape-competitor`), and `competitorUrlKey` keys them by the stable id inside `prds` (the `q` search query is dropped) so one listing is one row. The web badge comes from `resolveCompetitorSource` (`lib/competitor-source.ts`): never show "google.com" or "Google Alışveriş" as the seller — unknown seller is "Satıcı bilinmiyor" plus a small "Google Alışveriş" source chip. The web never links to a raw Google card (they die: "Bu ürünle ilgili ayrıntı yok"): `competitorOpenUrl` opens a fresh `google.com/search?udm=28&gl=tr&hl=tr&q=<title + seller>` search ("Google'da ara"); real marketplace URLs open directly
- Google-hosted competitors are moved to the seller's real product page (`jobs/direct-listing.ts`, pure logic `utils/direct-listing.ts`). The site comes from `sellerSiteDomain(marketplace, seller)`: scraper-backed marketplaces, enum seller sites (Koçtaş, Boyner, Çiçeksepeti…) and known CUSTOM sellers (`SELLER_SITE_DOMAINS`: idefix, D&R, Evkur…); price-comparison sites (akakce/cimri/epey) never. At the end of a discovery round and of the 6h refresh-url round, up to 3 trusted rows per product (fresh, or stale at most 7 more days) get one `site:<domain>` Serper web search (store sites pass `mapOrganicToShoppingResults` via `isLikelyStoreProductUrl`). `pickDirectListing` scores ALL results against the OWN title (Google card title only breaks ties): hard rejects in `directListingRejectReason` (bundle/gift words like "hediyeli"/"set"/extra product, colour conflict (own colour from the own title, else the own listing URL slug via `ownColourText`, else the Google card), colour-code variant, swapped flavour word (generic "-li" words like "renkli"/"kapasiteli" never count, `GENERIC_DESCRIPTOR_WORDS`), pack/spec, accessory); two close candidates on different pages → null, except when both pass via exact model code + brand (same product, different listings: the best one is picked). Trendyol titles omit the brand, so the code path also accepts the own brand in the candidate URL path (`brandInSlug`). When the pick is another row's page that cannot be merged (different seller / confirmed), `resolveDirectListings` tries the remaining listings; a page picked for one card is not picked again in the same round. Two-phase: the pick is stored as `matchAttributes.directCandidate` and a `scrape-competitor` job with `verifyDirect` checks the real page title (`verifyDirectPage`) and the price band before the URL changes; a failed candidate goes to `directRejected` (max 10) and is never proposed again; a transient scrape failure (429, timeout, proxy; anything but LISTING_GONE) is not a rejection: `withDirectTransientFailure` drops the candidate and retries the lookup after 24h (`directTransient`), rejecting only after 3 consecutive failures of the same page. Linked rows keep every Google card key in `matchAttributes.googleKeys` (legacy `googleKey` migrated on read); refresh-url never writes the Google price/name onto them (`partitionAliasHits`) and instead queues a direct scrape when 12h+ old. A Google row is merged (deleted) into an existing row with the same page only when that row is trusted and has the same seller (`decideDirectMerge`). The colour hard reject also uses `hasColourOrShadeConflict` (model-identity colour list: bakır, nar, sorgul…); worker boot runs `downgradeWrongColourDirectLinks` (`isWrongColourDirectLink`): an unconfirmed `directVerifiedAt` row whose name or URL path has a different colour than the own title + own URL slug is set to score 30 (never deleted). Rows without a dedicated scraper are scraped through the SSRF-guarded store path (`scraperMarketplaceFor` → CUSTOM). A failed lookup is retried after 7 days (`matchAttributes.directLookupAt`); bump `DIRECT_RULES_VERSION` when the rules change to fix wrong rejections: rows looked up under an older version (`directRulesV`) are due at once and their `directRejected`/`directTransient` are ignored and dropped. Each refresh-url round logs the stale Google cards whose seller has no known site (`unlinkableGoogleSellers`, "🧭" line): add those sellers to `SELLER_SITE_DOMAINS`
- A competitor can never be the product's own listing: `isSameListing` (`utils/url-match.ts`, `listingIdentity` = marketplace product id: Trendyol `-p-<id>`, Hepsiburada `-p-`/`-pm-<id>`, Amazon ASIN, N11 id) catches the same listing under a different slug. Discovery treats such a result as the own listing, the direct-listing lookup skips it, and the boot cleanup purges automated (scored, not confirmed) rows that point to it (`own-listing`)
- Model identity (`utils/model-identity.ts`): `compareModelIdentity` reads model codes as {base, suffix} (`parseModelCodes`: "EP3347/90" = "EP3347-90", never EP334790), model numbers (A55/A56, iPhone 15/16, V15/V12, Note 13/14, "3300 Serisi"/"Series 3300") and screen size (55"/55 inç/inch, "139 Ekran") from title + URL slug (`slugModelText`, listing ids stripped, Google cards → "") + scraped page title. `conflict`/`config-variant` (HD9650/90 ≠ /99) → rejected at ≤30 before the AI, never pending; `unknown` (source has a code, candidate does not) → no 88/75/Rule-14 promotion, AI score capped at 69, and a Google card is rejected at 45 (never pending). Rule 14 never promotes colour/shade variants (`hasColourOrShadeConflict`) or a pack/spec conflict in the title + URL slug (`hasPackOrSpecConflict`; the boot purge `purgeTitleAcceptMismatches` also re-checks rule-14 rows). The same check guards `pickDirectListing`, known-row downgrades (30), the `scrape-competitor` page-title check and the boot purge (`model-code-conflict`; pending code-less Google cards → `unverifiable-model`; purge also deletes `price_history` twins). Deterministic accepts log "Deterministic match accept" with the full candidate title. Accepted matches write `matchAttributes.matchBasis` ("model-code" for the 95/90 shared-code accepts, "title" for title/AI accepts)
- The deterministic title rules never accept a one-word swap (`hasSwappedWords`: both titles have a word the other lacks, e.g. "Çilekli" vs "Fıstıklı"): flavour/scent variants cannot be told from colours, so the AI decides
- Pending candidates (50–69) are re-evaluated every discovery round with the deterministic title rules only (`reevaluateUncertainMatch` in `matcher.ts`, no AI call): seen in results or not, a candidate that now passes is promoted (88/75) and leaves the pending list. A priceless pre-match in 50–69 is kept as a pending candidate when the lightweight fetch reads an in-band price; when the fetch fails it is saved priceless as pending with a direct `scrape-competitor` job (same caps). A direct scrape of a pending row only updates its price (no price history/alerts)
- Automated competitor rows not priced for 30+ days, or marked dead (`deadAt`), are "dormant" (`isDormantCompetitor`): hidden behind a toggle and excluded from the competitor count on the product page; manual and user-confirmed rows are never dormant
- Competitor listings are matched by `competitorUrlKey` (tracking params stripped, seller params kept), never by raw URL; a known competitor is always updated under its stored URL
- The AI matcher never sees prices (it used price gaps as "different product" evidence); price sanity is deterministic (0.3x–3x band, 4x backstop). Titles are cleaned with `cleanProductTitle` (marketplace SEO suffixes) before search and matching
- Deterministic title layer (`utils/title-similarity.ts`) wraps the AI matcher for products without a model code: near-identical titles (`isNearIdenticalTitle`) are accepted at 88 without an AI call; an uncertain AI score (50–69) with strong overlap (`isStrongTitleOverlap`) is raised to 75. `isSourceSubsetTitle` (every source word in the candidate, extras only descriptive: no digits, variant, form, colour or flavour words) also accepts at 88. Tokens: "2'si 1 arada" → `2in1`, `d3k2` → `d3 k2`, `98"`/"98 inç" → `98inch`, "Air Fryer"/"Air-Fryer" → `airfryer` ("air" is a variant token) (inch and N-in-1 differences are conflicts), brand aliases (Luxell = Kumtel; `canonicalBrandToken`, also used by the matcher's shared-model-code brand check so "Luxell LX-6331" ↔ "Kumtel LX-6331" is a 90 accept) and sub-brands (Kahve Dünyası → Tambol), a form word before the brand ("Tablet Tambol") is ignored. Both require the brand token and no conflict (`hasTitleConflict`: specs, counts, quantities, different model codes, accessory/packaging) and no variant word (Pro, Kids, set…) among the extra tokens. Search-result titles are often truncated, so a multipack hint blocks the deterministic accept when the source states no quantity (`hasMultipackSignal`), the candidate URL path is checked too (`urlSlugText`), and the direct `scrape-competitor` job drops a never-priced automated row whose real page title shows a different pack or size (`hasPackOrSpecConflict`)
- A page that loads fine but has no purchasable offer throws `PRODUCT_UNAVAILABLE` (`isProductUnavailableError`): callers mark the product OUT_OF_STOCK and keep the last price instead of counting a scrape failure. Parsers set `unavailable` only on a positive signal
- Puppeteer page reads go through `readPageHtml` (retries when a bot-check/geo redirect navigates mid-read)

### Scrapers

Located in `apps/worker/src/scrapers/`:

- **scrapeTrendyol**: public API primary, HTML fallback, Puppeteer last resort
- **scrapeHepsiburada**: Akamai-block detection, JSON-LD + `__NEXT_DATA__` + OG meta, Puppeteer fallback
- **scrapeAmazonTR**: JSON-LD with offer array handling
- **scrapeN11**: JSON-LD + HTML with "stokta yok" detection
- **scrapeMediaMarkt**, **scrapePTTAVM**: JSON-LD + marketplace-specific selectors
- **scrapeGeneric**: JSON-LD + OG meta fallback (TEKNOSA, VATAN, DECATHLON, unknown)
- `getScraper()` factory returns appropriate scraper (generic fallback for unknown)
- `fetchWithRetry()`: 3 attempts with exponential backoff, 15s timeout

### Competitor Data Quality

- Central policy: `packages/shared/src/competitor-quality.ts` (worker mirror: `apps/worker/src/utils/competitor-quality.ts` — keep in sync; the worker's Docker build context cannot import the shared package)
- A competitor only enters decision calculations (market position, price suggestion, COMPETITOR_CHEAPER alert, daily digest) if it passes `assessCompetitorList`: valid price, `matchScore` null-or-≥ `MIN_MATCH_SCORE`, not pending (`matchAttributes.review = "pending"`), scraped within 72h, and the price band of its **match basis** (`readMatchBasis`: `matchAttributes.matchBasis`, legacy code-accept `details`, or score): model-code 0.3x–3x, title/AI/unknown 0.55x–1.8x, manual (null score) 0.3x–3x, user-confirmed no band. Peer outlier: with ≥3 other trusted peers, `|ln(price/peerMedian)| > ln(1.8)` is rejected (confirmed rows exempt). Always use the list function, never single-row `assessCompetitor`, at decision points. Web API responses carry `matchBasis` / `match_basis` + `review` for this
- Own-price updates go through `guardOwnPriceUpdate` (`jobs/own-price-guard.ts`, pure `resolveOwnPriceUpdate` in `utils/price-sanity.ts`): a big change (>90% or below 0.4x) is held in `metadata.pendingOwnPrice` and accepted on a second consistent read (±3%, within 7 days) or at once when within 0.7x–1.4x of the trusted competitor median (`trustedPeerMedian`, own price not used as band anchor) and the jump is within 0.4x–2.5x. Never call `isPlausiblePriceChange` alone at a write site (it blocked real changes forever)
- Product insights (`lib/product-insights.ts`): an own price more than 1.8x away from the trusted peer median gives a "Fiyatınızı kontrol edin" (`check-price`) insight instead of a suggestion; suggested raises are capped at +15% (`MAX_SUGGESTED_RAISE_PCT`)
- `isPackagingListing()` deterministically rejects packaging/logistics listings (koli, ambalaj, …) before any AI call
- Automated pipelines must always persist a `matchScore` — null score is reserved for manual/legacy rows
- User-reviewed matching (`apps/worker/src/utils/match-review.ts`, web mirror `apps/web/src/lib/match-review.ts` — keep in sync): AI rejections scoring 50–69 are stored as pending candidates (`matchAttributes.review = "pending"`, max 5 new per round / 8 pending per product). They stay out of decisions, price history and alerts until the user confirms (`PATCH /api/products/[id]/competitors/[competitorId]` → score 100, `review = "confirmed"`; the worker never downgrades a confirmed row). Deleting a competitor writes its URL to `trackedProduct.metadata.rejectedCompetitorUrls`, and discovery skips those URLs
- Product detail page groups competitors with `lib/competitor-groups.ts` (cards in `components/products/CompetitorCards.tsx`): numbered trusted list (quality-policy usable), collapsed "Diğer rakipler" (unusable/stale/out-of-band; dormant only behind the toggle) and collapsed "Onay bekleyen olası eşleşmeler" (`review = "pending"`). Pending rows are removed before `assessCompetitorList` (`decisionCandidates`; `toInsightInput` does the same for list/dashboard insights), never numbered, and excluded from every count (`countCompetitors`). Pending cards show the full title/reason and a neutral gap (`describePriceGap`: "Fiyat farkı 2,7 kat" / "%X daha pahalı"); a gap above 50% needs an inline second confirm step. One freshness label per card (`competitorFreshness`), one reject control per card
- Pending and dormant competitors are hidden from the price chart: `GET /api/products/[id]` marks their price-history twins `chartHidden` (`chartHiddenHistoryFlags`) and passes `hiddenCompetitorIds` to `buildPriceEvents`
- Worker boot runs `cleanupJunkCompetitors()` to purge obvious legacy junk (packaging names, extreme price deviation on unscored rows)

### Price History (own vs competitor rows)

- `price_history` stores BOTH the product's own price rows and competitor price rows; there is no flag column, only `sellerName`
- `GET /api/products/[id]` classifies each row with `classifyOwnPriceHistory` (`apps/web/src/lib/price-history.ts`) and returns `isOwn`; the chart must use that flag, never guess from the seller name
- The reliable signal is the `competitor_prices` twin: every worker path that writes a competitor price must write `competitor_prices` and `price_history` with the same `scrapedAt` and price — a competitor row without a twin can be mistaken for the user's own price
- Own-price rows are recognized by `previousPrice`/`priceChange` (only the own-price scrape sets them), the markers in `OWN_SELLER_MARKERS` ("Benim Ürünüm", "Kendi Mağazam", "Elle girildi"), the product's seller name or its marketplace display name

### User Input & Refresh State

- Amounts typed by users (own price, cost) go through `parseTrNumber` (`apps/web/src/lib/format.ts`): "2.499" is 2499, "1.499,90" is 1499.9 — never raw `Number()`
- Text search uses `foldForSearch` so "SIRT", "sirt" and "sırt" match
- A manual refresh left in `pending`/`processing` for more than 10 minutes is timed out by `isRefreshStale` (`lib/tracked-product-refresh.ts`): the status route closes it as `failed`, the refresh route accepts a new request
- Bulk import names products with `provisionalProductName` (URL slug, else "<Marketplace> ürünü") until the first scrape; never store a "loading" placeholder as the product name

### Notifications

Located in `apps/worker/src/services/notifications.ts`:

- **Email**: Styled HTML via Resend with responsive design and price comparison
- **Telegram**: Emoji formatting with clickable URLs via node-telegram-bot-api
- **Webhook**: JSON POST with structured event data (product, price, change metadata)

- **Daily digest** (`jobs/daily-digest.ts`, pure logic in `utils/daily-digest.ts`): one email per user per Istanbul day, sent in the 09:00–12:00 window, only when a product has a cheaper competitor or a competitor price moved in the last 24h (same quality policy as alerts). Once-per-day is a per-user Redis `SET NX` claim (`cacheClaim`); if Redis is unreachable the round is skipped. Opt-out: `users.daily_digest_enabled` (settings toggle, `/api/account/alert-prefs`); also off when `emailAlertsEnabled` is false

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

| File                    | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `prisma.ts`             | Prisma client singleton (global reference in dev)        |
| `current-user.ts`       | Clerk → DB user resolution with upsert                   |
| `api-response.ts`       | Standardized API response helpers                        |
| `validation.ts`         | Zod schemas for API input validation                     |
| `redis.ts`              | Redis client singleton (ioredis)                         |
| `logger.ts`             | Pino logger instance                                     |
| `rate-limit.ts`         | Rate limiting utility                                    |
| `scraper.ts`            | Web-side scraping utilities                              |
| `marketplace-search.ts` | Marketplace search logic                                 |
| `marketplaces.ts`       | Marketplace helpers                                      |
| `ai-analyzer.ts`        | AI-powered product analysis                              |
| `format.ts`             | tr-TR formatters, `parseTrNumber`, search folding        |
| `price-history.ts`      | Own vs competitor price-history classification           |
| `provisional-name.ts`   | Provisional product name from the URL slug               |
| `product-insights.ts`   | Market position, opportunities, next check, chart events |

## Environment Variables

Validated at startup via Zod schemas in `packages/shared/src/env.ts`.

**Required (all environments):**

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string (default: `redis://localhost:6379`)

**Required (web only):**

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`

**Optional:**

- `TELEGRAM_BOT_TOKEN` — Telegram notification bot
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — Email notifications (worker, via Resend)
- `WHOP_API_KEY`, `WHOP_WEBHOOK_SECRET`, `WHOP_*_PRODUCT_ID`, `NEXT_PUBLIC_WHOP_*_PLAN_ID` — Whop payment/subscription integration
- `TELEGRAM_WEBHOOK_SECRET` — Telegram webhook request validation
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
