import type { Metadata } from "next";
import "./globals.css";

function parseHttpUrl(value: string | undefined): URL | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function parseVercelDomain(value: string | undefined): URL | undefined {
  return value?.trim() ? parseHttpUrl(`https://${value.trim()}`) : undefined;
}

function isLocalUrl(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" || url.hostname === "[::1]";
}

const configuredAppUrl = parseHttpUrl(process.env.NEXT_PUBLIC_APP_URL);
const vercelProductionUrl = parseVercelDomain(process.env.VERCEL_PROJECT_PRODUCTION_URL);
const productionFallbackUrl = process.env.NODE_ENV === "production"
  ? parseHttpUrl("https://airwise-india-one.vercel.app")
  : undefined;
// Vercel's project production URL prevents a local .env value from becoming
// the canonical URL in the statically generated production HTML. The known
// production alias remains a fallback if Vercel system variables are disabled.
const metadataBase = configuredAppUrl &&
  (process.env.NODE_ENV !== "production" || !isLocalUrl(configuredAppUrl))
  ? configuredAppUrl
  : vercelProductionUrl ?? productionFallbackUrl;

export const metadata: Metadata = {
  ...(metadataBase ? { metadataBase, alternates: { canonical: "/" } } : {}),
  title: "AIRWISE INDIA — Breathe smarter. Live better.",
  description: "A clear, careful air-quality companion for people across India."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
