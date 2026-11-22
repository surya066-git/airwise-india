import { CircuitBreaker } from "@/lib/ai/circuit-breaker";
import {
  buildAssistantProviderInput,
  AIRWISE_SYSTEM_INSTRUCTION,
  type AssistantProviderInput,
  type GeminiAdviceResult
} from "@/lib/ai/gemini";
import { fetchProviderWithRetry } from "@/lib/utils/provider-fetch";
import { diagnoseAssistantAdvice, GEMINI_ADVICE_JSON_SCHEMA } from "@/lib/validation/advice";

const ollamaCircuit = new CircuitBreaker(3, 30_000);

function config() {
  if (process.env.OLLAMA_ENABLED !== "true" || process.env.NODE_ENV === "production") return null;
  const baseUrl = process.env.OLLAMA_BASE_URL?.trim();
  const model = process.env.OLLAMA_MODEL?.trim();
  if (!baseUrl || !model) return null;
  try {
    const parsed = new URL(baseUrl);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
    if (!loopback || parsed.protocol !== "http:" || parsed.username || parsed.password) return null;
    return { baseUrl: parsed.origin, model };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: string, model: string, status: number | null = null): GeminiAdviceResult {
  return {
    ok: false,
    code: "provider_unavailable",
    message: "The optional local AI provider did not complete the request.",
    diagnostic: {
      stage: status === null ? "transport" : "provider",
      httpStatus: status,
      providerCode: code,
      providerMessage: null,
      model
    }
  };
}

function invalidResponse(reason: string, model: string, status: number): GeminiAdviceResult {
  return {
    ok: false,
    code: "invalid_provider_response",
    message: "The optional local AI response failed AIRWISE's structure and safety checks.",
    diagnostic: {
      stage: "response", httpStatus: status, providerCode: "invalid_structured_output",
      providerMessage: null, model, responseIssue: reason
    }
  };
}

export function getOllamaHealth() {
  return { configured: config() !== null, ...ollamaCircuit.snapshot() };
}

export function resetOllamaCircuitForTests() {
  ollamaCircuit.reset();
}

export async function requestOllamaAdvice(input: AssistantProviderInput): Promise<GeminiAdviceResult> {
  const selected = config();
  if (!selected) {
    return { ok: false, code: "not_configured", message: "The optional local AI provider is not configured." };
  }

  const permit = ollamaCircuit.tryAcquire();
  if (!permit.allowed) {
    return {
      ok: false,
      code: "provider_circuit_open",
      message: "The optional local AI provider is temporarily paused after repeated failures.",
      diagnostic: {
        stage: "circuit", httpStatus: null, providerCode: "circuit_open", providerMessage: null,
        model: selected.model,
        retryAfterMs: Math.max(0, (ollamaCircuit.snapshot().nextAttemptAt ?? Date.now()) - Date.now())
      }
    };
  }

  try {
    const { context, userInput } = buildAssistantProviderInput(input);
    const response = await fetchProviderWithRetry(new URL("/api/chat", selected.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        model: selected.model,
        messages: [
          { role: "system", content: AIRWISE_SYSTEM_INSTRUCTION },
          { role: "user", content: userInput }
        ],
        format: GEMINI_ADVICE_JSON_SCHEMA,
        stream: false,
        options: { temperature: 0.2 }
      }),
      cache: "no-store"
    }, 15_000, {
      maxRetries: permit.probe ? 0 : 1,
      retryStatuses: [429, 500, 502, 503, 504],
      baseDelayMs: 200,
      maxDelayMs: 3_000
    });

    if (!response.ok) {
      ollamaCircuit.recordFailure(String(response.status));
      return fail("http_" + response.status, selected.model, response.status);
    }

    ollamaCircuit.recordSuccess();
    const payload: unknown = await response.json().catch(() => null);
    const message = isRecord(payload) && isRecord(payload.message) ? payload.message : null;
    const outputText = message && typeof message.content === "string" ? message.content : null;
    if (!outputText) return invalidResponse("missing_structured_output", selected.model, response.status);

    let output: unknown;
    try {
      output = JSON.parse(outputText) as unknown;
    } catch {
      return invalidResponse("invalid_json_output", selected.model, response.status);
    }
    const validation = diagnoseAssistantAdvice(output, context);
    if (!validation.valid) {
      return {
        ok: false,
        code: "invalid_provider_response",
        message: "The optional local AI response failed AIRWISE's structure and safety checks.",
        diagnostic: {
          stage: "response", httpStatus: response.status, providerCode: "advice_schema_or_safety_rejected",
          providerMessage: null, model: selected.model, responseIssue: validation.reason,
          ...(validation.issuePaths ? { issuePaths: validation.issuePaths } : {})
        }
      };
    }
    return { ok: true, advice: validation.advice };
  } catch {
    ollamaCircuit.recordFailure("transport_error");
    return fail("transport_error", selected.model);
  }
}
