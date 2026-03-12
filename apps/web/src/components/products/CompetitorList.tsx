import { MarketplaceBadge } from "@/components/ui/MarketplaceBadge";
import { getMarketplaceInfo } from "@competehive/shared";

interface CompetitorItem {
  id?: string;
  marketplace: string;
  competitor_name: string | null;
  current_price: string | null;
  competitor_url: string;
  link?: string;
  retailerDomain?: string;
  retailerName?: string;
  retailerColor?: string;
}

interface CompetitorListProps {
  competitors: CompetitorItem[];
  myPrice: number | null;
  productId: string;
  productName: string;
  productUrl: string;
  marketplace: string;
  onCompareResults: (competitors: CompetitorItem[]) => void;
}

export function CompetitorList({
  competitors,
  myPrice,
  productId,
  productName,
  productUrl,
  marketplace,
  onCompareResults,
}: CompetitorListProps) {
  return (
    <div className="border-t border-dark-800 px-5 py-4 bg-dark-950/50">
      <h4 className="text-sm font-medium text-dark-300 mb-3">Marketplace Fiyat Karsilastirmasi</h4>

      {/* Own product row */}
      <div className="flex items-center gap-3 p-3 bg-dark-900 rounded-xl mb-2 border border-hive-500/30">
        <MarketplaceBadge marketplace={marketplace} />
        <a
          href={productUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-white flex-1 truncate hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {productName}
        </a>
        <span className="text-sm font-semibold text-hive-500">
          {myPrice ? `${myPrice.toLocaleString("tr-TR")} TL` : "\u2014"}
        </span>
        <span className="text-xs text-hive-500/60 bg-hive-500/10 px-2 py-0.5 rounded">
          Senin ununun
        </span>
      </div>

      {competitors.length > 0 ? (
        <div className="space-y-2">
          {competitors
            .sort(
              (a, b) => (Number(a.current_price) || 999999) - (Number(b.current_price) || 999999),
            )
            .map((comp, idx) => {
              const compPrice = comp.current_price ? Number(comp.current_price) : null;
              const diff = myPrice && compPrice ? compPrice - myPrice : null;
              const isLower = diff !== null && diff < 0;
              const isHigher = diff !== null && diff > 0;
              const compMp = getMarketplaceInfo(comp.marketplace);

              return (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-3 bg-dark-900 rounded-xl hover:bg-dark-800 transition"
                >
                  <MarketplaceBadge
                    marketplace={comp.marketplace}
                    overrideName={comp.retailerName || compMp.name}
                    overrideColor={comp.retailerColor || compMp.color}
                  />
                  <a
                    href={comp.link || comp.competitor_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-dark-300 flex-1 truncate hover:underline"
                  >
                    {comp.competitor_name}
                  </a>
                  <span
                    className={`text-sm font-semibold ${isLower ? "text-green-400" : isHigher ? "text-red-400" : "text-white"}`}
                  >
                    {compPrice ? `${compPrice.toLocaleString("tr-TR")} TL` : "\u2014"}
                  </span>
                  {diff !== null && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${isLower ? "bg-green-400/10 text-green-400" : "bg-red-400/10 text-red-400"}`}
                    >
                      {isLower ? "" : "+"}
                      {diff.toLocaleString("tr-TR")} TL
                    </span>
                  )}
                  <a
                    href={comp.link || comp.competitor_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0"
                  >
                    <svg
                      className="w-4 h-4 text-dark-600"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                </div>
              );
            })}
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-dark-500 text-sm mb-3">Rakipler araniyor veya bulunamadi...</p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              fetch("/api/products/compare", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId }),
              })
                .then((res) => res.json())
                .then((compareData) => {
                  if (compareData.competitors?.length > 0) {
                    onCompareResults(compareData.competitors);
                  }
                })
                .catch((err) => console.error("Compare error:", err));
            }}
            className="text-xs bg-hive-500/10 text-hive-500 px-4 py-2 rounded-lg hover:bg-hive-500/20 transition"
          >
            Diger Marketplace&apos;lerde Ara
          </button>
        </div>
      )}
    </div>
  );
}
