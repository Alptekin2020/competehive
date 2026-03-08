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

console.log("[db:migrate] Running prisma migrate deploy...");
const result = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "deploy",
    "--schema",
    "../../packages/database/prisma/schema.prisma",
  ],
  { stdio: "inherit", shell: process.platform === "win32" }
);

if (result.status !== 0) {
  console.error("[db:migrate] Prisma migrate deploy failed.");
  process.exit(result.status ?? 1);
}

console.log("[db:migrate] Prisma migrate deploy completed.");
