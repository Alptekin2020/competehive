export const MARKETPLACE_LABELS: Record<string, { name: string; color: string }> = {
  TRENDYOL: { name: "Trendyol", color: "#F27A1A" },
  HEPSIBURADA: { name: "Hepsiburada", color: "#FF6000" },
  AMAZON_TR: { name: "Amazon TR", color: "#FF9900" },
  N11: { name: "N11", color: "#7B2D8E" },
  TEKNOSA: { name: "Teknosa", color: "#005CA9" },
  VATAN: { name: "Vatan", color: "#E30613" },
  DECATHLON: { name: "Decathlon", color: "#0082C3" },
  MEDIAMARKT: { name: "MediaMarkt", color: "#DF0000" },
};

export function getMarketplaceLabel(marketplace: string): { name: string; color: string } {
  return MARKETPLACE_LABELS[marketplace] || { name: marketplace, color: "#6B7280" };
}
