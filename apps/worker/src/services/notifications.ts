import { Resend } from "resend";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import type { AlertRuleWithUser, AlertUser } from "../shared";

const prisma = new PrismaClient();

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
// Telegram Bot
// ============================================

async function sendTelegramAlert(user: AlertUser, data: AlertData): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !user.telegramChatId) return;

  try {
    const TelegramBot = (await import("node-telegram-bot-api")).default;
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

    const direction = data.priceChange < 0 ? "📉 DÜŞTÜ" : "📈 ARTTI";
    const changeAbs = Math.abs(data.priceChange).toFixed(2);
    const changePct = Math.abs(data.priceChangePct).toFixed(1);

    const message = [
      `${direction} — ${data.productName}`,
      ``,
      `💰 Eski fiyat: ${data.previousPrice.toFixed(2)} ₺`,
      `💰 Yeni fiyat: ${data.currentPrice.toFixed(2)} ₺`,
      `📊 Değişim: ${data.priceChange < 0 ? "-" : "+"}${changeAbs} ₺ (${changePct}%)`,
      `🏪 ${data.marketplace}`,
      ``,
      `🔗 ${data.productUrl}`,
    ].join("\n");

    await bot.sendMessage(user.telegramChatId, message);
    logger.info({ userId: user.id }, "Telegram alert sent");
  } catch (error) {
    logger.error({ userId: user.id, error }, "Telegram alert failed");
  }
}

// ============================================
// Alert Data Interface
// ============================================

interface AlertData {
  productName: string;
  currentPrice: number;
  previousPrice: number;
  priceChange: number;
  priceChangePct: number;
  marketplace: string;
  productUrl: string;
}

// ============================================
// Notification Title & Message Generators
// ============================================

function generateNotificationTitle(ruleType: string, data: AlertData): string {
  const changePct = Math.abs(data.priceChangePct).toFixed(1);

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
      const direction = data.priceChange < 0 ? "düştü" : "arttı";
      return `🔔 Fiyat ${direction}: ${data.productName}`;
    }
  }
}

function generateNotificationMessage(_ruleType: string, data: AlertData): string {
  const changeAbs = Math.abs(data.priceChange).toFixed(2);
  const changePct = Math.abs(data.priceChangePct).toFixed(1);
  const direction = data.priceChange < 0 ? "düştü" : "arttı";

  return `${data.productName} fiyatı ${data.previousPrice.toFixed(2)} ₺'den ${data.currentPrice.toFixed(2)} ₺'ye ${direction} (${data.priceChange < 0 ? "-" : "+"}${changeAbs} ₺, %${changePct}). Marketplace: ${data.marketplace}.`;
}

// ============================================
// Send Alerts — Main Entry Point
// ============================================

export async function sendAlerts(rule: AlertRuleWithUser, data: AlertData): Promise<void> {
  const channels: string[] = rule.notifyVia || [];
  const title = generateNotificationTitle(rule.ruleType, data);
  const message = generateNotificationMessage(rule.ruleType, data);

  for (const channel of channels) {
    try {
      // 1. ALWAYS write to notifications table in DB
      await writeNotificationToDB({
        userId: rule.userId,
        alertRuleId: rule.id,
        channel,
        title,
        message,
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

      // 2. Send external notification based on channel
      switch (channel) {
        case "EMAIL":
          await sendEmailAlert(rule.user, data, rule.ruleType);
          break;
        case "TELEGRAM":
          await sendTelegramAlert(rule.user, data);
          break;
        case "WEBHOOK":
          await sendWebhookAlert(rule.user, data);
          break;
      }

      logger.info(
        { channel, userId: rule.userId, ruleType: rule.ruleType },
        "Alert sent successfully",
      );
    } catch (error) {
      logger.error({ channel, userId: rule.userId, error }, "Failed to send alert");
    }
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
        metadata: JSON.parse(JSON.stringify(params.metadata)),
        isRead: false,
      },
    });
    logger.info({ userId: params.userId, channel: params.channel }, "Notification written to DB");
  } catch (error) {
    logger.error({ error }, "Failed to write notification to DB");
    // Don't throw — DB write failure shouldn't block external notification
  }
}

// ============================================
// Email Alert — Resend
// ============================================

async function sendEmailAlert(user: AlertUser, data: AlertData, _ruleType: string): Promise<void> {
  const resend = getResend();
  if (!resend) return;
  if (!user?.email) {
    logger.warn({ userId: user?.id }, "No email address — skipping email alert");
    return;
  }

  const direction = data.priceChange < 0 ? "düştü" : "arttı";
  const emoji = data.priceChange < 0 ? "📉" : "📈";
  const changeAbs = Math.abs(data.priceChange).toFixed(2);
  const changePct = Math.abs(data.priceChangePct).toFixed(1);
  const priceColor = data.priceChange < 0 ? "#22C55E" : "#EF4444";

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "CompeteHive <onboarding@resend.dev>",
      to: user.email,
      subject: `${emoji} Fiyat ${direction}: ${data.productName}`,
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
              ${emoji} Fiyat ${direction}!
            </h2>
            <p style="margin: 0 0 24px 0; color: #9CA3AF; font-size: 14px;">
              ${data.productName}
            </p>

            <!-- Price Card -->
            <div style="background: #111113; border: 1px solid #1F1F23; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #9CA3AF; font-size: 13px;">Önceki Fiyat</td>
                  <td style="padding: 8px 0; text-align: right; color: #9CA3AF; font-size: 14px;">
                    ${data.previousPrice.toFixed(2)} ₺
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #FFFFFF; font-size: 13px; font-weight: 600;">Yeni Fiyat</td>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; font-size: 20px; font-weight: 700; color: ${priceColor};">
                    ${data.currentPrice.toFixed(2)} ₺
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">Değişim</td>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: ${priceColor}; font-size: 14px; font-weight: 600;">
                    ${data.priceChange < 0 ? "-" : "+"}${changeAbs} ₺ (%${changePct})
                  </td>
                </tr>
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
  } catch (error) {
    logger.error({ userId: user.id, error }, "Resend email failed");
    throw error;
  }
}

// ============================================
// Webhook Alert
// ============================================

async function sendWebhookAlert(user: AlertUser, data: AlertData): Promise<void> {
  if (!user?.webhookUrl) return;

  try {
    const response = await fetch(user.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      logger.warn({ userId: user.id, status: response.status }, "Webhook returned non-OK");
    }

    logger.info({ userId: user.id }, "Webhook alert sent");
  } catch (error) {
    logger.error({ userId: user.id, error }, "Webhook alert failed");
    throw error;
  }
}
