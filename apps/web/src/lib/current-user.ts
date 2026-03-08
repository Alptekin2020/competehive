import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { auth, clerkClient } from "@clerk/nextjs/server";
import prisma from "@/lib/prisma";

function isMissingClerkIdColumnError(error: unknown) {
  if (error instanceof Error && error.message.includes("clerk_id") && error.message.includes("does not exist")) {
    return true;
  }
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2022" &&
    error.message.includes("clerk_id")
  );
}

function throwSchemaDriftError(error: unknown) {
  console.error(
    "Database schema is out of date: users.clerk_id is missing. Ensure deployment runs Prisma migrations before starting the web app.",
    error
  );
  throw new Error(
    "DATABASE_SCHEMA_OUT_OF_DATE: Missing users.clerk_id column. Automatic deployment must run Prisma migrations before serving requests."
  );
}

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
    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
      clerkUser.username ||
      null;

    // Incremental auth fix: preserve internal UUIDs and map Clerk IDs via `clerkId`.
    return prisma.user.upsert({
      where: { clerkId: userId },
      update: {
        email,
        name,
        isActive: true,
      },
      create: {
        id: randomUUID(),
        clerkId: userId,
        email,
        name,
      },
    });
  } catch (error) {
    if (isMissingClerkIdColumnError(error)) {
      throwSchemaDriftError(error);
    }

    console.error("Failed to provision Clerk user in database", error);

    try {
      return await prisma.user.findUnique({ where: { clerkId: userId } });
    } catch (fallbackError) {
      if (isMissingClerkIdColumnError(fallbackError)) {
        throwSchemaDriftError(fallbackError);
      }
      throw fallbackError;
    }
  }
}
