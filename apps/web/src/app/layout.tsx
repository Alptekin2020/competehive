import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
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
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: "#F59E0B",
          colorBackground: "#18181B",
          colorInputBackground: "#0A0A0B",
          colorInputText: "#FFFFFF",
          colorText: "#FFFFFF",
          colorTextSecondary: "#71717A",
          borderRadius: "0.75rem",
        },
        elements: {
          card: "bg-dark-900 border border-dark-800",
          formButtonPrimary: "bg-hive-500 hover:bg-hive-600 text-dark-1000",
          footerActionLink: "text-hive-500 hover:text-hive-400",
          identityPreview: "bg-dark-950",
          formFieldInput: "bg-dark-950 border-dark-800",
          headerTitle: "text-white",
          headerSubtitle: "text-dark-400",
          socialButtonsBlockButton: "bg-dark-950 border-dark-800 text-white hover:bg-dark-800",
          dividerLine: "bg-dark-800",
          dividerText: "text-dark-500",
          formFieldLabel: "text-dark-300",
          navbar: "bg-dark-950",
          navbarButton: "text-dark-400",
          avatarBox: "border-hive-500",
        },
      }}
    >
      <html lang="tr">
        <body className="antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
