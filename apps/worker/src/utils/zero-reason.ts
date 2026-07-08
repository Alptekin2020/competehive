// ============================================
// 0-rakip mesajı üretimi (saf, test edilebilir)
// ============================================

/**
 * 0 rakip durumunda kullanıcıya gösterilecek insana okunur, baskın-sebep odaklı
 * tek cümle. Sıfır olan kalemler ("0 ambalaj/koli") ASLA yazılmaz.
 */
export function buildZeroReason(
  candidates: number,
  c: {
    packaging: number;
    priceFiltered: number;
    aiRejected: number;
    priceUnrecoverable: number;
    aiUnavailable?: number;
  },
): string {
  // AI hiç çalışamadıysa "rakibiniz yok" demek YANLIŞ ve yanıltıcıdır — bu bir
  // altyapı durumudur, piyasa gerçeği değil. Kullanıcıya dürüst sebep + aksiyon ver.
  const aiUnavailable = c.aiUnavailable ?? 0;
  if (aiUnavailable > 0 && aiUnavailable >= c.aiRejected) {
    return `${candidates} aday bulundu ama yapay zekâ doğrulaması şu an kullanılamadığı için eşleştirme tamamlanamadı. "Rakipleri Tara" ile yeniden deneyin.`;
  }
  // Baskın sebep neyse ana mesajı ona göre kur.
  const max = Math.max(c.aiRejected, c.priceFiltered, c.packaging, c.priceUnrecoverable);
  if (max === 0) {
    return `${candidates} aday incelendi ama birebir aynı ürün bulunamadı.`;
  }
  if (c.aiRejected === max) {
    return `${candidates} benzer ürün incelendi; hiçbiri birebir aynı ürün olarak doğrulanamadı (farklı model, varyant veya marka). Bildiğiniz bir rakip varsa "Rakip Ekle" ile linkini ekleyebilirsiniz.`;
  }
  if (c.priceFiltered === max) {
    return `${candidates} benzer ürün bulundu ama fiyatları kıyas için fazla farklı (büyük olasılıkla farklı paket/boyut). Birebir aynı ürün eşleşmedi.`;
  }
  if (c.packaging === max) {
    return `${candidates} sonucun çoğu ambalaj/aksesuar ürünüydü; birebir aynı ürün bulunamadı.`;
  }
  return `${candidates} aday bulundu ama fiyat bilgisi alınamadığı için eşleştirilemedi.`;
}
