export const maxDuration = 15; // Vercel timeout 15 saniye

import { NextRequest } from "next/server";
import { z } from "zod";
import { apiSuccess, badRequest, serverError } from "@/lib/api-response";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { runStoreCheck } from "@/lib/store-check";

const schema = z.object({
  url: z
    .string()
    .trim()
    .url("Geçerli bir ürün linki girin")
    .max(2000, "Link çok uzun")
    .refine((value) => /^https?:\/\//i.test(value), "Link http:// veya https:// ile başlamalı"),
});

// POST - Herkese açık "Siteniz uyumlu mu?" kontrolü (giriş gerektirmez).
// Dış siteye istek attığı için fail-closed IP sınırları: dakikada 5, günde 30.
export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    const perMinute = await rateLimit(`rate:store-check:min:${ip}`, 5, 60, { failClosed: true });
    if (!perMinute.success) return rateLimitResponse(perMinute.reset);
    const perDay = await rateLimit(`rate:store-check:day:${ip}`, 30, 24 * 60 * 60, {
      failClosed: true,
    });
    if (!perDay.success) return rateLimitResponse(perDay.reset);

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Geçersiz istek");

    const { checkId, result } = await runStoreCheck(parsed.data.url);
    return apiSuccess({ checkId, ...result });
  } catch (error) {
    return serverError(error, "POST /api/public/store-check error");
  }
}
