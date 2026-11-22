export type CircuitState = "closed" | "open" | "half_open";

export type CircuitSnapshot = {
  state: CircuitState;
  consecutiveFailures: number;
  failureThreshold: number;
  cooldownMs: number;
  nextAttemptAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureCode: string | null;
  probeInFlight: boolean;
};

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedUntil: number | null = null;
  private lastAttempt: number | null = null;
  private lastSuccess: number | null = null;
  private lastFailure: number | null = null;
  private lastCode: string | null = null;
  private probeInFlight = false;

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now
  ) {}

  tryAcquire(): { allowed: boolean; probe: boolean } {
    const current = this.now();
    if (this.state === "open") {
      if (this.openedUntil === null || current < this.openedUntil) return { allowed: false, probe: false };
      this.state = "half_open";
    }
    if (this.state === "half_open") {
      if (this.probeInFlight) return { allowed: false, probe: false };
      this.probeInFlight = true;
      this.lastAttempt = current;
      return { allowed: true, probe: true };
    }
    this.lastAttempt = current;
    return { allowed: true, probe: false };
  }

  recordSuccess(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedUntil = null;
    this.probeInFlight = false;
    this.lastSuccess = this.now();
    this.lastCode = null;
  }

  recordFailure(code: string): void {
    this.failures += 1;
    this.lastFailure = this.now();
    this.lastCode = code.slice(0, 80);
    this.probeInFlight = false;
    if (this.state === "half_open" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedUntil = this.now() + this.cooldownMs;
    }
  }

  recordRateLimit(code: string, retryAt: number | null, fallbackCooldownMs = this.cooldownMs): void {
    const current = this.now();
    this.failures += 1;
    this.lastFailure = current;
    this.lastCode = code.slice(0, 80);
    this.probeInFlight = false;
    this.state = "open";
    this.openedUntil = retryAt === null
      ? current + fallbackCooldownMs
      : Math.max(current + 1_000, retryAt);
  }

  snapshot(): CircuitSnapshot {
    return {
      state: this.state,
      consecutiveFailures: this.failures,
      failureThreshold: this.failureThreshold,
      cooldownMs: this.cooldownMs,
      nextAttemptAt: this.openedUntil,
      lastAttemptAt: this.lastAttempt,
      lastSuccessAt: this.lastSuccess,
      lastFailureAt: this.lastFailure,
      lastFailureCode: this.lastCode,
      probeInFlight: this.probeInFlight
    };
  }

  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedUntil = null;
    this.lastAttempt = null;
    this.lastSuccess = null;
    this.lastFailure = null;
    this.lastCode = null;
    this.probeInFlight = false;
  }
}
