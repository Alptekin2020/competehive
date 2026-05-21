import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError } from "@/lib/api-response";
import crypto from "crypto";

const LINK_TOKEN_TTL_MINUTES = 10;

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      return serverError(
        new Error("TELEGRAM_BOT_USERNAME env var not set"),
        "POST /api/telegram/connect",
      );
    }

    const linkToken = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MINUTES * 60 * 1000);

    await prisma.user.update({
      where: { clerkId: user.clerkId },
      data: {
        telegramLinkToken: linkToken,
        telegramLinkTokenExpiresAt: expiresAt,
        telegramStatus: "awaiting_start",
      },
    });

    return apiSuccess({
      deepLink: `https://t.me/${botUsername}?start=${linkToken}`,
      botUsername,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    return serverError(error, "POST /api/telegram/connect");
  }
}
