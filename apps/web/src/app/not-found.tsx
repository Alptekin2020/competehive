import Link from "next/link";

// Türkçe, markalı 404 — daha önce Next.js'in çıplak İngilizce "This page could
// not be found." sayfası görünüyordu ve kullanıcıyı dashboard'a döndüren hiçbir
// bağlantı yoktu.
export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0A0A0B] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-amber-500 mb-4">404</p>
        <h1 className="text-xl font-semibold text-white mb-2">Sayfa bulunamadı</h1>
        <p className="text-sm text-gray-400 mb-8">
          Aradığınız sayfa taşınmış veya hiç var olmamış olabilir. Adresi kontrol edin ya da panele
          dönün.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="bg-amber-500 hover:bg-amber-400 text-black font-semibold px-5 py-2.5 rounded-lg transition-colors text-sm"
          >
            Panele Dön
          </Link>
          <Link
            href="/dashboard/yardim"
            className="border border-[#1F1F23] hover:border-amber-500/30 text-gray-400 hover:text-white px-5 py-2.5 rounded-lg transition-colors text-sm"
          >
            Yardım
          </Link>
        </div>
      </div>
    </div>
  );
}
