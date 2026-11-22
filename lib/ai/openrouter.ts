import {
  AIRWISE_SYSTEM_INSTRUCTION,
  buildAssistantProviderInput,
  type AssistantProviderDiagnostic,
  type AssistantProviderInput,
  type GeminiAdviceResult
} from "@/lib/ai/gemini";
import { CircuitBreaker } from "@/lib/ai/circuit-breaker";
import { GEMINI_ADVICE_JSON_SCHEMA, diagnoseAssistantAdvice } from "@/lib/validation/advice";
import { fetchProviderWithRetry } from "@/lib/utils/provider-fetch";

const MODEL_CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const FREE_ROUTER_MODEL = "openrouter/free";
const MODEL_CACHE_MS = 60 * 60 * 1000;
const openRouterCircuit = new CircuitBreaker(3, 30_000);

type ModelEntry = {
  id: string;
  endpoints: string[];
  supportedParameters: string[];
  promptPrice: string | null;
  completionPrice: string | null;
};

type ModelCatalogCache = { entries: ModelEntry[]; expiresAt: number; fetchedAt: number };

let modelCatalogCache: ModelCatalogCache | null = null;
let modelCatalogPromise: Promise<ModelCatalogCache> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractChatContent(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!Array.isArray(value)) return null;
  const text = value.flatMap((part) =>
    isRecord(part) && typeof part.text === "string" && (part.type === undefined || part.type === "text")
      ? [part.text]
      : []
  ).join("").trim();
  return text || null;
}

function configuredModel(): string {
  return (process.env.OPENROUTER_MODEL?.trim() || FREE_ROUTER_MODEL).slice(0, 160);
}

function parseModelCatalog(payload: unknown): ModelEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new Error("invalid_model_catalog");
  return payload.data.flatMap((item): ModelEntry[] => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const endpoints = Array.isArray(item.endpoints)
      ? item.endpoints.filter((endpoint): endpoint is string => typeof endpoint === "string")
      : [];
    const parameters = Array.isArray(item.supported_parameters)
      ? item.supported_parameters.filter((parameter): parameter is string => typeof parameter === "string")
      : [];
    const pricing = isRecord(item.pricing) ? item.pricing : {};
    return [{
      id: item.id,
      endpoints,
      supportedParameters: parameters,
      promptPrice: typeof pricing.prompt === "string" ? pricing.prompt : null,
      completionPrice: typeof pricing.completion === "string" ? pricing.completion : null
    }];
  });
}

async function loadModelCatalog(): Promise<ModelCatalogCache> {
  if (modelCatalogCache && modelCatalogCache.expiresAt > Date.now()) return modelCatalogCache;
  if (modelCatalogPromise) return modelCatalogPromise;

  const pending = (async () => {
    const response = await fetchProviderWithRetry(MODEL_CATALOG_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    }, 5_000, { maxRetries: 0 });
    if (!response.ok) throw new Error("model_catalog_http_" + response.status);
    const payload: unknown = await response.json();
    const next: ModelCatalogCache = {
      entries: parseModelCatalog(payload),
      fetchedAt: Date.now(),
      expiresAt: Date.now() + MODEL_CACHE_MS
    };
    modelCatalogCache = next;
    return next;
  })();
  modelCatalogPromise = pending;
  try {
    return await pending;
  } finally {
    if (modelCatalogPromise === pending) modelCatalogPromise = null;
  }
}

function safeCode(value: unknown): string | null {
  const code = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) && !/sk-or-v1-|bearer/i.test(code) ? code : null;
}

type OpenRouterOutputMode = "json_schema" | "json_object" | "plain_json";
type ValidationOutcome = "not_run" | "passed" | "failed";

type EmbeddedErrorSummary = {
  code: string;
  unsupportedFormat: boolean;
  rateLimited: boolean;
  authRejected: boolean;
};

type RateLimitClass = NonNullable<AssistantProviderDiagnostic["rateLimitClass"]>;
type RateLimitDetails = Pick<AssistantProviderDiagnostic,
  "rateLimitClass" | "rateLimitSource" | "rateLimitProviderName" | "rateLimitProviderCode" |
  "rateLimitLimit" | "rateLimitRemaining" | "rateLimitResetAt" | "rateLimitRetryAt" | "retryAfterMs">;

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return candidate.length > 0 && candidate.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9 ._:/@+-]*$/.test(candidate) ? candidate : null;
}

function describeEmbeddedError(value: unknown): EmbeddedErrorSummary {
  const record = isRecord(value) ? value : {};
  const rawCode = record.code ?? record.type ?? record.status;
  const code = safeCode(rawCode) ?? "embedded_provider_error";
  const message = typeof record.message === "string" ? record.message : typeof value === "string" ? value : "";
  const combined = code + " " + message;
  const unsupportedFormat = /unsupported|not supported|invalid|unrecognized|unknown/i.test(combined) &&
    /response_format|json_schema|structured[ _-]*outputs?|json mode/i.test(combined);
  return {
    code,
    unsupportedFormat,
    rateLimited: /rate[ _-]?limit|too[ _-]?many[ _-]?requests|quota/i.test(combined),
    authRejected: /unauthor|invalid[ _-]?api[ _-]?key|forbidden/i.test(combined)
  };
}

function errorMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) && isRecord(value.metadata) ? value.metadata : {};
}

function metadataHeader(metadata: Record<string, unknown>, name: string): string | null {
  if (!isRecord(metadata.headers)) return null;
  const key = Object.keys(metadata.headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? metadata.headers[key] : null;
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : null;
}

function headerValue(response: Response, metadata: Record<string, unknown>, name: string): string | null {
  return response.headers.get(name)?.trim() || metadataHeader(metadata, name);
}

function parseRetryAfterMilliseconds(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const normalized = value.trim();
  const seconds = Number(normalized);
  if (normalized !== "" && Number.isFinite(seconds) && seconds >= 0) return Math.min(86_400_000, seconds * 1000);
  const date = Date.parse(normalized);
  return Number.isFinite(date) ? Math.min(86_400_000, Math.max(0, date - now)) : null;
}

function rateLimitResetEpoch(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const normalized = value.trim();
  const numeric = Number(normalized);
  if (normalized !== "" && Number.isFinite(numeric) && numeric >= 0) {
    if (numeric >= 1_000_000_000_000) return numeric;
    if (numeric >= 1_000_000_000) return numeric * 1000;
    return now + numeric * 1000;
  }
  const date = Date.parse(normalized);
  return Number.isFinite(date) ? date : null;
}

function classifyRateLimit(
  source: string | null,
  providerName: string | null,
  providerCode: string | null,
  message: string
): RateLimitClass {
  const normalizedSource = (source ?? "").toLowerCase();
  const evidence = [normalizedSource, providerCode ?? "", message].join(" ").toLowerCase();
  if (/free_tier_daily|free-models-per-day|daily.*free.*limit/.test(evidence)) return "openrouter_daily_limit";
  if (/free_tier_per_minute|free-models-per-min|per.minute.*free.*limit/.test(evidence)) return "openrouter_per_minute_limit";
  if (/ddos|dos_protection|burst|traffic_protection/.test(evidence)) return "openrouter_burst_protection";
  if (/upstream_provider_shared_pool|upstream_provider_rate_limit|provider_rate_limit/.test(normalizedSource)) {
    return /capacity|overload|temporarily unavailable|no endpoints/i.test(message)
      ? "upstream_provider_capacity"
      : "upstream_provider_rate_limit";
  }
  if (/capacity|overload|temporarily unavailable|no endpoints/i.test(message) && /upstream|provider/i.test(evidence)) {
    return "upstream_provider_capacity";
  }
  if (providerName && (providerCode === "429" || /rate.?limit|too many requests/i.test(message))) {
    return "upstream_provider_rate_limit";
  }
  return "unknown";
}

function rateLimitDetails(
  response: Response,
  payload: unknown,
  choice: Record<string, unknown> | null,
  now = Date.now()
): RateLimitDetails {
  const root = isRecord(payload) ? payload : {};
  const errors = [root.error, choice?.error].filter((candidate) => candidate !== undefined && candidate !== null);
  const error = errors.find((candidate) => {
    const candidateMetadata = errorMetadata(candidate);
    return candidateMetadata.limit_source !== undefined || candidateMetadata.provider_name !== undefined ||
      candidateMetadata.provider_code !== undefined || candidateMetadata.headers !== undefined;
  }) ?? errors[0];
  const metadata = errorMetadata(error);
  const source = safeCode(metadata.limit_source);
  const providerName = safeIdentifier(metadata.provider_name);
  const providerCode = safeCode(metadata.provider_code);
  const errorRecord = isRecord(error) ? error : {};
  const message = typeof errorRecord.message === "string" ? errorRecord.message.slice(0, 500) :
    typeof error === "string" ? error.slice(0, 500) : "";
  const retryAfterMs = parseRetryAfterMilliseconds(headerValue(response, metadata, "retry-after"), now);
  const limitHeader = headerValue(response, metadata, "x-ratelimit-limit");
  const remainingHeader = headerValue(response, metadata, "x-ratelimit-remaining");
  const limitValue = limitHeader === null ? NaN : Number(limitHeader);
  const remainingValue = remainingHeader === null ? NaN : Number(remainingHeader);
  const resetAtEpoch = rateLimitResetEpoch(headerValue(response, metadata, "x-ratelimit-reset"), now);
  const retryAtEpoch = Math.max(
    retryAfterMs === null ? 0 : now + retryAfterMs,
    resetAtEpoch ?? 0
  );
  const toIso = (epoch: number | null): string | null => {
    if (epoch === null || !Number.isFinite(epoch) || epoch < 0 || epoch > 8_640_000_000_000_000) return null;
    return new Date(epoch).toISOString();
  };

  return {
    rateLimitClass: classifyRateLimit(source, providerName, providerCode, message),
    rateLimitSource: source,
    rateLimitProviderName: providerName,
    rateLimitProviderCode: providerCode,
    rateLimitLimit: Number.isFinite(limitValue) && limitValue >= 0 && limitValue <= 1_000_000_000 ? limitValue : null,
    rateLimitRemaining: Number.isFinite(remainingValue) && remainingValue >= 0 && remainingValue <= 1_000_000_000 ? remainingValue : null,
    rateLimitResetAt: toIso(resetAtEpoch),
    rateLimitRetryAt: retryAtEpoch > 0 ? toIso(retryAtEpoch) : null,
    retryAfterMs
  };
}

function rateLimitMessage(details: RateLimitDetails): string {
  const messages: Record<RateLimitClass, string> = {
    openrouter_daily_limit: "OpenRouter's free-model daily request limit was reached.",
    openrouter_per_minute_limit: "OpenRouter's free-model per-minute request limit was reached.",
    openrouter_burst_protection: "OpenRouter traffic protection blocked the request.",
    upstream_provider_rate_limit: "The upstream model provider rate-limited the request.",
    upstream_provider_capacity: "The upstream model provider is temporarily at capacity.",
    cloudflare_rate_limit: "Cloudflare Workers AI rate-limited the request.",
    unknown: "OpenRouter returned HTTP 429, but did not identify the limit source."
  };
  const timing = details.rateLimitRetryAt
    ? " AIRWISE paused this provider until the reported retry time; no model rotation was attempted."
    : " AIRWISE paused this provider because no reset time was supplied; check provider status before a controlled retry.";
  return messages[details.rateLimitClass ?? "unknown"] + timing;
}

function responseDiagnostic(
  payload: unknown,
  choice: Record<string, unknown> | null,
  outputMode: OpenRouterOutputMode,
  httpStatus: number,
  validationOutcome: ValidationOutcome,
  responseIssue?: string,
  providerCode: string | null = null,
  stage: AssistantProviderDiagnostic["stage"] = "response",
  rateLimit?: RateLimitDetails
): AssistantProviderDiagnostic {
  const root = isRecord(payload) ? payload : {};
  const message = choice && isRecord(choice.message) ? choice.message : null;
  const hasContent = Boolean(message && Object.prototype.hasOwnProperty.call(message, "content"));
  const content = hasContent ? message?.content : undefined;
  const contentType = !hasContent ? "missing" :
    content === null ? "null" :
    typeof content === "string" ? "string" :
    Array.isArray(content) ? "array" : "other";
  const contentLength = typeof content === "string" ? content.length :
    Array.isArray(content) ? (extractChatContent(content)?.length ?? 0) :
    content === null ? 0 : null;
  const reasoning = message?.reasoning;
  const reasoningPresent = Boolean(message && reasoning !== undefined && reasoning !== null);
  const reasoningLength = typeof reasoning === "string" ? reasoning.length :
    Array.isArray(reasoning) ? (extractChatContent(reasoning)?.length ?? 0) :
    reasoningPresent ? null : 0;
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls.length : 0;
  const legacyFunctionCall = Boolean(message?.function_call);
  const diagnostic: AssistantProviderDiagnostic = {
    stage,
    httpStatus,
    providerCode,
    providerMessage: null,
    model: configuredModel(),
    providerName: safeIdentifier(root.provider),
    responseModel: safeIdentifier(root.model),
    finishReason: choice ? safeIdentifier(choice.finish_reason) : null,
    contentType,
    contentLength,
    refusal: Boolean(message?.refusal),
    toolCallCount: toolCalls + (legacyFunctionCall ? 1 : 0),
    reasoningPresent,
    reasoningLength,
    outputMode,
    validationOutcome,
    ...(responseIssue ? { responseIssue } : {}),
    ...(rateLimit ? rateLimit : {})
  };
  return diagnostic;
}
function failure(
  code: "not_configured" | "provider_unavailable" | "provider_circuit_open" | "invalid_provider_response",
  message: string,
  model: string,
  diagnostic?: AssistantProviderDiagnostic
): GeminiAdviceResult {
  return {
    ok: false, code, message,
    ...(diagnostic ? { diagnostic: { ...diagnostic, model: model.slice(0, 160) } } : {})
  };
}

export function getOpenRouterHealth() {
  return {
    configured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    model: configuredModel(),
    modelCatalogCheckedAt: modelCatalogCache?.fetchedAt ?? null,
    ...openRouterCircuit.snapshot()
  };
}

export function resetOpenRouterForTests() {
  modelCatalogCache = null;
  modelCatalogPromise = null;
  openRouterCircuit.reset();
}

export async function requestOpenRouterAdvice(input: AssistantProviderInput): Promise<GeminiAdviceResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = configuredModel();
  if (!apiKey) return failure("not_configured", "OpenRouter is not configured.", model);

  const permit = openRouterCircuit.tryAcquire();
  if (!permit.allowed) {
    const health = openRouterCircuit.snapshot();
    return failure("provider_circuit_open", "OpenRouter is paused while its circuit is open. Wait before sending another assistant request.", model, {
      stage: "circuit", httpStatus: null, providerCode: "circuit_open", providerMessage: null, model,
      responseIssue: "circuit_open",
      retryAfterMs: health.nextAttemptAt === null ? null : Math.max(0, health.nextAttemptAt - Date.now())
    });
  }

  try {
    let catalog: ModelCatalogCache;
    try {
      catalog = await loadModelCatalog();
    } catch (error) {
      const statusMatch = error instanceof Error ? /^model_catalog_http_(\d+)$/.exec(error.message) : null;
      const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
      openRouterCircuit.recordFailure(httpStatus === null ? "model_catalog_unavailable" : String(httpStatus));
      return failure("provider_unavailable", "OpenRouter's model catalogue could not be verified.", model, {
        stage: "provider", httpStatus, providerCode: "model_catalog_unavailable", providerMessage: null, model
      });
    }

    const entry = catalog.entries.find((candidate) => candidate.id === model);
    if (!entry || !entry.endpoints.includes("/api/v1/chat/completions") ||
        (model === FREE_ROUTER_MODEL && (Number(entry.promptPrice) !== 0 || Number(entry.completionPrice) !== 0))) {
      return failure("invalid_provider_response", "The configured OpenRouter model is not listed with chat-completion support.", model, {
        stage: "provider", httpStatus: 200, providerCode: "model_not_compatible", providerMessage: null,
        model, responseIssue: "model_not_compatible"
      });
    }

    const { context, userInput } = buildAssistantProviderInput(input);
    const supportsStructured = entry.supportedParameters.includes("structured_outputs");
    const supportsResponseFormat = entry.supportedParameters.includes("response_format");
    const outputModes: Array<"json_schema" | "json_object" | "plain_json"> = [];
    if (supportsStructured) outputModes.push("json_schema");
    if (supportsResponseFormat) outputModes.push("json_object");
    outputModes.push("plain_json");

    for (let modeIndex = 0; modeIndex < outputModes.length; modeIndex += 1) {
      const outputMode = outputModes[modeIndex];
      const messages = [
        { role: "system", content: AIRWISE_SYSTEM_INSTRUCTION },
        { role: "user", content: userInput }
      ];
      if (outputMode === "plain_json") {
        messages[0] = {
          role: "system",
          content: AIRWISE_SYSTEM_INSTRUCTION + "\n\nReturn exactly one JSON object. Do not include Markdown, code fences, or text outside the JSON object."
        };
      }

      const requestBody: Record<string, unknown> = {
        model,
        messages,
        max_completion_tokens: 1400,
        temperature: 0.2,
        stream: false,
        provider: { require_parameters: true }
      };
      if (outputMode === "json_schema") {
        requestBody.response_format = {
          type: "json_schema",
          json_schema: { name: "recommendation", strict: true, schema: GEMINI_ADVICE_JSON_SCHEMA }
        };
      } else if (outputMode === "json_object") {
        requestBody.response_format = { type: "json_object" };
      }

      let response: Response;
      try {
        response = await fetchProviderWithRetry(CHAT_COMPLETIONS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey
          },
          body: JSON.stringify(requestBody),
          cache: "no-store"
        }, 15_000, {
          maxRetries: permit.probe ? 0 : 1,
          retryStatuses: [500, 502, 503, 504],
          baseDelayMs: 200,
          maxDelayMs: 3_000
        });
      } catch {
        openRouterCircuit.recordFailure("transport_error");
        return failure("provider_unavailable", "The configured OpenRouter service could not be reached.", model, {
          stage: "transport", httpStatus: null, providerCode: "transport_error", providerMessage: null, model,
          outputMode, validationOutcome: "not_run"
        });
      }

      const payload: unknown = await response.json().catch(() => null);
      const root = isRecord(payload) ? payload : null;
      const choice = root && Array.isArray(root.choices) && isRecord(root.choices[0]) ? root.choices[0] : null;
      const embeddedErrorValues: unknown[] = [];
      if (root && root.error !== undefined && root.error !== null) embeddedErrorValues.push(root.error);
      if (choice && choice.error !== undefined && choice.error !== null) embeddedErrorValues.push(choice.error);
      const embeddedErrors = embeddedErrorValues.map(describeEmbeddedError);
      const unsupportedFormat = embeddedErrors.some((error) => error.unsupportedFormat);
      const rateLimited = response.status === 429 || embeddedErrors.some((error) => error.rateLimited);
      const authRejected = response.status === 401 || response.status === 403 ||
        embeddedErrors.some((error) => error.authRejected);
      const providerErrorCode = embeddedErrors.find((error) => error.code)?.code ?? null;
      const retryAfterMs = parseRetryAfterMilliseconds(response.headers.get("retry-after"));

      if (rateLimited) {
        const limit = rateLimitDetails(response, payload, choice);
        const retryAt = limit.rateLimitRetryAt ? Date.parse(limit.rateLimitRetryAt) : null;
        const classification = limit.rateLimitClass ?? "unknown";
        openRouterCircuit.recordRateLimit("429_" + classification, retryAt, 60_000);
        return failure("provider_unavailable", rateLimitMessage(limit), model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "rate_limited",
            providerErrorCode ?? String(response.status), "provider", limit)
        });
      }

      if (authRejected) {
        openRouterCircuit.recordFailure(providerErrorCode ?? String(response.status));
        return failure("not_configured", "OpenRouter rejected the configured credentials.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "authentication_rejected",
            providerErrorCode ?? String(response.status), "provider")
        });
      }

      if (unsupportedFormat && modeIndex < outputModes.length - 1) continue;

      if (!response.ok || embeddedErrors.length > 0) {
        openRouterCircuit.recordFailure(providerErrorCode ?? String(response.status));
        const invalidRequest = response.status === 400 || response.status === 422;
        return failure(invalidRequest ? "invalid_provider_response" : "provider_unavailable",
          "OpenRouter did not complete the request.", model, {
            ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run",
              unsupportedFormat ? "unsupported_output_format" : "embedded_provider_error",
              providerErrorCode ?? String(response.status), "provider"),
            ...(retryAfterMs === null ? {} : { retryAfterMs })
          });
      }

      if (!root || !choice) {
        openRouterCircuit.recordFailure("missing_choice");
        return failure("invalid_provider_response", "OpenRouter returned no chat completion choice.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "missing_choice", null)
        });
      }

      const message = isRecord(choice.message) ? choice.message : null;
      const finishReason = safeIdentifier(choice.finish_reason);
      const refusal = Boolean(message?.refusal);
      const toolCallCount = Array.isArray(message?.tool_calls) ? message.tool_calls.length : message?.function_call ? 1 : 0;

      if (finishReason === "error") {
        openRouterCircuit.recordFailure("completion_error");
        return failure("provider_unavailable", "OpenRouter reported a completion error.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "completion_error", "completion_error")
        });
      }
      if (refusal || finishReason === "content_filter") {
        return failure("invalid_provider_response", "OpenRouter refused the request.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "refusal", null)
        });
      }
      if (toolCallCount > 0) {
        return failure("invalid_provider_response", "OpenRouter returned tool calls instead of AIRWISE advice.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "tool_calls", null)
        });
      }
      if (finishReason === "length" || finishReason === "max_tokens") {
        openRouterCircuit.recordFailure("incomplete_output");
        return failure("invalid_provider_response", "OpenRouter returned incomplete output.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "incomplete_output", null)
        });
      }
      if (!message) {
        openRouterCircuit.recordFailure("missing_message");
        return failure("invalid_provider_response", "OpenRouter returned no assistant message.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "missing_message", null)
        });
      }

      const answer = extractChatContent(message.content);
      if (!answer) {
        openRouterCircuit.recordFailure("missing_structured_output");
        return failure("invalid_provider_response", "OpenRouter returned no readable text content.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "missing_text_content", null)
        });
      }

      let result: unknown;
      try {
        result = JSON.parse(answer) as unknown;
      } catch {
        openRouterCircuit.recordFailure("invalid_json_output");
        return failure("invalid_provider_response", "OpenRouter returned invalid JSON.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "not_run", "invalid_json_output", null)
        });
      }

      const validation = diagnoseAssistantAdvice(result, context);
      if (!validation.valid) {
        openRouterCircuit.recordFailure("advice_schema_or_safety_rejected");
        return failure("invalid_provider_response", "OpenRouter's response failed AIRWISE's safety and structure checks.", model, {
          ...responseDiagnostic(payload, choice, outputMode, response.status, "failed",
            validation.reason, "advice_schema_or_safety_rejected"),
          ...(validation.issuePaths ? { issuePaths: validation.issuePaths } : {})
        });
      }

      openRouterCircuit.recordSuccess();
      return {
        ok: true,
        advice: validation.advice,
        diagnostic: responseDiagnostic(payload, choice, outputMode, response.status, "passed", undefined, null)
      };
    }

    openRouterCircuit.recordFailure("no_output_mode");
    return failure("invalid_provider_response", "OpenRouter did not provide a supported JSON output mode.", model, {
      stage: "response", httpStatus: null, providerCode: "unsupported_output_format", providerMessage: null, model,
      validationOutcome: "not_run", responseIssue: "unsupported_output_format"
    });
  } catch {
    openRouterCircuit.recordFailure("transport_error");
    return failure("provider_unavailable", "The configured OpenRouter service could not be reached.", model, {
      stage: "transport", httpStatus: null, providerCode: "transport_error", providerMessage: null, model,
      validationOutcome: "not_run"
    });
  }
}
