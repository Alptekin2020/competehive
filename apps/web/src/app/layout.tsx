import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "CompeteHive — Rakip Fiyat Takip Platformu",
  description: "Trendyol, Hepsiburada, Amazon ve N11'deki rakip fiyatları otomatik takip edin.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider afterSignOutUrl="/">
      <html lang="tr">
        <body className="bg-[#0A0A0B] text-white antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
