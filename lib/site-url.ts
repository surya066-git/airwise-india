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

export function getSiteUrl(): URL {
  const configuredUrl = parseHttpUrl(process.env.NEXT_PUBLIC_APP_URL);
  const vercelProductionUrl = parseVercelDomain(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const productionFallbackUrl = process.env.NODE_ENV === "production"
    ? parseHttpUrl("https://airwise-india-one.vercel.app")
    : undefined;

  if (configuredUrl && (process.env.NODE_ENV !== "production" || !isLocalUrl(configuredUrl))) {
    return configuredUrl;
  }
  return vercelProductionUrl ?? productionFallbackUrl ?? new URL("http://localhost:3000");
}
