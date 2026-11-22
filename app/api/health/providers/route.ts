import { NextResponse } from "next/server";
import { getCloudflareHealth } from "@/lib/ai/cloudflare";
import { getGeminiHealth } from "@/lib/ai/gemini";
import { getOpenRouterHealth } from "@/lib/ai/openrouter";
import { getOllamaHealth } from "@/lib/ai/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderHealth = {
  configured: boolean;
  model?: string;
  state: string;
  consecutiveFailures: number;
  failureThreshold: number;
  cooldownMs: number;
  nextAttemptAt: number | null;
  probeInFlight: boolean;
};

function publicProviderHealth(health: ProviderHealth) {
  return {
    configured: health.configured,
    ...(health.model ? { model: health.model } : {}),
    state: health.state,
    consecutiveFailures: health.consecutiveFailures,
    failureThreshold: health.failureThreshold,
    cooldownMs: health.cooldownMs,
    retryAfterSeconds: health.nextAttemptAt === null
      ? null
      : Math.max(0, Math.ceil((health.nextAttemptAt - Date.now()) / 1000)),
    probeInFlight: health.probeInFlight
  };
}

/** In-process provider health only; never exposes credentials or makes probe requests. */
export async function GET() {
  return NextResponse.json({
    providers: {
      cloudflare: publicProviderHealth(getCloudflareHealth()),
      gemini: publicProviderHealth(getGeminiHealth()),
      openrouter: publicProviderHealth(getOpenRouterHealth()),
      ollama: publicProviderHealth(getOllamaHealth())
    }
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
