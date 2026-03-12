import { getMarketplaceInfo } from "@competehive/shared";

interface MarketplaceBadgeProps {
  marketplace: string;
  overrideName?: string;
  overrideColor?: string;
}

export function MarketplaceBadge({
  marketplace,
  overrideName,
  overrideColor,
}: MarketplaceBadgeProps) {
  const mpInfo = getMarketplaceInfo(marketplace);
  const color = overrideColor || mpInfo.color;
  const name = overrideName || mpInfo.name;

  return (
    <span
      className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
      style={{
        backgroundColor: `${color}20`,
        color,
      }}
    >
      {name}
    </span>
  );
}
