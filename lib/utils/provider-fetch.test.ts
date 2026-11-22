import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderWithRetry } from "@/lib/utils/provider-fetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded provider retries", () => {
  it("retries a transient upstream 503 once and returns the successful response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchProviderWithRetry("https://provider.example/data", {}, 1000);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry rate limits or client errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("limited", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchProviderWithRetry("https://provider.example/data", {}, 1000);

    expect(response.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the provider Retry-After value for a retryable response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503, headers: { "Retry-After": "0.25" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchProviderWithRetry("https://provider.example/data", {}, 1000, {
      sleep, maxDelayMs: 1000
    });

    expect(response.status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(250);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry before an excessive Retry-After interval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("busy", {
      status: 503, headers: { "Retry-After": "60" }
    }));
    const sleep = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchProviderWithRetry("https://provider.example/data", {}, 1000, {
      sleep, maxDelayMs: 1000
    });

    expect(response.status).toBe(503);
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies bounded jittered backoff to a retryable network error", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchProviderWithRetry("https://provider.example/data", {}, 1000, {
      sleep, random: () => 0, baseDelayMs: 200, maxDelayMs: 800
    });

    expect(response.status).toBe(200);
    expect(sleep).toHaveBeenCalledWith(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("applies a per-attempt timeout signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchProviderWithRetry("https://provider.example/data", {}, 1000);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
