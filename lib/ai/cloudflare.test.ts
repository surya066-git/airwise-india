import { afterEach, describe, expect, it, vi } from "vitest";
import { getCloudflareHealth, requestCloudflareAdvice, resetCloudflareCircuitForTests } from "@/lib/ai/cloudflare";
import type { AirQualityResponse } from "@/types/air-quality";
import { DEFAULT_PREFERENCES } from "@/types/preferences";
import { GEMINI_ADVICE_JSON_SCHEMA } from "@/lib/validation/advice";

const ACCOUNT_ID = "0123456789abcdef0123456789abcdef";
const API_TOKEN = "cloudflare-test-secret";
const data: AirQualityResponse = {
  location: { label: "Hyderabad", latitude: 17.385, longitude: 78.4867 },
  official: {
    status: "unverified", source: "CPCB / data.gov.in", requestedCity: "Hyderabad", city: null,
    station: null, state: null, distanceMeters: null, aqi: null, category: null,
    interpretation: null, updatedAt: null, pollutants: [], message: "AQI unavailable"
  },
  supplementary: {
    status: "unavailable", source: "OpenAQ", station: null, distanceMeters: null,
    updatedAt: null, measurements: [], message: "No measurements"
  },
  fetchedAt: "2026-11-21T00:00:00.000Z"
};
const advice = {
  summary: "Keep travel plans flexible and choose a practical shared option when it fits.",
  recommendations: [{
    action: "Compare transit options before leaving",
    reason: "A live official AQI is unavailable, so this suggestion is general travel guidance.",
    intendedProfile: "Daily commuters in Hyderabad",
    expectedBenefit: "Can make routine travel simpler while reducing separate vehicle trips.",
    practicalSteps: ["Check a transit route and departure time before setting out."],
    environmentalImpact: "Choosing shared transit may reduce individual vehicle use; no numerical estimate is available.",
    basis: ["general_guidance"],
    guidanceType: "general",
    personalizedBy: [],
    conditionalOn: []
  }],
  uncertainty: "Current outdoor pollution conditions are unverified."
};

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers).entries()) }
  });
}

function configure() {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT_ID);
  vi.stubEnv("CLOUDFLARE_API_TOKEN", API_TOKEN);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetCloudflareCircuitForTests();
});

describe("Cloudflare Workers AI adapter", () => {
  it("does not call the service when either required credential is missing", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", ACCOUNT_ID);
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestCloudflareAdvice({ question: "Travel?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(getCloudflareHealth()).toMatchObject({ configured: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the account-scoped OpenAI-compatible JSON Schema request and validates success", async () => {
    configure();
    vi.stubEnv("CLOUDFLARE_AI_MODEL", "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(advice) } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestCloudflareAdvice({
      question: "How can I make better daily travel decisions?", data, preferences: DEFAULT_PREFERENCES
    });

    expect(result).toMatchObject({
      ok: true,
      advice,
      diagnostic: { httpStatus: 200, outputMode: "json_schema", validationOutcome: "passed", providerName: "Cloudflare Workers AI" }
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/v1/chat/completions`);
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${API_TOKEN}`);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", max_tokens: 1600, temperature: 0.2, stream: false,
      response_format: { type: "json_schema", json_schema: GEMINI_ADVICE_JSON_SCHEMA }
    });
    const responseFormat = request.response_format as Record<string, unknown>;
    expect(responseFormat).not.toHaveProperty("name");
    expect(responseFormat).not.toHaveProperty("strict");
    expect(responseFormat).not.toHaveProperty("schema");
    expect(JSON.stringify(request)).toContain("Hyderabad");
    expect(JSON.stringify(request)).toContain("How can I make better daily travel decisions?");
  });

  it("rejects authentication failures without returning response details or credentials", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: { code: "invalid_api_token", message: `Bearer ${API_TOKEN} must be rotated` }
    }, 401)));

    const result = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "not_configured", diagnostic: { httpStatus: 401 } });
    expect(JSON.stringify(result)).not.toContain(API_TOKEN);
    expect(JSON.stringify(result)).not.toContain("must be rotated");
  });

  it("rejects malformed JSON and structurally invalid advice", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "not-json" } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify({ ...advice, extra: true }) } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const malformed = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });
    const invalid = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(malformed).toMatchObject({ ok: false, diagnostic: {
      responseIssue: "invalid_json_output", diagnosticCategory: "json_parse_failure", validationOutcome: "failed"
    } });
    expect(invalid).toMatchObject({ ok: false, diagnostic: {
      responseIssue: "schema_invalid", diagnosticCategory: "schema_validation_failure", validationOutcome: "failed"
    } });
  });

  it("captures safe field paths and types for missing or malformed schema fields", async () => {
    configure();
    const missingSummary = { ...advice } as Record<string, unknown>;
    delete missingSummary.summary;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(missingSummary) } }]
    })));

    const result = await requestCloudflareAdvice({ question: "Private question text", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, diagnostic: {
      diagnosticCategory: "schema_validation_failure",
      validationIssues: [{ path: "summary", expectedType: "string", actualType: "missing", missingField: "summary" }]
    } });
    expect(JSON.stringify(result)).not.toContain("Private question text");
    expect(JSON.stringify(result)).not.toContain(JSON.stringify(missingSummary));
  });

  it.each([
    ["empty string", "", "empty_model_content", "empty_model_content", "string"],
    ["null content", null, "upstream_invalid_response", "null_model_content", "null"]
  ])("classifies %s without exposing output", async (_label, content, category, issue, contentType) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ finish_reason: "stop", message: { content } }]
    })));

    const result = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, diagnostic: {
      diagnosticCategory: category, responseIssue: issue, contentType, validationOutcome: "failed"
    } });
  });

  it.each([
    ["missing choices", {}, "invalid_response_envelope"],
    ["invalid top-level JSON shape", [], "invalid_response_envelope"],
    ["refusal", { choices: [{ finish_reason: "stop", message: { refusal: "private refusal detail", content: "" } }] }, "model_refusal"],
    ["incomplete response", { choices: [{ finish_reason: "length", message: { content: JSON.stringify(advice) } }] }, "incomplete_response"]
  ])("rejects %s as an upstream invalid response", async (_label, body, issue) => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));

    const result = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, diagnostic: {
      diagnosticCategory: "upstream_invalid_response", responseIssue: issue, validationOutcome: "failed"
    } });
    expect(JSON.stringify(result)).not.toContain("private refusal detail");
  });

  it("preserves the upstream HTTP status and safe category without retaining provider text", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: { code: "service_unavailable", message: "private upstream detail" }
    }, 503)));

    const result = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, diagnostic: {
      httpStatus: 503, diagnosticCategory: "upstream_http_error", validationOutcome: "not_run"
    } });
    expect(JSON.stringify(result)).not.toContain("private upstream detail");
  });

  it("honors Retry-After and opens the circuit without retrying a 429", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "rate_limited" } }, 429, { "Retry-After": "120" }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });
    const second = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(first).toMatchObject({
      ok: false, diagnostic: { httpStatus: 429, rateLimitClass: "cloudflare_rate_limit", retryAfterMs: 120_000 }
    });
    expect(second).toMatchObject({ ok: false, code: "provider_circuit_open" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCloudflareHealth().state).toBe("open");
  });

  it("fails closed on a timed-out transport without retrying an expired request", async () => {
    configure();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    const fetchMock = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestCloudflareAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "provider_unavailable", diagnostic: { stage: "transport", httpStatus: null } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
