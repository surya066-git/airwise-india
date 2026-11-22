/** Server-only diagnostic gate for a single hosted-provider verification. */
export function isCloudflareOnlyLiveTest(): boolean {
  return process.env.NODE_ENV === "development" && process.env.AIRWISE_LIVE_TEST_PROVIDER === "cloudflare";
}

/** Server-side guard used by the browser regression suite to prevent all live provider access. */
export function isAirwiseOfflineTestMode(): boolean {
  return process.env.NODE_ENV === "development" && process.env.AIRWISE_OFFLINE_TESTS === "true";
}
