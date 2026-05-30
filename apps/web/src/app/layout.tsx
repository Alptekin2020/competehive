import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { trTR } from "@clerk/localizations";
import "./globals.css";
import CookieBanner from "@/components/CookieBanner";

const SITE_TITLE = "CompeteHive — Rakip Fiyat Takip Platformu";
const SITE_DESCRIPTION =
  "Trendyol, Hepsiburada, Amazon ve N11'deki rakip fiyatları otomatik takip edin.";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  icons: {
    icon: [{ url: "/favicon.png", type: "image/png" }],
    shortcut: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: "website",
    locale: "tr_TR",
    siteName: "CompeteHive",
    images: [{ url: "/competehive-logo.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: ["/competehive-logo.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider localization={trTR} afterSignOutUrl="/">
      <html lang="tr">
        <body className="bg-[#0A0A0B] text-white antialiased">
          {children}
          <CookieBanner />
        </body>
      </html>
    </ClerkProvider>
  );
}
