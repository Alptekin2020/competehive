import OpenAI from "openai";
import { MIN_MATCH_SCORE } from "@competehive/shared";
import { logger } from "./logger";

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) return null;
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export interface MatchAttributes {
  brandMatch: boolean;
  modelMatch: boolean;
  specMatch: boolean;
  categoryMatch: boolean;
  details: string;
}

export interface MatchResult {
  isMatch: boolean;
  score: number;
  reason: string;
  attributes: MatchAttributes;
}

export interface ProductInfo {
  title: string;
  url?: string;
  price?: number;
  marketplace?: string;
}

// apps/worker/src/matcher.ts ile birebir aynı prompt — iki tarafın da aynı kararı
// vermesini sağlıyor. Worker tarafı tek source-of-truth, web tarafı senkron compare
// için aynı mantığı kullanır.
function buildPrompt(source: ProductInfo, candidate: ProductInfo): string {
  return `Sen bir e-ticaret ürün eşleştirme uzmanısın. İki ürünün AYNI ÜRÜN olup olmadığını belirle.

KAYNAK ÜRÜN:
- Başlık: "${source.title}"
${source.price ? `- Fiyat: ${source.price} ₺` : ""}
${source.marketplace ? `- Marketplace: ${source.marketplace}` : ""}

ADAY ÜRÜN:
- Başlık: "${candidate.title}"
${candidate.price ? `- Fiyat: ${candidate.price} ₺` : ""}
${candidate.marketplace ? `- Marketplace: ${candidate.marketplace}` : ""}

KURALLAR:
1. AYNI ÜRÜN = aynı marka, aynı model, aynı varyant (renk/boyut farklı olabilir)
2. Aksesuar, kılıf, cam, kablosu vs. orijinal ürünle AYNI DEĞİLDİR
3. Aynı markanın farklı modelleri AYNI DEĞİLDİR (ör: iPhone 15 ≠ iPhone 15 Pro)
4. Set/paket ürünler tekli ürünle AYNI DEĞİLDİR
5. Yenilenmiş/refurbished ürünler orijinaliyle farklı kabul edilebilir (skor düşük)
6. Fiyat farkı %300'den fazlaysa büyük olasılıkla farklı üründür
7. PAKETLEME/AMBALAJ İSTİSNASI: Aday başlığında "koli", "kutu", "kutusu", "ambalaj", "ambalajı", "paket", "paketleme", "carton", "kargo poşeti", "stretch film", "bant", "etiket", "kraft" gibi paketleme/ambalaj/lojistik malzemesi sözcükleri varsa VE kaynak ürün ayakkabı, terlik, telefon, ev aleti gibi son tüketici ürünüyse: score=0 ve isMatch=false ver. "kolikutugelsin", "bojopack", "packmore", "kolicim", "kolicixx" gibi mağaza/marka adlarında "koli", "pack", "paket" geçenler ambalaj satıcısıdır — skor=0.
8. KRİTİK MARKA TUTARLILIĞI: Eğer marka adı HEM kaynak HEM aday başlığında AYNI şekilde geçiyorsa brandMatch=true OLMAK ZORUNDA. ANCAK kategori/tip eşleşmesi de zorunludur (Kural 11).
9. SKOR-İSMATCH TUTARLILIĞI: Eğer score >= ${MIN_MATCH_SCORE} ise isMatch=true. score < ${MIN_MATCH_SCORE} ise isMatch=false.
10. KİTAP/MEDYA İSTİSNASI: Kaynak ürün kitap değilse ama aday başlığı "kitap", "roman", "öykü", "dergi", "nadirkitap", "idefix", "bkmkitap" içeriyorsa score=0.
11. ÜRÜN TİPİ/KATEGORİ ZORUNLULUĞU: Kaynak ürünün kategorisi (terlik, ayakkabı, telefon, laptop, ütü, kahve, bardak vs.) ile aday ürünün kategorisi açıkça farklıysa categoryMatch=false ve score < 40 OLMAK ZORUNDA.
12. FİYAT BÜYÜKLÜK SAĞDUYU: Kaynak fiyatı ${source.price ?? "verilmedi"} ₺ ve aday fiyatı çok daha düşükse (örn: ¹/₁₀'undan az) yüksek olasılıkla farklı ürün/aksesuar/ambalajdır — score < 40 ver.

SADECE aşağıdaki JSON formatında yanıt ver:
{
  "isMatch": true/false,
  "score": 0-100,
  "reason": "Türkçe kısa açıklama (max 100 karakter)",
  "brandMatch": true/false,
  "modelMatch": true/false,
  "specMatch": true/false,
  "categoryMatch": true/false,
  "details": "Karşılaştırma detayı (max 150 karakter)"
}`;
}

function fallbackResult(isMatch: boolean, reason: string): MatchResult {
  return {
    isMatch,
    score: isMatch ? 50 : 0,
    reason,
    attributes: {
      brandMatch: false,
      modelMatch: false,
      specMatch: false,
      categoryMatch: false,
      details: reason,
    },
  };
}

export async function verifyProductMatch(
  source: ProductInfo,
  candidate: ProductInfo,
): Promise<MatchResult> {
  const client = getOpenAIClient();
  if (!client) return fallbackResult(false, "OpenAI API yapılandırılmamış");

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: buildPrompt(source, candidate) }],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return fallbackResult(false, "AI yanıt vermedi");

    const parsed = JSON.parse(content);
    const score = Math.min(100, Math.max(0, parseInt(parsed.score) || 0));
    const finalIsMatch = score >= MIN_MATCH_SCORE;

    return {
      isMatch: finalIsMatch,
      score,
      reason: String(parsed.reason || "Açıklama yok").slice(0, 200),
      attributes: {
        brandMatch: parsed.brandMatch === true,
        modelMatch: parsed.modelMatch === true,
        specMatch: parsed.specMatch === true,
        categoryMatch: parsed.categoryMatch === true,
        details: String(parsed.details || "").slice(0, 300),
      },
    };
  } catch (err) {
    logger.error({ err, source: source.title, candidate: candidate.title }, "matcher fail");
    return fallbackResult(false, "AI hatası");
  }
}

// Worker tarafıyla aynı band (0.3x — 3x). Bu eşik matcher prompt'undaki "%300 farkı"
// kuralıyla senkron tutuluyor.
export const PRICE_BAND_MIN_RATIO = 0.3;
export const PRICE_BAND_MAX_RATIO = 3.0;

export function withinPriceBand(sourcePrice: number, candidatePrice: number): boolean {
  if (!Number.isFinite(sourcePrice) || sourcePrice <= 0) return true;
  if (!Number.isFinite(candidatePrice) || candidatePrice <= 0) return false;
  const min = sourcePrice * PRICE_BAND_MIN_RATIO;
  const max = sourcePrice * PRICE_BAND_MAX_RATIO;
  return candidatePrice >= min && candidatePrice <= max;
}
