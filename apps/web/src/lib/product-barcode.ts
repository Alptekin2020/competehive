import { readMetadataGtin } from "@competehive/shared";

type Metadata = Record<string, unknown>;

export interface BarcodeUpdate {
  metadata: Metadata;
  /** Ürünün etkin barkodu değişti mi (worker'ın okuyacağı değer). */
  changed: boolean;
  /** Yeni bir barkod girildi: rakipler barkodla yeniden aranmalı. */
  shouldSearch: boolean;
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
  if (gtin) {
    metadata.gtin = gtin;
    metadata.gtinSource = "user";
  } else {
    for (const key of ["gtin", "ean", "barcode", "gtin13", "gtinSource"]) delete metadata[key];
  }
  const after = readMetadataGtin(metadata);
  const changed = before !== after;
  return { metadata, changed, shouldSearch: changed && after !== null };
}
