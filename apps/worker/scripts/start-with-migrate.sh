#!/usr/bin/env sh
set -eu

SCHEMA_PATH="./packages/database/prisma/schema.prisma"

# Prisma client imaj build'inde üretilir (Dockerfile'daki `prisma generate`)
# ve node_modules ile birlikte kopyalanır — boot'ta yeniden üretim yok
# (deterministik imaj; npm registry'e boot bağımlılığı yok).

# Migration'lar deploy edilir. Başarısızlık worker'ı DÜŞÜRMEZ: mevcut üretim
# veritabanı migration geçmişi olmadan kurulmuş olabilir (P3005) ve
# runMigrations() (src/migrate.ts) idempotent raw-SQL güvenlik ağı şemayı
# zaten hizalar. Hata yüksek sesle loglanır ve worker Sentry üzerinden
# raporlar — sessizce yutulmaz.
echo "Running Prisma migrations..."
if npx prisma migrate deploy --schema "$SCHEMA_PATH"; then
  echo "Prisma migrations completed"
else
  echo "WARNING: prisma migrate deploy FAILED — continuing with raw-SQL schema reconciliation (runMigrations)." >&2
  echo "         If this is a P3005 (non-empty database without migration history), baseline the database:" >&2
  echo "         npx prisma migrate resolve --applied <migration_name> for each already-applied migration." >&2
fi

echo "Starting worker service..."
exec node dist/index.js "$@"
