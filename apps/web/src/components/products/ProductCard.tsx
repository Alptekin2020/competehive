"use client";

import { MarketplaceBadge } from "@/components/ui/MarketplaceBadge";
import { CompetitorList } from "@/components/products/CompetitorList";

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

interface ProductItem {
  id: string;
  product_name: string;
  marketplace: string;
  product_url: string;
  product_image: string | null;
  current_price: string | null;
  last_scraped_at: string | null;
  competitors?: CompetitorItem[];
}

interface ProductCardProps {
  product: ProductItem;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onCompareResults: (competitors: CompetitorItem[]) => void;
}

function getPriceRange(product: ProductItem) {
  const prices = [
    product.current_price ? Number(product.current_price) : null,
    ...(product.competitors || []).map((c) => (c.current_price ? Number(c.current_price) : null)),
  ].filter(Boolean) as number[];

  if (prices.length === 0) return { lowest: null, highest: null };
  return { lowest: Math.min(...prices), highest: Math.max(...prices) };
}

export function ProductCard({
  product,
  isExpanded,
  onToggle,
  onDelete,
  onCompareResults,
}: ProductCardProps) {
  const { lowest, highest } = getPriceRange(product);
  const competitorCount = product.competitors?.length || 0;
  const myPrice = product.current_price ? Number(product.current_price) : null;
  const isCheapest = myPrice !== null && lowest !== null && myPrice <= lowest;

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden">
      {/* Header row */}
      <div
        className="p-5 flex items-center gap-4 cursor-pointer hover:bg-dark-800/30 transition"
        onClick={onToggle}
      >
        <div className="w-14 h-14 bg-dark-800 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0">
          {product.product_image ? (
            <img
              src={product.product_image}
              alt=""
              className="w-full h-full object-cover rounded-xl"
            />
          ) : (
            <span className="text-dark-500 text-xl">📦</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium text-sm truncate">
            <a
              href={product.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {product.product_name}
            </a>
          </h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <MarketplaceBadge marketplace={product.marketplace} />
            {competitorCount > 0 && (
              <span className="text-xs text-dark-500">{competitorCount} rakip bulundu</span>
            )}
            {myPrice && !isCheapest && lowest && (
              <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                En dusuk: {lowest.toLocaleString("tr-TR")} TL
              </span>
            )}
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          <div className={`font-semibold ${isCheapest ? "text-green-400" : "text-white"}`}>
            {myPrice ? `${myPrice.toLocaleString("tr-TR")} TL` : "\u2014"}
          </div>
          <div className="text-dark-600 text-xs">
            {product.last_scraped_at
              ? new Date(product.last_scraped_at).toLocaleDateString("tr-TR")
              : "Taraniyor..."}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <svg
            className={`w-5 h-5 text-dark-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-dark-600 hover:text-red-400 transition p-1"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded competitor section */}
      {isExpanded && (
        <>
          <CompetitorList
            competitors={product.competitors || []}
            myPrice={myPrice}
            productId={product.id}
            productName={product.product_name}
            productUrl={product.product_url}
            marketplace={product.marketplace}
            onCompareResults={onCompareResults}
          />

          {product.competitors &&
            product.competitors.length > 0 &&
            lowest !== null &&
            highest !== null && (
              <div className="px-5 pb-4">
                <div className="p-3 bg-dark-900 rounded-xl border border-dark-800">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-dark-500">Fiyat araligi:</span>
                    <span className="text-white font-medium">
                      {lowest.toLocaleString("tr-TR")} TL &mdash; {highest.toLocaleString("tr-TR")}{" "}
                      TL
                    </span>
                    <span className="text-dark-500">Fark:</span>
                    <span
                      className={`font-medium ${highest - lowest > 0 ? "text-hive-500" : "text-white"}`}
                    >
                      {(highest - lowest).toLocaleString("tr-TR")} TL (
                      {(((highest - lowest) / lowest) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            )}
        </>
      )}
    </div>
  );
}
