import { Resend } from "resend";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import { sendMessage as tgSendMessage, TelegramApiError } from "../utils/telegram-api";
import { postWebhookSafe } from "../utils/webhook-guard";
import type { AlertRuleWithUser, AlertUser } from "../shared";

const prisma = new PrismaClient();

// External delivery outcome recorded on each notification row.
//   SENT    — handed off to the provider successfully
//   FAILED  — provider rejected / errored (reason in `error`)
//   SKIPPED — channel not configured for this user (no token/URL/key)
type DeliveryStatus = "SENT" | "FAILED" | "SKIPPED";
interface DeliveryOutcome {
  status: DeliveryStatus;
  error?: string;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ============================================
// Resend Email Client
// ============================================

let resendClient: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — email alerts disabled");
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

// ============================================
// Telegram Bot (central)
// ============================================

async function sendTelegramAlert(
  user: AlertUser,
  ruleType: string,
  data: AlertData,
): Promise<DeliveryOutcome> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { status: "SKIPPED", error: "TELEGRAM_BOT_TOKEN tanımlı değil" };

  if (!user.telegramChatId || user.telegramStatus !== "connected") {
    return { status: "SKIPPED", error: "Telegram bağlı değil" };
  }

  try {
    const text = formatTelegramMessage(ruleType, data);
    await tgSendMessage(botToken, user.telegramChatId, text);
    logger.info({ userId: user.id }, "Telegram alert sent");
    return { status: "SENT" };
  } catch (error) {
    if (error instanceof TelegramApiError) {
      logger.warn({ userId: user.id, code: error.code, msg: error.message }, "Telegram API error");
    } else {
      logger.error({ userId: user.id, error }, "Telegram alert failed");
    }
    return { status: "FAILED", error: errorMessage(error) };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Null-safe formatters: alerts triggered by stock or competitor changes carry
// no price delta, so previousPrice/priceChange/priceChangePct can be null.
function money(n: number | null): string {
  return n == null ? "—" : n.toFixed(2);
}
function absMoney(n: number | null): string {
  return n == null ? "—" : Math.abs(n).toFixed(2);
}
function absPct(n: number | null): string {
  return n == null ? "—" : Math.abs(n).toFixed(1);
}
function isDrop(n: number | null): boolean {
  return n != null && n < 0;
}
function emailHeadline(ruleType: string, drop: boolean): { emoji: string; heading: string } {
  switch (ruleType) {
    case "OUT_OF_STOCK":
      return { emoji: "🚫", heading: "Stoktan çıktı" };
    case "BACK_IN_STOCK":
      return { emoji: "✅", heading: "Stoğa girdi" };
    case "COMPETITOR_CHEAPER":
      return { emoji: "⚡", heading: "Rakip daha ucuz" };
    case "PRICE_THRESHOLD":
      return { emoji: "🎯", heading: "Hedef fiyata ulaşıldı" };
    default:
      return drop
        ? { emoji: "📉", heading: "Fiyat düştü" }
        : { emoji: "📈", heading: "Fiyat arttı" };
  }
}

function formatTelegramMessage(ruleType: string, data: AlertData): string {
  const changeAbs = absMoney(data.priceChange);
  const changePct = absPct(data.priceChangePct);
  const name = `<b>${escapeHtml(data.productName)}</b>`;
  const marketplace = `🏪 ${escapeHtml(data.marketplace)}`;
  const linkLine = `🔗 <a href="${escapeHtml(data.productUrl)}">Ürüne git</a>`;

  switch (ruleType) {
    case "PRICE_DROP":
      return [
        `📉 <b>Fiyat düştü</b>`,
        ``,
        name,
        `${money(data.previousPrice)} → <b>${data.currentPrice.toFixed(2)} ₺</b>`,
        `Değişim: <b>−${changeAbs} ₺</b> (%${changePct})`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");

    case "PRICE_INCREASE":
      return [
        `📈 <b>Fiyat arttı</b>`,
        ``,
        name,
        `${money(data.previousPrice)} → <b>${data.currentPrice.toFixed(2)} ₺</b>`,
        `Değişim: <b>+${changeAbs} ₺</b> (%${changePct})`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");

    case "PRICE_THRESHOLD":
      return [
        `🎯 <b>Hedef fiyata ulaşıldı</b>`,
        ``,
        name,
        `Şu anki fiyat: <b>${data.currentPrice.toFixed(2)} ₺</b>`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");

    case "PERCENTAGE_CHANGE": {
      const dir = isDrop(data.priceChange) ? "düştü" : "arttı";
      const emoji = isDrop(data.priceChange) ? "📉" : "📈";
      const sign = isDrop(data.priceChange) ? "−" : "+";
      return [
        `${emoji} <b>%${changePct} ${dir}</b>`,
        ``,
        name,
        `${money(data.previousPrice)} → <b>${data.currentPrice.toFixed(2)} ₺</b>`,
        `Değişim: <b>${sign}${changeAbs} ₺</b>`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");
    }

    case "COMPETITOR_CHEAPER":
      return [
        `⚡ <b>Rakip daha ucuz</b>`,
        ``,
        name,
        `${marketplace} fiyatı: <b>${data.currentPrice.toFixed(2)} ₺</b>`,
        ``,
        linkLine,
      ].join("\n");

    case "OUT_OF_STOCK":
      return [`🚫 <b>Stoktan çıktı</b>`, ``, name, marketplace, ``, linkLine].join("\n");

    case "BACK_IN_STOCK":
      return [
        `✅ <b>Stoğa girdi</b>`,
        ``,
        name,
        `Fiyat: <b>${data.currentPrice.toFixed(2)} ₺</b>`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");

    default: {
      const dir = isDrop(data.priceChange) ? "düştü" : "arttı";
      const emoji = isDrop(data.priceChange) ? "📉" : "📈";
      const sign = isDrop(data.priceChange) ? "−" : "+";
      return [
        `${emoji} <b>Fiyat ${dir}</b>`,
        ``,
        name,
        `${money(data.previousPrice)} → <b>${data.currentPrice.toFixed(2)} ₺</b>`,
        `Değişim: <b>${sign}${changeAbs} ₺</b> (%${changePct})`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");
    }
  }
}

// ============================================
// Alert Data Interface
// ============================================

interface AlertData {
  productName: string;
  currentPrice: number;
  previousPrice: number | null;
  priceChange: number | null;
  priceChangePct: number | null;
  marketplace: string;
  productUrl: string;
}

// ============================================
// Notification Title & Message Generators
// ============================================

function generateNotificationTitle(ruleType: string, data: AlertData): string {
  const changePct = absPct(data.priceChangePct);

  switch (ruleType) {
    case "PRICE_DROP":
      return `📉 Fiyat düştü: ${data.productName}`;
    case "PRICE_INCREASE":
      return `📈 Fiyat arttı: ${data.productName}`;
    case "PRICE_THRESHOLD":
      return `🎯 Fiyat eşiğine ulaştı: ${data.productName}`;
    case "PERCENTAGE_CHANGE":
      return `📊 %${changePct} değişim: ${data.productName}`;
    case "COMPETITOR_CHEAPER":
      return `⚡ Rakip daha ucuz: ${data.productName}`;
    case "OUT_OF_STOCK":
      return `🚫 Stoktan çıktı: ${data.productName}`;
    case "BACK_IN_STOCK":
      return `✅ Stoğa girdi: ${data.productName}`;
    default: {
      const direction = isDrop(data.priceChange) ? "düştü" : "arttı";
      return `🔔 Fiyat ${direction}: ${data.productName}`;
    }
  }
}

function generateNotificationMessage(ruleType: string, data: AlertData): string {
  if (ruleType === "OUT_OF_STOCK") {
    return `${data.productName} stoktan çıktı. Marketplace: ${data.marketplace}.`;
  }
  if (ruleType === "BACK_IN_STOCK") {
    return `${data.productName} tekrar stokta. Güncel fiyat: ${money(data.currentPrice)} ₺. Marketplace: ${data.marketplace}.`;
  }
  if (ruleType === "COMPETITOR_CHEAPER") {
    return `${data.productName} için bir rakip daha ucuz. Senin fiyatın: ${money(data.currentPrice)} ₺. Marketplace: ${data.marketplace}.`;
  }
  if (data.previousPrice === null || data.priceChange === null) {
    return `${data.productName} güncel fiyatı: ${money(data.currentPrice)} ₺. Marketplace: ${data.marketplace}.`;
  }

  const direction = data.priceChange < 0 ? "düştü" : "arttı";
  const sign = data.priceChange < 0 ? "-" : "+";
  return `${data.productName} fiyatı ${money(data.previousPrice)} ₺'den ${money(data.currentPrice)} ₺'ye ${direction} (${sign}${absMoney(data.priceChange)} ₺, %${absPct(data.priceChangePct)}). Marketplace: ${data.marketplace}.`;
}

// ============================================
// Send Alerts — Main Entry Point
// ============================================

export async function sendAlerts(rule: AlertRuleWithUser, data: AlertData): Promise<void> {
  const channels: string[] = rule.notifyVia || [];
  const title = generateNotificationTitle(rule.ruleType, data);
  const message = generateNotificationMessage(rule.ruleType, data);

  for (const channel of channels) {
    // 1. Attempt the external send and capture the real outcome.
    let outcome: DeliveryOutcome;
    try {
      switch (channel) {
        case "EMAIL":
          outcome = await sendEmailAlert(rule.user, data, rule.ruleType);
          break;
        case "TELEGRAM":
          outcome = await sendTelegramAlert(rule.user, rule.ruleType, data);
          break;
        case "WEBHOOK":
          outcome = await sendWebhookAlert(rule.user, data);
          break;
        default:
          outcome = { status: "SKIPPED", error: `Bilinmeyen kanal: ${channel}` };
      }
    } catch (error) {
      // Senders are written not to throw, but guard so one bad channel can't
      // abort the rest or skip the DB record.
      outcome = { status: "FAILED", error: errorMessage(error) };
      logger.error({ channel, userId: rule.userId, error }, "Failed to send alert");
    }

    // 2. ALWAYS record the notification — the in-app feed shows it regardless
    // of external delivery — now annotated with the actual delivery outcome.
    await writeNotificationToDB({
      userId: rule.userId,
      alertRuleId: rule.id,
      channel,
      title,
      message,
      status: outcome.status,
      error: outcome.error ?? null,
      metadata: {
        productName: data.productName,
        currentPrice: data.currentPrice,
        previousPrice: data.previousPrice,
        priceChange: data.priceChange,
        priceChangePct: data.priceChangePct,
        marketplace: data.marketplace,
        productUrl: data.productUrl,
        ruleType: rule.ruleType,
      },
    });

    logger.info(
      { channel, userId: rule.userId, ruleType: rule.ruleType, status: outcome.status },
      "Alert processed",
    );
  }
}

// ============================================
// Write Notification to DB
// ============================================

async function writeNotificationToDB(params: {
  userId: string;
  alertRuleId: string;
  channel: string;
  title: string;
  message: string;
  status: string;
  error: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        alertRuleId: params.alertRuleId,
        channel: params.channel as "EMAIL" | "TELEGRAM" | "WEBHOOK",
        title: params.title,
        message: params.message,
        status: params.status,
        error: params.error,
        metadata: JSON.parse(JSON.stringify(params.metadata)),
        isRead: false,
      },
    });
    logger.info(
      { userId: params.userId, channel: params.channel, status: params.status },
      "Notification written to DB",
    );
  } catch (error) {
    logger.error({ error }, "Failed to write notification to DB");
    // Don't throw — DB write failure shouldn't block external notification
  }
}

// ============================================
// Email Alert — Resend
// ============================================

async function sendEmailAlert(
  user: AlertUser,
  data: AlertData,
  ruleType: string,
): Promise<DeliveryOutcome> {
  // Kullanıcı tercihi: e-posta uyarıları kapalıysa SADECE e-posta gönderimini
  // atla. Telegram/in-app çekirdek kanallardır ve etkilenmez; sendAlerts bu
  // SKIPPED sonucuyla bildirim satırını yine de yazar.
  if (user?.emailAlertsEnabled === false) {
    return { status: "SKIPPED", error: "E-posta uyarıları kapalı" };
  }

  const resend = getResend();
  if (!resend) return { status: "SKIPPED", error: "RESEND_API_KEY tanımlı değil" };
  if (!user?.email) {
    logger.warn({ userId: user?.id }, "No email address — skipping email alert");
    return { status: "SKIPPED", error: "E-posta adresi yok" };
  }

  const drop = isDrop(data.priceChange);
  const changeAbs = absMoney(data.priceChange);
  const changePct = absPct(data.priceChangePct);
  const priceColor = data.priceChange === null ? "#FFFFFF" : drop ? "#22C55E" : "#EF4444";
  const { emoji, heading } = emailHeadline(ruleType, drop);

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "CompeteHive <onboarding@resend.dev>",
      to: user.email,
      subject: `${emoji} ${heading}: ${data.productName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0A0B; color: #FFFFFF;">
          <!-- Header -->
          <div style="background: #111113; padding: 24px; border-bottom: 1px solid #1F1F23;">
            <table style="width: 100%;">
              <tr>
                <td>
                  <span style="font-size: 20px; font-weight: 700; color: #F59E0B;">🐝 CompeteHive</span>
                </td>
                <td style="text-align: right;">
                  <span style="font-size: 12px; color: #6B7280;">Fiyat Uyarısı</span>
                </td>
              </tr>
            </table>
          </div>

          <!-- Body -->
          <div style="padding: 32px 24px;">
            <h2 style="margin: 0 0 8px 0; font-size: 18px; color: #FFFFFF;">
              ${emoji} ${heading}!
            </h2>
            <p style="margin: 0 0 24px 0; color: #9CA3AF; font-size: 14px;">
              ${data.productName}
            </p>

            <!-- Price Card -->
            <div style="background: #111113; border: 1px solid #1F1F23; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse;">
                ${
                  data.previousPrice === null
                    ? ""
                    : `<tr>
                      <td style="padding: 8px 0; color: #9CA3AF; font-size: 13px;">Önceki Fiyat</td>
                      <td style="padding: 8px 0; text-align: right; color: #9CA3AF; font-size: 14px;">
                        ${money(data.previousPrice)} ₺
                      </td>
                    </tr>`
                }
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #FFFFFF; font-size: 13px; font-weight: 600;">Yeni Fiyat</td>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; font-size: 20px; font-weight: 700; color: ${priceColor};">
                    ${data.currentPrice.toFixed(2)} ₺
                  </td>
                </tr>
                ${
                  data.priceChange === null
                    ? ""
                    : `<tr>
                      <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">Değişim</td>
                      <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: ${priceColor}; font-size: 14px; font-weight: 600;">
                        ${drop ? "-" : "+"}${changeAbs} ₺ (%${changePct})
                      </td>
                    </tr>`
                }
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">Marketplace</td>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: #FFFFFF; font-size: 14px;">
                    ${data.marketplace}
                  </td>
                </tr>
              </table>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin-bottom: 24px;">
              <a href="${data.productUrl}" style="display: inline-block; background: #F59E0B; color: #000000; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                Ürüne Git →
              </a>
            </div>
          </div>

          <!-- Footer -->
          <div style="padding: 16px 24px; border-top: 1px solid #1F1F23; text-align: center;">
            <p style="margin: 0; color: #6B7280; font-size: 11px;">
              Bu uyarı CompeteHive tarafından gönderilmiştir.
              <a href="${process.env.NEXT_PUBLIC_APP_URL || "https://competehive-web.vercel.app"}/dashboard/alerts" style="color: #F59E0B; text-decoration: none;">Uyarı ayarları</a>
            </p>
          </div>
        </div>
      `,
    });

    logger.info({ userId: user.id, email: user.email }, "Email alert sent via Resend");
    return { status: "SENT" };
  } catch (error) {
    logger.error({ userId: user.id, error }, "Resend email failed");
    return { status: "FAILED", error: errorMessage(error) };
  }
}

// ============================================
// Webhook Alert
// ============================================

async function sendWebhookAlert(user: AlertUser, data: AlertData): Promise<DeliveryOutcome> {
  if (!user?.webhookUrl) return { status: "SKIPPED", error: "Webhook URL yok" };

  const body = JSON.stringify({
    event: "price_change",
    timestamp: new Date().toISOString(),
    product: {
      name: data.productName,
      url: data.productUrl,
      marketplace: data.marketplace,
    },
    price: {
      current: data.currentPrice,
      previous: data.previousPrice,
      change: data.priceChange,
      changePercent: data.priceChangePct,
    },
  });

  try {
    // postWebhookSafe enforces http(s)-only + no private/internal targets
    // (validated at connection time, so DNS rebinding can't bypass it) with an
    // 8s timeout.
    const status = await postWebhookSafe(user.webhookUrl, body);
    if (status < 200 || status >= 300) {
      logger.warn({ userId: user.id, status }, "Webhook returned non-OK");
      return { status: "FAILED", error: `Webhook HTTP ${status}` };
    }
    logger.info({ userId: user.id }, "Webhook alert sent");
    return { status: "SENT" };
  } catch (error) {
    logger.error({ userId: user.id, error }, "Webhook alert failed");
    return { status: "FAILED", error: errorMessage(error) };
  }
}
