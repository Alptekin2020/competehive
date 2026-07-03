// ============================================================
// Yasal kimlik — TEK KAYNAK
// ============================================================
// KVKK aydınlatma metni, mesafeli satış sözleşmesi, kullanım şartları ve
// destek sayfaları veri sorumlusunu/satıcıyı bu sabitlerden okur.
//
// ÖNEMLİ (yayın öncesi doldurulmalı): Türkiye'de ücretli abonelik satmak ve
// KVKK aydınlatma yükümlülüğünü karşılamak için gerçek tüzel kişilik
// bilgileri gereklidir. Şahıs şirketi ise ad-soyad + vergi dairesi/no,
// sermaye şirketi ise ticaret unvanı + MERSİS numarası girilmelidir.
// Boş bırakılan alanlar sayfalarda gösterilmez — ama LEGAL_NAME ve adres
// doldurulmadan ödemeli lansman yapılmamalıdır.

export const LEGAL_ENTITY = {
  // Marka adı (her zaman gösterilir)
  brand: "CompeteHive",
  // Ticaret unvanı veya şahıs işletmesi sahibinin adı — DOLDURUN.
  legalName: "",
  // Kayıtlı iş adresi — DOLDURUN.
  address: "",
  // MERSİS numarası (sermaye şirketi ise) — varsa doldurun.
  mersis: "",
  // Vergi dairesi / numarası (şahıs işletmesi ise) — varsa doldurun.
  taxInfo: "",
  // Destek ve yasal bildirim e-postası
  email: "support@competehive.com",
} as const;

// Sözleşme/politika sayfalarında "Satıcı"/"Veri Sorumlusu" olarak gösterilecek ad.
export function legalDisplayName(): string {
  return LEGAL_ENTITY.legalName
    ? `${LEGAL_ENTITY.legalName} (${LEGAL_ENTITY.brand})`
    : LEGAL_ENTITY.brand;
}
