import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenAqNear } from "@/lib/aqi/openaq";

const NOW = Date.parse("2026-11-20T12:00:00Z");

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function successResponses() {
  return [
    jsonResponse({ results: [{
      id: 21,
      name: "Example reference location",
      country: { code: "IN", name: "India" },
      isMonitor: true,
      coordinates: { latitude: 18.521, longitude: 73.857 }
    }] }),
    jsonResponse({ results: [
      { id: 101, parameter: { name: "pm25", displayName: "PM2.5", units: "µg/m³" } },
      { id: 102, parameter: { name: "no2", displayName: "NO2", units: "µg/m³" } },
      { id: 103, parameter: { name: "temperature", displayName: "Temperature", units: "°C" } }
    ] }),
    jsonResponse({ results: [
      { locationsId: 21, sensorsId: 101, datetime: { utc: "2026-11-20T11:30:00Z" }, value: 24.5 },
      { locationsId: 21, sensorsId: 102, datetime: { utc: "2026-11-20T10:00:00Z" }, value: 11 },
      { locationsId: 21, sensorsId: 103, datetime: { utc: "2026-11-20T11:45:00Z" }, value: 31 }
    ] })
  ];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("OpenAQ v3 adapter", () => {
  it("authenticates each request and preserves station and per-sensor timestamps", async () => {
    vi.stubEnv("OPENAQ_API_KEY", "test-secret-do-not-print");
    const replies = successResponses();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(replies.shift()!));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOpenAqNear(18.5204, 73.8567, NOW);

    expect(result.status).toBe("live");
    expect(result.station).toBe("Example reference location");
    expect(result.measurements).toHaveLength(2);
    expect(result.measurements.map((item) => item.measuredAt)).toEqual([
      "2026-11-20T11:30:00.000Z", "2026-11-20T10:00:00.000Z"
    ]);
    expect(result.message).toContain("Each pollutant keeps its own timestamp");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    for (const [requestUrl, init] of fetchMock.mock.calls as [URL, RequestInit][]) {
      expect(new Headers(init.headers).get("x-api-key")).toBe("test-secret-do-not-print");
      expect(String(requestUrl)).toContain("https://api.openaq.org/v3/");
    }
    const locationsUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(locationsUrl.pathname).toBe("/v3/locations");
    expect(locationsUrl.searchParams.get("coordinates")).toBe("18.5204,73.8567");
    expect(locationsUrl.searchParams.get("radius")).toBe("25000");
    expect(locationsUrl.searchParams.get("iso")).toBe("IN");
  });

  it("does not call OpenAQ when the API key is missing", async () => {
    vi.stubEnv("OPENAQ_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchOpenAqNear(18.52, 73.85, NOW);
    expect(result.status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("handles authorization, rate limiting, malformed data, and network failure", async () => {
    vi.stubEnv("OPENAQ_API_KEY", "test-key");
    const authFetch = vi.fn().mockResolvedValue(jsonResponse({}, 403));
    vi.stubGlobal("fetch", authFetch);
    expect((await fetchOpenAqNear(18.52, 73.85, NOW)).status).toBe("not_configured");

    const limitedFetch = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    vi.stubGlobal("fetch", limitedFetch);
    const limited = await fetchOpenAqNear(18.52, 73.85, NOW);
    expect(limited.status).toBe("unavailable");
    expect(limited.message).toContain("request limit");

    const malformedFetch = vi.fn().mockResolvedValueOnce(jsonResponse({ results: "invalid" }));
    vi.stubGlobal("fetch", malformedFetch);
    expect((await fetchOpenAqNear(18.52, 73.85, NOW)).status).toBe("unavailable");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));
    const network = await fetchOpenAqNear(18.52, 73.85, NOW);
    expect(network.status).toBe("unavailable");
    expect(network.message).not.toContain("network unavailable");
  });

  it("omits invalid values and timestamps and marks the remaining data unverified", async () => {
    vi.stubEnv("OPENAQ_API_KEY", "test-key");
    const replies = successResponses();
    replies[2] = jsonResponse({ results: [
      { locationsId: 21, sensorsId: 101, datetime: { utc: "not-a-time" }, value: 20 },
      { locationsId: 21, sensorsId: 102, datetime: { utc: "2026-11-20T10:00:00Z" }, value: -1 }
    ] });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(replies.shift()!)));
    const result = await fetchOpenAqNear(18.52, 73.85, NOW);
    expect(result.status).toBe("unverified");
    expect(result.measurements).toHaveLength(0);
  });

  it("keeps stale measurements separate from fresh ones", async () => {
    vi.stubEnv("OPENAQ_API_KEY", "test-key");
    const replies = successResponses();
    replies[2] = jsonResponse({ results: [
      { locationsId: 21, sensorsId: 101, datetime: { utc: "2026-11-20T11:30:00Z" }, value: 24.5 },
      { locationsId: 21, sensorsId: 102, datetime: { utc: "2026-11-20T06:00:00Z" }, value: 11 }
    ] });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(replies.shift()!)));
    const result = await fetchOpenAqNear(18.52, 73.85, NOW);
    expect(result.status).toBe("live");
    expect(result.measurements.map((item) => item.freshness)).toEqual(["live", "stale"]);
  });
});
