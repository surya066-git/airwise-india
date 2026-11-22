import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOllamaAdvice, resetOllamaCircuitForTests } from "@/lib/ai/ollama";
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
  summary: "Keep plans flexible and check the source before you leave.",
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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetOllamaCircuitForTests();
});

describe("optional local Ollama adapter", () => {
  it("is disabled by default even when a loopback model is configured", async () => {
    vi.stubEnv("OLLAMA_ENABLED", "false");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
    vi.stubEnv("OLLAMA_MODEL", "qwen3:4b");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOllamaAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call a provider unless loopback URL and model are configured", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "https://remote.example");
    vi.stubEnv("OLLAMA_MODEL", "qwen3:4b");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOllamaAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests structured output locally and validates it with AIRWISE rules", async () => {
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
    vi.stubEnv("OLLAMA_MODEL", "qwen3:4b");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: { content: JSON.stringify(advice) } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOllamaAdvice({ question: "How can I plan?", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toEqual({ ok: true, advice });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(request.format).toBeTruthy();
    expect(request.stream).toBe(false);
    expect(JSON.stringify(request)).toContain("Hyderabad");
  });

  it("classifies service failures without returning upstream error text", async () => {
    vi.stubEnv("OLLAMA_ENABLED", "true");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    vi.stubEnv("OLLAMA_MODEL", "qwen3:4b");
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "private upstream detail" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestOllamaAdvice({ question: "Help", data, preferences: DEFAULT_PREFERENCES });

    expect(result).toMatchObject({ ok: false, code: "provider_unavailable", diagnostic: { httpStatus: 503 } });
    expect(JSON.stringify(result)).not.toContain("private upstream detail");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
