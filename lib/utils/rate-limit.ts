type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function isRateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (buckets.size > 2_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (current.count >= limit) return true;
  current.count += 1;
  return false;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
