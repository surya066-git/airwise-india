import { expect, test } from "@playwright/test";
import { requestOpenRouterAdvice } from "@/lib/ai/openrouter";
import type { AirQualityResponse } from "@/types/air-quality";
import { DEFAULT_PREFERENCES } from "@/types/preferences";

const endpoint = "https://openrouter.ai/api/v1/chat/completions";
const catalogueEndpoint = "https://openrouter.ai/api/v1/models";
const model = process.env.OPENROUTER_MODEL || "openrouter/free";
const canContactOpenRouter = process.env.AIRWISE_LIVE_TESTS === "1" && Boolean(process.env.OPENROUTER_API_KEY);
let liveRateLimited = false;

const minimalSchema = {
  type: "object",
  properties: {
    result: { type: "string" },
    reason: { type: "string" },
    next_step: { type: "string" }
  },
  required: ["result", "reason", "next_step"],
  additionalProperties: false
};

const data: AirQualityResponse = {
  location: { label: "Hyderabad", latitude: null, longitude: null },
  official: {
    status: "unavailable", source: "CPCB / data.gov.in", requestedCity: "Hyderabad", city: null,
    station: null, state: null, distanceMeters: null, aqi: null, category: null,
    interpretation: null, updatedAt: null, pollutants: [], message: "No explicit official AQI was returned."
  },
  supplementary: {
    status: "unavailable", source: "OpenAQ", station: null, distanceMeters: null,
    updatedAt: null, measurements: [], message: "No OpenAQ measurements were returned for this test fixture."
  },
  fetchedAt: new Date().toISOString()
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeCode(value: unknown): string | null {
  const code = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) && !/sk-or-v1-|bearer/i.test(code) ? code : null;
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  return label.length > 0 && label.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9 ._:/@+-]*$/.test(label) ? label : null;
}

function extractText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const joined = content.flatMap((part) =>
    isRecord(part) && typeof part.text === "string" && (part.type === undefined || part.type === "text")
      ? [part.text] : []
  ).join("").trim();
  return joined || null;
}

function errorCode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return safeCode(value.code ?? value.type ?? value.status);
}

function inspectCompletion(status: number, payload: unknown) {
  const root = isRecord(payload) ? payload : {};
  const choice = Array.isArray(root.choices) && isRecord(root.choices[0]) ? root.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const content = message && Object.prototype.hasOwnProperty.call(message, "content") ? message.content : undefined;
  const text = extractText(content);
  const errors = [
    root.error === undefined || root.error === null ? null : errorCode(root.error) ?? "embedded_provider_error",
    choice?.error === undefined || choice?.error === null ? null : errorCode(choice.error) ?? "embedded_provider_error"
  ].filter((code): code is string => code !== null);
  const reasoning = message?.reasoning;
  let parsedJson = false;
  if (text) {
    try {
      JSON.parse(text);
      parsedJson = true;
    } catch {
      parsedJson = false;
    }
  }
  const result = {
    httpStatus: status,
    providerErrorCode: errors[0] ?? null,
    model: safeIdentifier(root.model),
    provider: safeIdentifier(root.provider),
    finishReason: safeIdentifier(choice?.finish_reason),
    contentType: content === undefined ? "missing" :
      content === null ? "null" : typeof content === "string" ? "string" : Array.isArray(content) ? "array" : "other",
    contentLength: text?.length ?? (content === null ? 0 : null),
    hasText: Boolean(text),
    parsedJson: parsedJson,
    refusal: Boolean(message?.refusal),
    toolCallCount: Array.isArray(message?.tool_calls) ? message.tool_calls.length : message?.function_call ? 1 : 0,
    reasoningPresent: reasoning !== undefined && reasoning !== null,
    reasoningLength: typeof reasoning === "string" ? reasoning.length : null
  };
  if (status === 429 || errors.some((code) => /rate.?limit|quota|too.?many/i.test(code))) liveRateLimited = true;
  return { safe: result, text };
}

async function readCatalogueParameter(parameter: "structured_outputs" | "response_format"): Promise<boolean> {
  const response = await fetch(catalogueEndpoint, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) return false;
  const payload: unknown = await response.json().catch(() => null);
  if (!isRecord(payload) || !Array.isArray(payload.data)) return false;
  const entry = payload.data.find((item) => isRecord(item) && item.id === model);
  return isRecord(entry) &&
    Array.isArray(entry.endpoints) && entry.endpoints.includes("/api/v1/chat/completions") &&
    Array.isArray(entry.supported_parameters) && entry.supported_parameters.includes(parameter);
}

async function postCompletion(body: Record<string, unknown>) {
  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.OPENROUTER_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
}

test("OpenRouter test A: minimal text generation", async () => {
  test.skip(!canContactOpenRouter, "Set AIRWISE_LIVE_TESTS=1 and OPENROUTER_API_KEY to call OpenRouter.");
  let status = 0;
  let inspected: ReturnType<typeof inspectCompletion> | null = null;
  try {
    const response = await postCompletion({
      model,
      messages: [{ role: "user", content: "Reply with the single word READY." }],
      max_completion_tokens: 30
    });
    status = response.status;
    inspected = inspectCompletion(status, await response.json().catch(() => null));
  } catch {
    inspected = null;
  }
  console.log(JSON.stringify({ openRouterTestA: inspected?.safe ?? { httpStatus: status, transportError: true, model } }));
  expect(inspected).not.toBeNull();
  expect(inspected?.safe.httpStatus).toBe(200);
  expect(inspected?.safe.providerErrorCode).toBeNull();
  expect(inspected?.safe.hasText).toBe(true);
});

test("OpenRouter test B: minimal JSON Schema output", async () => {
  test.skip(!canContactOpenRouter, "Set AIRWISE_LIVE_TESTS=1 and OPENROUTER_API_KEY to call OpenRouter.");
  test.skip(liveRateLimited, "A previous live request was rate-limited; stopping further provider calls.");
  test.skip(!(await readCatalogueParameter("structured_outputs")), "The configured model does not list structured-output support.");
  const response = await postCompletion({
    model,
    messages: [
      { role: "system", content: "Return a JSON object that satisfies the supplied schema. Do not include Markdown." },
      { role: "user", content: "Give one safe planning suggestion when official AQI is unavailable." }
    ],
    response_format: { type: "json_schema", json_schema: { name: "minimal_recommendation", strict: true, schema: minimalSchema } },
    max_completion_tokens: 160,
    provider: { require_parameters: true },
    stream: false
  });
  const inspected = inspectCompletion(response.status, await response.json().catch(() => null));
  console.log(JSON.stringify({ openRouterTestB: inspected.safe }));
  expect(response.status).toBe(200);
  expect(inspected.safe.providerErrorCode).toBeNull();
  expect(inspected.safe.refusal).toBe(false);
  expect(inspected.safe.finishReason).not.toBe("error");
  expect(inspected.safe.finishReason).not.toBe("length");
  expect(inspected.text).not.toBeNull();
  const value: unknown = JSON.parse(inspected.text as string);
  expect(isRecord(value) && typeof value.result === "string" && typeof value.reason === "string" &&
    typeof value.next_step === "string").toBe(true);
});

test("OpenRouter test C: minimal JSON mode", async () => {
  test.skip(!canContactOpenRouter, "Set AIRWISE_LIVE_TESTS=1 and OPENROUTER_API_KEY to call OpenRouter.");
  test.skip(liveRateLimited, "A previous live request was rate-limited; stopping further provider calls.");
  test.skip(!(await readCatalogueParameter("response_format")), "The configured model does not list JSON-mode support.");
  const response = await postCompletion({
    model,
    messages: [
      { role: "system", content: "Return only a JSON object with string properties result, reason, and next_step." },
      { role: "user", content: "Give one safe planning suggestion when official AQI is unavailable." }
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 160,
    provider: { require_parameters: true },
    stream: false
  });
  const inspected = inspectCompletion(response.status, await response.json().catch(() => null));
  console.log(JSON.stringify({ openRouterTestC: inspected.safe }));
  expect(response.status).toBe(200);
  expect(inspected.safe.providerErrorCode).toBeNull();
  expect(inspected.text).not.toBeNull();
  const value: unknown = JSON.parse(inspected.text as string);
  expect(isRecord(value) && typeof value.result === "string" && typeof value.reason === "string" &&
    typeof value.next_step === "string").toBe(true);
});

test("OpenRouter test D: full AIRWISE schema passes application validation", async () => {
  test.skip(!canContactOpenRouter, "Set AIRWISE_LIVE_TESTS=1 and OPENROUTER_API_KEY to call OpenRouter.");
  test.skip(liveRateLimited, "A previous live request was rate-limited; stopping further provider calls.");
  const result = await requestOpenRouterAdvice({
    question: "Give one practical way to plan an outdoor activity when current official AQI is unavailable.",
    data,
    preferences: DEFAULT_PREFERENCES
  });
  if (!result.ok && result.diagnostic?.httpStatus === 429) liveRateLimited = true;
  console.log(JSON.stringify({
    openRouterTestD: {
      ok: result.ok,
      model: result.ok ? result.diagnostic?.responseModel ?? model : result.diagnostic?.model ?? model,
      httpStatus: result.ok ? result.diagnostic?.httpStatus ?? null : result.diagnostic?.httpStatus ?? null,
      provider: result.ok ? result.diagnostic?.providerName ?? null : result.diagnostic?.providerName ?? null,
      finishReason: result.diagnostic?.finishReason ?? null,
      contentType: result.diagnostic?.contentType ?? null,
      contentLength: result.diagnostic?.contentLength ?? null,
      outputMode: result.diagnostic?.outputMode ?? null,
      validationOutcome: result.diagnostic?.validationOutcome ?? "not_run",
      responseIssue: result.ok ? null : result.diagnostic?.responseIssue ?? null
    }
  }));
  expect(result.ok).toBe(true);
});

test("OpenRouter test E: full assistant API returns validated OpenRouter advice using live app data", async ({ request }) => {
  test.setTimeout(120_000);
  test.skip(!canContactOpenRouter, "Set AIRWISE_LIVE_TESTS=1 and OPENROUTER_API_KEY to call OpenRouter.");
  test.skip(liveRateLimited, "A previous live request was rate-limited; stopping further provider calls.");
  const response = await request.post("/api/assistant", {
    data: {
      city: "Hyderabad",
      latitude: 17.385,
      longitude: 78.4867,
      preferences: {
        ...DEFAULT_PREFERENCES,
        occupation: "Office worker",
        commute: "Public transit",
        outdoorActivity: "Sometimes"
      },
      messages: [{
        role: "user",
        content: "How can I make better daily travel decisions given the available pollution measurements?"
      }]
    }
  });
  const payload = await response.json() as {
    advice?: { recommendations?: unknown[] };
    provider?: string;
    responseMode?: string;
    diagnostics?: {
      gemini?: { httpStatus?: number | null };
      openrouter?: {
        httpStatus?: number | null;
        outputMode?: string;
        validationOutcome?: string;
        responseIssue?: string;
      };
    };
    sources?: { cpcbStatus?: string; openAqStatus?: string };
  };
  if (payload.diagnostics?.openrouter?.httpStatus === 429) liveRateLimited = true;
  console.log(JSON.stringify({
    openRouterTestE: {
      httpStatus: response.status(),
      provider: payload.provider ?? null,
      responseMode: payload.responseMode ?? null,
      validatedRecommendationCount: payload.advice?.recommendations?.length ?? 0,
      outputMode: payload.diagnostics?.openrouter?.outputMode ?? null,
      validationOutcome: payload.diagnostics?.openrouter?.validationOutcome ?? null,
      responseIssue: payload.diagnostics?.openrouter?.responseIssue ?? null,
      geminiStatus: payload.diagnostics?.gemini?.httpStatus ?? null,
      openRouterStatus: payload.diagnostics?.openrouter?.httpStatus ?? null,
      cpcbStatus: payload.sources?.cpcbStatus ?? null,
      openAqStatus: payload.sources?.openAqStatus ?? null
    }
  }));
  expect(response.status()).toBe(200);
  expect(payload.responseMode).toBe("ai_generated");
  expect(payload.provider).toBe("OpenRouter");
  expect(payload.advice?.recommendations?.length).toBeGreaterThan(0);
  expect(payload.diagnostics?.openrouter?.validationOutcome).toBe("passed");
});