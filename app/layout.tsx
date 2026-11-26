import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

// Vercel's project production URL prevents a local .env value from becoming
// the canonical URL in static production HTML; the production alias is the fallback.
const metadataBase = getSiteUrl();

export const metadata: Metadata = {
  ...(metadataBase ? { metadataBase, alternates: { canonical: "/" } } : {}),
  title: "AIRWISE INDIA — Breathe smarter. Live better.",
  description: "A clear, careful air-quality companion for people across India.",
  robots: { index: true, follow: true }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
