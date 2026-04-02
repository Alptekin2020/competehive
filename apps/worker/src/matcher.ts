import OpenAI from "openai";
import { logger } from "./utils/logger";

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
// Minimum Score Threshold
// ============================================

const MIN_MATCH_SCORE = 70;

// ============================================
// Fallback string matcher (when OpenAI unavailable)
// ============================================

function fallbackMatch(sourceTitle: string, candidateTitle: string): MatchResult {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const src = normalize(sourceTitle);
  const cnd = normalize(candidateTitle);
  const isMatch = src.length > 5 && cnd.includes(src.slice(0, Math.floor(src.length * 0.6)));
  return {
    isMatch,
    score: isMatch ? 50 : 0,
    reason: isMatch ? "Metin benzerliği (AI kullanılamadı)" : "Metin eşleşmedi (AI kullanılamadı)",
    attributes: {
      brandMatch: false,
      modelMatch: false,
      specMatch: false,
      categoryMatch: false,
      details: "OpenAI API kullanılamadığı için fallback kullanıldı",
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
1. AYNI ÜRÜN = aynı marka, aynı model, aynı varyant (renk/boyut farklı olabilir)
2. Aksesuar, kılıf, cam, kablosu vs. orijinal ürünle AYNI DEĞİLDİR
3. Aynı markanın farklı modelleri AYNI DEĞİLDİR (ör: iPhone 15 ≠ iPhone 15 Pro)
4. Set/paket ürünler tekli ürünle AYNI DEĞİLDİR
5. Yenilenmiş/refurbished ürünler orijinaliyle farklı kabul edilebilir (skor düşük)
6. Fiyat farkı %200'den fazlaysa büyük olasılıkla farklı üründür — skor 30'un altında olmalı
7. Ambalaj, koli, kutu, aksesuar, kılıf gibi ürünler orijinal ürünle ASLA eşleşmez — skor 0 olmalı
8. Farklı kategorideki ürünler (ör: giyim vs. ambalaj, elektronik vs. aksesuar) ASLA eşleşmez — skor 0 olmalı

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
- 70-89: Büyük olasılıkla aynı ürün (küçük belirsizlikler var)
- 40-69: Belirsiz (benzer ama emin değilim)
- 10-39: Farklı ürün ama aynı kategoride
- 0-9: Tamamen alakasız ürün (farklı kategori, ambalaj, aksesuar vb.)`;

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

    const result: MatchResult = {
      isMatch: parsed.isMatch === true && (parsed.score ?? 0) >= MIN_MATCH_SCORE,
      score: Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
      reason: String(parsed.reason || "Açıklama yok").slice(0, 200),
      attributes: {
        brandMatch: parsed.brandMatch === true,
        modelMatch: parsed.modelMatch === true,
        specMatch: parsed.specMatch === true,
        categoryMatch: parsed.categoryMatch === true,
        details: String(parsed.details || "").slice(0, 300),
      },
    };

    // Apply threshold: even if AI says isMatch=true, reject if score < MIN_MATCH_SCORE
    if (parsed.isMatch === true && result.score < MIN_MATCH_SCORE) {
      result.isMatch = false;
      result.reason = `Skor eşiğinin altında (${result.score}/${MIN_MATCH_SCORE}): ${result.reason}`;
      logger.info(
        {
          source: sourceProduct.title,
          candidate: candidate.title,
          score: result.score,
        },
        "Match rejected: below threshold",
      );
    }

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
