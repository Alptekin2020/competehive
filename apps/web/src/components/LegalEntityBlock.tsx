import { LEGAL_ENTITY, legalDisplayName } from "@/lib/legal";

// Yasal sayfalarda (KVKK, mesafeli satış, şartlar) satıcı/veri sorumlusu
// kimlik bloğu — tek kaynaktan (lib/legal.ts) beslenir, sayfalar arasında
// kopya metin tutulmaz.
export default function LegalEntityBlock({ title }: { title: string }) {
  // Yayına yanlışlıkla boş kimlikle çıkılmasın: zorunlu alanlar eksikse
  // geliştirme ortamında belirgin bir uyarı göster (prod'da gösterilmez).
  const isMissingLegalInfo = !LEGAL_ENTITY.legalName || !LEGAL_ENTITY.address;
  const showDevWarning = isMissingLegalInfo && process.env.NODE_ENV === "development";

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl p-4 text-dark-300">
      {showDevWarning && (
        <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs leading-relaxed">
          ⚠️ <strong>Geliştirme uyarısı:</strong> <code>lib/legal.ts</code> içindeki yasal kimlik
          (unvan ve adres) doldurulmamış. Ödemeli lansmandan önce mutlaka doldurun.
        </div>
      )}
      <p className="text-white font-medium mb-1">{title}</p>
      <p>{legalDisplayName()}</p>
      {LEGAL_ENTITY.address && <p>{LEGAL_ENTITY.address}</p>}
      {LEGAL_ENTITY.mersis && <p>MERSİS: {LEGAL_ENTITY.mersis}</p>}
      {LEGAL_ENTITY.taxInfo && <p>Vergi: {LEGAL_ENTITY.taxInfo}</p>}
      <p>
        E-posta:{" "}
        <a href={`mailto:${LEGAL_ENTITY.email}`} className="text-hive-500 hover:underline">
          {LEGAL_ENTITY.email}
        </a>
      </p>
    </div>
  );
}
