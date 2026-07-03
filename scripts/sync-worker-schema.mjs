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
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalPath = join(root, "packages/database/prisma/schema.prisma");
const workerPath = join(root, "apps/worker/prisma/schema.prisma");
// Migration klasörü de aynalanır: worker imajı `prisma migrate deploy`'u
// gerçek migration'larla çalıştırabilsin (önceden boş klasörle no-op'tu).
const canonicalMigrationsDir = join(root, "packages/database/prisma/migrations");
const workerMigrationsDir = join(root, "apps/worker/prisma/migrations");

const canonical = readFileSync(canonicalPath, "utf8");
const isCheck = process.argv.includes("--check");

function listMigrationFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) {
      files.push(join(entry.parentPath ?? entry.path, entry.name));
    }
  }
  return files.sort();
}

function migrationsInSync() {
  const canonicalFiles = listMigrationFiles(canonicalMigrationsDir).map((f) =>
    f.slice(canonicalMigrationsDir.length),
  );
  const workerFiles = listMigrationFiles(workerMigrationsDir).map((f) =>
    f.slice(workerMigrationsDir.length),
  );
  if (canonicalFiles.join("\n") !== workerFiles.join("\n")) return false;
  const normalize = (s) => s.replace(/\r\n/g, "\n");
  return canonicalFiles.every(
    (rel) =>
      normalize(readFileSync(join(canonicalMigrationsDir, rel), "utf8")) ===
      normalize(readFileSync(join(workerMigrationsDir, rel), "utf8")),
  );
}

if (isCheck) {
  let worker = "";
  try {
    worker = readFileSync(workerPath, "utf8");
  } catch {
    // missing file is treated as out of sync
  }
  // Normalize line endings so a CRLF checkout (Windows) doesn't false-fail.
  const normalize = (s) => s.replace(/\r\n/g, "\n");
  if (normalize(worker) !== normalize(canonical)) {
    console.error(
      "✖ apps/worker/prisma/schema.prisma is out of sync with the canonical schema.\n" +
        "  Run `npm run sync:schema` and commit the result.",
    );
    process.exit(1);
  }
  if (!migrationsInSync()) {
    console.error(
      "✖ apps/worker/prisma/migrations is out of sync with packages/database/prisma/migrations.\n" +
        "  Run `npm run sync:schema` and commit the result.",
    );
    process.exit(1);
  }
  console.log("✓ worker schema and migrations are in sync with the canonical versions");
} else {
  writeFileSync(workerPath, canonical);
  rmSync(workerMigrationsDir, { recursive: true, force: true });
  if (existsSync(canonicalMigrationsDir)) {
    cpSync(canonicalMigrationsDir, workerMigrationsDir, { recursive: true });
  }
  console.log(
    "✓ Synced canonical schema + migrations → apps/worker/prisma/{schema.prisma,migrations}",
  );
}
