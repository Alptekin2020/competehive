import OpenAI from "openai";
import { logger } from "./utils/logger";
import { directFetch } from "./utils/direct-fetch";
import { cleanProductTitle } from "./utils/search-queries";
import {
  MIN_MATCH_SCORE,
  compareProductCodes,
  hasConflictingCountDescriptors,
  hasConflictingSpecs,
  isAccessoryListing,
  isPackagingListing,
  sharesStrongProductCode,
  withinPriceBand,
} from "./utils/competitor-quality";
import {
  analyzeModelIdentity,
  hasColourOrShadeConflict,
  type ModelIdentity,
  type ModelIdentityAnalysis,
} from "./utils/model-identity";
import { isGoogleHostedUrl } from "./utils/stale-competitors";
import {
  hasPackOrSpecConflict,
  isNearIdenticalTitle,
  isSourceSubsetTitle,
  isStrongTitleOverlap,
  urlSlugText,
} from "./utils/title-similarity";

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      return null;
    }
    // directFetch: scraping proxy'sini baypas eder (bkz. utils/direct-fetch.ts).
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      fetch: directFetch,
      timeout: 30_000,
      maxRetries: 2,
    });
  }
  return openai;
}

// AI'ın Kural 14'ü ihlal eden tipik red kalıpları: aday başlıkta hiç yazmayan
// bir özelliği "farklı/eksik" sayması. reason Türkçe üretilir; hem aksanlı hem
// ascii yazımlar kapsanır. Kural 14 backstop'u yalnızca deterministik spec/adet
// kontrolü de temizse devreye girer — gerçek çelişkiler asla geri çevrilmez.
const MISSING_INFO_REJECTION_RE =
  /belirtilmemi|belirtilmedi|eksik bilgi|bilgi yok|bilgi verilmemi|yazmıyor|yazmiyor|not specified|unspecified|kapasite fark|hacim fark|boyut fark|miktar fark|renk fark|farkl[ıi]\s+(?:hacim|miktar|boyut|kapasite|gramaj)/i;

// AI'ın FİYATI ürün kimliği kanıtı sayan red kalıpları ("Farklı fiyat ve model
// bilgisi", "fiyat aralığı farklı"). Fiyat artık prompt'a hiç verilmiyor; bu
// regex yalnızca modelin yine de fiyattan söz ettiği durumlar için emniyet.
const PRICE_BASED_REJECTION_RE = /fiyat/i;

// ============================================
// Types
// ============================================

export interface MatchResult {
  isMatch: boolean;
  score: number; // 0-100
  reason: string; // Turkish explanation
  /** AI doğrulaması yapılamadı (anahtar yok / API hatası) — karar güvenilmez. */
  aiUnavailable?: boolean;
  /** Deterministik model kimliği karşılaştırması (bkz. utils/model-identity.ts). */
  modelIdentity?: ModelIdentity;
  attributes: {
    brandMatch: boolean;
    modelMatch: boolean;
    specMatch: boolean;
    categoryMatch: boolean;
    details: string;
    /**
     * Kabulün dayanağı (yalnızca isMatch=true): "model-code" ortak model
     * kodu / benzersiz ürün kodu, "title" başlık ya da AI kabulü. Fiyat bandı
     * matchAttributes.matchBasis'i okur (model-code geniş, title dar bant).
     */
    matchBasis?: "model-code" | "title";
  };
}

export interface ProductInfo {
  title: string;
  url?: string;
  price?: number;
  marketplace?: string;
}

// ============================================
// Deterministik başlık kabulü (AI çağrısı yok)
// ============================================

const NEAR_IDENTICAL_REASON = "Başlıklar neredeyse aynı (marka ve ürün adı birebir örtüşüyor)";
const STRONG_OVERLAP_REASON = "Başlıklar büyük oranda aynı; belirgin bir fark bulunamadı";

/** Kimliği doğrulanamayan adayın ulaşabileceği en yüksek skor (onay bekler). */
const UNKNOWN_IDENTITY_MAX_SCORE = MIN_MATCH_SCORE - 1;
/** Google kartında kimlik doğrulanamıyorsa: aday bile saklanmaz (<50). */
const UNVERIFIABLE_GOOGLE_SCORE = 45;

function identityOf(source: ProductInfo, candidate: ProductInfo): ModelIdentityAnalysis {
  return analyzeModelIdentity(
    { title: source.title, url: source.url },
    { title: candidate.title, url: candidate.url },
  );
}

/**
 * Model kodu/numarası/ekran boyutu kesin farklıysa ya da (Google kartında)
 * hiç doğrulanamıyorsa AI'a sormadan verilecek red. null → devam.
 */
function identityRejection(
  identity: ModelIdentityAnalysis,
  candidate: ProductInfo,
): MatchResult | null {
  let score: number;
  let reason: string;
  if (identity.relation === "conflict") {
    score = 20;
    reason = identity.reason;
  } else if (identity.relation === "config-variant") {
    score = 30;
    reason = identity.reason;
  } else if (identity.relation === "unknown" && isGoogleHostedUrl(candidate.url)) {
    // Google ürün kartı taranamaz ve slug taşımaz: kod hiçbir zaman
    // doğrulanamaz. Onaya sunulmaz (prod: EP3347/90 ↔ EP3341/50 kartı).
    score = UNVERIFIABLE_GOOGLE_SCORE;
    reason = `${identity.reason}; Google kartı doğrulanamaz`;
  } else {
    return null;
  }
  return {
    isMatch: false,
    score,
    reason,
    modelIdentity: identity.relation,
    attributes: {
      brandMatch: true,
      modelMatch: false,
      specMatch: false,
      categoryMatch: true,
      details: `Kaynak kod: ${identity.sourceCodes.join(", ") || "-"}; aday kod: ${identity.candidateCodes.join(", ") || "-"}`,
    },
  };
}

function logDeterministicAccept(
  path: string,
  source: ProductInfo,
  candidate: ProductInfo,
  score: number,
  identity: ModelIdentity,
): void {
  logger.info(
    {
      path,
      score,
      identity,
      source: source.title,
      candidate: candidate.title,
      url: candidate.url,
    },
    "Deterministic match accept",
  );
}

/**
 * Daha önce AI'ın emin olamadığı (50–69) bir adayı yalnızca deterministik
 * başlık kurallarıyla yeniden değerlendirir. verifyProductMatch içindeki iki
 * kabul yolunun aynısıdır (neredeyse aynı başlık → 88; güçlü örtüşme → 75),
 * AI'a tekrar sormaz. Onay bekleyen adayların, kurallar sonradan iyileştiğinde
 * kullanıcı tek tek onaylamadan kabul edilebilmesi için kullanılır.
 */
export function reevaluateUncertainMatch(
  sourceProduct: ProductInfo,
  candidate: ProductInfo,
  previous: { score: number | null; categoryMatch?: boolean | null },
): MatchResult | null {
  if (isPackagingListing(candidate.title, sourceProduct.title)) return null;
  if (isAccessoryListing(candidate.title, sourceProduct.title)) return null;
  const cleanedSource = cleanProductTitle(sourceProduct.title);
  const cleanedCandidate = cleanProductTitle(candidate.title);
  if (cleanedSource.length < 3 || cleanedCandidate.length < 3) return null;
  if (
    typeof sourceProduct.price === "number" &&
    sourceProduct.price > 0 &&
    typeof candidate.price === "number" &&
    candidate.price > 0 &&
    !withinPriceBand(sourceProduct.price, candidate.price)
  ) {
    return null;
  }
  if (hasPackOrSpecConflict(cleanedSource, urlSlugText(candidate.url))) return null;
  // Model kimliği doğrulanmadan (farklı kod ya da adayda kod yok) yükseltme yok.
  const identity = identityOf(sourceProduct, candidate);
  if (identity.relation !== "same" && identity.relation !== "none") return null;

  const accept = (score: number, reason: string): MatchResult => {
    logDeterministicAccept("reevaluate", sourceProduct, candidate, score, identity.relation);
    return {
      isMatch: true,
      score,
      reason,
      modelIdentity: identity.relation,
      attributes: {
        brandMatch: true,
        modelMatch: true,
        specMatch: true,
        categoryMatch: true,
        details: "Deterministik başlık örtüşmesi; spec/adet/kod çelişkisi yok",
        matchBasis: "title",
      },
    };
  };

  if (
    isNearIdenticalTitle(cleanedSource, cleanedCandidate) ||
    isSourceSubsetTitle(cleanedSource, cleanedCandidate)
  ) {
    return accept(88, NEAR_IDENTICAL_REASON);
  }
  if (
    previous.score !== null &&
    previous.score >= 50 &&
    previous.score < MIN_MATCH_SCORE &&
    previous.categoryMatch !== false &&
    isStrongTitleOverlap(cleanedSource, cleanedCandidate)
  ) {
    return accept(75, STRONG_OVERLAP_REASON);
  }
  return null;
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
function fallbackMatch(
  sourceTitle: string,
  candidateTitle: string,
  identity: ModelIdentity,
): MatchResult {
  const srcTokens = fallbackTokens(sourceTitle);
  const cndSet = new Set(fallbackTokens(candidateTitle));
  const overlap =
    srcTokens.length === 0 ? 0 : srcTokens.filter((t) => cndSet.has(t)).length / srcTokens.length;
  const brandShared = srcTokens.length > 0 && cndSet.has(srcTokens[0]);
  const specsConflict = hasConflictingSpecs(sourceTitle, candidateTitle);
  // Model kimliği doğrulanamıyorsa (kaynakta kod var, adayda yok) başlık
  // benzerliği tek başına "muhtemelen aynı" demeye yetmez.
  const identityOk = identity === "same" || identity === "none";
  const likelySame = brandShared && overlap >= 0.5 && !specsConflict && identityOk;
  return {
    isMatch: likelySame,
    score: likelySame ? MIN_MATCH_SCORE - 1 : 0,
    reason: likelySame
      ? "Başlık benzerliği yüksek — AI doğrulaması yapılamadı"
      : "AI doğrulaması yapılamadı; başlık benzerliği yetersiz",
    aiUnavailable: true,
    modelIdentity: identity,
    attributes: {
      brandMatch: brandShared,
      modelMatch: false,
      specMatch: !specsConflict,
      categoryMatch: false,
      details: "OpenAI API kullanılamadığı için deterministik tahmin kullanıldı",
      ...(likelySame ? { matchBasis: "title" as const } : {}),
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

  // MODEL KİMLİĞİ (AI'dan önce): başlık + URL slug'ındaki model kodu, model
  // numarası (A55/A56, iPhone 15/16, 3300 Serisi) ve ekran boyutu farklıysa
  // aday farklı üründür; AI'a sorulmaz, onaya da sunulmaz (skor ≤30).
  const identity = identityOf(sourceProduct, candidate);
  const identityRejected = identityRejection(identity, candidate);
  if (identityRejected) {
    logger.info(
      {
        source: sourceProduct.title,
        candidate: candidate.title,
        url: candidate.url,
        identity: identity.relation,
        score: identityRejected.score,
      },
      "Model identity rejection",
    );
    return identityRejected;
  }
  // Kaynakta model kodu var ama aday doğrulamıyor: deterministik kabul ve
  // backstop yükseltmesi yok, skor en fazla 69 (kullanıcı onayı beklenir).
  const identityUnknown = identity.relation === "unknown";

  // Deterministik KOD ANALİZİ — AI'dan önce ve AI'dan bağımsız çalışır.
  //
  // 1) KONFİGÜRASYON VARYANTI: aynı temel kod ama rakamlı alt-SKU eki
  //    (83SC000QTR vs "83SC000QTR 015" / "-001"). Spec imzası çelişmese bile
  //    (FreeDOS vs Windows 11 Pro) FARKLI SKU'dur; %95 kabulünden ÖNCE
  //    yakalanır ve kayıt şüpheli bandda (<70) kalır.
  // 2) EXACT / RENK VARYANTI: spec ve adet imzaları çelişmiyorsa deterministik
  //    kabul — uzun kod (>=10, MPN/barkod) %95; kısa model kodu (OK004,
  //    HD9650) marka teyidi + fiyat bandı sağlamasıyla %90. Bu yol, AI'ın
  //    "kapasite belirtilmemiş" tarzı kural-14-ihlali redlerini (prod: Arzum
  //    OK004 — birebir aynı makineler 81 kez reddedildi) devre dışı bırakır.
  const codeRelation = compareProductCodes(sourceProduct.title, candidate.title);
  if (codeRelation === "config-variant") {
    return {
      isMatch: false,
      score: 30,
      modelIdentity: "config-variant",
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
  // AKSESUAR GUARD'I: ana ürünün kodunu taşıyan ilan ürünün kendisi olmayabilir
  // ("OK004 ... MAKİNESİ İÇİN ORİJİNAL CEZVE GRUBU" — prod'da %90 alıp ₺1.450
  // ile "en düşük rakip" oldu). Aksesuar görünümünde deterministik kabul
  // ATLANIR; karar AI'a kalır ve Kural 2/11 aksesuarı reddeder.
  const accessoryLike = isAccessoryListing(candidate.title, sourceProduct.title);
  if ((codeRelation === "exact" || codeRelation === "color-variant") && !accessoryLike) {
    if (
      hasConflictingSpecs(sourceProduct.title, candidate.title) ||
      hasConflictingCountDescriptors(sourceProduct.title, candidate.title)
    ) {
      return {
        isMatch: false,
        score: 30,
        modelIdentity: "config-variant",
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
    if (sharesStrongProductCode(sourceProduct.title, candidate.title)) {
      logDeterministicAccept("strong-code", sourceProduct, candidate, 95, identity.relation);
      return {
        isMatch: true,
        score: 95,
        modelIdentity: identity.relation,
        reason: "Aynı ürün kodu (MPN/barkod) eşleşmesi",
        attributes: {
          brandMatch: true,
          modelMatch: true,
          specMatch: true,
          categoryMatch: true,
          details: "Ortak benzersiz ürün kodu",
          matchBasis: "model-code",
        },
      };
    }
    // Kısa model kodu (5-9 karakter) barkod kadar benzersiz değildir; marka
    // teyidi + fiyat bandı sağlamasıyla kabul edilir, sağlanmazsa karar AI'a kalır.
    const srcTokens = fallbackTokens(sourceProduct.title);
    const brandShared =
      srcTokens.length > 0 && new Set(fallbackTokens(candidate.title)).has(srcTokens[0]);
    const priceOk =
      typeof sourceProduct.price !== "number" ||
      sourceProduct.price <= 0 ||
      typeof candidate.price !== "number" ||
      candidate.price <= 0 ||
      withinPriceBand(sourceProduct.price, candidate.price);
    if (brandShared && priceOk) {
      logDeterministicAccept("model-code", sourceProduct, candidate, 90, identity.relation);
      return {
        isMatch: true,
        score: 90,
        modelIdentity: identity.relation,
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
          matchBasis: "model-code",
        },
      };
    }
  }

  // NEREDEYSE AYNI BAŞLIK: model kodu olmayan ürünlerde (gıda, takviye,
  // kozmetik) yukarıdaki kod yolu çalışmaz ve karar AI'a kalırdı; AI ise
  // birebir aynı başlığı bile reddedebiliyor (prod: "Kahve Dünyası Tambol
  // Çilekli Milföy Dolgulu 100 gr" ↔ aynı başlık → 30 puan, ürün 0 rakip).
  // Marka ortak, sözcüklerin büyük çoğunluğu iki yönde de örtüşüyor ve hiçbir
  // çelişki/varyant sinyali yoksa AI'a sorulmadan kabul edilir.
  const cleanedSource = cleanProductTitle(sourceProduct.title);
  const cleanedCandidate = cleanProductTitle(candidate.title);
  const priceInBand =
    typeof sourceProduct.price !== "number" ||
    sourceProduct.price <= 0 ||
    typeof candidate.price !== "number" ||
    candidate.price <= 0 ||
    withinPriceBand(sourceProduct.price, candidate.price);
  // Arama sonucu başlıkları kısaltılmış gelebilir; paket bilgisi çoğu zaman URL
  // yolunda durur ("…100-g-7-li-paket"). URL çelişki gösteriyorsa deterministik
  // kabul yapılmaz, karar AI'a kalır.
  const urlConflict = hasPackOrSpecConflict(cleanedSource, urlSlugText(candidate.url));
  if (
    !identityUnknown &&
    !urlConflict &&
    priceInBand &&
    (isNearIdenticalTitle(cleanedSource, cleanedCandidate) ||
      isSourceSubsetTitle(cleanedSource, cleanedCandidate))
  ) {
    logDeterministicAccept("near-identical", sourceProduct, candidate, 88, identity.relation);
    return {
      isMatch: true,
      score: 88,
      modelIdentity: identity.relation,
      reason: NEAR_IDENTICAL_REASON,
      attributes: {
        brandMatch: true,
        modelMatch: true,
        specMatch: true,
        categoryMatch: true,
        details: "Deterministik başlık örtüşmesi; spec/adet/kod çelişkisi yok",
        matchBasis: "title",
      },
    };
  }

  const client = getOpenAIClient();
  if (!client) {
    return fallbackMatch(sourceProduct.title, candidate.title, identity.relation);
  }

  try {
    // Pazaryeri SEO ekleri ("... Fiyatları ve Özellikleri") ürün kimliği değildir.
    const sourceTitle = cleanedSource;
    const candidateTitle = cleanedCandidate;

    // FİYAT BİLEREK VERİLMEZ. Bu aracın işi aynı ürünü FARKLI fiyatla satan
    // rakibi bulmaktır; fiyatı gören model farkı "farklı ürün" kanıtı sayıyordu
    // (prod: "iCollagen 60 Tablet — Farklı fiyat ve boyut/miktar", "Oral-B
    // Vitality Pro — Farklı fiyat ve model bilgisi var" → aynı ürünler
    // reddedildi, kullanıcı "rakip yok" gördü). Fiyat sağduyusu deterministik
    // olarak kodda uygulanır: keşifte 0.3x–3x bandı, aşağıda 4x backstop'u.
    const prompt = `Sen bir e-ticaret ürün eşleştirme uzmanısın. İki ürünün AYNI ÜRÜN olup olmadığını YALNIZCA başlıklara bakarak belirle.

KAYNAK ÜRÜN:
- Başlık: "${sourceTitle}"
${sourceProduct.marketplace ? `- Marketplace: ${sourceProduct.marketplace}` : ""}

ADAY ÜRÜN:
- Başlık: "${candidateTitle}"
${candidate.marketplace ? `- Marketplace: ${candidate.marketplace}` : ""}

KURALLAR:
1. AYNI ÜRÜN = aynı marka + aynı model + aynı boyut/hacim/miktar/kapasite. Renk farkı önemli değildir (aynı üründür); ama BOYUT/HACİM/MİKTAR/KAPASİTE farkı FARKLI ÜRÜNDÜR — 10ml ≠ 20ml, 50cm ≠ 70cm, 128GB ≠ 256GB, tekli ≠ 2'li paket, 1L ≠ 2L.
2. Aksesuar, kılıf, cam, kablosu vs. orijinal ürünle AYNI DEĞİLDİR. Bir ürün "İÇİN" üretilen parçalar (cezve grubu, yedek hazne, filtre, kapak, şarj aleti) o ürünün KENDİSİ DEĞİLDİR — başlık ana ürünün model kodunu içerse bile categoryMatch=false ve score < 40 ver.
3. Aynı markanın farklı modelleri AYNI DEĞİLDİR (ör: iPhone 15 ≠ iPhone 15 Pro)
4. Set/paket ürünler tekli ürünle AYNI DEĞİLDİR
5. Yenilenmiş/refurbished ürünler orijinaliyle farklı kabul edilebilir (skor düşük)
6. FİYAT ÜRÜN KİMLİĞİ DEĞİLDİR: Sana fiyat verilmedi; fiyat hakkında tahmin yürütme ve "farklı fiyat", "fiyat aralığı farklı" gibi bir gerekçe ASLA yazma. Aynı ürün farklı satıcıda farklı fiyata satılır — amaç tam da bunu bulmaktır.
7. PAKETLEME/AMBALAJ İSTİSNASI: Aday başlığında "koli", "kutu", "kutusu", "ambalaj", "ambalajı", "paket", "paketleme", "carton", "kargo poşeti", "stretch film", "bant", "etiket", "kraft" gibi paketleme/ambalaj/lojistik malzemesi sözcükleri varsa VE kaynak ürün ayakkabı, terlik, telefon, ev aleti gibi son tüketici ürünüyse: score=0 ve isMatch=false ver. "kolikutugelsin", "bojopack", "packmore", "kolicim", "kolicixx" gibi mağaza/marka adlarında "koli", "pack", "paket" geçenler ambalaj satıcısıdır — skor=0.
8. KRİTİK MARKA TUTARLILIĞI: Eğer marka adı (Karaca, Apple, Samsung, Nike, Beko, Arzum, Sinbo vb.) HEM kaynak HEM aday başlığında AYNI şekilde geçiyorsa, brandMatch=true OLMAK ZORUNDA. "aynı marka değil" reasoning'i veremezsin marka adı iki başlıkta da varsa. Bu kuralı ihlal etmek tutarsız cevap üretmek demektir. ANCAK marka adının başlıkta geçmesi yalnız başına eşleşme demek değildir — kategori/tip eşleşmesi de zorunludur (Kural 11).
9. SKOR-İSMATCH TUTARLILIĞI: Eğer score >= ${MIN_MATCH_SCORE} ise isMatch=true OLMAK ZORUNDA. score < ${MIN_MATCH_SCORE} ise isMatch=false OLMAK ZORUNDA. score ve isMatch çelişemez.
10. KİTAP/MEDYA İSTİSNASI: Kaynak ürün kitap değilse ama aday başlığı "kitap", "roman", "öykü", "dergi", "nadirkitap", "idefix", "bkmkitap" içeriyorsa: score=0 ve isMatch=false.
11. ÜRÜN TİPİ/KATEGORİ ZORUNLULUĞU: Kaynak ürünün kategorisi (terlik, ayakkabı, telefon, laptop, ütü, kahve, terlik, bardak vs.) ile aday ürünün kategorisi açıkça farklıysa (örn: "terlik" vs "kutu/ambalaj"; "telefon" vs "kılıf"; "kahve" vs "kahve makinesi"), categoryMatch=false ve score < 40 olmak ZORUNDA. Aynı marka olması yeterli değildir.
12. KISA BAŞLIK = EKSİK BİLGİ: Aday başlığı kaynağın kısaltılmış hâliyse ("Oral-B Vitality Pro" ↔ "Oral-B Şarjlı Vitality Pro Koruma ve Temizlik Elektrikli Diş Fırçası") ve aday başlığında kaynakla ÇELİŞEN hiçbir kelime yoksa AYNI ÜRÜNDÜR. Adayda kaynakta OLMAYAN ek bir model/seri/varyant adı ("Kids", "Frozen", "Cross Action", "Plus", "Pro", "2'li", "Set") varsa farklı üründür.
13. AYNI ÜRÜN — FARKLI SATICI/İLAN: Aynı ürün farklı pazaryerlerinde farklı kelime sırası, fazladan pazarlama sözcükleri ("orijinal", "hediyeli", "ücretsiz kargo", "outlet", "faturalı") veya küçük başlık farklarıyla listelenir. Marka + model + boyut/hacim/miktar AYNIYSA bu farklar ÖNEMSİZDİR ve ürün AYNI ÜRÜNDÜR (score >= ${MIN_MATCH_SCORE}). Rakip fiyatı kıyaslamanın amacı aynı ürünü farklı satıcıda bulmaktır; salt pazarlama veya söz dizimi farkı yüzünden eşleşmeyi reddetme. (Boyut/hacim/miktar farkı bu kuralın İSTİSNASIDIR — Kural 1 geçerli.)
14. EKSİK BİLGİ FARK DEĞİLDİR: Aday başlığında bir özellik (kapasite, fincan sayısı, hacim, renk vb.) HİÇ YAZMIYORSA bunu fark sayma ve "potansiyel/olası farklılık" gerekçesiyle skoru DÜŞÜRME. Yalnızca iki başlıkta AÇIKÇA yazan ve ÇELİŞEN değerler farklılıktır. Örn: kaynak "4 Fincan Kapasiteli" der, aday kapasite yazmaz → fark YOK; marka+model aynıysa AYNI ÜRÜNDÜR. "Adayda belirtilmemiş", "bilgi yok", "kapasite/hacim/boyut belirtilmemiş" ifadeleri ASLA red gerekçesi OLAMAZ — bu durumda o özellik için specMatch=true kabul et. Bu kuralı ihlal eden cevap HATALIDIR ve sistem tarafından geçersiz sayılır.
15. RENK VARYANTI = AYNI ÜRÜN: Renk adı ("Bakır" vs "Krom") ve model kodundaki renk eki (OK004 vs OK004-K, OK004-O, "-B") aynı modelin renk varyantıdır ve fiyat takibi amacıyla AYNI ÜRÜNDÜR (Kural 1'deki renk istisnası). Boyut/hacim/kapasite çelişkisi yoksa renk yüzünden reddetme.

16. "X'i 1 ARADA" MİKTAR DEĞİLDİR: "2'si 1 arada", "3'ü 1 arada", "2in1", "3 in 1", "5 Tip" gibi ifadeler ürünün ÖZELLİĞİDİR; hacim, adet veya paket bilgisi DEĞİLDİR. Bunları "farklı hacim/miktar" gerekçesi yapma; yalnızca gerçek ölçüler (ml, gr, tablet, adet) karşılaştırılır.
17. ÜRETİCİ + ÜRÜN MARKASI: Bazı ilanlar ürün markasının önüne üretici/firma adını yazar ("Doctamin iCollagen 60 Tablet" ↔ "iCollagen 60 Tablet", "Eczacıbaşı Selpak" ↔ "Selpak"). Kaynaktaki marka adı aday başlığında da geçiyorsa, adaydaki ek üretici adı "farklı marka" DEĞİLDİR; brandMatch=true ver ve ürünü diğer kurallara göre değerlendir.

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

    // KURAL 14 BACKSTOP'U (deterministik): AI, adayda HİÇ YAZMAYAN bir özelliği
    // ("kapasite belirtilmemiş", "4 fincan vs belirtilmemiş") fark sayıp
    // reddedebiliyor — prompt'taki Kural 14'e rağmen (prod: Arzum OK004,
    // birebir aynı makineler 81 kez bu gerekçeyle reddedildi). Marka+model+
    // kategori AI'a göre de aynıysa VE başlıklarda deterministik olarak
    // doğrulanabilir hiçbir spec/adet çelişkisi yoksa red geri çevrilir:
    // politika prompt'a değil koda emanet edilir.
    const aiReason = String(parsed.reason || "");
    const candidateIdentityText = `${candidate.title} ${urlSlugText(candidate.url)}`;
    if (
      !identityUnknown &&
      !finalIsMatch &&
      finalScore >= 40 &&
      parsed.brandMatch === true &&
      parsed.modelMatch === true &&
      parsed.categoryMatch === true &&
      (MISSING_INFO_REJECTION_RE.test(aiReason) || PRICE_BASED_REJECTION_RE.test(aiReason)) &&
      !isAccessoryListing(candidate.title, sourceProduct.title) &&
      !hasConflictingSpecs(sourceProduct.title, candidate.title) &&
      !hasConflictingCountDescriptors(sourceProduct.title, candidate.title) &&
      // Renk/ton varyantı (Oral-B Vitality Pro Lila ↔ Siyah) yükseltilmez.
      !hasColourOrShadeConflict(sourceProduct.title, candidateIdentityText)
    ) {
      logger.info(
        {
          source: sourceProduct.title,
          candidate: candidate.title,
          url: candidate.url,
          score: finalScore,
          aiReason: aiReason.slice(0, 120),
        },
        "Kural 14 backstop: 'eksik bilgi'/'fiyat' reddi geri çevrildi",
      );
      logDeterministicAccept(
        "rule14",
        sourceProduct,
        candidate,
        MIN_MATCH_SCORE,
        identity.relation,
      );
      finalIsMatch = true;
      finalScore = MIN_MATCH_SCORE;
      parsed.reason = "Marka+model aynı; eksik bilgi veya fiyat farkı ürün farkı sayılmaz";
    }

    // GÜÇLÜ BAŞLIK ÖRTÜŞMESİ BACKSTOP'U: AI "benzer ama emin değilim" (50–69)
    // dedi, kategori aynı ve başlıklar deterministik olarak büyük oranda
    // örtüşüyor, çelişki yok → kabul. Prod: "icollagen 5 Tip Kolajen Ve
    // Prebiyotik 60 Tablet" ve "icollagen Kolajen Ve Prebiyotik Tablet" 60
    // puanda kaldı ("farklı model isimleri") ve ürün 0 rakiple bitti.
    if (
      !identityUnknown &&
      !finalIsMatch &&
      finalScore >= 50 &&
      parsed.categoryMatch !== false &&
      priceInBand &&
      !urlConflict &&
      isStrongTitleOverlap(cleanedSource, cleanedCandidate)
    ) {
      logger.info(
        {
          source: sourceProduct.title.slice(0, 80),
          candidate: candidate.title.slice(0, 80),
          score: finalScore,
          aiReason: aiReason.slice(0, 120),
        },
        "Title overlap backstop: uncertain AI score accepted",
      );
      logDeterministicAccept("title-overlap", sourceProduct, candidate, 75, identity.relation);
      finalIsMatch = true;
      finalScore = 75;
      parsed.reason = STRONG_OVERLAP_REASON;
    }

    // Model kodu doğrulanamayan aday AI ne derse desin güvenilir sayılmaz:
    // en fazla 69 (onay bekleyen olası eşleşme).
    if (identityUnknown && finalScore > UNKNOWN_IDENTITY_MAX_SCORE) {
      logger.info(
        {
          source: sourceProduct.title,
          candidate: candidate.title,
          url: candidate.url,
          score: finalScore,
        },
        "Model identity unknown: AI score capped",
      );
      finalScore = UNKNOWN_IDENTITY_MAX_SCORE;
      finalIsMatch = false;
      parsed.reason = identity.reason;
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
      modelIdentity: identity.relation,
      reason: String(parsed.reason || "Açıklama yok").slice(0, 200),
      attributes: {
        brandMatch: parsed.brandMatch === true,
        modelMatch: parsed.modelMatch === true,
        specMatch: parsed.specMatch === true,
        categoryMatch: parsed.categoryMatch === true,
        details: String(parsed.details || "").slice(0, 300),
        ...(finalIsMatch ? { matchBasis: "title" as const } : {}),
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
