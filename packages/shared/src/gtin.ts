// Ürün barkodu (GTIN: EAN-8, UPC-A, EAN-13, GTIN-14). Kullanıcının elle yazdığı
// ya da kamerayla okuttuğu barkod buradan geçer; worker aynı kontrolü
// `apps/worker/src/utils/listing-identity.ts` içinde yapar (Docker bağlamı bu
// paketi göremez) — ikisi aynı kalmalı.

/** EAN-8 / UPC-A (12) / EAN-13 / GTIN-14 kontrol hanesi doğru mu? */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  // Sağdan sola: kontrol hanesinin hemen solundaki hane x3.
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) {
    sum += digits[i] * w;
  }
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Kullanıcı girdisindeki boşluk/tireleri atar: "869 1234 567895" → "8691234567895".
 * Rakam dışı başka karakter varsa olduğu gibi döner (doğrulama reddetsin).
 */
export function normalizeGtinInput(raw: string): string {
  const trimmed = raw.trim();
  const compact = trimmed.replace(/[\s-]+/g, "");
  return /^\d+$/.test(compact) ? compact : trimmed;
}

export type GtinCheck = { ok: true; gtin: string } | { ok: false; error: string };

/** Boş girdi null (barkod isteğe bağlı); aksi halde geçerli barkod ya da Türkçe hata. */
export function checkGtinInput(raw: string | null | undefined): GtinCheck | null {
  if (raw == null || raw.trim() === "") return null;
  const gtin = normalizeGtinInput(raw);
  if (!/^\d+$/.test(gtin)) return { ok: false, error: "Barkod yalnızca rakamlardan oluşmalı." };
  if (!/^(\d{8}|\d{12,14})$/.test(gtin)) {
    return { ok: false, error: "Barkod 8, 12, 13 ya da 14 haneli olmalı." };
  }
  if (!isValidGtin(gtin)) {
    return { ok: false, error: "Barkod geçersiz görünüyor, rakamları kontrol edin." };
  }
  return { ok: true, gtin };
}
