import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOpenRouterAdvice, resetOpenRouterForTests } from "@/lib/ai/openrouter";
import type { AirQualityResponse } from "@/types/air-quality";
import { DEFAULT_PREFERENCES } from "@/types/preferences";

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
  summary: "Keep plans flexible and check official information before you leave.",
  recommendations: [{
    action: "Check conditions before outdoor plans",
    reason: "A live official AQI is unavailable, so current conditions are unknown.",
    intendedProfile: "People in Hyderabad",
    expectedBenefit: "Keeps planning tied to a source rather than an estimate.",
    practicalSteps: ["Check CPCB before a longer outdoor activity."],
    environmentalImpact: null,
    basis: ["general_guidance"],
    guidanceType: "general",
    personalizedBy: [],
    conditionalOn: []
  }],
  uncertainty: "Current outdoor conditions are unverified."
};

const modelCatalog = {
  data: [{
    id: "openrouter/free",
    endpoints: ["/api/v1/chat/completions"],
    supported_parameters: ["response_format", "structured_outputs"],
    pricing: { prompt: "0", completion: "0" }
  }]
};

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) } });
}

function configure() {
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-secret");
  vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
}

function validCompletion(content: unknown = JSON.stringify(advice)) {
  return {
    model: "openrouter/free",
    provider: "Test Provider",
    choices: [{
      finish_reason: "stop",
      message: { content }
    }]
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetOpenRouterForTests();
});

describe("OpenRouter response handling", () => {
  it("does not make a request without a configured API key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How should I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies catalogue support, sends strict AIRWISE JSON Schema, and reports safe success metadata", async () => {
    configure();
    const privateReasoning = "private reasoning must never be returned";
    const answerLength = JSON.stringify(advice).length;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({
        ...validCompletion(),
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(advice), reasoning: privateReasoning } }]
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: true,
      advice,
      diagnostic: {
        stage: "response", httpStatus: 200, providerName: "Test Provider", responseModel: "openrouter/free",
        finishReason: "stop", contentType: "string", contentLength: answerLength, reasoningPresent: true,
        outputMode: "json_schema", validationOutcome: "passed"
      }
    });
    expect(JSON.stringify(result)).not.toContain(privateReasoning);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [catalogUrl, catalogInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(catalogUrl).toBe("https://openrouter.ai/api/v1/models");
    expect(new Headers(catalogInit.headers).has("authorization")).toBe(false);
    const [chatUrl, chatInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(chatUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(chatInit.headers).get("authorization")).toBe("Bearer test-openrouter-secret");
    const body = JSON.parse(String(chatInit.body)) as Record<string, unknown>;
    expect(body.model).toBe("openrouter/free");
    expect(body.response_format).toMatchObject({
      type: "json_schema", json_schema: { name: "recommendation", strict: true }
    });
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.max_completion_tokens).toBe(1400);
    expect(JSON.stringify(body)).toContain("Hyderabad");
  });

  it("extracts a text block as candidate JSON without using reasoning", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse(validCompletion([{ type: "text", text: JSON.stringify(advice) }])));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: true, diagnostic: { contentType: "array", outputMode: "json_schema", validationOutcome: "passed" } });
  });

  it.each([
    { label: "null", content: null, contentType: "null" },
    { label: "empty", content: "", contentType: "string" }
  ])("rejects $label completion content", async ({ content, contentType }) => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse(validCompletion(content)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: false, code: "invalid_provider_response",
      diagnostic: { httpStatus: 200, contentType, contentLength: content === null ? 0 : 0, responseIssue: "missing_text_content", validationOutcome: "not_run" }
    });
  });

  it.each([
    { where: "response", expectedCode: "upstream_busy" },
    { where: "choice", expectedCode: "provider_unavailable" }
  ])("classifies an embedded HTTP 200 error at $where without exposing its message", async ({ where, expectedCode }) => {
    configure();
    const embedded = { code: expectedCode, message: "private prompt and provider detail" };
    const payload = where === "response"
      ? { error: embedded, ...validCompletion() }
      : { ...validCompletion(), choices: [{ error: embedded, finish_reason: "error", message: { content: null } }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse(payload, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "private prompt", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: false, code: "provider_unavailable",
      diagnostic: { httpStatus: 200, providerCode: expectedCode, validationOutcome: "not_run" }
    });
    expect(JSON.stringify(result)).not.toContain("private prompt");
    expect(JSON.stringify(result)).not.toContain("provider detail");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: "JSON mode only", supported: ["response_format"], expectedMode: "json_object", expectedFormat: { type: "json_object" } },
    { label: "plain JSON only", supported: [], expectedMode: "plain_json", expectedFormat: undefined }
  ])("uses the available catalogue output mode for $label models", async ({ supported, expectedMode, expectedFormat }) => {
    configure();
    const catalog = { data: [{ ...modelCatalog.data[0], supported_parameters: supported }] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(catalog))
      .mockResolvedValueOnce(jsonResponse(validCompletion()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: true, diagnostic: { outputMode: expectedMode, validationOutcome: "passed" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as { response_format?: unknown };
    expect(body.response_format).toEqual(expectedFormat);
  });

  it("stops on an embedded HTTP 200 authentication error without trying a fallback", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "invalid_api_key", message: "private invalid API key detail" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "not_configured", diagnostic: { httpStatus: 200, responseIssue: "authentication_rejected" } });
    expect(JSON.stringify(result)).not.toContain("private invalid API key detail");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("falls back to JSON mode only when the endpoint rejects JSON Schema", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ error: {
        code: "unsupported_parameter",
        message: "response_format json_schema is not supported by this endpoint"
      } }, 400))
      .mockResolvedValueOnce(jsonResponse(validCompletion()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: true, diagnostic: { outputMode: "json_object", validationOutcome: "passed" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [, schemaInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [, jsonModeInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(String(schemaInit.body))).toMatchObject({ response_format: { type: "json_schema" } });
    expect(JSON.parse(String(jsonModeInit.body))).toMatchObject({
      response_format: { type: "json_object" }, provider: { require_parameters: true }
    });
  });

  it("uses plain JSON instruction only after JSON mode is explicitly rejected", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ error: {
        code: "unsupported_parameter",
        message: "response_format json_schema is unsupported"
      } }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: {
        code: "unsupported_parameter",
        message: "response_format json_object is unsupported"
      } }, 400))
      .mockResolvedValueOnce(jsonResponse(validCompletion()));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: true, diagnostic: { outputMode: "plain_json", validationOutcome: "passed" } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const [, plainInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    const plainBody = JSON.parse(String(plainInit.body)) as { messages: Array<{ content: string }> ; response_format?: unknown };
    expect(plainBody.response_format).toBeUndefined();
    expect(plainBody.messages[0].content).toContain("Return exactly one JSON object");
  });

  it("rejects refusal, tool calls, and truncated output before parsing content", async () => {
    configure();
    const cases = [
      { payload: { ...validCompletion(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify(advice), refusal: "refused" } }] }, issue: "refusal" },
      { payload: { ...validCompletion(), choices: [{ finish_reason: "tool_calls", message: { content: JSON.stringify(advice), tool_calls: [{ id: "call-1" }] } }] }, issue: "tool_calls" },
      { payload: { ...validCompletion(), choices: [{ finish_reason: "length", message: { content: JSON.stringify(advice) } }] }, issue: "incomplete_output" }
    ];

    for (const testCase of cases) {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(modelCatalog))
        .mockResolvedValueOnce(jsonResponse(testCase.payload));
      vi.stubGlobal("fetch", fetchMock);

      const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

      expect(result).toMatchObject({ ok: false, diagnostic: { responseIssue: testCase.issue } });
      resetOpenRouterForTests();
    }
  });

  it("does not retry or hide HTTP 429 rate limits", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "rate_limit_exceeded", message: "wait before retry" } }, 429, { "Retry-After": "30" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: false, code: "provider_unavailable",
      message: expect.stringContaining("limit source"),
      diagnostic: {
        httpStatus: 429, providerCode: "rate_limit_exceeded", retryAfterMs: 30_000,
        responseIssue: "rate_limited", rateLimitClass: "unknown", rateLimitResetAt: null
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const blocked = await requestOpenRouterAdvice({ question: "Try again?", data, preferences: DEFAULT_PREFERENCES });
    expect(blocked).toMatchObject({
      ok: false, code: "provider_circuit_open",
      diagnostic: { stage: "circuit", retryAfterMs: expect.any(Number) }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      source: "openrouter_free_tier_daily",
      expectedClass: "openrouter_daily_limit",
      limit: "50",
      remaining: "0"
    },
    {
      source: "openrouter_free_tier_per_minute",
      expectedClass: "openrouter_per_minute_limit",
      limit: "20",
      remaining: "0"
    }
  ])("preserves $source classification and rate-limit headers", async ({ source, expectedClass, limit, remaining }) => {
    configure();
    const resetEpoch = Date.now() + 120_000;
    const payload = {
      error: {
        code: 429,
        message: "Rate limit exceeded",
        metadata: {
          limit_source: source,
          provider_name: null,
          provider_code: null,
          headers: {
            "X-RateLimit-Limit": limit,
            "X-RateLimit-Remaining": remaining,
            "X-RateLimit-Reset": String(resetEpoch),
            "Retry-After": "15"
          }
        }
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse(payload, 429));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining(expectedClass === "openrouter_daily_limit" ? "daily request limit" : "per-minute request limit"),
      diagnostic: {
        httpStatus: 429,
        rateLimitClass: expectedClass,
        rateLimitSource: source,
        rateLimitProviderName: null,
        rateLimitProviderCode: null,
        rateLimitLimit: Number(limit),
        rateLimitRemaining: Number(remaining),
        rateLimitResetAt: new Date(resetEpoch).toISOString(),
        retryAfterMs: 15_000,
        rateLimitRetryAt: new Date(resetEpoch).toISOString()
      }
    });
    expect(JSON.stringify(result)).not.toContain("Rate limit exceeded");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { message: "Provider rate limit exceeded", expectedClass: "upstream_provider_rate_limit" },
    { message: "Upstream provider temporarily at capacity", expectedClass: "upstream_provider_capacity" }
  ])("classifies upstream shared-pool errors as $expectedClass", async ({ message, expectedClass }) => {
    configure();
    const payload = {
      error: {
        code: 429,
        message,
        metadata: {
          limit_source: "upstream_provider_shared_pool",
          provider_name: "Example Provider",
          provider_code: "429"
        }
      }
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse(payload, 429));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        rateLimitClass: expectedClass,
        rateLimitSource: "upstream_provider_shared_pool",
        rateLimitProviderName: "Example Provider",
        rateLimitProviderCode: "429"
      }
    });
    expect(JSON.stringify(result)).not.toContain(message);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("classifies missing rate-limit metadata as unknown and opens the circuit", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 429, message: "provider denied request" } }, 429));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });
    const blocked = await requestOpenRouterAdvice({ question: "Try again?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: false,
      message: expect.stringContaining("did not identify the limit source"),
      diagnostic: {
        rateLimitClass: "unknown", rateLimitSource: null, rateLimitProviderName: null,
        rateLimitLimit: null, rateLimitRemaining: null, rateLimitResetAt: null, rateLimitRetryAt: null
      }
    });
    expect(blocked).toMatchObject({ ok: false, code: "provider_circuit_open" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("parses an HTTP-date Retry-After and combines it with the rate-limit reset", async () => {
    configure();
    const retryAt = Date.now() + 45_000;
    const retryAfterEpoch = new Date(new Date(retryAt).toUTCString()).getTime();
    const resetEpoch = retryAt - 10_000;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 429, message: "retry later" } }, 429, {
        "Retry-After": new Date(retryAt).toUTCString(),
        "X-RateLimit-Reset": String(resetEpoch)
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        retryAfterMs: expect.any(Number),
        rateLimitResetAt: new Date(resetEpoch).toISOString(),
        rateLimitRetryAt: new Date(retryAfterEpoch).toISOString()
      }
    });
    expect(result.diagnostic?.retryAfterMs).toBeGreaterThan(0);
    expect(result.diagnostic?.retryAfterMs).toBeLessThanOrEqual(45_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient server errors once but does not return upstream bodies", async () => {
    configure();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "temporarily_unavailable", message: "temporary issue" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "temporarily_unavailable", message: "temporary issue" } }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "provider_unavailable", diagnostic: { httpStatus: 503, providerCode: "temporarily_unavailable" } });
    expect(JSON.stringify(result)).not.toContain("test-openrouter-secret");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid JSON and invalid AIRWISE advice", async () => {
    configure();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse(validCompletion("not JSON")));
    vi.stubGlobal("fetch", fetchMock);
    const invalidJson = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });
    expect(invalidJson).toMatchObject({ ok: false, diagnostic: { responseIssue: "invalid_json_output" } });

    resetOpenRouterForTests();
    const unsafeAdvice = structuredClone(advice);
    unsafeAdvice.recommendations[0].reason = "The monitoring station is showing a value.";
    const unsafeFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse(validCompletion(JSON.stringify(unsafeAdvice))));
    vi.stubGlobal("fetch", unsafeFetch);
    const unsafe = await requestOpenRouterAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });
    expect(unsafe).toMatchObject({
      ok: false,
      diagnostic: { responseIssue: "station_claim", validationOutcome: "failed" }
    });
  });
});
