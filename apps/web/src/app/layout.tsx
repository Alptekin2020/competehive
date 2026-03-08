import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CompeteHive — Akıllı Fiyat Takip & Rakip Analiz Platformu",
  description: "E-ticaret satıcıları için dinamik fiyat takip ve rakip analiz platformu.",
  icons: {
    icon: "/favicon.png",
    apple: "/competehive-logo.png",
  },
  openGraph: {
    title: "CompeteHive — Rakiplerinizin Fiyatlarını Takip Edin",
    description: "E-ticaret satıcıları için akıllı fiyat istihbaratı platformu",
    url: "https://competehive.com",
    siteName: "CompeteHive",
    type: "website",
    images: ["/competehive-logo.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr">
      <body className="bg-[#0A0A0B] text-white antialiased">{children}</body>
    </html>
  );
}
