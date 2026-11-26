import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/aqi/route";
import { airQualityResponseSchema } from "@/lib/validation/schemas";

afterEach(() => vi.unstubAllEnvs());

let nextTestClient = 1;

function requestFor(query: string): Request {
  return new Request("http://localhost/api/aqi?" + query, {
    headers: { "x-forwarded-for": `192.0.2.${nextTestClient++}` }
  });
}

describe("GET /api/aqi", () => {
  it("does not contact CPCB or OpenAQ in the development Cloudflare-only mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AIRWISE_LIVE_TEST_PROVIDER", "cloudflare");
    vi.stubEnv("DATA_GOV_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("OPENAQ_API_KEY", "configured-but-must-not-be-used");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(requestFor("city=Hyderabad"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.official.message).toContain("No CPCB request was made");
    expect(payload.supplementary.message).toContain("No OpenAQ request was made");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns explicitly unavailable source data without fetches in offline browser-test mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AIRWISE_OFFLINE_TESTS", "true");
    vi.stubEnv("DATA_GOV_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("OPENAQ_API_KEY", "configured-but-must-not-be-used");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(requestFor("city=Hyderabad"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.official.aqi).toBeNull();
    expect(payload.official.message).toContain("offline test mode");
    expect(payload.supplementary.measurements).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a schema-valid unavailable response when provider keys are missing", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "");
    vi.stubEnv("OPENAQ_API_KEY", "");

    const response = await GET(requestFor("city=Pune"));
    const payload: unknown = await response.json();
    const parsed = airQualityResponseSchema.safeParse(payload);

    expect(response.status).toBe(200);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.official.status).toBe("not_configured");
      expect(parsed.data.official.aqi).toBeNull();
      expect(parsed.data.supplementary.status).toBe("unavailable");
    }
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects malformed coordinates before provider work", async () => {
    const response = await GET(requestFor("city=Pune&latitude=91&longitude=73"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_location" });
  });
});
