import OpenAI from "openai";
import {
  MIN_MATCH_SCORE,
  PRICE_BAND_MIN_RATIO,
  PRICE_BAND_MAX_RATIO,
  withinPriceBand,
  isPackagingListing,
  sharesStrongProductCode,
} from "@competehive/shared";
import { logger } from "./logger";

// Fiyat bandı politikası packages/shared/src/competitor-quality.ts'e taşındı;
// mevcut import yollarını kırmamak için buradan yeniden export ediliyor.
export { PRICE_BAND_MIN_RATIO, PRICE_BAND_MAX_RATIO, withinPriceBand };

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
1. AYNI ÜRÜN = aynı marka + aynı model + aynı boyut/hacim/miktar/kapasite. Renk farkı önemli değildir (aynı üründür); ama BOYUT/HACİM/MİKTAR/KAPASİTE farkı FARKLI ÜRÜNDÜR — 10ml ≠ 20ml, 50cm ≠ 70cm, 128GB ≠ 256GB, tekli ≠ 2'li paket, 1L ≠ 2L.
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
13. AYNI ÜRÜN — FARKLI SATICI/İLAN: Aynı ürün farklı pazaryerlerinde farklı kelime sırası, fazladan pazarlama sözcükleri ("orijinal", "hediyeli", "ücretsiz kargo", "outlet", "faturalı") veya küçük başlık farklarıyla listelenir. Marka + model + boyut/hacim/miktar AYNIYSA bu farklar ÖNEMSİZDİR ve ürün AYNI ÜRÜNDÜR (score >= ${MIN_MATCH_SCORE}). Rakip fiyatı kıyaslamanın amacı aynı ürünü farklı satıcıda bulmaktır; salt pazarlama veya söz dizimi farkı yüzünden eşleşmeyi reddetme. (Boyut/hacim/miktar farkı bu kuralın İSTİSNASIDIR — Kural 1 geçerli.)

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
// ile aynı algoritma. AI kullanılamadığında (key yok veya çağrı "unreliable"
// döndü) deterministik karar vermek için kullanılır; compare route'u bu sayede
// hiçbir zaman skorsuz rakip kaydetmez.
export function deterministicFallbackMatch(
  sourceTitle: string,
  candidateTitle: string,
): MatchResult {
  if (isPackagingListing(candidateTitle, sourceTitle)) {
    return {
      outcome: "reject",
      isMatch: false,
      score: 0,
      reason: "Ambalaj/koli ürünü — otomatik red",
      attributes: emptyAttributes("Aday başlığı paketleme/lojistik malzemesi içeriyor"),
    };
  }

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
  // Deterministik emniyet kemeri (AI'dan bağımsız): ambalaj/koli/lojistik
  // ürünü bir tüketici ürünüyle asla eşleşmez. AI çağrısından önce çalışır.
  if (isPackagingListing(candidate.title, source.title)) {
    return {
      outcome: "reject",
      isMatch: false,
      score: 0,
      reason: "Ambalaj/koli ürünü — otomatik red",
      attributes: emptyAttributes("Aday başlığı paketleme/lojistik malzemesi içeriyor"),
    };
  }

  // Deterministik KABUL: iki başlık uzun bir MPN/barkod (>=10) paylaşıyorsa
  // kesinlikle aynı üründür (AI'a sormaya gerek yok). Kısa spec kodları eşiğin altında.
  if (sharesStrongProductCode(source.title, candidate.title)) {
    return {
      outcome: "match",
      isMatch: true,
      score: 95,
      reason: "Aynı ürün kodu (MPN/barkod) eşleşmesi",
      attributes: {
        brandMatch: true,
        modelMatch: true,
        specMatch: true,
        categoryMatch: true,
        details: "Ortak benzersiz ürün kodu",
      },
    };
  }

  const client = getOpenAIClient();
  if (!client) return deterministicFallbackMatch(source.title, candidate.title);

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
    let finalScore = score;
    let finalIsMatch = score >= MIN_MATCH_SCORE;

    // Deterministic backstop (LLM-independent): a category mismatch is never the same product.
    if (finalIsMatch && obj.categoryMatch === false) {
      finalIsMatch = false;
      finalScore = Math.min(finalScore, 39);
    }
    // Deterministic backstop: an extreme price ratio (>4x or <1/4) is almost never the same product.
    if (
      finalIsMatch &&
      typeof source.price === "number" &&
      source.price > 0 &&
      typeof candidate.price === "number"
    ) {
      const ratio = candidate.price / source.price;
      if (ratio > 4 || ratio < 0.25) {
        finalIsMatch = false;
        finalScore = Math.min(finalScore, 39);
      }
    }

    return {
      outcome: finalIsMatch ? "match" : "reject",
      isMatch: finalIsMatch,
      score: finalScore,
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
