import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { apiSuccess, unauthorized, serverError } from "@/lib/api-response";

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();

    await prisma.user.update({
      where: { clerkId: user.clerkId },
      data: {
        telegramChatId: null,
        telegramStatus: null,
        telegramConnectedAt: null,
        telegramLinkToken: null,
        telegramLinkTokenExpiresAt: null,
      },
    });

    return apiSuccess({ success: true });
  } catch (error) {
    return serverError(error, "DELETE /api/telegram/disconnect");
  }
}
