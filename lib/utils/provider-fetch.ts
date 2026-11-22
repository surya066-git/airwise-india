const DEFAULT_RETRYABLE_STATUSES = [500, 502, 503, 504];

export type ProviderRetryOptions = {
  maxRetries?: number;
  retryStatuses?: readonly number[];
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

function retryAfterMs(response: Response, now: number): number | null {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function jitterDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, random: () => number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(ceiling * (0.5 + Math.max(0, Math.min(1, random()))));
}

/** Bounded exponential-backoff retries. A long Retry-After is honored by not retrying early. */
export async function fetchProviderWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  options: ProviderRetryOptions = {}
): Promise<Response> {
  const maxRetries = Math.max(0, Math.min(2, Math.floor(options.maxRetries ?? 1)));
  const statuses = new Set(options.retryStatuses ?? DEFAULT_RETRYABLE_STATUSES);
  const baseDelayMs = options.baseDelayMs ?? 150;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(input, { ...init, signal: timeout });
    } catch (error) {
      if (timeout.aborted || attempt === maxRetries) throw error;
      await sleep(jitterDelay(attempt, baseDelayMs, maxDelayMs, random));
      continue;
    }

    if (attempt < maxRetries && statuses.has(response.status)) {
      const requestedDelay = retryAfterMs(response, Date.now());
      if (requestedDelay !== null && requestedDelay > maxDelayMs) return response;
      try {
        await response.body?.cancel();
      } catch {
        // Preserve the response status if its body cannot be discarded.
      }
      await sleep(requestedDelay ?? jitterDelay(attempt, baseDelayMs, maxDelayMs, random));
      continue;
    }
    return response;
  }
  throw new Error("Provider retry attempts were exhausted.");
}
