import { randomUUID } from "crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";
import pool from "@/lib/db-pool";

export interface AppUser {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  plan: string;
  maxProducts: number;
  isActive: boolean;
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const { userId } = await auth();
  if (!userId) {
    return null;
  }

  try {
    const client = await clerkClient();
    const clerkUser = await client.users.getUser(userId);

    const primaryEmail = clerkUser.emailAddresses.find(
      (email) => email.id === clerkUser.primaryEmailAddressId
    )?.emailAddress;

    const fallbackEmail = `${userId}@users.clerk.local`;
    const email = primaryEmail ?? fallbackEmail;
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.username ||
      null;

    const newId = randomUUID();

    // Upsert user by clerk_id using pg directly
    const result = await pool.query(
      `INSERT INTO users (id, clerk_id, email, name, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (clerk_id) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         is_active = true
       RETURNING id, clerk_id, email, name, plan, max_products, is_active`,
      [newId, userId, email, name]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      clerkId: row.clerk_id,
      email: row.email,
      name: row.name,
      plan: row.plan,
      maxProducts: row.max_products,
      isActive: row.is_active,
    };
  } catch (error) {
    console.error("Failed to provision Clerk user in database", error);

    // Fallback: try to find existing user by clerk_id
    try {
      const result = await pool.query(
        `SELECT id, clerk_id, email, name, plan, max_products, is_active
         FROM users WHERE clerk_id = $1`,
        [userId]
      );
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      return {
        id: row.id,
        clerkId: row.clerk_id,
        email: row.email,
        name: row.name,
        plan: row.plan,
        maxProducts: row.max_products,
        isActive: row.is_active,
      };
    } catch (fallbackError) {
      console.error("Fallback user lookup failed", fallbackError);
      throw fallbackError;
    }
  }
}
