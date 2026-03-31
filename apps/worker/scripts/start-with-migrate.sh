#!/usr/bin/env sh
set -eu

SCHEMA_PATH="./packages/database/prisma/schema.prisma"

echo "Running Prisma client generation for worker..."
npx prisma generate --schema "$SCHEMA_PATH"

echo "Running Prisma migrations..."
npx prisma migrate deploy --schema "$SCHEMA_PATH"

echo "Prisma migrations completed"
echo "Starting worker service..."
exec node dist/index.js "$@"
