import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCpcbCacheForTests, fetchCpcbByLocation, parseCpcbResponse, parseCpcbTimestamp } from "@/lib/aqi/cpcb";

const RESOURCE_ID = "00000000-1111-2222-3333-444444444444";
const NOW = Date.parse("2026-11-20T12:00:00Z");

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  clearCpcbCacheForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CPCB data.gov.in adapter", () => {
  it("parses CPCB local timestamps as India time and rejects invalid dates", () => {
    expect(parseCpcbTimestamp("20-11-2026 16:00:00")).toBe("2026-11-20T10:30:00.000Z");
    expect(parseCpcbTimestamp("31-02-2026 16:00")).toBeNull();
    expect(parseCpcbTimestamp("20/11/2026 16:00")).toBeNull();
  });

  it("selects the nearest station within an exact normalized city and keeps its records together", () => {
    const result = parseCpcbResponse({ records: [
      { country: "India", city: "Pune", state: "Maharashtra", station: "Far", latitude: "18.8", longitude: "74.0", last_update: "20-11-2026 17:00", aqi: "90", pollutant_id: "PM2.5", pollutant_avg: "30", pollutant_unit: "µg/m3" },
      { country: "India", city: "Pune", state: "Maharashtra", station: "Near", latitude: "18.521", longitude: "73.857", last_update: "20-11-2026 16:00", aqi: "83", pollutant_id: "PM2.5", pollutant_avg: "26", pollutant_unit: "µg/m3" },
      { country: "India", city: "Mumbai", state: "Maharashtra", station: "Wrong city", latitude: "19.0", longitude: "72.8", last_update: "20-11-2026 17:00", aqi: "20" }
    ] }, " pune ", NOW, { latitude: 18.5204, longitude: 73.8567 });

    expect(result.station).toBe("Near");
    expect(result.city).toBe("Pune");
    expect(result.aqi).toBe(83);
    expect(result.category).toBe("Satisfactory");
    expect(result.distanceMeters).toBeLessThan(500);
    expect(result.pollutants).toHaveLength(1);
  });

  it("does not merge different station timestamps or use an older AQI", () => {
    const result = parseCpcbResponse({ records: [
      { city: "Pune", station: "Station A", last_update: "20-11-2026 16:00", aqi: "83", pollutant_id: "PM2.5", pollutant_avg: "26" },
      { city: "Pune", station: "Station A", last_update: "20-11-2026 17:00", pollutant_id: "PM10", pollutant_avg: "51" }
    ] }, "Pune", NOW);

    expect(result.aqi).toBeNull();
    expect(result.status).toBe("unverified");
    expect(result.pollutants.map((item) => item.parameter)).toEqual(["PM10"]);
    expect(result.message).toContain("has not calculated an index");
  });

  it("maps the live OGD avg_value field as a pollutant concentration without inferring AQI", () => {
    const result = parseCpcbResponse({ records: [
      { country: "India", state: "Telangana", city: "Hyderabad", station: "Test CPCB station",
        last_update: "20-11-2026 16:00", latitude: "17.38", longitude: "78.48",
        pollutant_id: "PM2.5", min_value: "18", max_value: "42", avg_value: "29" }
    ] }, "Hyderabad", NOW);

    expect(result.station).toBe("Test CPCB station");
    expect(result.pollutants).toEqual([{
      parameter: "PM2.5", value: 29, unit: null,
      measuredAt: "2026-11-20T10:30:00.000Z", freshness: "live"
    }]);
    expect(result.aqi).toBeNull();
    expect(result.status).toBe("unverified");
    expect(result.message).toContain("no explicit valid AQI field");
  });

  it("fails closed when the API reports more matching records than it returned", () => {
    const result = parseCpcbResponse({
      total: 98,
      count: 10,
      limit: 10,
      offset: 0,
      records: [{ city: "Hyderabad", station: "Partial page station", last_update: "20-11-2026 21:00",
        pollutant_id: "NO2", avg_value: "14", aqi: "42" }]
    }, "Hyderabad", NOW);

    expect(result.status).toBe("unverified");
    expect(result.station).toBeNull();
    expect(result.aqi).toBeNull();
    expect(result.pollutants).toHaveLength(0);
    expect(result.message).toContain("only 1 of 98 matching records");
  });

  it("rejects AQI outside CPCB's official scale and extreme pollutant values", () => {
    const invalidAqi = parseCpcbResponse({ records: [
      { city: "Pune", station: "A", last_update: "20-11-2026 17:00", aqi: "501" }
    ] }, "Pune", NOW);
    expect(invalidAqi.status).toBe("unverified");
    expect(invalidAqi.aqi).toBeNull();
    expect(invalidAqi.message).toContain("0–500");

    const extremePollutant = parseCpcbResponse({ records: [
      { city: "Pune", station: "A", last_update: "20-11-2026 17:00", pollutant_id: "PM2.5", avg_value: "1000001" }
    ] }, "Pune", NOW);
    expect(extremePollutant.pollutants).toHaveLength(0);
    expect(extremePollutant.message).toContain("extreme pollutant value");
  });

  it("matches by coordinates when a city label is unavailable and never substitutes a distant station", () => {
    const records = { records: [
      { country: "India", city: "Pune", station: "Nearby", latitude: "18.52", longitude: "73.85", last_update: "20-11-2026 17:00", pollutant_id: "PM10", pollutant_avg: "10" },
      { country: "India", city: "Mumbai", station: "Far", latitude: "19.07", longitude: "72.87", last_update: "20-11-2026 17:00", aqi: "50" }
    ] };
    const nearby = parseCpcbResponse(records, "", NOW, { latitude: 18.5204, longitude: 73.8567 });
    expect(nearby.station).toBe("Nearby");
    expect(nearby.city).toBe("Pune");
    const absent = parseCpcbResponse(records, "Pune", NOW, { latitude: 19.07, longitude: 72.87 });
    expect(absent.status).toBe("unavailable");
    expect(absent.station).toBeNull();
  });

  it("reports missing credentials without making a request", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchCpcbByLocation("Pune");
    expect(result.status).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the OGD resource endpoint, API-key query authentication, and record pagination parameters", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "test-secret-do-not-print");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", RESOURCE_ID);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ total: 1, count: 1, limit: 1, offset: 0, records: [
      { country: "India", city: "Pune", station: "A", last_update: "20-11-2026 17:00", pollutant_id: "PM2.5", aqi: "83" }
    ] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCpcbByLocation("Pune");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe("https://api.data.gov.in/resource/" + RESOURCE_ID);
    expect(parsed.searchParams.get("api-key")).toBe("test-secret-do-not-print");
    expect(parsed.searchParams.get("format")).toBe("json");
    expect(parsed.searchParams.get("limit")).toBe("500");
    expect(parsed.searchParams.get("offset")).toBe("0");
    expect(parsed.searchParams.get("filters[city]")).toBe("Pune");
    expect(new Headers(init.headers).get("accept")).toBe("application/json");
  });

  it("uses the supplied CPCB resource ID by default when no override is configured", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "test-key");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", "");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ total: 0, count: 0, limit: 500, offset: 0, records: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCpcbByLocation("Pune");

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(new URL(String(url)).pathname).toBe("/resource/3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69");
  });

  it.each([[401, "not_configured"], [403, "not_configured"], [429, "unavailable"], [503, "unavailable"]] as const)(
    "handles CPCB HTTP %i as %s without exposing provider details", async (status, expected) => {
      vi.stubEnv("DATA_GOV_API_KEY", "test-key");
      vi.stubEnv("DATA_GOV_RESOURCE_ID", RESOURCE_ID);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "sensitive provider text" }, status)));
      const result = await fetchCpcbByLocation("Pune");
      expect(result.status).toBe(expected);
      expect(result.message).not.toContain("sensitive provider text");
    }
  );

  it("retrieves pages sequentially using the source-reported page size and validates complete totals", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "test-key");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", RESOURCE_ID);
    const pages = [
      jsonResponse({ total: 2, count: 1, limit: 1, offset: 0, records: [
        { country: "India", city: "Pune", station: "A", last_update: "20-11-2026 17:00", pollutant_id: "PM2.5", avg_value: "20" }
      ] }),
      jsonResponse({ total: 2, count: 1, limit: 1, offset: 1, records: [
        { country: "India", city: "Pune", station: "B", last_update: "20-11-2026 17:00", pollutant_id: "PM10", avg_value: "30" }
      ] })
    ];
    const offsets: number[] = [];
    const fetchMock = vi.fn().mockImplementation((input: URL) => {
      offsets.push(Number(new URL(String(input)).searchParams.get("offset")));
      return Promise.resolve(pages.shift()!);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCpcbByLocation("Pune");

    expect(offsets).toEqual([0, 1]);
    expect(result.status).toBe("unverified");
    expect(result.aqi).toBeNull();
    expect(result.pagination).toMatchObject({ status: "complete", pageCount: 2, reportedTotal: 2, uniqueRecords: 2 });
    expect(result.pagination?.pages.map((page) => page.requestedOffset)).toEqual([0, 1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when pagination repeats a row", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "test-key");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", RESOURCE_ID);
    const row = { country: "India", city: "Pune", station: "A", last_update: "20-11-2026 17:00", pollutant_id: "PM2.5", avg_value: "20" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ total: 2, count: 1, limit: 1, offset: 0, records: [row] }))
      .mockResolvedValueOnce(jsonResponse({ total: 2, count: 1, limit: 1, offset: 1, records: [row] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCpcbByLocation("Pune");

    expect(result.status).toBe("unverified");
    expect(result.station).toBeNull();
    expect(result.message).toContain("repeated a station/pollutant/time row");
    expect(result.pagination).toMatchObject({
      status: "overlap", pageCount: 2, recordsReturned: 2, uniqueRecords: 1, duplicateRows: 1
    });
  });

  it("marks a conflicting value for the same station, pollutant, and observation time", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "test-key");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", RESOURCE_ID);
    const base = { country: "India", city: "Pune", station: "A", last_update: "20-11-2026 17:00", pollutant_id: "PM2.5" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ total: 2, count: 1, limit: 1, offset: 0, records: [{ ...base, avg_value: "20" }] }))
      .mockResolvedValueOnce(jsonResponse({ total: 2, count: 1, limit: 1, offset: 1, records: [{ ...base, avg_value: "21" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCpcbByLocation("Pune");

    expect(result.status).toBe("unverified");
    expect(result.station).toBeNull();
    expect(result.pagination).toMatchObject({ status: "conflict", conflictingRows: 1, uniqueRecords: 1 });
    expect(result.message).toContain("conflicting values");
  });

  it("marks a short page incomplete instead of continuing with guessed offsets", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "test-key");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", RESOURCE_ID);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      total: 3, count: 1, limit: 2, offset: 0,
      records: [{ country: "India", city: "Pune", station: "A", last_update: "20-11-2026 17:00", pollutant_id: "PM2.5", avg_value: "20" }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCpcbByLocation("Pune");

    expect(result.pagination).toMatchObject({ status: "incomplete", reportedTotal: 3, recordsReturned: 1, pageCount: 1 });
    expect(result.message).toContain("incomplete page");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for an immediate Retry-After before retrying one rate-limited page", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "test-key");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", RESOURCE_ID);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(jsonResponse({ total: 0, count: 0, limit: 500, offset: 0, records: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCpcbByLocation("Pune");

    expect(result.status).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches a complete city snapshot to avoid repeating paginated provider calls", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "test-key");
    vi.stubEnv("DATA_GOV_RESOURCE_ID", RESOURCE_ID);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      total: 1, count: 1, limit: 500, offset: 0,
      records: [{ country: "India", city: "Pune", station: "A", last_update: "20-11-2026 17:00", pollutant_id: "PM2.5", avg_value: "20" }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchCpcbByLocation("Pune");
    const second = await fetchCpcbByLocation("Pune");

    expect(first.station).toBe("A");
    expect(second.station).toBe("A");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
