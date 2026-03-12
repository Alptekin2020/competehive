import { auth, clerkClient } from "@clerk/nextjs/server";
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

    const user = await prisma.user.upsert({
      where: { clerkId: userId },
      update: { email, name, isActive: true },
      create: { clerkId: userId, email, name, isActive: true },
    });

    return {
      id: user.id,
      clerkId: user.clerkId!,
      email: user.email,
      name: user.name,
      plan: user.plan,
      maxProducts: user.maxProducts,
      isActive: user.isActive,
    };
  } catch (error) {
    console.error("Failed to provision Clerk user in database", error);

    // Fallback: try to find existing user by clerk_id
    try {
      const user = await prisma.user.findUnique({
        where: { clerkId: userId },
      });
      if (!user) return null;

      return {
        id: user.id,
        clerkId: user.clerkId!,
        email: user.email,
        name: user.name,
        plan: user.plan,
        maxProducts: user.maxProducts,
        isActive: user.isActive,
      };
    } catch (fallbackError) {
      console.error("Fallback user lookup failed", fallbackError);
      throw fallbackError;
    }
  }
}
