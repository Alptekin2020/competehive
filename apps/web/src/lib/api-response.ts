import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Standardized API response helpers.
 * User-facing messages in Turkish, internal logs in English.
 */

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function unauthorized() {
  return apiError("Yetkisiz erişim", 401);
}

export function badRequest(message: string) {
  return apiError(message, 400);
}

export function notFound(message: string) {
  return apiError(message, 404);
}

export function forbidden(message: string) {
  return apiError(message, 403);
}

export function serverError(error: unknown, context: string) {
  logger.error({ err: error }, context);
  return apiError("Sunucu hatası", 500);
}
