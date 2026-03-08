import { auth, clerkClient } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

export async function getCurrentUser() {
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
    const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || clerkUser.username || null;

    return prisma.user.upsert({
      where: { id: userId },
      update: {
        email,
        name,
        isActive: true,
      },
      create: {
        id: userId,
        email,
        name,
      },
    });
  } catch (error) {
    console.error("Failed to provision Clerk user in database", error);
    return prisma.user.findUnique({ where: { id: userId } });
  }
}
