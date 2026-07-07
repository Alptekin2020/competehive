import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import redis from "@/lib/redis";
import { WHOP_PRODUCT_TO_PLAN, getPlanLimits, type PlanTier } from "@/lib/plans";
import { isPaidTier } from "@/lib/plan-resolve";
import { getWhopClient } from "@/lib/whop";
import {
  isFreshWebhookTimestamp,
  isSupersededMembershipEvent,
  parseWhopTimestamp,
  verifyWhopSignature,
} from "@/lib/whop-webhook";

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
  // Payment payloads carry the membership as a nested {id, status} reference
  // instead of membership fields at the top level.
  membership?: { id?: string; status?: string } | null;
  // invoice.paid payload'ında müşteri e-postası user.email'de DEĞİL, üst
  // düzey email_address alanındadır (SDK Shared.Invoice); user nesnesi
  // yalnızca id/name/username taşır.
  email_address?: string;
}

interface WhopEvent {
  id?: string;
  api_version?: string;
  type?: string;
  data?: WhopMembershipData;
  company_id?: string | null;
}

// Whop at-least-once teslimat yapar ve her yeniden gönderim taze imza/
// timestamp taşır — replay penceresi çift işlemi YAKALAYAMAZ. Başarıyla
// işlenen event id'leri Redis'te işaretlenir; anahtar yalnızca 2xx dönen
// işlemlerden SONRA yazılır ki kasıtlı 5xx-retry akışları (unmapped product,
// user not found) sonraki denemede atlanmasın. Redis erişilemezse akış
// bozulmaz (fail-open): çift işlem koruması zaten ikinci savunma hattı.
const EVENT_DEDUP_TTL_SEC = 48 * 60 * 60;

async function isDuplicateEvent(eventId: string | undefined): Promise<boolean> {
  if (!eventId) return false;
  try {
    return (await redis.exists(`whop-event:${eventId}`)) === 1;
  } catch (redisError) {
    console.warn("[whop] dedup check unavailable (redis): " + String(redisError));
    return false;
  }
}

async function markEventProcessed(eventId: string | undefined): Promise<void> {
  if (!eventId) return;
  try {
    await redis.set(`whop-event:${eventId}`, "1", "EX", EVENT_DEDUP_TTL_SEC);
  } catch (redisError) {
    console.warn("[whop] dedup mark unavailable (redis): " + String(redisError));
  }
}

function isP2002(e: unknown): e is { code: string; meta?: { target?: unknown } } {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

// whopUserId/whopMembershipId @unique kolonlarında çakışma (aynı Whop hesabı
// daha önce başka bir CompeteHive kullanıcısına bağlanmış) plan aktivasyonunu
// engellememeli: çakışan bağlantı alanlarını sırayla düşürerek yeniden dene.
// Aksi halde P2002 → 500 → Whop aynı payload'ı sonsuza dek yeniden dener ve
// ödeyen kullanıcı hiç yükseltilmez.
async function updateUserForActivation(
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const attempts: Array<(d: Record<string, unknown>) => Record<string, unknown>> = [
    (d) => d,
    (d) => ({ ...d, whopUserId: undefined }),
    (d) => ({ ...d, whopUserId: undefined, whopMembershipId: undefined }),
  ];
  for (let i = 0; i < attempts.length; i++) {
    try {
      await prisma.user.update({ where: { id: userId }, data: attempts[i](data) });
      if (i > 0) {
        console.error(
          "[whop] unique collision on Whop link columns — activated user=" +
            userId +
            " WITHOUT " +
            (i === 1 ? "whopUserId" : "whopUserId+whopMembershipId") +
            "; another account holds the same Whop link, reconcile manually",
        );
      }
      return;
    } catch (updateError) {
      if (!isP2002(updateError) || i === attempts.length - 1) throw updateError;
    }
  }
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
  // invoice.paid müşteri e-postasını üst düzey email_address'te taşır.
  const invoiceEmail = typeof data.email_address === "string" ? data.email_address : undefined;
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
  for (const candidate of [metaEmail, email, invoiceEmail]) {
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

  // Replay protection (Standard Webhooks): reject stale/early-dated messages
  // so a captured, validly-signed request can't be replayed later.
  if (!isFreshWebhookTimestamp(msgTimestamp)) {
    console.error("[whop] stale or invalid timestamp — possible replay");
    return NextResponse.json({ error: "stale timestamp" }, { status: 401 });
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

  if (await isDuplicateEvent(event.id)) {
    console.log("[whop] duplicate delivery skipped event=" + String(event.id) + " type=" + type);
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    if (type === "membership.activated") {
      const productId = data.product?.id;
      let tier = productId ? (WHOP_PRODUCT_TO_PLAN[productId] as PlanTier | undefined) : undefined;
      if (!tier) {
        // Product eşlemesi eksikse checkout'un kendi yazdığı
        // metadata.competehive_plan'a düş: env eşlemesi yanlış diye ödeyen
        // müşteri kaybedilmez, ama config hatası yine yüksek sesle loglanır.
        const md = (data.metadata || {}) as Record<string, unknown>;
        const metaPlan = typeof md.competehive_plan === "string" ? md.competehive_plan : undefined;
        if (metaPlan && isPaidTier(metaPlan)) {
          tier = metaPlan;
          console.error(
            "[whop] product=" +
              String(productId) +
              " is UNMAPPED — using checkout metadata plan=" +
              metaPlan +
              " as fallback; FIX the WHOP_*_PRODUCT_ID env mapping",
          );
        }
      }
      if (!productId || !tier) {
        // A paid activation we can't map to a tier means our WHOP_*_PRODUCT_ID
        // env mapping is missing/wrong. Do NOT silently 200 it away — return a
        // 5xx so Whop retries (buying time to fix config) and the failure shows
        // up as a failed delivery instead of a silently-lost paying customer.
        console.error(
          "[whop] membership.activated for UNMAPPED product=" +
            String(productId) +
            " membership=" +
            String(data.id) +
            " — check WHOP_*_PRODUCT_ID env mapping",
        );
        return NextResponse.json({ error: "unmapped product" }, { status: 500 });
      }
      const user = await findUser(data);
      if (!user) {
        // Paid activation but we couldn't match it to a user (metadata/email
        // mismatch, or the Clerk->DB upsert hasn't happened yet). Returning a
        // 5xx lets Whop retry so the upgrade isn't silently dropped.
        console.error(
          "[whop] membership.activated: USER NOT FOUND — membership=" +
            String(data.id) +
            " email=" +
            String(data.user?.email) +
            " whopUserId=" +
            String(data.user?.id) +
            " plan=" +
            tier,
        );
        return NextResponse.json({ error: "user not found" }, { status: 500 });
      }
      const limits = getPlanLimits(tier);
      const previousMembershipId = user.whopMembershipId;

      // Whop at-least-once teslimat + sırasız retry'lara karşı canlı doğrulama:
      // payload eski olabilir, API'deki güncel membership kaydı gerçektir.
      // API erişilemezse payload ile devam edilir (meşru yükseltmeyi bloklama).
      let liveMembership: {
        status?: string;
        renewal_period_end?: string | null;
        created_at?: string;
      } | null = null;
      if (data.id) {
        try {
          liveMembership = await getWhopClient().memberships.retrieve(data.id);
        } catch (retrieveError) {
          console.error(
            "[whop] could not retrieve membership=" +
              data.id +
              " for live validation, proceeding with payload: " +
              String(retrieveError),
          );
        }
      }

      // Gecikmiş bir activated retry'ı, bu arada iade/iptal edilmiş bir
      // aboneliği diriltmemeli (deactivated tekrar GÖNDERİLMEZ).
      if (
        liveMembership &&
        (liveMembership.status === "canceled" || liveMembership.status === "expired")
      ) {
        console.log(
          "[whop] ignoring stale activation: membership=" +
            String(data.id) +
            " live status=" +
            String(liveMembership.status) +
            " user=" +
            user.id,
        );
        await markEventProcessed(event.id);
        return NextResponse.json({ received: true });
      }

      // Sıralama koruması: kullanıcının kayıtlı membership'i bu event'tekinden
      // farklıysa hangisinin daha yeni olduğunu CANLI created_at ile belirle.
      // Eski membership'in gecikmiş aktivasyonu yeni planı ezmemeli ve
      // kullanıcının hâlâ ödediği yeni aboneliği iptal ETMEMELİ.
      let cancelSuperseded = isSupersededMembershipEvent(previousMembershipId, data.id);
      if (cancelSuperseded) {
        try {
          const previous = await getWhopClient().memberships.retrieve(
            previousMembershipId as string,
          );
          const previousCreated = parseWhopTimestamp(previous?.created_at);
          const incomingCreated = parseWhopTimestamp(liveMembership?.created_at ?? null);
          if (previousCreated && incomingCreated && previousCreated > incomingCreated) {
            console.log(
              "[whop] ignoring out-of-order activation of OLDER membership=" +
                String(data.id) +
                " (current=" +
                String(previousMembershipId) +
                " is newer) user=" +
                user.id,
            );
            await markEventProcessed(event.id);
            return NextResponse.json({ received: true });
          }
        } catch (orderError) {
          // Sıra belirlenemedi: aktivasyonu işle ama yanlış aboneliği iptal
          // etme riskine karşı otomatik iptali atla. Olası çifte tahsilat,
          // mevcut cancel-failure yolundaki gibi manuel müdahale için loglanır.
          cancelSuperseded = false;
          console.error(
            "[whop] could not order memberships current=" +
              String(previousMembershipId) +
              " incoming=" +
              String(data.id) +
              " — activating WITHOUT auto-cancel, check for double billing: " +
              String(orderError),
          );
        }
      }

      // Dönem sonu: canlı değer > payload değeri; hiçbir durumda mevcut
      // planExpiresAt geriye sarılmaz (duplicate teslimat payment.succeeded'ın
      // uzattığı tarihi ezmemeli).
      let renewalEnd =
        parseWhopTimestamp(liveMembership?.renewal_period_end ?? null) ??
        parseWhopTimestamp(data.renewal_period_end);
      if (renewalEnd && user.planExpiresAt && user.planExpiresAt > renewalEnd) {
        renewalEnd = user.planExpiresAt;
      }

      await updateUserForActivation(user.id, {
        plan: tier,
        planStatus: "ACTIVE",
        planExpiresAt: renewalEnd ?? user.planExpiresAt ?? null,
        maxProducts: limits.maxProducts,
        whopUserId: data.user?.id ?? undefined,
        whopMembershipId: data.id ?? undefined,
        whopProductId: productId,
        whopPlanId: data.plan?.id ?? undefined,
      });

      // Plan değişikliği ürün satırlarına da yansımalı: tarama aralığı ürün
      // oluşturulurken plandan set edilir ve ürün bazlı özelleştirme yoktur.
      // Güncellenmezse PRO'ya yükselen kullanıcının mevcut ürünleri günlük
      // taramada kalır — ödenen ana özellik teslim edilmez.
      await prisma.trackedProduct.updateMany({
        where: { userId: user.id },
        data: { scrapeInterval: limits.scrapeInterval },
      });

      // Paid→paid geçişte yeni kapasite eskisinden küçükse kapasite üstünü
      // durdur (iptal dalıyla aynı politika: en eski N ürün aktif kalır).
      // ERROR da dahil: worker ERROR ürünleri de günlük taramaya sokar, kapsam
      // dışı bırakılırlarsa kapasite üstü tarama tüketmeye devam ederler.
      const activeCount = await prisma.trackedProduct.count({
        where: { userId: user.id, status: { in: ["ACTIVE", "OUT_OF_STOCK", "ERROR"] } },
      });
      if (activeCount > limits.maxProducts) {
        const keep = await prisma.trackedProduct.findMany({
          where: { userId: user.id, status: { in: ["ACTIVE", "OUT_OF_STOCK", "ERROR"] } },
          orderBy: { createdAt: "asc" },
          take: limits.maxProducts,
          select: { id: true },
        });
        await prisma.trackedProduct.updateMany({
          where: {
            userId: user.id,
            status: { in: ["ACTIVE", "OUT_OF_STOCK", "ERROR"] },
            id: { notIn: keep.map((k) => k.id) },
          },
          data: { status: "PAUSED" },
        });
      }

      // Yükseltme akışı yeni bir Whop aboneliği açar; eskisi iptal edilmezse
      // kullanıcı iki planı birden ödemeye devam eder. Dönem sonunda iptal:
      // ödenen süre kullanılır, bir sonraki tahsilat engellenir. (Aşağıdaki
      // superseded-membership koruması sayesinde bu iptalin webhook'u mevcut
      // planı düşürmez.) cancelSuperseded, yukarıdaki sıralama korumasından
      // geçmiş olmayı da içerir.
      if (cancelSuperseded) {
        try {
          const whop = getWhopClient();
          await whop.memberships.cancel(previousMembershipId as string, {
            cancellation_mode: "at_period_end",
          });
          console.log(
            "[whop] canceled superseded membership=" +
              previousMembershipId +
              " user=" +
              user.id +
              " (upgraded to " +
              tier +
              ")",
          );
        } catch (cancelError) {
          // İptal başarısızsa çifte tahsilat riski sürer — manuel müdahale
          // gerektirir, bu yüzden yüksek sesle logla ama aktivasyonu bozma.
          console.error(
            "[whop] FAILED to cancel superseded membership=" +
              previousMembershipId +
              " user=" +
              user.id +
              " — DOUBLE BILLING until manually canceled in Whop: " +
              String(cancelError),
          );
        }
      }

      console.log("[whop] activated user=" + user.id + " plan=" + tier);
      await markEventProcessed(event.id);
      return NextResponse.json({ received: true });
    }

    // membership.deactivated, Whop V1'de TEK sonlanma event'idir (iptal, süre
    // dolumu ve geçersizleşme dahil) — SDK'nın WebhookEvent union'ında
    // went_invalid/expired diye ayrı adlar yoktur.
    if (type === "membership.deactivated") {
      const user = await findUser(data);
      if (!user) {
        console.warn("[whop] membership terminated: user not found");
        return NextResponse.json({ received: true });
      }
      // Yükseltmede iptal edilen ESKİ aboneliğin sonlanma webhook'u, hâlâ
      // ödeme yapan kullanıcının YENİ planını düşürmemeli. Kullanıcının güncel
      // membership'i bu event'teki değilse hiçbir şey yapma.
      if (isSupersededMembershipEvent(user.whopMembershipId, data.id)) {
        console.log(
          "[whop] ignoring termination of superseded membership=" +
            String(data.id) +
            " current=" +
            String(user.whopMembershipId) +
            " user=" +
            user.id,
        );
        await markEventProcessed(event.id);
        return NextResponse.json({ received: true });
      }
      // Access has ended — revert to the FREE plan and its product cap so the
      // UI and limit checks stop treating the user as a paying customer.
      const freeLimits = getPlanLimits("FREE");
      const freeCap = freeLimits.maxProducts;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          plan: "FREE",
          planStatus: "EXPIRED",
          maxProducts: freeCap,
          planExpiresAt: null,
        },
      });

      // Tarama sıklığı da FREE'ye dönmeli: worker doğrudan ürün satırındaki
      // scrapeInterval'dan planlama yapar; sıfırlanmazsa aboneliği biten
      // kullanıcının kalan ürünleri ücretli tier sıklığında taranmaya devam
      // eder (ör. ENTERPRISE'ın 6 saatte 1'i).
      await prisma.trackedProduct.updateMany({
        where: { userId: user.id },
        data: { scrapeInterval: freeLimits.scrapeInterval },
      });

      // Enforce the FREE product cap (B1): a lapsed subscriber must stop
      // receiving paid-tier scraping. Keep the oldest `freeCap` tracked
      // products active and pause the rest — the worker skips PAUSED products,
      // so this is what actually stops over-cap scraping/alerting. Re-upgrading
      // raises the cap again; paused products can be resumed manually.
      // ERROR da dahil: worker ERROR ürünleri de günlük taramaya sokar.
      const keep = await prisma.trackedProduct.findMany({
        where: { userId: user.id, status: { in: ["ACTIVE", "OUT_OF_STOCK", "ERROR"] } },
        orderBy: { createdAt: "asc" },
        take: freeCap,
        select: { id: true },
      });
      const paused = await prisma.trackedProduct.updateMany({
        where: {
          userId: user.id,
          status: { in: ["ACTIVE", "OUT_OF_STOCK", "ERROR"] },
          id: { notIn: keep.map((k) => k.id) },
        },
        data: { status: "PAUSED" },
      });
      console.log(
        "[whop] membership terminated -> FREE, user=" +
          user.id +
          " paused=" +
          paused.count +
          " over-cap products",
      );
      await markEventProcessed(event.id);
      return NextResponse.json({ received: true });
    }

    if (type === "payment.succeeded" || type === "invoice.paid") {
      // Yenileme / başarılı tahsilat. Bu, ödeyen kullanıcının erişiminin devam
      // etmesini sağlayan KRİTİK daldır: planExpiresAt uzatılmazsa worker ilk
      // fatura döneminden sonra kullanıcının tüm taramalarını durdurur.
      const user = await findUser(data);
      if (!user) {
        console.log("[whop] payment event: user not found type=" + type);
        return NextResponse.json({ received: true });
      }

      // Ödeme, kullanıcının GÜNCEL aboneliğine mi ait? Yükseltme sonrası eski
      // aboneliğin son ödemesi yeni planın süresini etkilememeli.
      const paymentMembershipId = data.membership?.id ?? null;
      if (isSupersededMembershipEvent(user.whopMembershipId, paymentMembershipId)) {
        console.log(
          "[whop] ignoring payment for superseded membership=" +
            String(paymentMembershipId) +
            " user=" +
            user.id,
        );
        await markEventProcessed(event.id);
        return NextResponse.json({ received: true });
      }

      // 1) Membership-şekilli payload'larda dönem sonu doğrudan gelir.
      let renewalEnd = parseWhopTimestamp(data.renewal_period_end);

      // 2) Payment/invoice payload'ı membership'i yalnızca {id, status} olarak
      // taşır — dönem sonunu Whop API'sinden tam membership kaydıyla al.
      if (!renewalEnd) {
        const membershipId = paymentMembershipId || user.whopMembershipId;
        if (membershipId) {
          try {
            const whop = getWhopClient();
            const membership = await whop.memberships.retrieve(membershipId);
            renewalEnd = parseWhopTimestamp(membership?.renewal_period_end);
          } catch (retrieveError) {
            console.error(
              "[whop] failed to retrieve membership=" +
                membershipId +
                " for renewal: " +
                String(retrieveError),
            );
          }
        }
      }

      // 3) Dönem sonu hâlâ bilinmiyorsa: ödeme başarılı, kullanıcıyı asla
      // durdurma — 35 günlük güvenlik penceresi ver (aylık faturalamayı aşar,
      // bir sonraki webhook doğru değeri yazar). Mevcut değeri asla geriye
      // çekme.
      if (!renewalEnd) {
        renewalEnd = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
        console.warn(
          "[whop] renewal_period_end unavailable — applying 35-day grace user=" + user.id,
        );
      }
      if (user.planExpiresAt && user.planExpiresAt > renewalEnd) {
        renewalEnd = user.planExpiresAt;
      }

      // İlk satın almada payment event'i membership.activated'dan ÖNCE
      // gelebilir; kullanıcı henüz FREE ise plan kurulumunu activation dalına
      // bırak (FREE satırına expiry yazmak etkisiz ama kafa karıştırıcı olur).
      if (!isPaidTier(user.plan)) {
        console.log("[whop] payment for non-paid user — awaiting activation user=" + user.id);
        return NextResponse.json({ received: true });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          planStatus: "ACTIVE",
          planExpiresAt: renewalEnd,
        },
      });
      console.log(
        "[whop] payment renewal user=" + user.id + " expiresAt=" + renewalEnd.toISOString(),
      );
      await markEventProcessed(event.id);
      return NextResponse.json({ received: true });
    }

    console.log("[whop] ignored event type=" + type);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("[whop] handler error", err);
    return NextResponse.json({ error: "handler error" }, { status: 500 });
  }
}
