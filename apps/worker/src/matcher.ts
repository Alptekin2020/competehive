import OpenAI from "openai";
import { logger } from "./utils/logger";
import {
  MIN_MATCH_SCORE,
  hasConflictingSpecs,
  isPackagingListing,
  sharesStrongProductCode,
} from "./utils/competitor-quality";

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      return null;
    }
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

// ============================================
// Types
// ============================================

export interface MatchResult {
  isMatch: boolean;
  score: number; // 0-100
  reason: string; // Turkish explanation
  /** AI doğrulaması yapılamadı (anahtar yok / API hatası) — karar güvenilmez. */
  aiUnavailable?: boolean;
  attributes: {
    brandMatch: boolean;
    modelMatch: boolean;
    specMatch: boolean;
    categoryMatch: boolean;
    details: string;
  };
}

export interface ProductInfo {
  title: string;
  url?: string;
  price?: number;
  marketplace?: string;
}

// ============================================
// Fallback string matcher (when OpenAI unavailable)
// ============================================

function fallbackTokens(s: string): string[] {
  return s
    .replace(/[İIı]/g, "i")
    .replace(/[şŞ]/g, "s")
    .replace(/[çÇ]/g, "c")
    .replace(/[ğĞ]/g, "g")
    .replace(/[üÜ]/g, "u")
    .replace(/[öÖ]/g, "o")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

// AI kullanılamadığında token örtüşmesine dayalı deterministik tahmin.
// Eski davranış (başlığın %60'lık ön ekinin adayda AYNEN geçmesi) gerçek
// pazaryeri başlıklarında pratikte hiç tutmuyordu: kelime sırası değişince tüm
// adaylar 0 puanla reddediliyor ve kullanıcı yanıltıcı bir "rakip yok"
// görüyordu. Yeni tahmin: marka + token örtüşmesi + spec çelişkisi kontrolü.
// Skor bilinçli olarak MIN_MATCH_SCORE'un ALTINDA tutulur (69): rakip listede
// görünür ama AI onayı olmadan karar hesaplarına girmez.
function fallbackMatch(sourceTitle: string, candidateTitle: string): MatchResult {
  const srcTokens = fallbackTokens(sourceTitle);
  const cndSet = new Set(fallbackTokens(candidateTitle));
  const overlap =
    srcTokens.length === 0 ? 0 : srcTokens.filter((t) => cndSet.has(t)).length / srcTokens.length;
  const brandShared = srcTokens.length > 0 && cndSet.has(srcTokens[0]);
  const specsConflict = hasConflictingSpecs(sourceTitle, candidateTitle);
  const likelySame = brandShared && overlap >= 0.5 && !specsConflict;
  return {
    isMatch: likelySame,
    score: likelySame ? MIN_MATCH_SCORE - 1 : 0,
    reason: likelySame
      ? "Başlık benzerliği yüksek — AI doğrulaması yapılamadı"
      : "AI doğrulaması yapılamadı; başlık benzerliği yetersiz",
    aiUnavailable: true,
    attributes: {
      brandMatch: brandShared,
      modelMatch: false,
      specMatch: !specsConflict,
      categoryMatch: false,
      details: "OpenAI API kullanılamadığı için deterministik tahmin kullanıldı",
    },
  };
}

// ============================================
// Enhanced Product Match Verification
// ============================================

export async function verifyProductMatch(
  sourceProduct: ProductInfo,
  candidate: ProductInfo,
): Promise<MatchResult> {
  // Deterministik emniyet kemeri (AI'dan bağımsız): ambalaj/koli/lojistik
  // ürünü bir tüketici ürünüyle asla eşleşmez. AI çağrısından ÖNCE çalışır —
  // hem maliyeti düşürür hem AI hatası/yanılgısında bile koruma sağlar.
  if (isPackagingListing(candidate.title, sourceProduct.title)) {
    return {
      isMatch: false,
      score: 0,
      reason: "Ambalaj/koli ürünü — otomatik red",
      attributes: {
        brandMatch: false,
        modelMatch: false,
        specMatch: false,
        categoryMatch: false,
        details: "Aday başlığı paketleme/lojistik malzemesi içeriyor",
      },
    };
  }

  // Deterministik KABUL: iki başlık uzun bir MPN/barkod (>=10) paylaşıyorsa
  // kesinlikle aynı üründür — AI'a sormaya gerek yok (maliyet + AI'nın aşırı
  // katı reddini de aşar). Kısa spec kodları (CPU/RAM) bu eşiğin altında.
  //
  // VARYANT GUARD'I: Aynı temel kodu paylaşan konfigürasyon varyantları
  // (83SC000QTR 16GB/512GB vs "…QTR 001" 20GB/512GB vs "…QTR 006" 16GB/1TB)
  // farklı SKU'lardır. Spec imzaları çelişiyorsa otomatik %95 verilmez;
  // kayıt şüpheli bandda (<70) kalır ve karar hesaplarına girmez.
  if (sharesStrongProductCode(sourceProduct.title, candidate.title)) {
    if (hasConflictingSpecs(sourceProduct.title, candidate.title)) {
      return {
        isMatch: false,
        score: 55,
        reason: "Aynı model kodu ama farklı donanım/kapasite varyantı",
        attributes: {
          brandMatch: true,
          modelMatch: true,
          specMatch: false,
          categoryMatch: true,
          details: "Ortak ürün kodu, çelişen spec imzası (RAM/depolama/hacim)",
        },
      };
    }
    return {
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
  if (!client) {
    return fallbackMatch(sourceProduct.title, candidate.title);
  }

  try {
    const prompt = `Sen bir e-ticaret ürün eşleştirme uzmanısın. İki ürünün AYNI ÜRÜN olup olmadığını belirle.

KAYNAK ÜRÜN:
- Başlık: "${sourceProduct.title}"
${sourceProduct.price ? `- Fiyat: ${sourceProduct.price} ₺` : ""}
${sourceProduct.marketplace ? `- Marketplace: ${sourceProduct.marketplace}` : ""}

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
12. FİYAT BÜYÜKLÜK SAĞDUYU: Kaynak fiyatı ${sourceProduct.price ?? "verilmedi"} ₺ ve aday fiyatı çok daha düşükse (örn: ¹/₁₀'undan az) yüksek olasılıkla farklı ürün/aksesuar/ambalajdır — score < 40 ver.
13. AYNI ÜRÜN — FARKLI SATICI/İLAN: Aynı ürün farklı pazaryerlerinde farklı kelime sırası, fazladan pazarlama sözcükleri ("orijinal", "hediyeli", "ücretsiz kargo", "outlet", "faturalı") veya küçük başlık farklarıyla listelenir. Marka + model + boyut/hacim/miktar AYNIYSA bu farklar ÖNEMSİZDİR ve ürün AYNI ÜRÜNDÜR (score >= ${MIN_MATCH_SCORE}). Rakip fiyatı kıyaslamanın amacı aynı ürünü farklı satıcıda bulmaktır; salt pazarlama veya söz dizimi farkı yüzünden eşleşmeyi reddetme. (Boyut/hacim/miktar farkı bu kuralın İSTİSNASIDIR — Kural 1 geçerli.)
14. EKSİK BİLGİ FARK DEĞİLDİR: Aday başlığında bir özellik (kapasite, fincan sayısı, hacim, renk vb.) HİÇ YAZMIYORSA bunu fark sayma ve "potansiyel/olası farklılık" gerekçesiyle skoru DÜŞÜRME. Yalnızca iki başlıkta AÇIKÇA yazan ve ÇELİŞEN değerler farklılıktır. Örn: kaynak "4 Fincan Kapasiteli" der, aday kapasite yazmaz → fark YOK; marka+model aynıysa AYNI ÜRÜNDÜR.
15. RENK VARYANTI = AYNI ÜRÜN: Renk adı ("Bakır" vs "Krom") ve model kodundaki renk eki (OK004 vs OK004-K, OK004-O, "-B") aynı modelin renk varyantıdır ve fiyat takibi amacıyla AYNI ÜRÜNDÜR (Kural 1'deki renk istisnası). Boyut/hacim/kapasite çelişkisi yoksa renk yüzünden reddetme.

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

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300,
      temperature: 0,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      logger.warn("Empty GPT response for match verification");
      return createFallbackResult(false, "AI yanıt vermedi");
    }

    const parsed = JSON.parse(content);
    const score = Math.min(100, Math.max(0, parseInt(parsed.score) || 0));

    // SCORE-BASED DECISION:
    // AI'nin isMatch field'ını nihai karar olarak kullanmıyoruz çünkü tutarsız çıktılar
    // (score=70 ama isMatch=false gibi) sayesinde aynı markalı ürünler kayboluyordu.
    // Tek source-of-truth: score >= MIN_MATCH_SCORE → isMatch=true.
    let finalScore = score;
    let finalIsMatch = score >= MIN_MATCH_SCORE;

    // Deterministic backstop (LLM-independent): a category mismatch is never the same product.
    if (finalIsMatch && parsed.categoryMatch === false) {
      finalIsMatch = false;
      finalScore = Math.min(finalScore, 39);
    }
    // Deterministic backstop: an extreme price ratio (>4x or <1/4) is almost never the same product.
    if (
      finalIsMatch &&
      typeof sourceProduct.price === "number" &&
      sourceProduct.price > 0 &&
      typeof candidate.price === "number"
    ) {
      const ratio = candidate.price / sourceProduct.price;
      if (ratio > 4 || ratio < 0.25) {
        finalIsMatch = false;
        finalScore = Math.min(finalScore, 39);
      }
    }

    // Tutarsızlık tespiti — gözlem amaçlı log (matcher davranışını izleyebilelim)
    if (parsed.isMatch === false && score >= MIN_MATCH_SCORE) {
      logger.info(
        {
          source: sourceProduct.title.slice(0, 80),
          candidate: candidate.title.slice(0, 80),
          score,
          aiIsMatch: parsed.isMatch,
        },
        "AI score override: AI isMatch=false ama score>=70, kabul edildi",
      );
    } else if (parsed.isMatch === true && score < MIN_MATCH_SCORE) {
      logger.info(
        {
          source: sourceProduct.title.slice(0, 80),
          candidate: candidate.title.slice(0, 80),
          score,
          aiIsMatch: parsed.isMatch,
        },
        "AI score override: AI isMatch=true ama score<70, reddedildi",
      );
    }

    const result: MatchResult = {
      isMatch: finalIsMatch,
      score: finalScore,
      reason: String(parsed.reason || "Açıklama yok").slice(0, 200),
      attributes: {
        brandMatch: parsed.brandMatch === true,
        modelMatch: parsed.modelMatch === true,
        specMatch: parsed.specMatch === true,
        categoryMatch: parsed.categoryMatch === true,
        details: String(parsed.details || "").slice(0, 300),
      },
    };

    logger.info(
      {
        source: sourceProduct.title.slice(0, 50),
        candidate: candidate.title.slice(0, 50),
        isMatch: result.isMatch,
        score: result.score,
      },
      "Match verification complete",
    );

    return result;
  } catch (error) {
    logger.error(
      { error, source: sourceProduct.title, candidate: candidate.title },
      "Match verification failed",
    );
    return createFallbackResult(false, "Eşleştirme hatası");
  }
}

// ============================================
// Fallback for API failures
// ============================================

function createFallbackResult(isMatch: boolean, reason: string): MatchResult {
  return {
    isMatch,
    score: isMatch ? 50 : 0,
    reason,
    aiUnavailable: true,
    attributes: {
      brandMatch: false,
      modelMatch: false,
      specMatch: false,
      categoryMatch: false,
      details: reason,
    },
  };
}

// ============================================
// Batch Match — verify multiple candidates efficiently
// ============================================

export async function batchVerifyMatches(
  sourceProduct: ProductInfo,
  candidates: ProductInfo[],
): Promise<Map<string, MatchResult>> {
  const results = new Map<string, MatchResult>();

  // Process in parallel with concurrency limit of 3
  const batchSize = 3;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((candidate) => verifyProductMatch(sourceProduct, candidate)),
    );

    batchResults.forEach((result, idx) => {
      const candidate = batch[idx];
      const key = candidate.url || candidate.title;
      if (result.status === "fulfilled") {
        results.set(key, result.value);
      } else {
        results.set(key, createFallbackResult(false, "API hatası"));
      }
    });
  }

  return results;
}
