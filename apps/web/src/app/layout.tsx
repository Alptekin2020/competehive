import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CompeteHive — Akıllı Fiyat Takip & Rakip Analiz Platformu",
  description:
    "E-ticaret satıcıları için dinamik fiyat takip ve rakip analiz platformu. Trendyol, Hepsiburada, Amazon TR ve N11 fiyatlarını otomatik takip edin.",
  keywords: [
    "fiyat takip",
    "rakip analiz",
    "e-ticaret",
    "trendyol fiyat",
    "hepsiburada fiyat",
    "price tracking",
    "competitor analysis",
  ],
  openGraph: {
    title: "CompeteHive — Rakiplerinizin Fiyatlarını Takip Edin",
    description: "E-ticaret satıcıları için akıllı fiyat istihbaratı platformu",
    url: "https://competehive.com",
    siteName: "CompeteHive",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
