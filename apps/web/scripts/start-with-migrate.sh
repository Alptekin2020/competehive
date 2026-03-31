#!/usr/bin/env sh
set -eu

SCHEMA_PATH="./packages/database/prisma/schema.prisma"

echo "Running Prisma client generation for web..."
npx prisma generate --schema "$SCHEMA_PATH"

echo "Running Prisma migrations..."
node ./scripts/migrate-deploy.js

echo "Prisma migrations completed"
echo "Starting web service..."
exec next start "$@"
