import { NextResponse } from "next/server";
import { Webhook } from "svix";

import prisma from "@/lib/prisma";
import { WHOP_PRODUCT_TO_PLAN, type PlanTier } from "@/lib/plans";

export const dynamic = "force-dynamic";

interface WhopEvent {
  action?: string;
  data?: Record<string, unknown>;
}

export async function POST(req: Request) {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[whop-webhook] WHOP_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const body = await req.text();
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error("[whop-webhook] missing svix headers");
    return NextResponse.json({ error: "missing headers" }, { status: 400 });
  }

  let event: WhopEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WhopEvent;
  } catch (err) {
    console.error("[whop-webhook] signature verification failed:", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const action = event.action ?? "";
  const data = (event.data ?? {}) as Record<string, unknown>;
  console.log(`[whop-webhook] ${action}`, JSON.stringify(data).slice(0, 500));

  try {
    if (action === "membership.went_valid" || action === "membership.activated") {
      await handleMembershipValid(data);
    } else if (action === "membership.went_invalid" || action === "membership.deactivated") {
      await handleMembershipInvalid(data);
    } else if (action === "payment.succeeded") {
      await handlePaymentSucceeded(data);
    } else {
      console.log(`[whop-webhook] unhandled action: ${action}`);
    }
    // Always 200 to prevent infinite Whop retries on logic errors.
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[whop-webhook] error in ${action}:`, err);
    return NextResponse.json({ ok: true, warning: "logged" });
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function handleMembershipValid(data: Record<string, unknown>) {
  const userObj = pickRecord(data.user);
  const accessPass = pickRecord(data.access_pass);
  const planObj = pickRecord(data.plan);
  const metadata = pickRecord(data.metadata) ?? {};
  const checkoutMeta = pickRecord(pickRecord(data.checkout)?.metadata) ?? {};

  const whopUserId = pickString(data.user_id) ?? pickString(userObj?.id);
  const email = pickString(userObj?.email);
  const clerkUserIdFromMeta =
    pickString(metadata.clerk_user_id) ?? pickString(checkoutMeta.clerk_user_id);
  const internalUserIdFromMeta =
    pickString(metadata.competehive_user_id) ?? pickString(checkoutMeta.competehive_user_id);

  const productId = pickString(data.product_id) ?? pickString(accessPass?.id);
  const membershipId = pickString(data.id);
  const planId = pickString(data.plan_id) ?? pickString(planObj?.id);

  const expiresAtSec =
    typeof data.expires_at === "number"
      ? data.expires_at
      : typeof data.renewal_period_end === "number"
        ? data.renewal_period_end
        : typeof planObj?.expires_at === "number"
          ? (planObj.expires_at as number)
          : undefined;
  const expiresAt = expiresAtSec ? new Date(expiresAtSec * 1000) : null;

  if (!productId || !membershipId) {
    console.error("[whop-webhook] missing productId or membershipId", { productId, membershipId });
    return;
  }

  const plan: PlanTier | undefined = WHOP_PRODUCT_TO_PLAN[productId];
  if (!plan) {
    console.error(
      `[whop-webhook] unknown Whop product ID: ${productId}. Update WHOP_PRODUCT_TO_PLAN.`,
    );
    return;
  }

  // Find user — try metadata (best), then email, then whopUserId.
  let user = null;
  if (clerkUserIdFromMeta) {
    user = await prisma.user.findUnique({ where: { clerkId: clerkUserIdFromMeta } });
  }
  if (!user && internalUserIdFromMeta) {
    user = await prisma.user.findUnique({ where: { id: internalUserIdFromMeta } });
  }
  if (!user && email) {
    user = await prisma.user.findUnique({ where: { email } });
  }
  if (!user && whopUserId) {
    user = await prisma.user.findUnique({ where: { whopUserId } });
  }

  if (!user) {
    console.error("[whop-webhook] user not found", { clerkUserIdFromMeta, email, whopUserId });
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      plan,
      planStatus: "ACTIVE",
      planExpiresAt: expiresAt,
      whopUserId: whopUserId ?? user.whopUserId,
      whopMembershipId: membershipId,
      whopProductId: productId,
      whopPlanId: planId ?? user.whopPlanId,
    },
  });

  console.log(`[whop-webhook] activated ${plan} for ${user.email}`);
}

async function handleMembershipInvalid(data: Record<string, unknown>) {
  const membershipId = pickString(data.id);
  if (!membershipId) return;

  const user = await prisma.user.findUnique({ where: { whopMembershipId: membershipId } });
  if (!user) {
    console.error(`[whop-webhook] no user found for membership ${membershipId}`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { planStatus: "EXPIRED" },
  });
  console.log(`[whop-webhook] expired plan for ${user.email}`);
}

async function handlePaymentSucceeded(data: Record<string, unknown>) {
  // Whop also sends membership.went_valid on renewals, so we just log here for
  // observability. Plan-state changes go through the membership handlers.
  const membershipObj = pickRecord(data.membership);
  console.log("[whop-webhook] payment succeeded", {
    membershipId: pickString(data.membership_id) ?? pickString(membershipObj?.id),
  });
}
