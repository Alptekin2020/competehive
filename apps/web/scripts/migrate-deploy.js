#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const isVercel = process.env.VERCEL === "1";
const vercelEnv = process.env.VERCEL_ENV;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (vercelEnv === "production") {
    console.error(
      "[db:migrate] DATABASE_URL is missing in production deployment. Prisma migrations cannot run."
    );
    process.exit(1);
  }

  console.log(
    "[db:migrate] DATABASE_URL is not set; skipping Prisma migrate deploy for this build environment."
  );
  process.exit(0);
}

if (isVercel && vercelEnv === "preview") {
  console.log(
    "[db:migrate] Vercel preview deployment detected; skipping Prisma migrate deploy."
  );
  process.exit(0);
}

const schemaArg = ["--schema", "../../packages/database/prisma/schema.prisma"];
const spawnOpts = { shell: process.platform === "win32" };

console.log("[db:migrate] Running prisma migrate deploy...");
const result = spawnSync(
  "npx",
  ["prisma", "migrate", "deploy", ...schemaArg],
  { ...spawnOpts, stdio: ["inherit", "pipe", "pipe"] }
);

const stdout = result.stdout?.toString() ?? "";
const stderr = result.stderr?.toString() ?? "";

if (result.status === 0) {
  if (stdout) process.stdout.write(stdout);
  console.log("[db:migrate] Prisma migrate deploy completed.");
  process.exit(0);
}

// P3005: database schema is not empty – need to baseline existing migrations
if (stdout.includes("P3005") || stderr.includes("P3005")) {
  console.log(
    "[db:migrate] Database already has tables but no migration history (P3005)."
  );
  console.log("[db:migrate] Baselining existing migrations...");

  // Read migration directory names to resolve them as already applied
  const fs = require("node:fs");
  const path = require("node:path");
  const migrationsDir = path.resolve(
    __dirname,
    "../../../packages/database/prisma/migrations"
  );
  const migrations = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "migration_lock.toml")
    .map((d) => d.name)
    .sort();

  for (const migration of migrations) {
    console.log(`[db:migrate] Resolving migration as applied: ${migration}`);
    const resolveResult = spawnSync(
      "npx",
      [
        "prisma",
        "migrate",
        "resolve",
        "--applied",
        migration,
        ...schemaArg,
      ],
      { ...spawnOpts, stdio: "inherit" }
    );
    if (resolveResult.status !== 0) {
      console.error(
        `[db:migrate] Failed to resolve migration: ${migration}`
      );
      process.exit(resolveResult.status ?? 1);
    }
  }

  // Retry migrate deploy after baselining
  console.log("[db:migrate] Retrying prisma migrate deploy...");
  const retryResult = spawnSync(
    "npx",
    ["prisma", "migrate", "deploy", ...schemaArg],
    { ...spawnOpts, stdio: "inherit" }
  );

  if (retryResult.status !== 0) {
    console.error("[db:migrate] Prisma migrate deploy failed after baselining.");
    process.exit(retryResult.status ?? 1);
  }

  console.log("[db:migrate] Prisma migrate deploy completed after baselining.");
} else {
  // Some other error
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  console.error("[db:migrate] Prisma migrate deploy failed.");
  process.exit(result.status ?? 1);
}
