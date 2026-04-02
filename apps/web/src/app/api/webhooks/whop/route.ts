import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { getCompeteHivePlanByWhopId, getPlanLimits } from "@/lib/plans";
import crypto from "crypto";

const prisma = new PrismaClient();

// Verify Whop webhook signature (Standard Webhooks spec)
function verifyWebhookSignature(body: string, headers: Headers): boolean {
  const webhookKey = process.env.WHOP_WEBHOOK_SECRET;
  if (!webhookKey) {
    console.warn("WHOP_WEBHOOK_SECRET not set — skipping signature verification");
    return true; // Allow in dev, but MUST set in production
  }

  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false;
  }

  // Verify timestamp is recent (within 5 minutes)
  const timestamp = parseInt(svixTimestamp);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return false;
  }

  // Compute expected signature
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const secret = Buffer.from(webhookKey.replace("whsec_", ""), "base64");
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedContent)
    .digest("base64");

  // Compare signatures (Whop sends multiple, check each)
  const signatures = svixSignature.split(" ");
  return signatures.some((sig) => {
    const sigValue = sig.split(",")[1]; // format: "v1,base64signature"
    return sigValue === expectedSignature;
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    // Verify signature
    if (!verifyWebhookSignature(body, req.headers)) {
      console.error("Whop webhook signature verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(body);
    const action = payload.action;
    const data = payload.data;

    console.log(`Whop webhook received: ${action}`, {
      membershipId: data?.id,
      userId: data?.user?.id,
      planId: data?.plan?.id,
    });

    switch (action) {
      case "membership.went_valid": {
        await handleMembershipValid(data);
        break;
      }
      case "membership.went_invalid": {
        await handleMembershipInvalid(data);
        break;
      }
      case "payment.succeeded": {
        console.log("Payment succeeded:", {
          membershipId: data?.membership_id,
          amount: data?.amount,
        });
        // Payment success is informational — plan change is handled by membership events
        break;
      }
      case "payment.failed": {
        console.log("Payment failed:", {
          membershipId: data?.membership_id,
        });
        // Payment failure will eventually trigger membership.went_invalid
        break;
      }
      default:
        console.log(`Unhandled Whop webhook action: ${action}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Whop webhook error:", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

// ============================================
// Membership Activated — Upgrade Plan
// ============================================

async function handleMembershipValid(data: Record<string, unknown>) {
  const user_data = data.user as Record<string, unknown> | undefined;
  const plan_data = data.plan as Record<string, unknown> | undefined;
  const whopUserId = user_data?.id as string | undefined;
  const whopMembershipId = data.id as string | undefined;
  const whopPlanId = plan_data?.id as string | undefined;
  const userEmail = user_data?.email as string | undefined;
  const metadata = (data.metadata as Record<string, unknown>) || {};

  if (!whopPlanId) {
    console.error("No plan ID in membership.went_valid webhook");
    return;
  }

  // Map Whop plan to CompeteHive plan
  const competehivePlan = getCompeteHivePlanByWhopId(whopPlanId);
  const limits = getPlanLimits(competehivePlan);

  console.log(`Upgrading user to ${competehivePlan}`, {
    whopUserId,
    whopMembershipId,
    whopPlanId,
    email: userEmail,
  });

  // Find user by metadata (preferred) or by email (fallback)
  const competehiveUserId = metadata.competehive_user_id as string | undefined;
  let user = null;

  if (competehiveUserId) {
    user = await prisma.user.findUnique({ where: { id: competehiveUserId } });
  }

  if (!user && whopUserId) {
    user = await prisma.user.findFirst({ where: { whopUserId } });
  }

  if (!user && userEmail) {
    user = await prisma.user.findFirst({ where: { email: userEmail } });
  }

  if (!user) {
    console.error("Could not find CompeteHive user for Whop membership", {
      competehiveUserId,
      whopUserId,
      email: userEmail,
    });
    return;
  }

  // Update user's plan
  await prisma.user.update({
    where: { id: user.id },
    data: {
      plan: competehivePlan as "FREE" | "STARTER" | "PRO" | "ENTERPRISE",
      maxProducts: limits.maxProducts,
      whopUserId: whopUserId || user.whopUserId,
      whopMembershipId: whopMembershipId,
      planExpiresAt: null, // Active membership — no expiry
    },
  });

  // Update scrape intervals for all user's products
  await prisma.trackedProduct.updateMany({
    where: { userId: user.id },
    data: { scrapeInterval: limits.scrapeInterval },
  });

  console.log(`User ${user.id} upgraded to ${competehivePlan}`);
}

// ============================================
// Membership Deactivated — Downgrade to FREE
// ============================================

async function handleMembershipInvalid(data: Record<string, unknown>) {
  const user_data = data.user as Record<string, unknown> | undefined;
  const whopUserId = user_data?.id as string | undefined;
  const whopMembershipId = data.id as string | undefined;

  console.log("Membership went invalid", { whopUserId, whopMembershipId });

  // Find user by Whop membership ID or user ID
  let user = null;

  if (whopMembershipId) {
    user = await prisma.user.findFirst({ where: { whopMembershipId } });
  }

  if (!user && whopUserId) {
    user = await prisma.user.findFirst({ where: { whopUserId } });
  }

  if (!user) {
    console.error("Could not find user for invalid membership", { whopUserId, whopMembershipId });
    return;
  }

  const freeLimits = getPlanLimits("FREE");

  // Downgrade to FREE
  await prisma.user.update({
    where: { id: user.id },
    data: {
      plan: "FREE",
      maxProducts: freeLimits.maxProducts,
      whopMembershipId: null,
      planExpiresAt: new Date(), // Mark as expired
    },
  });

  // Update scrape intervals
  await prisma.trackedProduct.updateMany({
    where: { userId: user.id },
    data: { scrapeInterval: freeLimits.scrapeInterval },
  });

  // If user has more products than free limit, pause excess
  const activeProducts = await prisma.trackedProduct.findMany({
    where: { userId: user.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });

  if (activeProducts.length > freeLimits.maxProducts) {
    const toDeactivate = activeProducts.slice(freeLimits.maxProducts);
    for (const product of toDeactivate) {
      await prisma.trackedProduct.update({
        where: { id: product.id },
        data: { status: "PAUSED" },
      });
    }
    console.log(`Paused ${toDeactivate.length} products due to plan downgrade`);
  }

  console.log(`User ${user.id} downgraded to FREE`);
}
