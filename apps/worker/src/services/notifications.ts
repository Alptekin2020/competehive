import TelegramBot from "node-telegram-bot-api";
import nodemailer from "nodemailer";
import { logger } from "../utils/logger";
import type { AlertRuleWithUser, AlertUser } from "../shared";

// ============================================
// Telegram Bot
// ============================================

let telegramBot: TelegramBot | null = null;

function getTelegramBot(): TelegramBot | null {
  if (!process.env.TELEGRAM_BOT_TOKEN) return null;
  if (!telegramBot) {
    telegramBot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  }
  return telegramBot;
}

// ============================================
// Email Transporter
// ============================================

let emailTransporter: nodemailer.Transporter | null = null;

function getEmailTransporter(): nodemailer.Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!emailTransporter) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return emailTransporter;
}

// ============================================
// Alert Data
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
// Send Alerts
// ============================================

export async function sendAlerts(rule: AlertRuleWithUser, data: AlertData) {
  const channels = rule.notifyVia || [];

  for (const channel of channels) {
    try {
      switch (channel) {
        case "TELEGRAM":
          await sendTelegramAlert(rule.user, data);
          break;
        case "EMAIL":
          await sendEmailAlert(rule.user, data);
          break;
        case "WEBHOOK":
          await sendWebhookAlert(rule.user, data);
          break;
      }
    } catch (error) {
      logger.error({ channel, userId: rule.user.id, error }, "Failed to send alert");
    }
  }
}

// ============================================
// Telegram Alert
// ============================================

async function sendTelegramAlert(user: AlertUser, data: AlertData) {
  const bot = getTelegramBot();
  if (!bot || !user.telegramChatId) return;

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

  await bot.sendMessage(user.telegramChatId, message, { parse_mode: "HTML" });
  logger.info({ userId: user.id }, "Telegram alert sent");
}

// ============================================
// Email Alert
// ============================================

async function sendEmailAlert(user: AlertUser, data: AlertData) {
  const transporter = getEmailTransporter();
  if (!transporter) return;

  const direction = data.priceChange < 0 ? "düştü" : "arttı";
  const emoji = data.priceChange < 0 ? "📉" : "📈";
  const changeAbs = Math.abs(data.priceChange).toFixed(2);
  const changePct = Math.abs(data.priceChangePct).toFixed(1);

  await transporter.sendMail({
    from: process.env.SMTP_FROM || "CompeteHive <noreply@competehive.com>",
    to: user.email,
    subject: `${emoji} Fiyat ${direction}: ${data.productName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1B4F72; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">CompeteHive Fiyat Uyarısı</h2>
        </div>
        <div style="padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 8px 8px;">
          <h3>${data.productName}</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Eski Fiyat</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.previousPrice.toFixed(2)} ₺</td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Yeni Fiyat</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #eee; font-size: 18px; font-weight: bold; color: ${data.priceChange < 0 ? "#27AE60" : "#E74C3C"};">
                ${data.currentPrice.toFixed(2)} ₺
              </td>
            </tr>
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Değişim</strong></td>
              <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.priceChange < 0 ? "-" : "+"}${changeAbs} ₺ (${changePct}%)</td>
            </tr>
            <tr>
              <td style="padding: 8px;"><strong>Marketplace</strong></td>
              <td style="padding: 8px;">${data.marketplace}</td>
            </tr>
          </table>
          <div style="margin-top: 20px; text-align: center;">
            <a href="${data.productUrl}" style="background: #2E86C1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Ürüne Git →
            </a>
          </div>
          <p style="margin-top: 20px; color: #888; font-size: 12px; text-align: center;">
            Bu uyarı CompeteHive tarafından gönderilmiştir.
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard">Uyarı ayarlarını düzenle</a>
          </p>
        </div>
      </div>
    `,
  });

  logger.info({ userId: user.id }, "Email alert sent");
}

// ============================================
// Webhook Alert
// ============================================

async function sendWebhookAlert(user: AlertUser, data: AlertData) {
  if (!user.webhookUrl) return;

  await fetch(user.webhookUrl, {
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

  logger.info({ userId: user.id }, "Webhook alert sent");
}
