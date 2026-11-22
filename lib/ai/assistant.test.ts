import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCloudflareCircuitForTests } from "@/lib/ai/cloudflare";
import { resolveAssistantAdvice } from "@/lib/ai/assistant";
import { resetGeminiCircuitForTests } from "@/lib/ai/gemini";
import { resetOpenRouterForTests } from "@/lib/ai/openrouter";
import { resetOllamaCircuitForTests } from "@/lib/ai/ollama";
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

const localAdvice = {
  summary: "Keep plans flexible and check the official source before you leave.",
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
    id: "openrouter/free", endpoints: ["/api/v1/chat/completions"],
    supported_parameters: ["structured_outputs"], pricing: { prompt: "0", completion: "0" }
  }]
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetGeminiCircuitForTests();
  resetCloudflareCircuitForTests();
  resetOpenRouterForTests();
  resetOllamaCircuitForTests();
});

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
});

describe("AI provider resolution", () => {
  it("routes validated advice through Cloudflare first and attributes the provider", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cloudflare-test-secret");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-secret");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(localAdvice) } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAssistantAdvice({ question: "How should I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result.mode).toBe("ai_generated");
    expect(result.provider).toBe("Cloudflare Workers AI");
    expect(result.advice).toEqual(localAdvice);
    expect(result.diagnostics.cloudflare).toMatchObject({ validationOutcome: "passed", outputMode: "json_schema" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetchMock.mock.calls[0])).not.toContain("gemini-test-secret");
  });

  it("returns deterministic profile-based guidance when no AI provider is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    vi.stubEnv("OLLAMA_MODEL", "");
    vi.stubEnv("OLLAMA_ENABLED", "false");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const preferences = { ...DEFAULT_PREFERENCES, occupation: "Student" as const, commute: "Public transit" as const };

    const result = await resolveAssistantAdvice({ question: "How should I plan?", data, preferences });

    expect(result.mode).toBe("standard_guidance");
    expect(result.provider).toBe("AIRWISE rules");
    expect(result.advice.summary).toContain("not AI-generated advice");
    expect(result.advice.recommendations[2]?.personalizedBy).toEqual(["commute"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the optional local adapter after Gemini fails and keeps structured validation", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
    vi.stubEnv("OLLAMA_MODEL", "qwen3:4b");
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { status: "service_unavailable" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { status: "service_unavailable" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ message: { content: JSON.stringify(localAdvice) } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAssistantAdvice({ question: "How should I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result.mode).toBe("ai_generated");
    expect(result.provider).toBe("Ollama");
    expect(result.advice).toEqual(localAdvice);
    expect(result.diagnostics.gemini).toMatchObject({ httpStatus: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid local model response and falls back to standard rules", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
    vi.stubEnv("OLLAMA_MODEL", "qwen3:4b");
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: { content: "not JSON" } })));

    const result = await resolveAssistantAdvice({ question: "How should I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result.mode).toBe("standard_guidance");
    expect(result.provider).toBe("AIRWISE rules");
    expect(result.diagnostics.ollama).toMatchObject({ responseIssue: "invalid_json_output" });
  });

  it("keeps local Ollama unavailable in production even when explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
    vi.stubEnv("OLLAMA_MODEL", "qwen3:4b");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAssistantAdvice({ question: "How should I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result.provider).toBe("AIRWISE rules");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes a Gemini availability failure to OpenRouter and labels the validated provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { status: "service_unavailable" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { status: "service_unavailable" } }, 503))
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: JSON.stringify(localAdvice) } }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAssistantAdvice({ question: "How should I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result.mode).toBe("ai_generated");
    expect(result.provider).toBe("OpenRouter");
    expect(result.advice).toEqual(localAdvice);
    expect(result.diagnostics.gemini).toMatchObject({ httpStatus: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uses deterministic guidance when Gemini and OpenRouter both fail", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { status: "service_unavailable" } }, 503))
      .mockResolvedValueOnce(jsonResponse({ error: { status: "service_unavailable" } }, 503))
      .mockResolvedValueOnce(jsonResponse(modelCatalog))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "rate_limited" } }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: { code: "rate_limited" } }, 429));
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveAssistantAdvice({ question: "How should I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result.mode).toBe("standard_guidance");
    expect(result.provider).toBe("AIRWISE rules");
    expect(result.advice.summary).toContain("not AI-generated advice");
    expect(result.diagnostics.gemini).toMatchObject({ httpStatus: 503 });
    expect(result.diagnostics.openrouter).toMatchObject({ httpStatus: 429 });
    expect(result.providerNotice).toContain("did not identify the limit source");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
