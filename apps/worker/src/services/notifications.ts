import { Resend } from "resend";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import { sendMessage as tgSendMessage, TelegramApiError } from "../utils/telegram-api";
import { postWebhookSafe } from "../utils/webhook-guard";
import { resolveAllowedChannels, type AlertRuleWithUser, type AlertUser } from "../shared";

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

// Kanal bazlı teslimat sonucu — uyarı başına TEK bildirim satırının
// metadata.deliveries alanında saklanır; UI kanal rozetlerini buradan çizer.
export interface ChannelDelivery {
  channel: string;
  status: DeliveryStatus;
  error: string | null;
}

// Kanal sonuçlarını satırın tekil status/error alanlarına indirger:
// herhangi bir kanal gönderildiyse SENT (düşen kanallar error özetinde),
// hiçbiri gönderilemeyip hata varsa FAILED, kalan durumda SKIPPED.
export function summarizeDeliveries(deliveries: ChannelDelivery[]): {
  status: DeliveryStatus;
  error: string | null;
} {
  const describe = (items: ChannelDelivery[]) =>
    items.map((d) => `${d.channel}: ${d.error ?? "hata"}`).join(" · ");
  const failed = deliveries.filter((d) => d.status === "FAILED");

  if (deliveries.some((d) => d.status === "SENT")) {
    return { status: "SENT", error: failed.length > 0 ? describe(failed) : null };
  }
  if (failed.length > 0) {
    return { status: "FAILED", error: describe(failed) };
  }
  const skippedWithReason = deliveries.filter((d) => d.status === "SKIPPED" && d.error);
  return {
    status: "SKIPPED",
    error: skippedWithReason.length > 0 ? describe(skippedWithReason) : null,
  };
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
      // Kalıcı hatalar (bot engellendi / sohbet silindi): bağlantıyı kopmuş
      // işaretle ki kullanıcı ayarlarda "connected" görüp bildirimlerin
      // gelmediğini fark etmemezlik yaşamasın; ayrıca boşuna deneme yapılmasın.
      const message = String(error.message || "").toLowerCase();
      if (error.code === 403 || message.includes("chat not found") || message.includes("blocked")) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { telegramStatus: "blocked" },
          });
          logger.warn({ userId: user.id }, "Telegram marked as blocked (permanent send failure)");
        } catch (updateError) {
          logger.error({ userId: user.id, updateError }, "Failed to mark telegram as blocked");
        }
      }
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
//
// Türk kullanıcıya giden HER fiyat tr-TR biçiminde yazılır: binlik ayracı
// nokta, ondalık virgül ("5299.00" değil "5.299,00"). Uygulama içi UI ile
// bildirim/Telegram/e-posta metinleri arasındaki format tutarsızlığının kökü
// buradaki toFixed kullanımıydı.
const TRY_FORMAT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PCT_FORMAT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
function money(n: number | null): string {
  return n == null ? "—" : TRY_FORMAT.format(n);
}
function absMoney(n: number | null): string {
  return n == null ? "—" : TRY_FORMAT.format(Math.abs(n));
}
function absPct(n: number | null): string {
  return n == null ? "—" : PCT_FORMAT.format(Math.abs(n));
}
function pct(n: number): string {
  return PCT_FORMAT.format(n);
}

// Bildirimden uygulamadaki ürün detayına dönüş linki: kullanıcı aksiyonu
// (fiyat güncelle, rakipleri incele) pazaryeri sayfasında değil CompeteHive'da
// alır. NEXT_PUBLIC_APP_URL prod'da www.competehive.com'dur.
function appProductUrl(productId: string | undefined): string | null {
  if (!productId) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://www.competehive.com").replace(
    /\/$/,
    "",
  );
  return `${base}/dashboard/products/${productId}`;
}

// Prisma enum sabitleri ("TRENDYOL", "AMAZON_TR") kullanıcıya CAPS-İngilizce
// sızmasın; UI'daki marka adlarıyla aynı yazım kullanılır.
const MARKETPLACE_LABELS: Record<string, string> = {
  TRENDYOL: "Trendyol",
  HEPSIBURADA: "Hepsiburada",
  AMAZON_TR: "Amazon TR",
  N11: "N11",
  PAZARAMA: "Pazarama",
  MEDIAMARKT: "MediaMarkt",
  TEKNOSA: "Teknosa",
  VATAN: "Vatan",
  DECATHLON: "Decathlon",
  PTTAVM: "PTT AVM",
  CICEKSEPETI: "Çiçeksepeti",
  AKAKCE: "Akakçe",
  CIMRI: "Cimri",
  EPEY: "Epey",
  BOYNER: "Boyner",
  WATSONS: "Watsons",
  KITAPYURDU: "Kitapyurdu",
  SEPHORA: "Sephora",
  KOCTAS: "Koçtaş",
  ITOPYA: "İtopya",
  GRATIS: "Gratis",
  CUSTOM: "Diğer",
};
function marketplaceLabel(mp: string): string {
  return MARKETPLACE_LABELS[mp] ?? mp;
}
function isDrop(n: number | null): boolean {
  return n != null && n < 0;
}
// Rakip fiyat hareketlerinin ortak yönü: hepsi düşüşse "drop", hepsi artışsa
// "increase", karışıksa "mixed". Başlık/emoji seçimini besler.
type CompetitorMovesDirection = "drop" | "increase" | "mixed";
function competitorMovesDirection(
  moves: NonNullable<AlertData["competitorMoves"]>,
): CompetitorMovesDirection {
  const hasDrop = moves.some((m) => m.currentPrice < m.previousPrice);
  const hasIncrease = moves.some((m) => m.currentPrice > m.previousPrice);
  if (hasDrop && hasIncrease) return "mixed";
  return hasIncrease ? "increase" : "drop";
}
function competitorMovesHeading(moves: NonNullable<AlertData["competitorMoves"]>): {
  emoji: string;
  heading: string;
} {
  const direction = competitorMovesDirection(moves);
  const many = moves.length > 1;
  switch (direction) {
    case "increase":
      return {
        emoji: "📈",
        heading: many ? `${moves.length} rakip fiyat artırdı` : "Rakibiniz fiyat artırdı",
      };
    case "mixed":
      return { emoji: "🔀", heading: `${moves.length} rakip fiyat değiştirdi` };
    default:
      return {
        emoji: "📉",
        heading: many ? `${moves.length} rakip fiyat düşürdü` : "Rakibiniz fiyat düşürdü",
      };
  }
}
// Tek bir rakip hareketini "önceki → yeni (±%X)" satırına çevirir.
function competitorMoveLine(move: {
  competitorName: string | null;
  previousPrice: number;
  currentPrice: number;
}): string {
  const pctChange =
    move.previousPrice > 0
      ? ((move.currentPrice - move.previousPrice) / move.previousPrice) * 100
      : null;
  const sign = move.currentPrice < move.previousPrice ? "−" : "+";
  const pctPart = pctChange !== null ? ` (${sign}%${absPct(pctChange)})` : "";
  const name = move.competitorName?.trim() || "Rakip";
  return `${name}: ${money(move.previousPrice)} → ${money(move.currentPrice)} ₺${pctPart}`;
}
// Bildirimde en fazla bu kadar rakip satırı listelenir; kalanı "+N rakip daha".
const MAX_COMPETITOR_MOVE_LINES = 5;
// Negatif marj = zarar; pozitif ama düşük marj = "ince" uyarı. İkisi de LOW_MARGIN.
function isLoss(marginPct: number | null | undefined): boolean {
  return typeof marginPct === "number" && marginPct < 0;
}
function emailHeadline(
  ruleType: string,
  drop: boolean,
  data?: AlertData,
): { emoji: string; heading: string } {
  switch (ruleType) {
    case "OUT_OF_STOCK":
      return { emoji: "🚫", heading: "Stoktan çıktı" };
    case "BACK_IN_STOCK":
      return { emoji: "✅", heading: "Stoğa girdi" };
    case "COMPETITOR_CHEAPER":
      return { emoji: "⚡", heading: "Rakip daha ucuz" };
    case "COMPETITOR_PRICE_CHANGE": {
      const moves = data?.competitorMoves ?? [];
      if (moves.length === 0) return { emoji: "🔀", heading: "Rakip fiyatı değişti" };
      return competitorMovesHeading(moves);
    }
    case "PRICE_THRESHOLD":
      return { emoji: "🎯", heading: "Hedef fiyata ulaşıldı" };
    case "LOW_MARGIN":
      return { emoji: "💸", heading: "Kâr marjı düştü" };
    default:
      // Takip edilen ürün kullanıcının KENDİ ürünü — fiyatı genelde kendisi
      // değiştirir. "Fiyat düştü" haberi yerine "siz değiştirdiniz" dili.
      return drop
        ? { emoji: "📉", heading: "Fiyatınızı düşürdünüz" }
        : { emoji: "📈", heading: "Fiyatınızı artırdınız" };
  }
}

function formatTelegramMessage(ruleType: string, data: AlertData): string {
  const changeAbs = absMoney(data.priceChange);
  const changePct = absPct(data.priceChangePct);
  const name = `<b>${escapeHtml(data.productName)}</b>`;
  const marketplace = `🏪 ${escapeHtml(marketplaceLabel(data.marketplace))}`;
  const appUrl = appProductUrl(data.productId);
  // İki link: pazaryerindeki ürün + CompeteHive'daki detay (aksiyon alınan yer).
  const linkLine = [
    `🔗 <a href="${escapeHtml(data.productUrl)}">Ürüne git</a>`,
    appUrl ? `📊 <a href="${escapeHtml(appUrl)}">CompeteHive'da aç</a>` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  // Kendi ürün fiyat hareketi (PRICE_DROP / PRICE_INCREASE / PERCENTAGE_CHANGE
  // ve bilinmeyen türler): takip edilen ürün kullanıcının KENDİ ürünü olduğu
  // için "Fiyat düştü" haberi yerine "Fiyatınızı düşürdünüz" dili kullanılır.
  // Üç kural tipi de AYNI metni üretir — tutar + yüzde tek mesajda; alert
  // worker'daki tekilleştirme ile birlikte kullanıcıya tek mesaj gider.
  const ownPriceChangeMessage = () => {
    const drop = isDrop(data.priceChange);
    const emoji = drop ? "📉" : "📈";
    const heading = drop ? "Fiyatınızı düşürdünüz" : "Fiyatınızı artırdınız";
    const sign = drop ? "−" : "+";
    return [
      `${emoji} <b>${heading}</b>`,
      ``,
      name,
      `${money(data.previousPrice)} → <b>${money(data.currentPrice)} ₺</b>`,
      `Değişim: <b>${sign}${changeAbs} ₺</b> (%${changePct})`,
      marketplace,
      ``,
      linkLine,
    ].join("\n");
  };

  switch (ruleType) {
    case "PRICE_DROP":
    case "PRICE_INCREASE":
      return ownPriceChangeMessage();

    case "PRICE_THRESHOLD":
      return [
        `🎯 <b>Hedef fiyata ulaşıldı</b>`,
        ``,
        name,
        data.previousPrice !== null
          ? `${money(data.previousPrice)} → <b>${money(data.currentPrice)} ₺</b>`
          : `Şu anki fiyat: <b>${money(data.currentPrice)} ₺</b>`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");

    case "PERCENTAGE_CHANGE":
      return ownPriceChangeMessage();

    case "COMPETITOR_CHEAPER": {
      const compPrice = data.competitorPrice ?? null;
      const compName = escapeHtml(data.cheapestCompetitorName?.trim() || "Bir rakip");
      const count = data.cheaperCompetitorCount ?? 0;
      const diffPct =
        compPrice && compPrice > 0 ? ((data.currentPrice - compPrice) / compPrice) * 100 : null;
      const lead = count > 1 ? `${count} rakip senden ucuz — en ucuzu:` : `Senden ucuz:`;
      return [
        `⚡ <b>Rakip daha ucuz</b>`,
        ``,
        name,
        `${lead} <b>${compName} · ${money(compPrice)} ₺</b>`,
        `Senin fiyatın: <b>${money(data.currentPrice)} ₺</b>${diffPct !== null ? ` (%${pct(diffPct)} daha pahalı)` : ""}`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");
    }

    case "COMPETITOR_PRICE_CHANGE": {
      const moves = data.competitorMoves ?? [];
      const { emoji, heading } = competitorMovesHeading(moves.length > 0 ? moves : []);
      const moveLines = moves
        .slice(0, MAX_COMPETITOR_MOVE_LINES)
        .map((m) => escapeHtml(competitorMoveLine(m)));
      const extraCount = moves.length - MAX_COMPETITOR_MOVE_LINES;
      return [
        `${emoji} <b>${heading}</b>`,
        ``,
        name,
        ...moveLines,
        ...(extraCount > 0 ? [`… ve ${extraCount} rakip daha`] : []),
        ...(data.currentPrice > 0 ? [`Sizin fiyatınız: <b>${money(data.currentPrice)} ₺</b>`] : []),
        marketplace,
        ``,
        linkLine,
      ].join("\n");
    }

    case "OUT_OF_STOCK":
      return [`🚫 <b>Stoktan çıktı</b>`, ``, name, marketplace, ``, linkLine].join("\n");

    case "BACK_IN_STOCK":
      return [
        `✅ <b>Stoğa girdi</b>`,
        ``,
        name,
        `Fiyat: <b>${money(data.currentPrice)} ₺</b>`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");

    case "LOW_MARGIN": {
      const loss = isLoss(data.marginPct);
      const emoji = loss ? "🔻" : "💸";
      const heading = loss ? "Zarar ediyorsun" : "Kâr marjı düştü";
      const profit = data.cost != null ? data.currentPrice - data.cost : null;
      const marginStr = data.marginPct != null ? pct(data.marginPct) : "—";
      return [
        `${emoji} <b>${heading}</b>`,
        ``,
        name,
        `Satış: <b>${money(data.currentPrice)} ₺</b> • Maliyet: ${money(data.cost ?? null)} ₺`,
        `Birim kâr: <b>${money(profit)} ₺</b> • Marj: <b>%${marginStr}</b>`,
        marketplace,
        ``,
        linkLine,
      ].join("\n");
    }

    default:
      return ownPriceChangeMessage();
  }
}

// ============================================
// Alert Data Interface
// ============================================

interface AlertData {
  /** CompeteHive ürün detayına derin link için (Telegram/e-posta). */
  productId?: string;
  productName: string;
  currentPrice: number;
  previousPrice: number | null;
  priceChange: number | null;
  priceChangePct: number | null;
  marketplace: string;
  productUrl: string;
  // Kârlılık alanları — yalnızca LOW_MARGIN için doldurulur (maliyet girilmişse).
  cost?: number | null;
  marginPct?: number | null;
  // Rakip bağlamı — yalnızca COMPETITOR_CHEAPER için doldurulur.
  competitorPrice?: number | null;
  cheapestCompetitorName?: string | null;
  cheaperCompetitorCount?: number | null;
  // Anlamlı rakip fiyat hareketleri — yalnızca COMPETITOR_PRICE_CHANGE için.
  competitorMoves?: Array<{
    competitorName: string | null;
    previousPrice: number;
    currentPrice: number;
  }> | null;
}

// ============================================
// Notification Title & Message Generators
// ============================================

function generateNotificationTitle(ruleType: string, data: AlertData): string {
  // Kendi ürün fiyat hareketlerinde üç kural tipi de aynı başlığı üretir —
  // "%X değişim" ve "Fiyat düştü" aynı olayın iki ayrı bildirimi gibi
  // görünmesin (tutar + yüzde mesaj gövdesinde birlikte).
  const ownPriceTitle = isDrop(data.priceChange)
    ? `📉 Fiyatınızı düşürdünüz: ${data.productName}`
    : `📈 Fiyatınızı artırdınız: ${data.productName}`;

  switch (ruleType) {
    case "PRICE_DROP":
    case "PRICE_INCREASE":
    case "PERCENTAGE_CHANGE":
      return ownPriceTitle;
    case "PRICE_THRESHOLD":
      return `🎯 Fiyat eşiğine ulaştı: ${data.productName}`;
    case "COMPETITOR_CHEAPER":
      return `⚡ Rakip daha ucuz: ${data.productName}`;
    case "COMPETITOR_PRICE_CHANGE": {
      const moves = data.competitorMoves ?? [];
      if (moves.length === 0) return `🔀 Rakip fiyatı değişti: ${data.productName}`;
      const { emoji, heading } = competitorMovesHeading(moves);
      return `${emoji} ${heading}: ${data.productName}`;
    }
    case "OUT_OF_STOCK":
      return `🚫 Stoktan çıktı: ${data.productName}`;
    case "BACK_IN_STOCK":
      return `✅ Stoğa girdi: ${data.productName}`;
    case "LOW_MARGIN":
      return isLoss(data.marginPct)
        ? `🔻 Zarar uyarısı: ${data.productName}`
        : `💸 Kâr marjı düştü: ${data.productName}`;
    default:
      return ownPriceTitle;
  }
}

function generateNotificationMessage(ruleType: string, data: AlertData): string {
  if (ruleType === "OUT_OF_STOCK") {
    return `${data.productName} stoktan çıktı. Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
  }
  if (ruleType === "BACK_IN_STOCK") {
    return `${data.productName} tekrar stokta. Güncel fiyat: ${money(data.currentPrice)} ₺. Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
  }
  if (ruleType === "COMPETITOR_CHEAPER") {
    const compName = data.cheapestCompetitorName?.trim() || "Bir rakip";
    const count = data.cheaperCompetitorCount ?? 0;
    const countText = count > 1 ? `${count} rakip senden ucuz. ` : "";
    return `${data.productName}: ${countText}En ucuz rakip ${compName} ${money(data.competitorPrice ?? null)} ₺. Senin fiyatın: ${money(data.currentPrice)} ₺. Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
  }
  if (ruleType === "LOW_MARGIN") {
    const profit = data.cost != null ? data.currentPrice - data.cost : null;
    const marginStr = data.marginPct != null ? pct(data.marginPct) : "—";
    return `${data.productName} kâr marjı %${marginStr} seviyesine indi. Satış: ${money(data.currentPrice)} ₺, maliyet: ${money(data.cost ?? null)} ₺, birim kâr: ${money(profit)} ₺. Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
  }
  if (ruleType === "COMPETITOR_PRICE_CHANGE") {
    const moves = data.competitorMoves ?? [];
    const ownPricePart =
      data.currentPrice > 0 ? ` Sizin fiyatınız: ${money(data.currentPrice)} ₺.` : "";
    if (moves.length === 1) {
      const move = moves[0];
      const direction = move.currentPrice < move.previousPrice ? "düşürdü" : "artırdı";
      const movePct =
        move.previousPrice > 0
          ? ` (%${absPct(((move.currentPrice - move.previousPrice) / move.previousPrice) * 100)})`
          : "";
      return `${data.productName}: Rakibiniz ${move.competitorName?.trim() || "bir rakip"} fiyatını ${money(move.previousPrice)} ₺'den ${money(move.currentPrice)} ₺'ye ${direction}${movePct}.${ownPricePart} Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
    }
    const lines = moves
      .slice(0, MAX_COMPETITOR_MOVE_LINES)
      .map((m) => competitorMoveLine(m))
      .join("; ");
    const extra =
      moves.length > MAX_COMPETITOR_MOVE_LINES
        ? ` ve ${moves.length - MAX_COMPETITOR_MOVE_LINES} rakip daha`
        : "";
    return `${data.productName}: ${moves.length} rakip fiyat değiştirdi. ${lines}${extra}.${ownPricePart} Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
  }
  if (data.previousPrice === null || data.priceChange === null) {
    return `${data.productName} güncel fiyatı: ${money(data.currentPrice)} ₺. Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
  }

  // Kendi ürün fiyat hareketi: fiyatı genelde kullanıcının kendisi değiştirir —
  // "fiyat düştü" haberi yerine "siz değiştirdiniz" dili (PRICE_THRESHOLD gibi
  // hedef bazlı kurallarda mevcut nötr dil korunur).
  const isOwnPriceMoveRule =
    ruleType === "PRICE_DROP" || ruleType === "PRICE_INCREASE" || ruleType === "PERCENTAGE_CHANGE";
  const sign = data.priceChange < 0 ? "-" : "+";
  const changeSummary = `(${sign}${absMoney(data.priceChange)} ₺, %${absPct(data.priceChangePct)})`;
  if (isOwnPriceMoveRule) {
    const direction = data.priceChange < 0 ? "düşürdünüz" : "artırdınız";
    return `${data.productName} ürününüzün fiyatını ${money(data.previousPrice)} ₺'den ${money(data.currentPrice)} ₺'ye ${direction} ${changeSummary}. Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
  }
  const direction = data.priceChange < 0 ? "düştü" : "arttı";
  return `${data.productName} fiyatı ${money(data.previousPrice)} ₺'den ${money(data.currentPrice)} ₺'ye ${direction} ${changeSummary}. Pazaryeri: ${marketplaceLabel(data.marketplace)}.`;
}

// ============================================
// Send Alerts — Main Entry Point
// ============================================

export async function sendAlerts(rule: AlertRuleWithUser, data: AlertData): Promise<void> {
  // Yinelenen kanal kaydı çift gönderime (ve UI'da çift rozete) yol açmasın.
  const requestedChannels: string[] = [...new Set(rule.notifyVia || [])];
  const title = generateNotificationTitle(rule.ruleType, data);
  const message = generateNotificationMessage(rule.ruleType, data);

  const deliveries: ChannelDelivery[] = [];

  // Send-time plan kapısı: kural oluşturulduktan SONRA planı düşen kullanıcının
  // kurallarındaki ücretli kanallar (Telegram/Webhook) süresiz çalışmaya devam
  // etmesin. İzin dışı kanallar SKIPPED olarak kaydedilir ki kullanıcı
  // bildirim geçmişinde nedenini görebilsin.
  const allowedChannels = resolveAllowedChannels(rule.user);
  const channels = requestedChannels.filter((ch) => allowedChannels.includes(ch));
  for (const blocked of requestedChannels.filter((ch) => !allowedChannels.includes(ch))) {
    deliveries.push({
      channel: blocked,
      status: "SKIPPED",
      error: "Bu kanal mevcut planınızda yer almıyor. Planınızı yükseltin.",
    });
  }

  const attemptChannel = async (channel: string): Promise<DeliveryOutcome> => {
    try {
      switch (channel) {
        case "EMAIL":
          return await sendEmailAlert(rule.user, data, rule.ruleType);
        case "TELEGRAM":
          return await sendTelegramAlert(rule.user, rule.ruleType, data);
        case "WEBHOOK":
          return await sendWebhookAlert(rule.user, data, rule.ruleType);
        default:
          return { status: "SKIPPED", error: `Bilinmeyen kanal: ${channel}` };
      }
    } catch (error) {
      // Senders are written not to throw, but guard so one bad channel can't
      // abort the rest or skip the DB record.
      logger.error({ channel, userId: rule.userId, error }, "Failed to send alert");
      return { status: "FAILED", error: errorMessage(error) };
    }
  };

  for (const channel of channels) {
    // 1. Attempt the external send and capture the real outcome. Geçici sağlayıcı
    // hatalarında (5xx/timeout) tek uyarının tamamen kaybolmaması için kanal
    // bazlı BİR yeniden deneme yapılır — job seviyesinde retry yok (throw yok),
    // bu yüzden bu, teslimatın tek telafi mekanizmasıdır.
    let outcome = await attemptChannel(channel);
    if (outcome.status === "FAILED") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const retryOutcome = await attemptChannel(channel);
      if (retryOutcome.status !== "FAILED") {
        outcome = retryOutcome;
      } else {
        outcome = retryOutcome.error ? retryOutcome : outcome;
      }
    }

    deliveries.push({ channel, status: outcome.status, error: outcome.error ?? null });
    logger.info(
      { channel, userId: rule.userId, ruleType: rule.ruleType, status: outcome.status },
      "Alert channel processed",
    );
  }

  if (deliveries.length === 0) return;

  // 2. Uyarı başına TEK bildirim satırı yaz — kanal başına ayrı satır,
  // uygulama içi akışta aynı uyarıyı kanal sayısı kadar (3 kanal = 3 özdeş
  // kart) gösteriyor ve okunmamış sayacını şişiriyordu. Kanal bazlı teslimat
  // sonuçları metadata.deliveries'te; satırın status/error alanları özettir.
  const overall = summarizeDeliveries(deliveries);
  await writeNotificationToDB({
    userId: rule.userId,
    alertRuleId: rule.id,
    channel: channels[0] ?? requestedChannels[0] ?? "EMAIL",
    title,
    message,
    status: overall.status,
    error: overall.error,
    metadata: {
      productName: data.productName,
      currentPrice: data.currentPrice,
      previousPrice: data.previousPrice,
      priceChange: data.priceChange,
      priceChangePct: data.priceChangePct,
      marketplace: data.marketplace,
      productUrl: data.productUrl,
      ruleType: rule.ruleType,
      deliveries,
    },
  });

  logger.info(
    {
      userId: rule.userId,
      ruleType: rule.ruleType,
      status: overall.status,
      channels: deliveries.map((d) => `${d.channel}:${d.status}`).join(","),
    },
    "Alert processed",
  );
}

// ============================================
// Write Notification to DB
// ============================================

async function writeNotificationToDB(params: {
  userId: string;
  // null = kurala bağlı olmayan sistem bildirimi (örn. SCRAPE_FAILURE) —
  // şemada alertRuleId zaten opsiyonel, satır bildirim akışında normal görünür.
  alertRuleId: string | null;
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
  const { emoji, heading } = emailHeadline(ruleType, drop, data);

  // LOW_MARGIN: fiyat kartına maliyet + birim kâr/marj satırlarını ekle. Diğer
  // kural türlerinde boş kalır (mevcut e-posta görünümü değişmez).
  const showMargin = ruleType === "LOW_MARGIN" && data.marginPct != null;
  const marginProfit = data.cost != null ? data.currentPrice - data.cost : null;
  const marginColor = isLoss(data.marginPct) ? "#EF4444" : "#F59E0B";
  const marginRowsHtml = showMargin
    ? `<tr>
        <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">Maliyet</td>
        <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: #FFFFFF; font-size: 14px;">
          ${money(data.cost ?? null)} ₺
        </td>
      </tr>
      <tr>
        <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">Birim kâr / Marj</td>
        <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: ${marginColor}; font-size: 14px; font-weight: 600;">
          ${money(marginProfit)} ₺ (%${pct(data.marginPct as number)})
        </td>
      </tr>`
    : "";

  // COMPETITOR_CHEAPER: fiyat kartına "en ucuz rakip" satırını ekle.
  const showCompetitor = ruleType === "COMPETITOR_CHEAPER" && data.competitorPrice != null;
  const competitorLabel =
    (data.cheaperCompetitorCount ?? 0) > 1
      ? `En ucuz rakip (${data.cheaperCompetitorCount})`
      : "Rakip fiyatı";
  const competitorRowsHtml = showCompetitor
    ? `<tr>
        <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">${competitorLabel}</td>
        <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: #22C55E; font-size: 14px; font-weight: 600;">
          ${escapeHtml(data.cheapestCompetitorName?.trim() || "Bir rakip")} · ${money(data.competitorPrice ?? null)} ₺
        </td>
      </tr>`
    : "";

  // COMPETITOR_PRICE_CHANGE: fiyat kartına rakip hareket satırlarını ekle.
  const competitorMoves =
    ruleType === "COMPETITOR_PRICE_CHANGE" ? (data.competitorMoves ?? []) : [];
  const extraMoveCount = competitorMoves.length - MAX_COMPETITOR_MOVE_LINES;
  const competitorMoveRowsHtml =
    competitorMoves
      .slice(0, MAX_COMPETITOR_MOVE_LINES)
      .map((move) => {
        const moveColor = move.currentPrice < move.previousPrice ? "#22C55E" : "#EF4444";
        return `<tr>
        <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">${escapeHtml(move.competitorName?.trim() || "Rakip")}</td>
        <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: ${moveColor}; font-size: 14px; font-weight: 600;">
          ${money(move.previousPrice)} → ${money(move.currentPrice)} ₺
        </td>
      </tr>`;
      })
      .join("") +
    (extraMoveCount > 0
      ? `<tr>
        <td colspan="2" style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">… ve ${extraMoveCount} rakip daha</td>
      </tr>`
      : "");

  // Rakip hareketi e-postasında ana fiyat "Sizin fiyatınız"dır; bilinmiyorsa
  // (0) satır tamamen gizlenir — "0,00 ₺" yanıltıcı olur.
  const isCompetitorMoveEmail = ruleType === "COMPETITOR_PRICE_CHANGE";
  const ownPriceRowLabel = isCompetitorMoveEmail ? "Sizin fiyatınız" : "Yeni Fiyat";
  const showOwnPriceRow = !isCompetitorMoveEmail || data.currentPrice > 0;

  // Prod'da doğrulanmış gönderici zorunlu (env validasyonu boot'ta zorlar);
  // onboarding@resend.dev yalnızca geliştirmede işe yarar — müşterilere
  // teslim edemez, bu yüzden prod'da fallback YOK.
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ||
    (process.env.NODE_ENV === "production" ? null : "CompeteHive <onboarding@resend.dev>");
  if (!fromAddress) {
    return { status: "FAILED", error: "RESEND_FROM_EMAIL yapılandırılmamış" };
  }

  // Ücretsiz e-posta domain'leri (gmail/hotmail/…) Resend'de ASLA doğrulanamaz;
  // böyle bir gönderici tanımlıysa her e-posta "domain is not verified" ile
  // düşer ve kullanıcı İngilizce altyapı hatası görür. Erken ve TÜRKÇE başarısız
  // ol ki bildirim geçmişindeki hata aksiyon alınabilir olsun.
  const fromDomain = fromAddress.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? "";
  const FREE_MAIL_DOMAINS = new Set([
    "gmail.com",
    "googlemail.com",
    "hotmail.com",
    "outlook.com",
    "yahoo.com",
    "icloud.com",
    "yandex.com",
    "mail.ru",
  ]);
  if (FREE_MAIL_DOMAINS.has(fromDomain)) {
    logger.error(
      { fromAddress },
      "RESEND_FROM_EMAIL uses a free-mail domain that can never be verified in Resend",
    );
    return {
      status: "FAILED",
      error: `E-posta gönderici adresi (${fromDomain}) doğrulanamaz. Yönetici: RESEND_FROM_EMAIL'i doğrulanmış alan adıyla (örn. bildirim@competehive.com) güncelleyin.`,
    };
  }

  try {
    const { error: sendError } = await resend.emails.send({
      from: fromAddress,
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
                ${
                  showOwnPriceRow
                    ? `<tr>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #FFFFFF; font-size: 13px; font-weight: 600;">${ownPriceRowLabel}</td>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; font-size: 20px; font-weight: 700; color: ${priceColor};">
                    ${money(data.currentPrice)} ₺
                  </td>
                </tr>`
                    : ""
                }
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
                ${marginRowsHtml}
                ${competitorRowsHtml}
                ${competitorMoveRowsHtml}
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">Pazaryeri</td>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: #FFFFFF; font-size: 14px;">
                    ${marketplaceLabel(data.marketplace)}
                  </td>
                </tr>
              </table>
            </div>

            <!-- CTA Buttons -->
            <div style="text-align: center; margin-bottom: 24px;">
              <a href="${data.productUrl}" style="display: inline-block; background: #F59E0B; color: #000000; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                Ürüne Git →
              </a>
              ${
                appProductUrl(data.productId)
                  ? `<a href="${appProductUrl(data.productId)}" style="display: inline-block; margin-left: 8px; border: 1px solid #F59E0B; color: #F59E0B; padding: 11px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                CompeteHive'da Aç
              </a>`
                  : ""
              }
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

    // Resend SDK'sı API/ağ hatalarında throw ETMEZ — hatayı sonuç nesnesinde
    // döndürür. Kontrol edilmezse reddedilen/bounce olan her e-posta "SENT"
    // olarak kaydedilir ve kullanıcı hiç ulaşmayan bir kanala güvenir.
    if (sendError) {
      logger.error({ userId: user.id, error: sendError }, "Resend email failed");
      const rawError = sendError.message || sendError.name || String(sendError);
      // Sağlayıcının İngilizce altyapı hatası kullanıcı arayüzüne olduğu gibi
      // sızmasın; bilinen hataları Türkçe + aksiyon alınabilir metne çevir.
      const turkishError = /domain is not verified/i.test(rawError)
        ? "E-posta gönderici alan adı doğrulanmamış. Yönetici: Resend panelinde alan adını doğrulayıp RESEND_FROM_EMAIL'i güncelleyin."
        : rawError;
      return {
        status: "FAILED",
        error: turkishError,
      };
    }

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

async function sendWebhookAlert(
  user: AlertUser,
  data: AlertData,
  ruleType: string,
): Promise<DeliveryOutcome> {
  if (!user?.webhookUrl) return { status: "SKIPPED", error: "Webhook URL yok" };

  const body = JSON.stringify({
    // Rakip fiyat hareketi ayrı bir olay adıyla gider — otomasyonlar kendi
    // fiyat değişimi ile rakip hareketini ayırt edebilsin.
    event: ruleType === "COMPETITOR_PRICE_CHANGE" ? "competitor_price_change" : "price_change",
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
    // Maliyet girilmiş ürünlerde otomasyonların kârlılığa göre karar verebilmesi
    // için marj bloğu eklenir (repricing botları vb.). Maliyet yoksa atlanır.
    ...(data.cost != null
      ? {
          margin: {
            cost: data.cost,
            profit: data.currentPrice - data.cost,
            marginPercent: data.marginPct ?? null,
          },
        }
      : {}),
    // En ucuz geçerli rakip bağlamı (COMPETITOR_CHEAPER). Otomasyonlar "kimden,
    // ne kadar ucuz" bilgisiyle repricing kararı verebilir.
    ...(data.competitorPrice != null
      ? {
          competitor: {
            cheapestPrice: data.competitorPrice,
            cheapestName: data.cheapestCompetitorName ?? null,
            cheaperCount: data.cheaperCompetitorCount ?? null,
          },
        }
      : {}),
    // Anlamlı rakip fiyat hareketleri (COMPETITOR_PRICE_CHANGE).
    ...(data.competitorMoves && data.competitorMoves.length > 0
      ? {
          competitorChanges: data.competitorMoves.map((move) => ({
            name: move.competitorName,
            previous: move.previousPrice,
            current: move.currentPrice,
          })),
        }
      : {}),
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

// ============================================
// Scrape-Failure Alert — kurala bağlı olmayan sistem bildirimi
// ============================================
//
// Ürün SCRAPE_FAILURE_THRESHOLD ardışık başarısız taramadan sonra ERROR
// durumuna geçtiği anda kullanıcıya haber verir. Fiyat uyarılarından farkı:
// AlertRule gerektirmez (kullanıcının kural kurmasına gerek yok — taranamayan
// ürün her kullanıcı için önemlidir) ve eşiğin AŞILDIĞI ilk anda tam bir kez
// gönderilir. Sayaç başarılı taramada sıfırlandığından her yeni kesinti yeni
// bir bildirim üretir; süregiden kesinti spam üretmez (bkz. processor.ts).

export interface ScrapeFailureInput {
  productId: string;
  productName: string;
  marketplace: string;
  productUrl: string;
  failureCount: number;
}

export interface ScrapeFailureContent {
  title: string;
  message: string;
  telegramText: string;
}

// İçerik üretimi ayrı ve export — deterministik metin testlenebilir olsun.
export function buildScrapeFailureContent(input: ScrapeFailureInput): ScrapeFailureContent {
  const mpLabel = marketplaceLabel(input.marketplace);
  const title = `⛔ Ürün taranamıyor: ${input.productName}`;
  const message =
    `${input.productName} ürünü ${input.failureCount} ardışık denemede taranamadı ve HATA durumuna alındı. ` +
    `Pazaryeri: ${mpLabel}. Sistem 24 saatte bir otomatik denemeye devam edecek; ilk başarılı taramada ürün kendini düzeltir. ` +
    `Sorun devam ederse ürün linkinin hâlâ geçerli olduğunu kontrol edin.`;

  const appUrl = appProductUrl(input.productId);
  const linkLine = [
    `🔗 <a href="${escapeHtml(input.productUrl)}">Ürüne git</a>`,
    appUrl ? `📊 <a href="${escapeHtml(appUrl)}">CompeteHive'da aç</a>` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const telegramText = [
    `⛔ <b>Ürün taranamıyor</b>`,
    ``,
    `<b>${escapeHtml(input.productName)}</b>`,
    `${input.failureCount} ardışık deneme başarısız — ürün HATA durumuna alındı.`,
    `Sistem 24 saatte bir yeniden deneyecek; ilk başarılı taramada kendini düzeltir.`,
    `🏪 ${escapeHtml(mpLabel)}`,
    ``,
    linkLine,
  ].join("\n");

  return { title, message, telegramText };
}

async function sendScrapeFailureTelegram(
  user: AlertUser,
  content: ScrapeFailureContent,
): Promise<DeliveryOutcome> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { status: "SKIPPED", error: "TELEGRAM_BOT_TOKEN tanımlı değil" };
  if (!user.telegramChatId || user.telegramStatus !== "connected") {
    return { status: "SKIPPED", error: "Telegram bağlı değil" };
  }
  try {
    await tgSendMessage(botToken, user.telegramChatId, content.telegramText);
    return { status: "SENT" };
  } catch (error) {
    // Kalıcı-hata (blocked) işaretlemesi fiyat-uyarısı yolunda yapılır; burada
    // sonucu kaydetmek yeterli — bir sonraki fiyat uyarısı durumu düzeltir.
    logger.warn({ userId: user.id, error }, "Scrape-failure Telegram send failed");
    return { status: "FAILED", error: errorMessage(error) };
  }
}

async function sendScrapeFailureEmail(
  user: AlertUser,
  content: ScrapeFailureContent,
  input: ScrapeFailureInput,
): Promise<DeliveryOutcome> {
  if (user?.emailAlertsEnabled === false) {
    return { status: "SKIPPED", error: "E-posta uyarıları kapalı" };
  }
  const resend = getResend();
  if (!resend) return { status: "SKIPPED", error: "RESEND_API_KEY tanımlı değil" };
  if (!user?.email) return { status: "SKIPPED", error: "E-posta adresi yok" };

  const fromAddress =
    process.env.RESEND_FROM_EMAIL ||
    (process.env.NODE_ENV === "production" ? null : "CompeteHive <onboarding@resend.dev>");
  if (!fromAddress) {
    return { status: "FAILED", error: "RESEND_FROM_EMAIL yapılandırılmamış" };
  }

  const appUrl = appProductUrl(input.productId);
  try {
    const { error: sendError } = await resend.emails.send({
      from: fromAddress,
      to: user.email,
      subject: content.title,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #0A0A0B; color: #FFFFFF;">
          <div style="background: #111113; padding: 24px; border-bottom: 1px solid #1F1F23;">
            <table style="width: 100%;">
              <tr>
                <td>
                  <span style="font-size: 20px; font-weight: 700; color: #F59E0B;">🐝 CompeteHive</span>
                </td>
                <td style="text-align: right;">
                  <span style="font-size: 12px; color: #6B7280;">Sistem Uyarısı</span>
                </td>
              </tr>
            </table>
          </div>
          <div style="padding: 32px 24px;">
            <h2 style="margin: 0 0 8px 0; font-size: 18px; color: #FFFFFF;">⛔ Ürün taranamıyor</h2>
            <p style="margin: 0 0 24px 0; color: #9CA3AF; font-size: 14px;">
              ${escapeHtml(input.productName)}
            </p>
            <div style="background: #111113; border: 1px solid #EF4444; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
              <p style="margin: 0 0 12px 0; color: #FFFFFF; font-size: 14px;">
                Ürün <strong style="color: #EF4444;">${input.failureCount} ardışık denemede</strong> taranamadı ve HATA durumuna alındı.
              </p>
              <p style="margin: 0; color: #9CA3AF; font-size: 13px;">
                Sistem 24 saatte bir otomatik denemeye devam edecek; ilk başarılı taramada ürün kendini düzeltir.
                Sorun devam ederse ürün linkinin hâlâ geçerli olduğunu kontrol edin.
              </p>
              <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                <tr>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; color: #9CA3AF; font-size: 13px;">Pazaryeri</td>
                  <td style="padding: 8px 0; border-top: 1px solid #1F1F23; text-align: right; color: #FFFFFF; font-size: 14px;">
                    ${escapeHtml(marketplaceLabel(input.marketplace))}
                  </td>
                </tr>
              </table>
            </div>
            <div style="text-align: center; margin-bottom: 24px;">
              <a href="${input.productUrl}" style="display: inline-block; background: #F59E0B; color: #000000; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                Ürüne Git →
              </a>
              ${
                appUrl
                  ? `<a href="${appUrl}" style="display: inline-block; margin-left: 8px; border: 1px solid #F59E0B; color: #F59E0B; padding: 11px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
                CompeteHive'da Aç
              </a>`
                  : ""
              }
            </div>
          </div>
          <div style="padding: 16px 24px; border-top: 1px solid #1F1F23; text-align: center;">
            <p style="margin: 0; color: #6B7280; font-size: 11px;">
              Bu uyarı CompeteHive tarafından gönderilmiştir.
            </p>
          </div>
        </div>
      `,
    });

    if (sendError) {
      logger.error({ userId: user.id, error: sendError }, "Scrape-failure email failed");
      return {
        status: "FAILED",
        error: sendError.message || sendError.name || String(sendError),
      };
    }
    logger.info({ userId: user.id, email: user.email }, "Scrape-failure email sent via Resend");
    return { status: "SENT" };
  } catch (error) {
    logger.error({ userId: user.id, error }, "Scrape-failure email failed");
    return { status: "FAILED", error: errorMessage(error) };
  }
}

export async function sendScrapeFailureAlert(
  productId: string,
  failureCount: number,
): Promise<void> {
  const product = await prisma.trackedProduct.findUnique({
    where: { id: productId },
    include: { user: true },
  });
  if (!product || !product.user) {
    logger.warn({ productId }, "Scrape-failure alert skipped — product/user not found");
    return;
  }
  const user = product.user as unknown as AlertUser;

  const input: ScrapeFailureInput = {
    productId,
    productName: product.productName,
    marketplace: product.marketplace,
    productUrl: product.productUrl,
    failureCount,
  };
  const content = buildScrapeFailureContent(input);

  // Plan kapısı fiyat uyarılarıyla aynı: FREE yalnızca EMAIL, ücretli planlar
  // Telegram'ı da alır. In-app satır her durumda yazılır.
  const requestedChannels = ["EMAIL", "TELEGRAM"];
  const allowedChannels = resolveAllowedChannels(user);
  const channels = requestedChannels.filter((ch) => allowedChannels.includes(ch));

  const attemptChannel = async (channel: string): Promise<DeliveryOutcome> => {
    try {
      switch (channel) {
        case "EMAIL":
          return await sendScrapeFailureEmail(user, content, input);
        case "TELEGRAM":
          return await sendScrapeFailureTelegram(user, content);
        default:
          return { status: "SKIPPED", error: `Bilinmeyen kanal: ${channel}` };
      }
    } catch (error) {
      logger.error({ channel, userId: user.id, error }, "Failed to send scrape-failure alert");
      return { status: "FAILED", error: errorMessage(error) };
    }
  };

  const deliveries: ChannelDelivery[] = [];
  for (const channel of channels) {
    // Fiyat uyarılarındaki tek-retry telafisi burada da geçerli: job seviyesinde
    // retry yok, geçici sağlayıcı hatası bildirimi tamamen düşürmesin.
    let outcome = await attemptChannel(channel);
    if (outcome.status === "FAILED") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const retryOutcome = await attemptChannel(channel);
      if (retryOutcome.status !== "FAILED") {
        outcome = retryOutcome;
      } else {
        outcome = retryOutcome.error ? retryOutcome : outcome;
      }
    }
    deliveries.push({ channel, status: outcome.status, error: outcome.error ?? null });
  }

  const overall = summarizeDeliveries(
    deliveries.length > 0 ? deliveries : [{ channel: "EMAIL", status: "SKIPPED", error: null }],
  );
  await writeNotificationToDB({
    userId: product.userId,
    alertRuleId: null,
    channel: channels[0] ?? "EMAIL",
    title: content.title,
    message: content.message,
    status: overall.status,
    error: overall.error,
    metadata: {
      ruleType: "SCRAPE_FAILURE",
      productId,
      productName: product.productName,
      marketplace: product.marketplace,
      productUrl: product.productUrl,
      failureCount,
      deliveries,
    },
  });

  logger.info(
    {
      userId: product.userId,
      productId,
      failureCount,
      status: overall.status,
      channels: deliveries.map((d) => `${d.channel}:${d.status}`).join(","),
    },
    "Scrape-failure alert processed",
  );
}
