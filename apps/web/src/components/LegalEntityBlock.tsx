import { LEGAL_ENTITY, legalDisplayName } from "@/lib/legal";

// Yasal sayfalarda (KVKK, mesafeli satış, şartlar) satıcı/veri sorumlusu
// kimlik bloğu — tek kaynaktan (lib/legal.ts) beslenir, sayfalar arasında
// kopya metin tutulmaz.
export default function LegalEntityBlock({ title }: { title: string }) {
  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl p-4 text-dark-300">
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
