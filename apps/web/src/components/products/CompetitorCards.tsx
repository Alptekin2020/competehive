"use client";

// Ürün detayındaki rakip kartları. Üç grup (bkz. lib/competitor-groups.ts):
// güvenilir (numaralı), "Diğer rakipler" ve "Onay bekleyen olası eşleşmeler".
// Kart yığın düzenindedir: başlık tam genişlik kendi satırında, fiyat bloğu
// altında — dar sütunda başlık kelime kelime kırılmaz.

import { useState, type ReactNode } from "react";
import { MIN_MATCH_SCORE } from "@competehive/shared";

import { MarketplaceBadge } from "@/components/ui/MarketplaceBadge";
import {
  competitorOpenLabel,
  competitorOpenUrl,
  isGoogleHostedUrl,
  resolveCompetitorSource,
} from "@/lib/competitor-source";
import { competitorFreshness, describePriceGap, type FreshnessTone } from "@/lib/competitor-groups";
import { formatPctTR } from "@/lib/format";

export interface CompetitorCardData {
  id: string;
  competitorUrl: string;
  competitorName: string | null;
  marketplace: string;
  currentPrice: string | null;
  lastScrapedAt: string | null;
  matchScore: number | null;
  matchReason: string | null;
  review?: "pending" | "confirmed" | null;
  seller?: string | null;
  inStock?: boolean | null;
}

export type CompetitorCardVariant = "trusted" | "other" | "pending";

export interface CompetitorCardProps {
  competitor: CompetitorCardData;
  variant: CompetitorCardVariant;
  /** Numaralı listedeki sıra (yalnızca güvenilir rakipler). */
  index?: number;
  ownPrice: number | null;
  currency: string;
  isCheapest?: boolean;
  /** Kalite politikası sorunları ("out-of-band", "peer-outlier", "stale", …). */
  issues?: string[];
  confirming?: boolean;
  confirmDisabled?: boolean;
  onConfirm?: (id: string) => void;
  onReject: (id: string) => void;
  now?: Date;
}

export function formatCompetitorPrice(price: number, currency = "TRY"): string {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

function parsePrice(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function MatchScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null;
  const colorClass =
    score >= 90
      ? "bg-green-500/10 text-green-400 border-green-500/30"
      : score >= MIN_MATCH_SCORE
        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
        : score >= 40
          ? "bg-orange-500/10 text-orange-400 border-orange-500/30"
          : "bg-red-500/10 text-red-400 border-red-500/30";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${colorClass}`}
      title={`Bu ilanın sizin ürününüzle aynı ürün olma ihtimali: %${score}. %${MIN_MATCH_SCORE} altındaki rakipler hesaplara girmez.`}
    >
      Eşleşme %{score}
    </span>
  );
}

const FRESHNESS_CLASS: Record<FreshnessTone, string> = {
  fresh: "text-gray-500",
  aging: "text-amber-400",
  stale: "text-red-400",
};

function Chip({
  children,
  tone,
  title,
}: {
  children: ReactNode;
  tone: "neutral" | "rose" | "pink" | "emerald";
  title?: string;
}) {
  const cls = {
    neutral: "text-gray-400 bg-white/5 border-[#2B2B30]",
    rose: "text-rose-300 bg-rose-500/10 border-rose-500/25",
    pink: "text-pink-300 bg-pink-500/10 border-pink-500/25",
    emerald: "text-emerald-300 bg-emerald-500/10 border-emerald-500/30",
  }[tone];
  return (
    <span
      className={`text-[11px] border px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}
      title={title}
    >
      {children}
    </span>
  );
}

/** Rakip kartı. Her kartta tek bir "kaldır/değil" kontrolü vardır. */
export function CompetitorCard({
  competitor,
  variant,
  index,
  ownPrice,
  currency,
  isCheapest = false,
  issues = [],
  confirming = false,
  confirmDisabled = false,
  onConfirm,
  onReject,
  now = new Date(),
}: CompetitorCardProps) {
  const [confirmStep, setConfirmStep] = useState(false);
  const source = resolveCompetitorSource(competitor);
  const price = parsePrice(competitor.currentPrice);
  const gap = describePriceGap(price, ownPrice);
  const freshness = competitorFreshness(competitor.lastScrapedAt, now);
  const title =
    competitor.competitorName?.trim() ||
    competitor.seller ||
    (isGoogleHostedUrl(competitor.competitorUrl) ? "Google Alışveriş ilanı" : null) ||
    hostnameOf(competitor.competitorUrl);
  const href = competitorOpenUrl(competitor);
  const linkLabel = competitorOpenLabel(competitor);
  const viaGoogleSearch = source.viaGoogle;

  // Onay: AI'ın emin olamadığı (pending) veya skoru eşiğin altındaki kayıtlarda.
  const canConfirm =
    onConfirm !== undefined &&
    competitor.review !== "confirmed" &&
    (variant === "pending" ||
      (competitor.matchScore !== null && competitor.matchScore < MIN_MATCH_SCORE));
  const confirmNeedsExtraStep = gap?.isLarge === true;

  const signedDiff = price !== null && ownPrice ? ((price - ownPrice) / ownPrice) * 100 : null;
  const borderClass =
    variant === "pending"
      ? "border-amber-500/25"
      : variant === "other"
        ? "border-[#1F1F23]"
        : isCheapest
          ? "border-emerald-500/40"
          : "border-[#1F1F23] hover:border-[#2F2F33]";

  const rejectLabel = variant === "trusted" ? "Kaldır" : "Aynı ürün değil";

  return (
    <div
      className={`p-3 rounded-lg bg-[#0A0A0B] border transition-colors ${borderClass}`}
      data-testid={`competitor-card-${competitor.id}`}
    >
      {/* 1. satır: sıra + kaynak rozetleri */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {index !== undefined && (
          <span className="text-gray-500 text-xs font-medium tabular-nums mr-0.5">{index}.</span>
        )}
        <MarketplaceBadge
          marketplace={source.marketplace}
          overrideName={source.overrideName}
          overrideColor={source.overrideColor}
        />
        {source.sourceLabel && (
          <Chip
            tone="neutral"
            title="Bu fiyat Google Alışveriş sonuçlarından alındı. Google'ın ürün kartları kısa sürede kaybolduğu için bağlantı ürünü Google'da yeniden arar."
          >
            {source.sourceLabel}
          </Chip>
        )}
        {variant !== "pending" && <MatchScoreBadge score={competitor.matchScore} />}
        {competitor.review === "confirmed" && (
          <Chip tone="emerald" title="Bu eşleşmeyi siz onayladınız">
            Sizin onayınız
          </Chip>
        )}
        {competitor.inStock === false && (
          <Chip tone="pink" title="Son taramada bu rakibin stoğu yoktu — talep size kayabilir">
            Stok yok
          </Chip>
        )}
        {variant === "other" && issues.includes("low-score") && (
          <Chip tone="rose" title="Eşleşme güveni karar eşiğinin altında; hesaplara girmez">
            Düşük eşleşme
          </Chip>
        )}
        {variant === "other" && issues.includes("out-of-band") && (
          <Chip
            tone="rose"
            title="Fiyatı sizin fiyatınızın 0.3x–3x bandının dışında — büyük olasılıkla farklı ürün; hesaplara dahil edilmez"
          >
            Bant dışı
          </Chip>
        )}
        {variant === "other" && issues.includes("peer-outlier") && (
          <Chip
            tone="rose"
            title="Fiyatı diğer rakiplerin medyanından aşırı kopuk — büyük olasılıkla sahte/yem ilan veya farklı ürün; hesaplara dahil edilmez"
          >
            Piyasa dışı
          </Chip>
        )}
      </div>

      {/* 2. satır: başlık tam genişlikte — asla kelime kelime kırılmaz */}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`mt-1.5 block text-sm text-gray-200 hover:text-white transition-colors break-words [overflow-wrap:anywhere] ${
          variant === "pending" ? "" : "line-clamp-2"
        }`}
        title={viaGoogleSearch ? `${title} — ${linkLabel}` : title}
      >
        {title}
      </a>

      {competitor.matchReason && (
        <p
          className={`text-xs text-gray-500 mt-0.5 break-words ${variant === "pending" ? "" : "line-clamp-1"}`}
          title={competitor.matchReason}
        >
          {variant === "pending" && competitor.matchScore !== null && (
            <span className="text-gray-400">Yapay zekâ: %{competitor.matchScore} · </span>
          )}
          {competitor.matchReason}
        </p>
      )}

      {/* 3. satır: fiyat bloğu + tek tazelik etiketi + aksiyonlar */}
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          {price !== null ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-bold text-white whitespace-nowrap">
                {formatCompetitorPrice(price, currency)}
              </span>
              {variant === "trusted" && signedDiff !== null ? (
                <span
                  className={`text-xs whitespace-nowrap ${
                    signedDiff < 0
                      ? "text-green-400"
                      : signedDiff > 0
                        ? "text-red-400"
                        : "text-gray-400"
                  }`}
                >
                  {formatPctTR(signedDiff, { sign: true })}
                </span>
              ) : (
                gap && (
                  <span className="text-xs text-gray-400 whitespace-nowrap" data-testid="price-gap">
                    {gap.text}
                  </span>
                )
              )}
              {variant === "trusted" && isCheapest && (
                <span className="text-[11px] text-emerald-300 whitespace-nowrap">
                  En düşük rakip
                </span>
              )}
              {freshness && (
                <span
                  className={`text-[11px] whitespace-nowrap ${FRESHNESS_CLASS[freshness.tone]}`}
                  title={freshness.title}
                >
                  · {freshness.label}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-gray-500">Fiyat yok</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-amber-300 underline underline-offset-2 decoration-dotted whitespace-nowrap"
            title={
              viaGoogleSearch
                ? "Google'ın ürün kartı kalıcı değildir; ürün adı ve satıcıyla Google Alışveriş'te yeni bir arama açılır."
                : "Satıcının ürün sayfasını açar"
            }
          >
            {viaGoogleSearch ? linkLabel : "Ürüne git"}
          </a>
          {canConfirm && !confirmStep && (
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={() => {
                if (confirmNeedsExtraStep) setConfirmStep(true);
                else onConfirm?.(competitor.id);
              }}
              className="text-xs font-semibold text-emerald-300 hover:text-emerald-200 underline underline-offset-2 transition disabled:opacity-50 whitespace-nowrap"
            >
              {confirming ? "Kaydediliyor…" : "Bu aynı ürün"}
            </button>
          )}
          {!confirmStep && (
            <button
              type="button"
              onClick={() => onReject(competitor.id)}
              className="text-xs font-medium text-gray-400 hover:text-rose-300 underline underline-offset-2 decoration-dotted transition whitespace-nowrap"
              title={
                variant === "trusted"
                  ? "Rakibi listeden kaldır; otomatik tarama bu ilanı bir daha getirmez"
                  : "Bu ilan sizin ürününüz değil; listeden kaldırılır ve bir daha getirilmez"
              }
            >
              {rejectLabel}
            </button>
          )}
        </div>
      </div>

      {confirmStep && (
        <div
          role="group"
          aria-label="Onayı doğrula"
          className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2"
        >
          <p className="text-xs text-amber-200">
            {gap?.text}. Fiyatlar bu kadar farklıyken genellikle farklı bir model veya paket söz
            konusudur. Yine de aynı ürün mü?
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={() => {
                setConfirmStep(false);
                onConfirm?.(competitor.id);
              }}
              className="text-xs font-semibold text-emerald-300 hover:text-emerald-200 underline underline-offset-2 disabled:opacity-50"
            >
              Evet, aynı ürün
            </button>
            <button
              type="button"
              onClick={() => setConfirmStep(false)}
              className="text-xs text-gray-400 hover:text-white underline underline-offset-2"
            >
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Varsayılan olarak kapalı, sayaçlı açılır grup başlığı. */
export function CollapsibleGroup({
  title,
  count,
  description,
  open,
  onToggle,
  children,
  id,
}: {
  title: string;
  count: number;
  description?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  id?: string;
}) {
  if (count === 0) return null;
  return (
    <section id={id} className="mt-4 rounded-lg border border-[#1F1F23]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="text-sm font-medium text-gray-200">
          {title} <span className="text-gray-500 font-normal">({count})</span>
        </span>
        <span className="text-xs text-gray-400">{open ? "Gizle" : "Göster"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
          <div className="space-y-2">{children}</div>
        </div>
      )}
    </section>
  );
}
