#!/usr/bin/env node
/**
 * Single source of truth for the Prisma schema is
 * `packages/database/prisma/schema.prisma`. The worker ships its own copy at
 * `apps/worker/prisma/schema.prisma` because its Docker build context is the
 * worker directory (it cannot reach the database package at build time).
 *
 * This script keeps the worker copy byte-identical to the canonical schema so
 * the two deployables never drift.
 *
 *   node scripts/sync-worker-schema.mjs           → copy canonical → worker
 *   node scripts/sync-worker-schema.mjs --check    → exit 1 if they differ
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPath = join(root, "packages/database/prisma/schema.prisma");
const workerPath = join(root, "apps/worker/prisma/schema.prisma");

const canonical = readFileSync(canonicalPath, "utf8");
const isCheck = process.argv.includes("--check");

if (isCheck) {
  let worker = "";
  try {
    worker = readFileSync(workerPath, "utf8");
  } catch {
    // missing file is treated as out of sync
  }
  if (worker !== canonical) {
    console.error(
      "✖ apps/worker/prisma/schema.prisma is out of sync with the canonical schema.\n" +
        "  Run `npm run sync:schema` and commit the result.",
    );
    process.exit(1);
  }
  console.log("✓ worker schema is in sync with the canonical schema");
} else {
  writeFileSync(workerPath, canonical);
  console.log("✓ Synced canonical schema → apps/worker/prisma/schema.prisma");
}
