import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { WHOP_PRODUCT_TO_PLAN, getPlanLimits, type PlanTier } from "@/lib/plans";

export const runtime = "nodejs";

// ---- Types for the Whop V1 (Standard Webhooks) payload ----
interface WhopUser {
  id?: string;
  email?: string;
  username?: string;
  name?: string;
}

interface WhopMembershipData {
  id?: string;
  status?: string;
  user?: WhopUser;
  product?: { id?: string; title?: string };
  plan?: { id?: string };
  renewal_period_end?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface WhopEvent {
  id?: string;
  api_version?: string;
  type?: string;
  data?: WhopMembershipData;
  company_id?: string | null;
}

// ---- Standard Webhooks signature verification (Whop V1) ----
// Whop signs `${webhook-id}.${webhook-timestamp}.${rawBody}` with HMAC-SHA256
// and sends the signature in the `webhook-signature` header as a
// space-separated list of `v1,<base64>` tokens. The webhook secret looks like
// `ws_...`; the Whop docs hand that raw string to the SDK (wrapped in btoa),
// so the HMAC key is the raw secret string bytes. We also try the classic
// Standard Webhooks key derivations as a safety net and log which one matched.
function candidateKeys(secret: string): { name: string; key: Buffer }[] {
  const keys: { name: string; key: Buffer }[] = [];
  keys.push({ name: "raw-utf8", key: Buffer.from(secret, "utf8") });
  const stripped = secret.replace(/^ws_/, "").replace(/^whsec_/, "");
  try {
    keys.push({ name: "b64-stripped", key: Buffer.from(stripped, "base64") });
  } catch {
    // ignore non-base64 secret
  }
  try {
    keys.push({ name: "b64-full", key: Buffer.from(secret, "base64") });
  } catch {
    // ignore non-base64 secret
  }
  return keys;
}

function verifyWhopSignature(
  rawBody: string,
  msgId: string,
  msgTimestamp: string,
  sigHeader: string,
  secret: string,
): { verified: boolean; scheme: string } {
  if (!rawBody || !msgId || !msgTimestamp || !sigHeader || !secret) {
    return { verified: false, scheme: "missing-input" };
  }
  const signedContent = msgId + "." + msgTimestamp + "." + rawBody;
  const passedSigs = sigHeader
    .split(" ")
    .map((token) => (token.includes(",") ? token.split(",")[1] : token))
    .filter(Boolean);

  for (const { name, key } of candidateKeys(secret)) {
    if (key.length === 0) continue;
    const expected = crypto.createHmac("sha256", key).update(signedContent).digest("base64");
    const expectedBuf = Buffer.from(expected, "base64");
    for (const sig of passedSigs) {
      let sigBuf: Buffer;
      try {
        sigBuf = Buffer.from(sig, "base64");
      } catch {
        continue;
      }
      if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return { verified: true, scheme: name };
      }
    }
  }
  return { verified: false, scheme: "no-match" };
}

function header(headers: Headers, ...names: string[]): string {
  for (const n of names) {
    const v = headers.get(n);
    if (v) return v;
  }
  return "";
}

async function findUser(data: WhopMembershipData) {
  const md = (data.metadata || {}) as Record<string, unknown>;
  const clerkFromMeta = md.clerkId || md.clerk_user_id || md.clerkUserId || md.clerk_id;
  // `competehive_user_id` / `competehive_email` are the keys the checkout flow
  // actually sets (see /api/checkout). They MUST be checked first or paying
  // users are never matched and never upgraded.
  const internalFromMeta =
    md.competehive_user_id || md.userId || md.user_id || md.internalUserId || md.internal_user_id;
  const metaEmail = typeof md.competehive_email === "string" ? md.competehive_email : undefined;
  const email = data.user?.email;
  const whopUserId = data.user?.id;

  // Priority: internal id (from checkout) -> clerk metadata -> checkout email
  // -> whop account email -> whop user id
  // `User.id` may be a Postgres uuid column in some environments; querying it
  // with a non-UUID string throws "invalid input syntax for type uuid" and
  // would 500 the webhook on attacker-/client-supplied metadata.
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (internalFromMeta && uuidRegex.test(String(internalFromMeta))) {
    const u = await prisma.user.findUnique({
      where: { id: String(internalFromMeta) },
    });
    if (u) return u;
  }
  if (clerkFromMeta) {
    const u = await prisma.user.findUnique({
      where: { clerkId: String(clerkFromMeta) },
    });
    if (u) return u;
  }
  for (const candidate of [metaEmail, email]) {
    if (!candidate) continue;
    const u = await prisma.user.findFirst({
      where: { email: { equals: candidate, mode: "insensitive" } },
    });
    if (u) return u;
  }
  if (whopUserId) {
    const u = await prisma.user.findUnique({ where: { whopUserId } });
    if (u) return u;
  }
  return null;
}

export async function POST(request: Request) {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[whop] WHOP_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const msgId = header(request.headers, "webhook-id", "svix-id");
  const msgTimestamp = header(request.headers, "webhook-timestamp", "svix-timestamp");
  const sigHeader = header(request.headers, "webhook-signature", "svix-signature");

  const { verified, scheme } = verifyWhopSignature(rawBody, msgId, msgTimestamp, sigHeader, secret);
  if (!verified) {
    console.error(
      "[whop] signature verification failed scheme=" +
        scheme +
        " hasId=" +
        Boolean(msgId) +
        " hasTs=" +
        Boolean(msgTimestamp) +
        " hasSig=" +
        Boolean(sigHeader),
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: WhopEvent;
  try {
    event = JSON.parse(rawBody) as WhopEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const type = event.type || "";
  const data = event.data || {};
  console.log("[whop] verified type=" + type + " scheme=" + scheme);

  try {
    if (type === "membership.activated") {
      const productId = data.product?.id;
      const tier = productId
        ? (WHOP_PRODUCT_TO_PLAN[productId] as PlanTier | undefined)
        : undefined;
      if (!productId || !tier) {
        console.warn("[whop] activated for unknown product=" + String(productId));
        return NextResponse.json({ received: true });
      }
      const user = await findUser(data);
      if (!user) {
        console.warn("[whop] membership.activated: user not found (email/whopId)");
        return NextResponse.json({ received: true });
      }
      const limits = getPlanLimits(tier);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          plan: tier,
          planStatus: "ACTIVE",
          planExpiresAt: data.renewal_period_end ? new Date(data.renewal_period_end) : null,
          maxProducts: limits.maxProducts,
          whopUserId: data.user?.id ?? undefined,
          whopMembershipId: data.id ?? undefined,
          whopProductId: productId,
          whopPlanId: data.plan?.id ?? undefined,
        },
      });
      console.log("[whop] activated user=" + user.id + " plan=" + tier);
      return NextResponse.json({ received: true });
    }

    if (type === "membership.deactivated") {
      const user = await findUser(data);
      if (!user) {
        console.warn("[whop] membership.deactivated: user not found");
        return NextResponse.json({ received: true });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { planStatus: "EXPIRED" },
      });
      console.log("[whop] deactivated user=" + user.id);
      return NextResponse.json({ received: true });
    }

    if (type === "payment.succeeded" || type === "invoice.paid") {
      // Renewal / successful charge. Whop also emits membership.activated for
      // access changes, so here we only refresh the expiry when we can match.
      const user = await findUser(data);
      if (user && data.renewal_period_end) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            planStatus: "ACTIVE",
            planExpiresAt: new Date(data.renewal_period_end),
          },
        });
        console.log("[whop] payment renewal user=" + user.id);
      } else {
        console.log("[whop] payment event logged type=" + type);
      }
      return NextResponse.json({ received: true });
    }

    console.log("[whop] ignored event type=" + type);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[whop] handler error", err);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}
