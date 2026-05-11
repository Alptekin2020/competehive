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

// "match"      — AI/fallback explicitly accepted the candidate (score >= threshold)
// "reject"     — AI/fallback explicitly rejected (score < threshold)
// "unreliable" — could not determine (API error, empty/invalid JSON). Caller may
//                choose to keep the candidate without an AI score since price-band
//                already filtered, instead of penalising it for our outage.
export type MatchOutcome = "match" | "reject" | "unreliable";

export interface MatchResult {
  outcome: MatchOutcome;
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

// Worker `apps/worker/src/matcher.ts` ile birebir aynı prompt — iki tarafın da
// aynı kararı vermesi için. Worker güncellendiğinde burası da güncellenmeli.
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
8. KRİTİK MARKA TUTARLILIĞI: Eğer marka adı (Karaca, Apple, Samsung, Nike, Beko, Arzum, Sinbo vb.) HEM kaynak HEM aday başlığında AYNI şekilde geçiyorsa, brandMatch=true OLMAK ZORUNDA. "aynı marka değil" reasoning'i veremezsin marka adı iki başlıkta da varsa. Bu kuralı ihlal etmek tutarsız cevap üretmek demektir. ANCAK marka adının başlıkta geçmesi yalnız başına eşleşme demek değildir — kategori/tip eşleşmesi de zorunludur (Kural 11).
9. SKOR-İSMATCH TUTARLILIĞI: Eğer score >= ${MIN_MATCH_SCORE} ise isMatch=true OLMAK ZORUNDA. score < ${MIN_MATCH_SCORE} ise isMatch=false OLMAK ZORUNDA. score ve isMatch çelişemez.
10. KİTAP/MEDYA İSTİSNASI: Kaynak ürün kitap değilse ama aday başlığı "kitap", "roman", "öykü", "dergi", "nadirkitap", "idefix", "bkmkitap" içeriyorsa: score=0 ve isMatch=false.
11. ÜRÜN TİPİ/KATEGORİ ZORUNLULUĞU: Kaynak ürünün kategorisi (terlik, ayakkabı, telefon, laptop, ütü, kahve, terlik, bardak vs.) ile aday ürünün kategorisi açıkça farklıysa (örn: "terlik" vs "kutu/ambalaj"; "telefon" vs "kılıf"; "kahve" vs "kahve makinesi"), categoryMatch=false ve score < 40 olmak ZORUNDA. Aynı marka olması yeterli değildir.
12. FİYAT BÜYÜKLÜK SAĞDUYU: Kaynak fiyatı ${source.price ?? "verilmedi"} ₺ ve aday fiyatı çok daha düşükse (örn: ¹/₁₀'undan az) yüksek olasılıkla farklı ürün/aksesuar/ambalajdır — score < 40 ver.

SADECE aşağıdaki JSON formatında yanıt ver, başka hiçbir şey yazma:

{
  "isMatch": true/false,
  "score": 0-100,
  "reason": "Türkçe kısa açıklama (max 100 karakter)",
  "brandMatch": true/false,
  "modelMatch": true/false,
  "specMatch": true/false,
  "categoryMatch": true/false,
  "details": "Karşılaştırma detayı (max 150 karakter)"
}

SKOR REHBERİ:
- 90-100: Kesinlikle aynı ürün (marka, model, tüm özellikler eşleşiyor)
- ${MIN_MATCH_SCORE}-89: Büyük olasılıkla aynı ürün (küçük belirsizlikler var)
- 40-${MIN_MATCH_SCORE - 1}: Belirsiz (benzer ama emin değilim)
- 0-39: Farklı ürün`;
}

function emptyAttributes(details: string): MatchAttributes {
  return {
    brandMatch: false,
    modelMatch: false,
    specMatch: false,
    categoryMatch: false,
    details,
  };
}

function unreliableResult(reason: string): MatchResult {
  return {
    outcome: "unreliable",
    isMatch: false,
    score: 0,
    reason,
    attributes: emptyAttributes(reason),
  };
}

// String benzerlik fallback'i — apps/worker/src/matcher.ts içindeki `fallbackMatch`
// ile aynı algoritma. OPENAI_API_KEY yapılandırılmamışsa kullanıyoruz ki worker
// ile compare endpoint aynı kararı versin.
function fallbackMatchByText(sourceTitle: string, candidateTitle: string): MatchResult {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const src = normalize(sourceTitle);
  const cnd = normalize(candidateTitle);
  const isMatch = src.length > 5 && cnd.includes(src.slice(0, Math.floor(src.length * 0.6)));
  return {
    outcome: isMatch ? "match" : "reject",
    isMatch,
    score: isMatch ? 50 : 0,
    reason: isMatch ? "Metin benzerliği (AI kullanılamadı)" : "Metin eşleşmedi (AI kullanılamadı)",
    attributes: emptyAttributes("OpenAI API kullanılamadığı için fallback kullanıldı"),
  };
}

export async function verifyProductMatch(
  source: ProductInfo,
  candidate: ProductInfo,
): Promise<MatchResult> {
  const client = getOpenAIClient();
  if (!client) return fallbackMatchByText(source.title, candidate.title);

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: buildPrompt(source, candidate) }],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const content = response.choices[0]?.message?.content?.trim();
    if (!content) return unreliableResult("AI yanıt vermedi");

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return unreliableResult("AI geçersiz JSON döndürdü");
    }
    if (!parsed || typeof parsed !== "object") {
      return unreliableResult("AI geçersiz yanıt verdi");
    }

    const obj = parsed as Record<string, unknown>;
    const score = Math.min(100, Math.max(0, parseInt(String(obj.score ?? "")) || 0));
    const finalIsMatch = score >= MIN_MATCH_SCORE;

    return {
      outcome: finalIsMatch ? "match" : "reject",
      isMatch: finalIsMatch,
      score,
      reason: String(obj.reason ?? "Açıklama yok").slice(0, 200),
      attributes: {
        brandMatch: obj.brandMatch === true,
        modelMatch: obj.modelMatch === true,
        specMatch: obj.specMatch === true,
        categoryMatch: obj.categoryMatch === true,
        details: String(obj.details ?? "").slice(0, 300),
      },
    };
  } catch (err) {
    logger.error({ err, source: source.title, candidate: candidate.title }, "matcher fail");
    // Teknik hata — caller bunu "unreliable" olarak ele alabilir ve mevcut
    // (fiyat bandını geçmiş) aday ürünü AI skoru olmadan saklayabilir.
    return unreliableResult("AI hatası");
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
