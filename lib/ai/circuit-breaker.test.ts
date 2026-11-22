import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "@/lib/ai/circuit-breaker";

describe("provider circuit breaker", () => {
  it("opens after the threshold, permits one recovery probe after cooldown, and closes on success", () => {
    let now = 10_000;
    const circuit = new CircuitBreaker(2, 5_000, () => now);

    expect(circuit.tryAcquire()).toEqual({ allowed: true, probe: false });
    circuit.recordFailure("503");
    expect(circuit.tryAcquire()).toEqual({ allowed: true, probe: false });
    circuit.recordFailure("503");
    expect(circuit.snapshot()).toMatchObject({ state: "open", consecutiveFailures: 2, lastFailureCode: "503" });
    expect(circuit.tryAcquire().allowed).toBe(false);

    now += 5_000;
    expect(circuit.tryAcquire()).toEqual({ allowed: true, probe: true });
    expect(circuit.tryAcquire().allowed).toBe(false);
    circuit.recordSuccess();
    expect(circuit.snapshot()).toMatchObject({ state: "closed", consecutiveFailures: 0, probeInFlight: false });
  });

  it("reopens after a failed half-open probe", () => {
    let now = 0;
    const circuit = new CircuitBreaker(1, 1_000, () => now);
    expect(circuit.tryAcquire().allowed).toBe(true);
    circuit.recordFailure("transport_error");
    now = 1_000;
    expect(circuit.tryAcquire()).toEqual({ allowed: true, probe: true });
    circuit.recordFailure("503");
    expect(circuit.snapshot()).toMatchObject({ state: "open", consecutiveFailures: 2, nextAttemptAt: 2_000 });
  });
});
