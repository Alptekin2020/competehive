import { auth, clerkClient } from "@clerk/nextjs/server";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import prisma from "@/lib/prisma";

export interface AppUser {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  plan: string;
  maxProducts: number;
  isActive: boolean;
}

const ROLLOUT_FALLBACK_MISSING_COLUMNS = [
  "whop_user_id",
  "whop_membership_id",
  "plan_expires_at",
] as const;

const ADMIN_OVERRIDE_PLAN = "ENTERPRISE";
const ADMIN_OVERRIDE_MAX_PRODUCTS = 99999;

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAdminUser({ clerkId, email }: { clerkId: string; email: string }): boolean {
  const adminClerkIds = parseAllowlist(process.env.ADMIN_CLERK_IDS);
  const adminEmails = parseAllowlist(process.env.ADMIN_EMAILS).map((value) => value.toLowerCase());

  return adminClerkIds.includes(clerkId) || adminEmails.includes(email.toLowerCase());
}

async function applyAdminOverride(user: {
  id: string;
  clerkId: string | null;
  email: string;
  name: string | null;
  plan: string;
  maxProducts: number;
  isActive: boolean;
}): Promise<AppUser> {
  if (!user.clerkId || !isAdminUser({ clerkId: user.clerkId, email: user.email })) {
    return {
      id: user.id,
      clerkId: user.clerkId!,
      email: user.email,
      name: user.name,
      plan: user.plan,
      maxProducts: user.maxProducts,
      isActive: user.isActive,
    };
  }

  const needsAdminUpdate =
    user.plan !== ADMIN_OVERRIDE_PLAN ||
    user.maxProducts !== ADMIN_OVERRIDE_MAX_PRODUCTS ||
    user.isActive !== true;

  if (needsAdminUpdate) {
    console.info(
      `[getCurrentUser] Applying admin ENTERPRISE override for ${user.email} (${user.clerkId}).`,
    );

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        plan: ADMIN_OVERRIDE_PLAN,
        maxProducts: ADMIN_OVERRIDE_MAX_PRODUCTS,
        isActive: true,
      },
    });

    return {
      id: updatedUser.id,
      clerkId: updatedUser.clerkId!,
      email: updatedUser.email,
      name: updatedUser.name,
      plan: updatedUser.plan,
      maxProducts: updatedUser.maxProducts,
      isActive: updatedUser.isActive,
    };
  }

  return {
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    name: user.name,
    plan: ADMIN_OVERRIDE_PLAN,
    maxProducts: ADMIN_OVERRIDE_MAX_PRODUCTS,
    isActive: true,
  };
}

function shouldUseLegacyUserUpsertFallback(error: unknown): boolean {
  if (!(error instanceof PrismaClientKnownRequestError)) {
    return false;
  }

  if (error.code !== "P2022") {
    return false;
  }

  const target = `${error.meta?.target ?? ""}`.toLowerCase();
  return ROLLOUT_FALLBACK_MISSING_COLUMNS.some(
    (column) => target.includes(`users.${column}`) || target.includes(column),
  );
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
      (email) => email.id === clerkUser.primaryEmailAddressId,
    )?.emailAddress;

    const fallbackEmail = `${userId}@users.clerk.local`;
    const email = primaryEmail ?? fallbackEmail;
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.username ||
      null;

    let dbUser;
    try {
      dbUser = await prisma.user.upsert({
        where: { clerkId: userId },
        update: {
          email,
          name,
        },
        create: {
          clerkId: userId,
          email,
          name,
        },
      });
    } catch (upsertError: any) {
      // P2002: unique constraint on email — same email used with different auth method
      if (upsertError?.code === "P2002" && upsertError?.meta?.target?.includes("email")) {
        try {
          dbUser = await prisma.user.update({
            where: { email },
            data: {
              clerkId: userId,
              name,
            },
          });
        } catch (mergeError) {
          dbUser = await prisma.user.findUnique({ where: { email } });
        }
      }
      // P2022: missing column — migration rollout
      else if (upsertError?.code === "P2022") {
        try {
          dbUser = await prisma.user.upsert({
            where: { clerkId: userId },
            update: { email, name },
            create: { clerkId: userId, email, name },
          });
        } catch {
          dbUser = await prisma.user.findUnique({ where: { clerkId: userId } });
        }
      } else {
        dbUser = await prisma.user.findUnique({ where: { clerkId: userId } });
      }
    }

    if (!dbUser) {
      return null;
    }

    return applyAdminOverride(dbUser);
  } catch (error) {
    console.error("Failed to provision Clerk user in database", error);

    // Fallback: try to find existing user by clerk_id
    try {
      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
      });
      if (!user) return null;

      return applyAdminOverride(user);
    } catch (fallbackError) {
      console.error("Fallback user lookup failed", fallbackError);
      throw fallbackError;
    }
  }
}
