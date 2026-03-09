import { NextResponse } from "next/server";
import pool from "@/lib/db-pool";

export async function GET() {
  const results: string[] = [];
  const client = await pool.connect();

  try {
    // Step 1: Add clerk_id column if not exists
    await client.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id TEXT UNIQUE`
    );
    results.push("Added clerk_id column (or already exists)");

    // Step 2: Make password_hash nullable
    await client.query(
      `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`
    );
    results.push("Made password_hash nullable");

    // Step 3: Create index on clerk_id
    await client.query(
      `CREATE INDEX IF NOT EXISTS users_clerk_id_idx ON users(clerk_id)`
    );
    results.push("Created index on clerk_id (or already exists)");

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Migration error:", error);
    return NextResponse.json(
      { error: error.message, results },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
