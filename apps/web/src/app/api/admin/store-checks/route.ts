import { NextRequest } from "next/server";
import { getCurrentUser, isAdminUser } from "@/lib/current-user";
import { apiSuccess, forbidden, serverError, unauthorized } from "@/lib/api-response";
import { parseSummaryDays, summarizeStoreChecks } from "@/lib/store-check-summary";

// GET - Herkese açık uyumluluk kontrolü kayıtlarının alan adı bazında özeti
// (yalnızca yöneticiler). Hangi sitelerin istendiğini ve hangilerinin
// desteklenmediğini gösterir; desteğe öncelik vermek için kullanılır.
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return unauthorized();
    if (!isAdminUser({ clerkId: user.clerkId, email: user.email })) {
      return forbidden("Bu işlem için yetkiniz yok");
    }

    const days = parseSummaryDays(new URL(req.url).searchParams.get("days"));
    return apiSuccess(await summarizeStoreChecks(days));
  } catch (error) {
    return serverError(error, "GET /api/admin/store-checks error");
  }
}
