import { CircuitBreaker } from "@/lib/ai/circuit-breaker";
import {
  AIRWISE_SYSTEM_INSTRUCTION,
  buildAssistantProviderInput,
  type AssistantProviderDiagnostic,
  type AssistantProviderInput,
  type GeminiAdviceResult
} from "@/lib/ai/gemini";
import { fetchProviderWithRetry } from "@/lib/utils/provider-fetch";
import { diagnoseAssistantAdvice, GEMINI_ADVICE_JSON_SCHEMA } from "@/lib/validation/advice";

const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const REQUEST_TIMEOUT_MS = 15_000;
const cloudflareCircuit = new CircuitBreaker(3, 60_000);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function selectedModel(): string {
  const configured = process.env.CLOUDFLARE_AI_MODEL?.trim();
  return configured && configured.length <= 160 && /^[A-Za-z0-9@/._:-]+$/.test(configured)
    ? configured
    : DEFAULT_MODEL;
}

function credentials() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !apiToken) return null;
  return { accountId, apiToken, model: selectedModel() };
}

function safeCode(value: unknown, secret?: string): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const code = String(value);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) && !/bearer|api.?token/i.test(code) &&
    (!secret || !code.includes(secret)) ? code : null;
}

function safeModelIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  return model.length > 0 && model.length <= 160 && /^[A-Za-z0-9@/._:-]+$/.test(model) ? model : null;
}

function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const normalized = value.trim();
  const seconds = Number(normalized);
  if (normalized && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(86_400_000, seconds * 1_000);
  }
  const date = Date.parse(normalized);
  return Number.isFinite(date) ? Math.min(86_400_000, Math.max(0, date - now)) : null;
}

function failure(
  code: "not_configured" | "provider_unavailable" | "provider_circuit_open" | "invalid_provider_response",
  message: string,
  model: string,
  diagnostic?: AssistantProviderDiagnostic
): GeminiAdviceResult {
  return { ok: false, code, message, ...(diagnostic ? { diagnostic: { ...diagnostic, model } } : {}) };
}

function invalidResponse(
  category: "upstream_invalid_response" | "empty_model_content" | "json_parse_failure",
  reason: string,
  model: string,
  status: number,
  contentType?: AssistantProviderDiagnostic["contentType"],
  refusal?: boolean
): GeminiAdviceResult {
  cloudflareCircuit.recordFailure(reason);
  return failure("invalid_provider_response", "Cloudflare Workers AI returned an answer that failed AIRWISE's structure and safety checks.", model, {
    stage: "response", httpStatus: status, providerCode: "invalid_structured_output", providerMessage: null,
    model, responseIssue: reason, diagnosticCategory: category, contentType,
    ...(refusal ? { refusal: true } : {}), outputMode: "json_schema", validationOutcome: "failed"
  });
}

export function getCloudflareHealth() {
  return { configured: credentials() !== null, model: selectedModel(), ...cloudflareCircuit.snapshot() };
}

export function resetCloudflareCircuitForTests() {
  cloudflareCircuit.reset();
}

export async function requestCloudflareAdvice(
  input: AssistantProviderInput,
  options: { maxRetries?: 0 | 1 } = {}
): Promise<GeminiAdviceResult> {
  const configured = credentials();
  if (!configured) {
    return failure("not_configured", "Cloudflare Workers AI is not configured. Set the account ID and API token in the server environment.", selectedModel());
  }

  const { accountId, apiToken, model } = configured;
  const permit = cloudflareCircuit.tryAcquire();
  if (!permit.allowed) {
    const health = cloudflareCircuit.snapshot();
    return failure("provider_circuit_open", "Cloudflare Workers AI is temporarily paused after a provider failure or rate limit.", model, {
      stage: "circuit", httpStatus: null, providerCode: "circuit_open", providerMessage: null, model,
      retryAfterMs: health.nextAttemptAt === null ? null : Math.max(0, health.nextAttemptAt - Date.now())
    });
  }

  try {
    const { context, userInput } = buildAssistantProviderInput(input);
    const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`;
    const response = await fetchProviderWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: AIRWISE_SYSTEM_INSTRUCTION },
          { role: "user", content: userInput }
        ],
        response_format: { type: "json_schema", json_schema: GEMINI_ADVICE_JSON_SCHEMA },
        max_tokens: 1_600,
        temperature: 0.2,
        stream: false
      }),
      cache: "no-store"
    }, REQUEST_TIMEOUT_MS, {
      maxRetries: permit.probe ? 0 : options.maxRetries ?? 1,
      retryStatuses: [500, 502, 503, 504],
      baseDelayMs: 200,
      maxDelayMs: 2_000
    });

    const now = Date.now();
    if (response.status === 401 || response.status === 403) {
      cloudflareCircuit.recordFailure(`http_${response.status}`);
      return failure("not_configured", "Cloudflare Workers AI rejected the configured API token or account access.", model, {
        stage: "provider", httpStatus: response.status, providerCode: null, providerMessage: null, model,
        diagnosticCategory: "upstream_http_error", outputMode: "json_schema", validationOutcome: "not_run"
      });
    }

    if (response.status === 429) {
      const waitMs = retryAfterMs(response.headers.get("retry-after"), now);
      cloudflareCircuit.recordRateLimit("429", waitMs === null ? null : now + waitMs, 60_000);
      const retryAt = waitMs === null ? null : new Date(now + waitMs).toISOString();
      return failure("provider_unavailable", retryAt
        ? `Cloudflare Workers AI rate-limited the request. AIRWISE paused this provider until the reported retry time (${retryAt}).`
        : "Cloudflare Workers AI rate-limited the request. AIRWISE paused this provider for 60 seconds before another user-triggered attempt.", model, {
        stage: "provider", httpStatus: 429, providerCode: "rate_limited", providerMessage: null, model,
        retryAfterMs: waitMs, rateLimitClass: "cloudflare_rate_limit", rateLimitRetryAt: retryAt,
        diagnosticCategory: "upstream_http_error", outputMode: "json_schema", validationOutcome: "not_run"
      });
    }

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      cloudflareCircuit.recordFailure(`http_${response.status}`);
      return failure("provider_unavailable", "Cloudflare Workers AI did not complete the request.", model, {
        stage: "provider", httpStatus: response.status, providerCode: safeCode(error?.code, apiToken),
        providerMessage: null, model, diagnosticCategory: "upstream_http_error",
        outputMode: "json_schema", validationOutcome: "not_run"
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return invalidResponse("upstream_invalid_response", "invalid_response_json", model, response.status, "other");
    }
    const root = isRecord(payload) ? payload : null;
    const choices = root && Array.isArray(root.choices) ? root.choices : [];
    const choice = choices.length && isRecord(choices[0]) ? choices[0] : null;
    const message = choice && isRecord(choice.message) ? choice.message : null;
    if (!root || !choice || !message) {
      return invalidResponse("upstream_invalid_response", "invalid_response_envelope", model, response.status, "missing");
    }
    const embeddedError = root?.error ?? choice?.error;
    if (embeddedError !== undefined && embeddedError !== null) {
      cloudflareCircuit.recordFailure("embedded_provider_error");
      return failure("provider_unavailable", "Cloudflare Workers AI returned a provider error instead of an answer.", model, {
        stage: "provider", httpStatus: response.status,
        providerCode: isRecord(embeddedError) ? safeCode(embeddedError.code ?? embeddedError.type, apiToken) : safeCode(embeddedError, apiToken),
        providerMessage: null, model, diagnosticCategory: "upstream_invalid_response",
        responseIssue: "embedded_provider_error", outputMode: "json_schema", validationOutcome: "not_run"
      });
    }

    const content = message?.content;
    const isRefusal = Boolean(message.refusal);
    const finishReason = choice.finish_reason;
    if (isRefusal || (typeof finishReason === "string" && finishReason !== "stop")) {
      return invalidResponse("upstream_invalid_response", isRefusal ? "model_refusal" : "incomplete_response",
        model, response.status, typeof content === "string" ? "string" : content === null ? "null" : "other", isRefusal);
    }
    if (content === null) {
      return invalidResponse("upstream_invalid_response", "null_model_content", model, response.status, "null");
    }
    if (typeof content !== "string") {
      return invalidResponse("upstream_invalid_response", "unsupported_content_type", model, response.status,
        content === undefined ? "missing" : "other");
    }
    if (!content.trim()) {
      return invalidResponse("empty_model_content", "empty_model_content", model, response.status, "string");
    }

    let output: unknown;
    try {
      output = JSON.parse(content) as unknown;
    } catch {
      return invalidResponse("json_parse_failure", "invalid_json_output", model, response.status, "string");
    }

    const validation = diagnoseAssistantAdvice(output, context);
    if (!validation.valid) {
      cloudflareCircuit.recordFailure(validation.reason);
      return failure("invalid_provider_response", "Cloudflare Workers AI's answer failed AIRWISE's structure and safety checks.", model, {
        stage: "response", httpStatus: response.status, providerCode: "advice_schema_or_safety_rejected",
        providerMessage: null, model, responseIssue: validation.reason,
        ...(validation.issuePaths ? { issuePaths: validation.issuePaths } : {}),
        ...(validation.validationIssues ? { validationIssues: validation.validationIssues } : {}),
        diagnosticCategory: "schema_validation_failure",
        outputMode: "json_schema", validationOutcome: "failed"
      });
    }

    cloudflareCircuit.recordSuccess();
    return {
      ok: true,
      advice: validation.advice,
      diagnostic: {
        stage: "response", httpStatus: response.status, providerCode: null, providerMessage: null, model,
        providerName: "Cloudflare Workers AI", responseModel: safeModelIdentifier(root?.model),
        finishReason: safeCode(choice?.finish_reason), contentType: "string", contentLength: content.length,
        diagnosticCategory: "accepted_ai_response", outputMode: "json_schema", validationOutcome: "passed"
      }
    };
  } catch {
    cloudflareCircuit.recordFailure("transport_or_timeout");
    return failure("provider_unavailable", "Cloudflare Workers AI could not be reached before the request timed out or the connection failed.", model, {
      stage: "transport", httpStatus: null, providerCode: "transport_or_timeout", providerMessage: null, model
    });
  }
}
