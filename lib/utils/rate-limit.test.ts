import { describe, expect, it } from "vitest";
import { clientKey, isRateLimited } from "@/lib/utils/rate-limit";

describe("request rate limiting", () => {
  it("limits a key for its window and allows it after reset", () => {
    const key = `limit-test-${crypto.randomUUID()}`;
    expect(isRateLimited(key, 2, 1_000, 10_000)).toBe(false);
    expect(isRateLimited(key, 2, 1_000, 10_001)).toBe(false);
    expect(isRateLimited(key, 2, 1_000, 10_002)).toBe(true);
    expect(isRateLimited(key, 2, 1_000, 11_000)).toBe(false);
  });

  it("prefers Vercel's client IP header and rejects invalid addresses", () => {
    const trusted = new Request("https://airwise.example", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.7",
        "x-forwarded-for": "198.51.100.9"
      }
    });
    const invalid = new Request("https://airwise.example", {
      headers: { "x-vercel-forwarded-for": "not-an-ip" }
    });
    expect(clientKey(trusted)).toBe("203.0.113.7");
    expect(clientKey(invalid)).toBe("unknown");
  });
});
