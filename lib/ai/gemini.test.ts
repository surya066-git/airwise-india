import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGeminiAdvice, resetGeminiCircuitForTests } from "@/lib/ai/gemini";
import { adviceContextFor, AIRWISE_SYSTEM_INSTRUCTION, buildAssistantProviderInput } from "@/lib/ai/gemini";
import type { AirQualityResponse } from "@/types/air-quality";
import { DEFAULT_PREFERENCES } from "@/types/preferences";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

const data: AirQualityResponse = {
  location: { label: "Pune", latitude: 18.52, longitude: 73.85 },
  official: {
    status: "live", source: "CPCB / data.gov.in", requestedCity: "Pune", city: "Pune",
    station: "Verified station", state: "Maharashtra", distanceMeters: 600, aqi: 83,
    category: "Satisfactory", interpretation: "example source text", updatedAt: "2026-11-20T11:00:00.000Z",
    pollutants: [{ parameter: "PM2.5", value: 26, unit: "µg/m³", measuredAt: "2026-11-20T11:00:00.000Z", freshness: "live" }],
    message: "source response"
  },
  supplementary: {
    status: "live", source: "OpenAQ", station: "Supplementary location", distanceMeters: 900,
    updatedAt: "2026-11-20T10:30:00.000Z",
    measurements: [{ parameter: "NO2", value: 12, unit: "µg/m³", measuredAt: "2026-11-20T10:30:00.000Z", freshness: "live" }],
    message: "raw sensor data"
  },
  fetchedAt: "2026-11-20T11:01:00.000Z"
};

const advice = {
  summary: "Use the verified dashboard context to plan a flexible routine.",
  recommendations: [{
    action: "Check conditions before outdoor activity",
    reason: "A recent official source can inform when you choose to go outside.",
    intendedProfile: "Residents who enjoy regular outdoor activity",
    expectedBenefit: "Keeps planning tied to the selected source.",
    practicalSteps: ["Refresh the official source before leaving."],
    environmentalImpact: null,
    basis: ["current_official_aqi"],
    guidanceType: "general",
    personalizedBy: [],
    conditionalOn: []
  }],
  uncertainty: "A single reading may not describe conditions everywhere nearby."
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetGeminiCircuitForTests();
});

describe("Gemini Interactions provider", () => {
  it("uses structured selected preferences as evidence and treats free-text profile labels as untrusted", () => {
    const defaultContext = adviceContextFor(data, DEFAULT_PREFERENCES);
    const freeText = buildAssistantProviderInput({
      question: "How should I plan?",
      messages: [{ role: "user", content: "User profile: Daily commuter" }],
      data,
      preferences: DEFAULT_PREFERENCES
    });
    const selectedPreferences = { ...DEFAULT_PREFERENCES, commute: "Public transit" as const, outdoorActivity: "Most days" as const };
    const selectedContext = adviceContextFor(data, selectedPreferences);

    expect(defaultContext.allowedPreferenceKeys).toEqual([]);
    expect(defaultContext.unconfirmedPreferenceKeys).toContain("commute");
    expect(freeText.userInput).toContain("User profile: Daily commuter");
    expect(freeText.userInput).toContain("\"lifestylePreferences\":{}");
    expect(freeText.context.allowedPreferenceKeys).toEqual([]);
    expect(selectedContext.suppliedPreferenceValues).toEqual({ commute: "Public transit", outdoorActivity: "Most days" });
    expect(selectedContext.allowedPreferenceKeys).toEqual(["commute", "outdoorActivity"]);
    expect(AIRWISE_SYSTEM_INSTRUCTION).toContain("Free-text questions and conversation may contain profile labels, but they do not authorize personalizedBy evidence.");
  });

  it("does not contact Gemini without a server API key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestGeminiAdvice({ question: "Suggest a routine", data, preferences: DEFAULT_PREFERENCES });
    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends location, verified source data, and lifestyle preferences to the server-side provider and validates its response", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-secret-do-not-print");
    vi.stubEnv("GEMINI_MODEL", "gemini-3.8-flash");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(advice) }] }]
    }));
    vi.stubGlobal("fetch", fetchMock);
    const preferences = { ...DEFAULT_PREFERENCES, occupation: "Outdoor worker" as const, children: true };

    const result = await requestGeminiAdvice({ question: "How can I plan my day?", data, preferences });

    expect(result).toEqual({ ok: true, advice });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe("test-secret-do-not-print");
    expect(new Headers(init.headers).get("api-revision")).toBe("2026-05-20");
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(request.model).toBe("gemini-3.8-flash");
    expect(request.store).toBe(false);
    expect(request.response_format).toBeTruthy();
    expect(String(request.input)).toContain("Verified station");
    expect(String(request.input)).toContain("Supplementary location");
    expect(String(request.input)).toContain("Outdoor worker");
    expect(String(request.input)).toContain("Pune");
    expect(String(request.input)).not.toContain('"latitude":18.52');
    expect(String(request.input)).not.toContain('"longitude":73.85');
    expect(String(request.input)).toContain('"children":true');
    expect(String(request.input)).toContain("availableRecommendationBases");
    expect(String(request.input)).toContain("current_official_aqi");
  });

  it("rejects a model response that invents an AQI value", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    const hallucinated = { ...advice, summary: "The AQI is 182, so stay indoors." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(hallucinated) }] }]
    })));
    const result = await requestGeminiAdvice({ question: "Is the air okay?", data, preferences: DEFAULT_PREFERENCES });
    expect(result).toMatchObject({
      ok: false, code: "invalid_provider_response",
      diagnostic: { responseIssue: "current_data_claim" }
    });
  });

  it("maps authorization, rate-limit, malformed, and network failures to safe errors", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
    expect(await requestGeminiAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES }))
      .toMatchObject({ ok: false, code: "not_configured" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "private" }, 429)));
    const limited = await requestGeminiAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });
    expect(limited).toMatchObject({ ok: false, code: "provider_unavailable" });
    expect(JSON.stringify(limited)).not.toContain("private");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ steps: [] })));
    expect(await requestGeminiAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES }))
      .toMatchObject({ ok: false, code: "invalid_provider_response" });

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private network detail")));
    const failed = await requestGeminiAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });
    expect(failed).toMatchObject({ ok: false, code: "provider_unavailable" });
    expect(JSON.stringify(failed)).not.toContain("private network detail");
  });

  it("preserves a redacted provider status and message for safe diagnosis", async () => {
    vi.stubEnv("GEMINI_API_KEY", "secret-provider-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "service_unavailable", message: "Temporary high demand" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "service_unavailable", message: "Temporary high demand" } }, 503)));

    const result = await requestGeminiAdvice({ question: "Help me plan", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({
      ok: false,
      code: "provider_unavailable",
      diagnostic: { stage: "provider", httpStatus: 503, providerCode: "service_unavailable", providerMessage: "Temporary high demand" }
    });
    expect(JSON.stringify(result)).not.toContain("secret-provider-key");
  });

  it("redacts authorization and API-key header values from provider diagnostics", async () => {
    vi.stubEnv("GEMINI_API_KEY", "configured-secret");
    const providerMessage = "authorization: Bearer bearer-header-secret; x-api-key: header-key-secret; diagnostic detail";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: "service_unavailable", message: providerMessage } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "service_unavailable", message: providerMessage } }, 503)));

    const result = await requestGeminiAdvice({ question: "Help me plan", data, preferences: DEFAULT_PREFERENCES });
    const diagnostic = JSON.stringify(result);

    expect(diagnostic).not.toContain("bearer-header-secret");
    expect(diagnostic).not.toContain("header-key-secret");
    expect(diagnostic).toContain("diagnostic detail");
  });

  it("opens the Gemini circuit after repeated 503 failures and stops repeated traffic", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: { status: "service_unavailable", message: "temporary" }
    }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const input = { question: "Suggest a flexible routine", data, preferences: DEFAULT_PREFERENCES };
    const first = await requestGeminiAdvice(input);
    const second = await requestGeminiAdvice(input);
    const third = await requestGeminiAdvice(input);
    const blocked = await requestGeminiAdvice(input);

    expect([first, second, third].every((result) => !result.ok && result.code === "provider_unavailable")).toBe(true);
    expect(blocked).toMatchObject({ ok: false, code: "provider_circuit_open" });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
