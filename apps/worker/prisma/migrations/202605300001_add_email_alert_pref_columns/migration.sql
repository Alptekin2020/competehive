-- Adds the user-level alert preference columns that the Prisma schema declares
-- (User.emailAlertsEnabled / User.alertThresholdPct) but that no migration ever
-- created — they had previously only been applied via `db push`.
--
-- Without this migration, a database built purely from `prisma migrate deploy`
-- lacks these columns, and every getCurrentUser() upsert plus the
-- /api/account/alert-prefs endpoint throw P2022 ("column does not exist").
--
-- Idempotent (IF NOT EXISTS) so environments where the columns were already
-- added via `db push` replay safely.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "alert_threshold_pct" DOUBLE PRECISION NOT NULL DEFAULT 5;
