import type { Metadata } from "next";
import "./globals.css";

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
const metadataBase = (() => {
  if (!configuredAppUrl) return undefined;
  try {
    const url = new URL(configuredAppUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
})();

export const metadata: Metadata = {
  ...(metadataBase ? { metadataBase, alternates: { canonical: "/" } } : {}),
  title: "AIRWISE INDIA — Breathe smarter. Live better.",
  description: "A clear, careful air-quality companion for people across India."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
