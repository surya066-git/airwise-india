import { getCloudflareHealth, requestCloudflareAdvice } from "@/lib/ai/cloudflare";
import { requestGeminiAdvice, type GeminiAdviceResult } from "@/lib/ai/gemini";
import { getOpenRouterHealth, requestOpenRouterAdvice } from "@/lib/ai/openrouter";
import { getOllamaHealth, requestOllamaAdvice } from "@/lib/ai/ollama";
import { buildRecommendations } from "@/lib/recommendations/engine";
import type { AirQualityResponse } from "@/types/air-quality";
import type { UserPreferences } from "@/types/preferences";
import type { AssistantAdvice } from "@/types/recommendation";

export type AssistantResolution = {
  mode: "ai_generated" | "standard_guidance";
  provider: "Cloudflare Workers AI" | "Gemini" | "OpenRouter" | "Ollama" | "AIRWISE rules";
  advice: AssistantAdvice;
  providerNotice?: string;
  diagnostics: {
    cloudflare: GeminiAdviceResult["diagnostic"] | undefined;
    gemini: GeminiAdviceResult["diagnostic"] | undefined;
    openrouter: GeminiAdviceResult["diagnostic"] | undefined;
    ollama: GeminiAdviceResult["diagnostic"] | undefined;
  };
};

function standardAdvice(data: AirQualityResponse, preferences: UserPreferences): AssistantAdvice {
  const currentOfficial = data.official.status === "live" && data.official.aqi !== null;
  return {
    summary: currentOfficial
      ? "Here is standard AIRWISE guidance based on the verified source context and your selected profile. This is rule-based, not AI-generated."
      : "A live official AQI is unavailable. Here is standard AIRWISE guidance based on your selected profile; it is not AI-generated advice or a current pollution estimate.",
    recommendations: buildRecommendations(data, preferences),
    uncertainty: currentOfficial
      ? "A station reading may not describe every part of the selected area. Recheck the source before time-sensitive plans."
      : "No live official AQI is available, so current air quality is unknown. Use these as general planning suggestions, not as a pollution rating."
  };
}

function openRouterNotice(result: GeminiAdviceResult | null): string | undefined {
  if (!result || result.ok) return undefined;
  return result.diagnostic?.rateLimitClass || result.code === "provider_circuit_open"
    ? result.message
    : undefined;
}

function cloudflareNotice(result: GeminiAdviceResult | null): string | undefined {
  if (!result || result.ok) return undefined;
  return result.diagnostic?.rateLimitClass || result.code === "provider_circuit_open"
    ? result.message
    : undefined;
}

export async function resolveAssistantAdvice(input: {
  question: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  data: AirQualityResponse;
  preferences: UserPreferences;
}): Promise<AssistantResolution> {
  let cloudflare: GeminiAdviceResult | null = null;
  if (getCloudflareHealth().configured) {
    cloudflare = await requestCloudflareAdvice(input);
    if (cloudflare.ok) {
      return {
        mode: "ai_generated", provider: "Cloudflare Workers AI", advice: cloudflare.advice,
        diagnostics: { cloudflare: cloudflare.diagnostic, gemini: undefined, openrouter: undefined, ollama: undefined }
      };
    }
  }

  const primary = await requestGeminiAdvice(input);
  if (primary.ok) {
    return {
      mode: "ai_generated", provider: "Gemini", advice: primary.advice,
      ...(cloudflareNotice(cloudflare) ? { providerNotice: cloudflareNotice(cloudflare) } : {}),
      diagnostics: { cloudflare: cloudflare?.diagnostic, gemini: undefined, openrouter: undefined, ollama: undefined }
    };
  }

  let openrouter: GeminiAdviceResult | null = null;
  if (getOpenRouterHealth().configured) {
    openrouter = await requestOpenRouterAdvice(input);
    if (openrouter.ok) {
      return {
        mode: "ai_generated", provider: "OpenRouter", advice: openrouter.advice,
        ...(cloudflareNotice(cloudflare) ? { providerNotice: cloudflareNotice(cloudflare) } : {}),
        diagnostics: { cloudflare: cloudflare?.diagnostic, gemini: primary.diagnostic, openrouter: openrouter.diagnostic, ollama: undefined }
      };
    }
  }

  let secondary: GeminiAdviceResult | null = null;
  if (getOllamaHealth().configured) {
    secondary = await requestOllamaAdvice(input);
    if (secondary.ok) {
      return {
        mode: "ai_generated", provider: "Ollama", advice: secondary.advice,
        ...(openRouterNotice(openrouter) ? { providerNotice: openRouterNotice(openrouter) } : {}),
        ...(cloudflareNotice(cloudflare) ? { providerNotice: cloudflareNotice(cloudflare) } : {}),
        diagnostics: { cloudflare: cloudflare?.diagnostic, gemini: primary.diagnostic, openrouter: openrouter?.diagnostic, ollama: undefined }
      };
    }
  }

  return {
    mode: "standard_guidance",
    provider: "AIRWISE rules",
    advice: standardAdvice(input.data, input.preferences),
    ...(cloudflareNotice(cloudflare) || openRouterNotice(openrouter)
      ? { providerNotice: cloudflareNotice(cloudflare) ?? openRouterNotice(openrouter) }
      : {}),
    diagnostics: { cloudflare: cloudflare?.diagnostic, gemini: primary.diagnostic, openrouter: openrouter?.diagnostic, ollama: secondary?.diagnostic }
  };
}

export function buildStandardAdvice(data: AirQualityResponse, preferences: UserPreferences): AssistantAdvice {
  return standardAdvice(data, preferences);
}
