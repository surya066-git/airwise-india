import { isIP } from "node:net";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
const CLEANUP_INTERVAL_MS = 60_000;
let nextCleanupAt = 0;

function removeExpiredBuckets(now: number) {
  if (now < nextCleanupAt) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  nextCleanupAt = now + CLEANUP_INTERVAL_MS;
}

export function isRateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  removeExpiredBuckets(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    if (!current && buckets.size >= MAX_BUCKETS) return true;
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  if (current.count >= limit) return true;
  current.count += 1;
  return false;
}

export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip");
  const address = forwarded?.split(",")[0]?.trim() ?? "";
  return address.length <= 64 && isIP(address) !== 0 ? address : "unknown";
}
