import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { resetCloudflareCircuitForTests } from "@/lib/ai/cloudflare";
import { resetGeminiCircuitForTests } from "@/lib/ai/gemini";
import { resetOpenRouterForTests } from "@/lib/ai/openrouter";
import { resetOllamaCircuitForTests } from "@/lib/ai/ollama";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetGeminiCircuitForTests();
  resetCloudflareCircuitForTests();
  resetOpenRouterForTests();
  resetOllamaCircuitForTests();
});

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
});

function requestFor(body: unknown): Request {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100." + Math.floor(Math.random() * 250)
    },
    body: JSON.stringify(body)
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

describe("POST /api/assistant", () => {
  it("uses one Cloudflare attempt and no other provider or AQI source in the dev-only live-test mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AIRWISE_LIVE_TEST_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cloudflare-test-secret");
    vi.stubEnv("CLOUDFLARE_AI_MODEL", "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    vi.stubEnv("DATA_GOV_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("OPENAQ_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("GEMINI_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("OPENROUTER_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("OLLAMA_ENABLED", "true");
    const advice = {
      summary: "Compare practical commute choices while checking verified local data when it is available.",
      recommendations: [{
        action: "Compare route options away from heavy traffic where practical",
        reason: "No live official AQI or pollutant readings were retrieved, so the suggestion uses general travel guidance.",
        intendedProfile: "Residents in Hyderabad",
        expectedBenefit: "May make a regular trip more comfortable without assuming current pollution levels.",
        practicalSteps: ["Compare a quieter route and a transit option when planning your usual trip."],
        environmentalImpact: null,
        basis: ["selected_location", "general_guidance"],
        guidanceType: "general",
        personalizedBy: [],
        conditionalOn: []
      }],
      uncertainty: "No current CPCB AQI or OpenAQ readings were retrieved; local air conditions remain unknown."
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(advice) } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(requestFor({
      city: "Hyderabad",
      messages: [{ role: "user", content: "How can I make better daily travel decisions to reduce my exposure to air pollution?" }]
    }));
    const payload = await response.json();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = JSON.parse(String(init.body)) as { messages: Array<{ content: string }> };
    const sentContext = JSON.parse(sentBody.messages[1].content.split("\n")[1] ?? "{}") as {
      lifestylePreferences?: Record<string, unknown>;
      availablePersonalizationKeys?: string[];
      unconfirmedPreferenceKeys?: string[];
    };

    expect(response.status).toBe(200);
    expect(payload.provider).toBe("Cloudflare Workers AI");
    expect(payload.responseMode).toBe("ai_generated");
    expect(payload.advice).toEqual(advice);
    expect(payload.diagnostics.cloudflare.validationOutcome).toBe("passed");
    expect(payload.limitationNotice).toContain("No verified CPCB AQI or OpenAQ readings");
    expect(payload.verifiedData).toContain("No CPCB request was made");
    expect(sentBody.messages[1].content).toContain("How can I make better daily travel decisions");
    expect(sentContext.lifestylePreferences).toEqual({});
    expect(sentContext.availablePersonalizationKeys).toEqual([]);
    expect(sentContext.unconfirmedPreferenceKeys).toContain("commute");
    expect(url).toContain("api.cloudflare.com/client/v4/accounts/");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(payload)).not.toContain("cloudflare-test-secret");
  });

  it("returns labeled standard guidance and separate route/upstream statuses after Cloudflare failure", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AIRWISE_LIVE_TEST_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cloudflare-test-secret");
    vi.stubEnv("CLOUDFLARE_AI_MODEL", "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    vi.stubEnv("GEMINI_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("OPENROUTER_API_KEY", "configured-but-must-not-be-used");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "service_unavailable" } }, 503));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(requestFor({
      city: "Hyderabad", messages: [{ role: "user", content: "How can I plan my commute?" }]
    }));
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toMatchObject({
      error: "cloudflare_live_test_failed", failedProvider: "Cloudflare Workers AI",
      provider: "AIRWISE rules", responseMode: "standard_guidance", upstreamHttpStatus: 503,
      diagnostics: { cloudflare: { diagnosticCategory: "upstream_http_error", httpStatus: 503 } }
    });
    expect(payload.message).toContain("not AI-generated");
    expect(payload.advice.recommendations.length).toBeGreaterThan(0);
    expect(payload.limitationNotice).toContain("No verified CPCB AQI or OpenAQ readings");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("blocks every live source and AI provider in development offline-test mode", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AIRWISE_OFFLINE_TESTS", "true");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "configured-but-must-not-be-used");
    vi.stubEnv("GEMINI_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("OPENROUTER_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("DATA_GOV_API_KEY", "configured-but-must-not-be-used");
    vi.stubEnv("OPENAQ_API_KEY", "configured-but-must-not-be-used");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(requestFor({
      city: "Hyderabad", messages: [{ role: "user", content: "How should I plan a commute?" }]
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.responseMode).toBe("standard_guidance");
    expect(payload.provider).toBe("AIRWISE rules");
    expect(payload.limitationNotice).toContain("current local air conditions are unknown");
    expect(payload.verifiedData).toContain("offline test mode");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns deterministic standard guidance when all AI providers are unconfigured", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "");
    vi.stubEnv("OPENAQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");

    const response = await POST(requestFor({
      city: "Pune",
      messages: [{ role: "user", content: "How can I combine my commute?" }]
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.responseMode).toBe("standard_guidance");
    expect(payload.provider).toBe("AIRWISE rules");
    expect(payload.advice.summary).toContain("not AI-generated advice");
    expect(payload.advice.recommendations).toHaveLength(4);
    expect(payload.advice.recommendations.some((item: { action: string }) => item.action.includes("evening"))).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("stack");
  });

  it("returns a clear uncertainty answer for current conditions without live official AQI", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "");
    vi.stubEnv("OPENAQ_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");

    const response = await POST(requestFor({
      city: "Hyderabad",
      messages: [{ role: "user", content: "Is it safe to go for a morning walk today?" }]
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.answer).toContain("No live official CPCB AQI is available.");
    expect(payload.verifiedData).toContain("not calculated one");
  });

  it("rejects malformed assistant input", async () => {
    const response = await POST(requestFor({ city: "Pune", messages: [] }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("returns standard guidance with safe Gemini outage diagnostics", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "");
    vi.stubEnv("OPENAQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "test-secret-do-not-print");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      json: async () => ({ error: { code: "service_unavailable", message: "Temporary high demand" } })
    }));

    const response = await POST(requestFor({
      city: "Pune",
      messages: [{ role: "user", content: "How can I plan a lower-emission commute?" }]
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.responseMode).toBe("standard_guidance");
    expect(payload.diagnostics.gemini).toMatchObject({
      stage: "provider", httpStatus: 503, providerCode: "service_unavailable", providerMessage: "Temporary high demand"
    });
    expect(JSON.stringify(payload)).not.toContain("test-secret-do-not-print");
  });

  it("serves validated OpenRouter advice through the full assistant route after Gemini outage", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "");
    vi.stubEnv("OPENAQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    vi.spyOn(Math, "random").mockReturnValue(0);
    const advice = {
      summary: "Keep plans flexible and check official information before you leave.",
      recommendations: [{
        action: "Try a shared trip when it fits",
        reason: "Sharing a ride can reduce the number of separate vehicle trips.",
        intendedProfile: "Residents and households",
        expectedBenefit: "A practical option that may reduce private vehicle use.",
        practicalSteps: ["Consider transit or a shared ride when it fits the route."],
        environmentalImpact: "May avoid some vehicle emissions; no numerical impact is estimated.",
        basis: ["general_guidance"],
        guidanceType: "general",
        personalizedBy: [],
        conditionalOn: []
      }],
      uncertainty: "Current outdoor conditions are unverified."
    };
    const catalog = { data: [{
      id: "openrouter/free", endpoints: ["/api/v1/chat/completions"],
      supported_parameters: ["structured_outputs"], pricing: { prompt: "0", completion: "0" }
    }] };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), json: async () => ({ error: { status: "service_unavailable" } }) })
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), json: async () => ({ error: { status: "service_unavailable" } }) })
      .mockResolvedValueOnce(jsonResponse(catalog))
      .mockResolvedValueOnce(jsonResponse({ model: "openrouter/free", provider: "MockProvider", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(advice) } }] })));

    const response = await POST(requestFor({
      city: "Pune",
      messages: [{ role: "user", content: "How can I make my commute lower emission?" }]
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.provider).toBe("OpenRouter");
    expect(payload.responseMode).toBe("ai_generated");
    expect(payload.advice).toEqual(advice);
    expect(payload.diagnostics.openrouter).toMatchObject({
      outputMode: "json_schema", validationOutcome: "passed",
      responseModel: "openrouter/free", providerName: "MockProvider", finishReason: "stop"
    });
    expect(payload.diagnostics.gemini).toMatchObject({ httpStatus: 503 });
    expect(JSON.stringify(payload)).not.toContain("test-openrouter-key");
  });

  it("returns a safe OpenRouter rate-limit notice with rule-based guidance", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "");
    vi.stubEnv("OPENAQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubEnv("OPENROUTER_MODEL", "openrouter/free");
    const resetAt = Date.now() + 90_000;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), json: async () => ({ error: { status: "service_unavailable" } }) })
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers(), json: async () => ({ error: { status: "service_unavailable" } }) })
      .mockResolvedValueOnce(jsonResponse({ data: [{
        id: "openrouter/free", endpoints: ["/api/v1/chat/completions"],
        supported_parameters: ["response_format", "structured_outputs"], pricing: { prompt: "0", completion: "0" }
      }] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: {
        code: 429,
        message: "private provider diagnostic detail",
        metadata: { limit_source: "openrouter_free_tier_per_minute", provider_name: null, provider_code: null }
      } }), { status: 429, headers: {
        "Content-Type": "application/json",
        "Retry-After": "10",
        "X-RateLimit-Limit": "20",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetAt)
      } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(requestFor({
      city: "Pune",
      messages: [{ role: "user", content: "How can I plan a lower-emission commute?" }]
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.responseMode).toBe("standard_guidance");
    expect(payload.provider).toBe("AIRWISE rules");
    expect(payload.providerNotice).toContain("per-minute request limit");
    expect(payload.diagnostics.openrouter).toMatchObject({
      httpStatus: 429,
      responseIssue: "rate_limited",
      rateLimitClass: "openrouter_per_minute_limit",
      rateLimitLimit: 20,
      rateLimitRemaining: 0,
      rateLimitResetAt: new Date(resetAt).toISOString()
    });
    expect(JSON.stringify(payload)).not.toContain("private provider diagnostic detail");
    expect(JSON.stringify(payload)).not.toContain("test-openrouter-key");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns a validated Cloudflare recommendation through the complete assistant route", async () => {
    vi.stubEnv("DATA_GOV_API_KEY", "");
    vi.stubEnv("OPENAQ_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cloudflare-test-secret");
    const advice = {
      summary: "Compare shared travel options that fit your routine.",
      recommendations: [{
        action: "Compare transit options before leaving",
        reason: "A live official AQI is unavailable, so this is general travel guidance.",
        intendedProfile: "Daily commuters in Hyderabad",
        expectedBenefit: "Can make routine travel simpler while reducing separate vehicle trips.",
        practicalSteps: ["Check a transit route and departure time before setting out."],
        environmentalImpact: "Shared transit may reduce individual vehicle use; no numerical estimate is available.",
        basis: ["general_guidance"],
        guidanceType: "general",
        personalizedBy: [],
        conditionalOn: []
      }],
      uncertainty: "Current outdoor pollution conditions are unverified."
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(advice) } }]
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(requestFor({
      city: "Hyderabad",
      messages: [{ role: "user", content: "How can I make better daily travel decisions?" }],
      preferences: {
        ageGroup: "Prefer not to say", occupation: "Office worker", commute: "Mixed",
        outdoorActivity: "Sometimes", children: false, olderAdults: false
      }
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.responseMode).toBe("ai_generated");
    expect(payload.provider).toBe("Cloudflare Workers AI");
    expect(payload.advice).toEqual(advice);
    expect(payload.verifiedData).toContain("Official CPCB AQI: unavailable");
    expect(payload.diagnostics.cloudflare).toMatchObject({
      httpStatus: 200, outputMode: "json_schema", validationOutcome: "passed"
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(payload)).not.toContain("cloudflare-test-secret");
  });
});
