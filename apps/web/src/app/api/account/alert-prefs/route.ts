import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/current-user";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { emailAlertsEnabled: true, alertThresholdPct: true },
  });

  return NextResponse.json({
    emailAlertsEnabled: row?.emailAlertsEnabled ?? true,
    alertThresholdPct: row?.alertThresholdPct ?? 5,
  });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 });
  }

  const { emailAlertsEnabled, alertThresholdPct } = (body ?? {}) as {
    emailAlertsEnabled?: unknown;
    alertThresholdPct?: unknown;
  };

  const data: { emailAlertsEnabled?: boolean; alertThresholdPct?: number } = {};

  if (typeof emailAlertsEnabled === "boolean") {
    data.emailAlertsEnabled = emailAlertsEnabled;
  }

  if (typeof alertThresholdPct === "number") {
    if (!Number.isFinite(alertThresholdPct) || alertThresholdPct < 0 || alertThresholdPct > 100) {
      return NextResponse.json({ error: "Eşik 0-100 arasında olmalı" }, { status: 400 });
    }
    data.alertThresholdPct = alertThresholdPct;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Güncellenecek alan yok" }, { status: 400 });
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data,
    select: { emailAlertsEnabled: true, alertThresholdPct: true },
  });

  return NextResponse.json(updated);
}
