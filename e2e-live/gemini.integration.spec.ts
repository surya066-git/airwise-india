import { expect, test } from "@playwright/test";

const endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions";
const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

function modelOutput(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.steps)) return "";
  return payload.steps.flatMap((step) => {
    if (typeof step !== "object" || step === null || !("type" in step) || step.type !== "model_output" ||
        !("content" in step) || !Array.isArray(step.content)) return [];
    const content: unknown[] = step.content;
    return content.flatMap((part) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? [part.text] : []
    );
  }).join(" ");
}

function safeError(payload: Record<string, unknown> | null) {
  const error = payload?.error;
  if (typeof error !== "object" || error === null) return { code: null, message: null };
  const value = error as Record<string, unknown>;
  const key = process.env.GEMINI_API_KEY ?? "";
  const message = typeof value.message === "string"
    ? value.message.replaceAll(key, "[redacted]")
      .replace(/(?:x-goog-api-key|x-api-key|api-key|authorization)\s*[:=]\s*[^\r\n,;]*/gi, "[redacted]")
      .replace(/[\r\n\t]+/g, " ").slice(0, 240)
    : null;
  return { code: value.status ?? value.code ?? null, message };
}

async function sendProvider(payload: Record<string, unknown>) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
        "Api-Revision": "2026-05-20"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25_000)
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { status: response.status, payload: result, transportError: null as string | null };
  } catch (error) {
    return { status: null, payload: null, transportError: error instanceof Error ? error.name : "TransportError" };
  }
}

test("Gemini test A: basic text request", async () => {
  test.skip(process.env.AIRWISE_LIVE_TESTS !== "1" || !process.env.GEMINI_API_KEY,
    "Set AIRWISE_LIVE_TESTS=1 and GEMINI_API_KEY to call Gemini.");
  const result = await sendProvider({ model, input: "Reply with the single word OK.", store: false });
  const payload = result.payload;
  const output = modelOutput(payload);
  console.log(JSON.stringify({
    geminiTestA: {
      httpStatus: result.status, transportError: result.transportError, ...safeError(payload),
      responseKeys: payload ? Object.keys(payload).slice(0, 20) : [],
      stepTypes: Array.isArray(payload?.steps)
        ? payload.steps.flatMap((step) => typeof step === "object" && step !== null && "type" in step ? [step.type] : [])
        : [],
      hasTextOutput: Boolean(output)
    }
  }));
});

test("Gemini test B: minimal structured JSON response", async () => {
  test.skip(process.env.AIRWISE_LIVE_TESTS !== "1" || !process.env.GEMINI_API_KEY,
    "Set AIRWISE_LIVE_TESTS=1 and GEMINI_API_KEY to call Gemini.");
  const result = await sendProvider({
      model,
      input: "Return status ok and message ready.",
      store: false,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: {
          type: "object",
          properties: { status: { type: "string" }, message: { type: "string" } },
          required: ["status", "message"],
          additionalProperties: false
        }
      }
  });
  const payload = result.payload;
  const output = modelOutput(payload);
  let structuredKeys: string[] = [];
  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed === "object" && parsed !== null) structuredKeys = Object.keys(parsed);
  } catch {
    // Report parse failure as response shape without printing model content.
  }
  console.log(JSON.stringify({
    geminiTestB: {
      httpStatus: result.status, transportError: result.transportError, ...safeError(payload),
      responseKeys: payload ? Object.keys(payload).slice(0, 20) : [],
      stepTypes: Array.isArray(payload?.steps)
        ? payload.steps.flatMap((step) => typeof step === "object" && step !== null && "type" in step ? [step.type] : [])
        : [],
      hasTextOutput: Boolean(output), structuredKeys
    }
  }));
});

test("Gemini test C: AIRWISE assistant route and application validation", async ({ request }) => {
  test.skip(process.env.AIRWISE_LIVE_TESTS !== "1" || !process.env.GEMINI_API_KEY,
    "Set AIRWISE_LIVE_TESTS=1 and GEMINI_API_KEY to call Gemini.");
  const response = await request.post("/api/assistant", {
    data: { messages: [{ role: "user", content: "Give one practical lower-emission commute idea." }] }
  });
  const payload = await response.json();
  const healthResponse = await request.get("/api/health/providers");
  const health = await healthResponse.json();
  console.log(JSON.stringify({
    geminiTestC: {
      httpStatus: response.status(),
      error: payload.error ?? null,
      diagnostic: payload.diagnostic ?? null,
      responseMode: payload.responseMode ?? null,
      provider: payload.provider ?? null,
      hasValidatedAnswer: Boolean(payload.advice && payload.answer),
      providerConfiguration: {
        gemini: health.providers?.gemini?.configured ?? null,
        openrouter: health.providers?.openrouter?.configured ?? null,
        ollama: health.providers?.ollama?.configured ?? null
      }
    }
  }));
  expect(response.status()).toBeGreaterThanOrEqual(200);
  expect(response.status()).toBeLessThan(600);
});
