import { readMetadataGtin } from "@competehive/shared";

type Metadata = Record<string, unknown>;

export interface BarcodeUpdate {
  metadata: Metadata;
  /** Ürünün etkin barkodu değişti mi (worker'ın okuyacağı değer). */
  changed: boolean;
  /** Yeni bir barkod girildi: rakipler barkodla yeniden aranmalı. */
  shouldSearch: boolean;
  /**
   * Ürünün ilanından okunmuş (kullanıcının girmediği) farklı bir barkodun
   * yerine yazıldı: kullanıcı uyarılır, iki barkoddan biri yanlış olabilir.
   */
  replacedListingGtin: string | null;
}

function asMetadata(value: unknown): Metadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Metadata) }
    : {};
}

/**
 * Kullanıcının girdiği barkodu ürün metadata'sına yazar. null barkodu siler:
 * worker `gtin`, `ean`, `barcode`, `gtin13` anahtarlarını sırayla okuduğu için
 * hepsi temizlenir, yoksa eski bir değer etkin kalırdı.
 */
export function applyBarcodeToMetadata(current: unknown, gtin: string | null): BarcodeUpdate {
  const before = readMetadataGtin(current);
  const metadata = asMetadata(current);
  const beforeFromListing = before !== null && metadata.gtinSource !== "user";
  if (gtin) {
    metadata.gtin = gtin;
    metadata.gtinSource = "user";
  } else {
    for (const key of ["gtin", "ean", "barcode", "gtin13", "gtinSource"]) delete metadata[key];
  }
  const after = readMetadataGtin(metadata);
  const changed = before !== after;
  // Eski barkodun "başka ürüne ait olabilir" uyarısı yeni barkoda taşınmaz.
  if (changed) delete metadata.gtinWarning;
  return {
    metadata,
    changed,
    shouldSearch: changed && after !== null,
    replacedListingGtin: beforeFromListing && after !== null && changed ? before : null,
  };
}

export interface BarcodeWarning {
  at: string;
  mismatches: number;
  samples: string[];
}

/**
 * Worker'ın yazdığı uyarı (`metadata.gtinWarning`): bu barkod son keşif
 * turunda yalnızca başka ürünlerin ilanlarında çıktı. Bozuk veri null.
 */
export function readBarcodeWarning(metadata: unknown): BarcodeWarning | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const raw = (metadata as Metadata).gtinWarning;
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.at !== "string" || typeof w.mismatches !== "number") return null;
  const samples = Array.isArray(w.samples)
    ? w.samples.filter((x): x is string => typeof x === "string").slice(0, 3)
    : [];
  return { at: w.at, mismatches: w.mismatches, samples };
}
