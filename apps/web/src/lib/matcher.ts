import OpenAI from "openai";
import {
  MIN_MATCH_SCORE,
  PRICE_BAND_MIN_RATIO,
  PRICE_BAND_MAX_RATIO,
  withinPriceBand,
  compareProductCodes,
  hasConflictingCountDescriptors,
  hasConflictingSpecs,
  isPackagingListing,
  sharesStrongProductCode,
} from "@competehive/shared";
import { logger } from "./logger";

// AI'ın Kural 14'ü ihlal eden tipik red kalıpları — worker matcher ile aynı
// backstop politikası (apps/worker/src/matcher.ts). Aday başlıkta hiç yazmayan
// bir özelliği "farklı/eksik" sayan redler, deterministik spec/adet kontrolü
// temizse geri çevrilir.
const MISSING_INFO_REJECTION_RE =
  /belirtilmemi|belirtilmedi|eksik bilgi|bilgi yok|bilgi verilmemi|yazmıyor|yazmiyor|not specified|unspecified|kapasite fark|hacim fark|boyut fark|miktar fark|renk fark/i;

// Kısa model kodu kabulündeki marka teyidi için basit token folding — worker
// matcher'daki fallbackTokens ile aynı normalize kuralları.
function titleTokens(s: string): string[] {
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
14. EKSİK BİLGİ FARK DEĞİLDİR: Aday başlığında bir özellik (kapasite, fincan sayısı, hacim, renk vb.) HİÇ YAZMIYORSA bunu fark sayma ve "potansiyel/olası farklılık" gerekçesiyle skoru DÜŞÜRME. Yalnızca iki başlıkta AÇIKÇA yazan ve ÇELİŞEN değerler farklılıktır. Örn: kaynak "4 Fincan Kapasiteli" der, aday kapasite yazmaz → fark YOK; marka+model aynıysa AYNI ÜRÜNDÜR. "Adayda belirtilmemiş", "bilgi yok", "kapasite/hacim/boyut belirtilmemiş" ifadeleri ASLA red gerekçesi OLAMAZ — bu durumda o özellik için specMatch=true kabul et. Bu kuralı ihlal eden cevap HATALIDIR ve sistem tarafından geçersiz sayılır.
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

  // Eski %60-önek-içerme kuralı gerçek pazaryeri başlıklarında pratikte hiç
  // tutmuyordu (kelime sırası değişince tümü 0). Worker ile aynı token-örtüşme
  // tahmini kullanılır; skor bilinçli olarak eşiğin ALTINDA (69) tutulur ki AI
  // onayı olmadan karar hesaplarına girmesin.
  const fold = (s: string) =>
    s
      .replace(/[İIı]/g, "i")
      .replace(/[şŞ]/g, "s")
      .replace(/[çÇ]/g, "c")
      .replace(/[ğĞ]/g, "g")
      .replace(/[üÜ]/g, "u")
      .replace(/[öÖ]/g, "o")
      .toLowerCase();
  const tokens = (s: string) =>
    fold(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3);
  const srcTokens = tokens(sourceTitle);
  const cndSet = new Set(tokens(candidateTitle));
  const overlap =
    srcTokens.length === 0 ? 0 : srcTokens.filter((t) => cndSet.has(t)).length / srcTokens.length;
  const brandShared = srcTokens.length > 0 && cndSet.has(srcTokens[0]);
  const specsConflict = hasConflictingSpecs(sourceTitle, candidateTitle);
  const likelySame = brandShared && overlap >= 0.5 && !specsConflict;
  return {
    outcome: likelySame ? "match" : "reject",
    isMatch: likelySame,
    score: likelySame ? MIN_MATCH_SCORE - 1 : 0,
    reason: likelySame
      ? "Başlık benzerliği yüksek — AI doğrulaması yapılamadı"
      : "AI doğrulaması yapılamadı; başlık benzerliği yetersiz",
    attributes: emptyAttributes("OpenAI API kullanılamadığı için deterministik tahmin kullanıldı"),
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

  // Deterministik KOD ANALİZİ — worker matcher ile aynı politika
  // (apps/worker/src/matcher.ts): AI'dan önce ve AI'dan bağımsız çalışır.
  //
  // 1) KONFİGÜRASYON VARYANTI: aynı temel kod ama rakamlı alt-SKU eki
  //    (83SC000QTR vs "83SC000QTR 015" / "-001") → farklı SKU, %95 verilmez.
  // 2) EXACT / RENK VARYANTI: spec ve adet imzaları çelişmiyorsa deterministik
  //    kabul — uzun kod (>=10) %95; kısa model kodu (OK004, HD9650) marka
  //    teyidi + fiyat bandı sağlamasıyla %90.
  const codeRelation = compareProductCodes(source.title, candidate.title);
  if (codeRelation === "config-variant") {
    return {
      outcome: "reject",
      isMatch: false,
      score: 55,
      reason: "Aynı model ailesi ama farklı konfigürasyon varyantı (alt-SKU eki)",
      attributes: {
        brandMatch: true,
        modelMatch: true,
        specMatch: false,
        categoryMatch: true,
        details: "Ortak temel kod, rakamlı alt-SKU eki farklı (örn. 015/001/006)",
      },
    };
  }
  if (codeRelation === "exact" || codeRelation === "color-variant") {
    if (
      hasConflictingSpecs(source.title, candidate.title) ||
      hasConflictingCountDescriptors(source.title, candidate.title)
    ) {
      return {
        outcome: "reject",
        isMatch: false,
        score: 55,
        reason: "Aynı model kodu ama farklı donanım/kapasite varyantı",
        attributes: {
          brandMatch: true,
          modelMatch: true,
          specMatch: false,
          categoryMatch: true,
          details: "Ortak ürün kodu, çelişen spec imzası (RAM/depolama/hacim/adet)",
        },
      };
    }
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
    // Kısa model kodu (5-9 karakter) barkod kadar benzersiz değildir; marka
    // teyidi + fiyat bandı sağlamasıyla kabul edilir, sağlanmazsa karar AI'a kalır.
    const srcTokens = titleTokens(source.title);
    const brandShared =
      srcTokens.length > 0 && new Set(titleTokens(candidate.title)).has(srcTokens[0]);
    const priceOk =
      typeof source.price !== "number" ||
      source.price <= 0 ||
      typeof candidate.price !== "number" ||
      candidate.price <= 0 ||
      withinPriceBand(source.price, candidate.price);
    if (brandShared && priceOk) {
      return {
        outcome: "match",
        isMatch: true,
        score: 90,
        reason:
          codeRelation === "color-variant"
            ? "Aynı model kodu — renk varyantı (fiyat takibi için aynı ürün)"
            : "Aynı model kodu eşleşmesi (marka + kod)",
        attributes: {
          brandMatch: true,
          modelMatch: true,
          specMatch: true,
          categoryMatch: true,
          details: "Ortak model kodu + marka teyidi; spec/adet çelişkisi yok",
        },
      };
    }
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

    // KURAL 14 BACKSTOP'U — worker matcher ile aynı politika: AI, adayda hiç
    // yazmayan bir özelliği fark sayıp reddediyorsa ve deterministik spec/adet
    // kontrolü de temizse (marka+model+kategori AI'a göre aynı) red geri çevrilir.
    let finalReason = String(obj.reason ?? "Açıklama yok");
    if (
      !finalIsMatch &&
      finalScore >= 40 &&
      obj.brandMatch === true &&
      obj.modelMatch === true &&
      obj.categoryMatch === true &&
      MISSING_INFO_REJECTION_RE.test(finalReason) &&
      !hasConflictingSpecs(source.title, candidate.title) &&
      !hasConflictingCountDescriptors(source.title, candidate.title)
    ) {
      logger.info(
        {
          source: source.title.slice(0, 80),
          candidate: candidate.title.slice(0, 80),
          score: finalScore,
          aiReason: finalReason.slice(0, 120),
        },
        "Kural 14 backstop: 'eksik bilgi' reddi geri çevrildi",
      );
      finalIsMatch = true;
      finalScore = MIN_MATCH_SCORE;
      finalReason = "Marka+model aynı; eksik bilgi fark sayılmaz (Kural 14 düzeltmesi)";
    }

    return {
      outcome: finalIsMatch ? "match" : "reject",
      isMatch: finalIsMatch,
      score: finalScore,
      reason: finalReason.slice(0, 200),
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
