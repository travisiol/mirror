import type { Metadata, Viewport } from "next";
import { DM_Sans, Inter } from "next/font/google";
import { WalletDialog } from "@/components/WalletDialog";
import { BRAND } from "@/config/brand";
import "./globals.css";

// Both families are downloaded at build time and served from this origin.
const display = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], display: "swap" });
const text = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: `mirror — ${BRAND.tagline}`, template: "%s · mirror" },
  description: BRAND.description,
};

export const viewport: Viewport = { themeColor: "#f1e7d4" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} h-full`}>
      <body className="flex min-h-full flex-col">
        {children}
        <WalletDialog />
      </body>
    </html>
  );
}
