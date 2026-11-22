import { NextResponse } from "next/server";
import { getAirQuality } from "@/lib/aqi/service";
import { airwiseOfflineTestData, cloudflareLiveTestData } from "@/lib/aqi/live-test-data";
import { buildStandardAdvice, resolveAssistantAdvice } from "@/lib/ai/assistant";
import { isAirwiseOfflineTestMode, isCloudflareOnlyLiveTest } from "@/lib/ai/live-test-mode";
import { getCloudflareHealth, requestCloudflareAdvice } from "@/lib/ai/cloudflare";
import { clientKey, isRateLimited } from "@/lib/utils/rate-limit";
import { assistantBodySchema } from "@/lib/validation/schemas";
import type { AirQualityResponse } from "@/types/air-quality";

export const runtime = "nodejs";
export const maxDuration = 300;

function timeLabel(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata"
  }).format(date) + " IST";
}

/** This exact-source summary is server-built and is never model generated. */
export function formatVerifiedData(data: AirQualityResponse): string {
  const lines: string[] = [];
  lines.push("Selected location: " + (data.location.label || data.official.city || "coordinates only"));
  const official = data.official;
  if (official.aqi !== null && official.category) {
    const freshness = official.status === "live" ? "live" : official.status;
    lines.push("Official CPCB AQI (" + freshness + "): " + official.aqi + " — " + official.category + ". Source: " + official.source + ".");
    if (official.city || official.state || official.station) {
      lines.push("Official station: " + [official.station, official.city, official.state].filter(Boolean).join(", ") + ".");
    }
    lines.push("Official observation time: " + (timeLabel(official.updatedAt) ?? "unverified") + ".");
  } else {
    lines.push("Official CPCB AQI: unavailable. " + official.message + " AIRWISE has not calculated one from pollutants.");
    if (official.station || official.city) {
      lines.push("CPCB station record: " + [official.station, official.city, official.state].filter(Boolean).join(", ") + ".");
    }
    if (official.updatedAt) lines.push("CPCB observation time: " + (timeLabel(official.updatedAt) ?? "unverified") + ".");
  }
  if (official.pollutants.length) {
    lines.push("CPCB pollutant observations (not AQI): " + official.pollutants.map((item) =>
      item.parameter + " " + item.value + (item.unit ? " " + item.unit : "") + " at " + (timeLabel(item.measuredAt) ?? "unverified time")
    ).join("; ") + ".");
  }

  const supplementary = data.supplementary;
  if (supplementary.measurements.length) {
    lines.push("Supplementary OpenAQ raw measurements at " + (supplementary.station ?? "an unnamed location") +
      " (" + supplementary.status + "; not official CPCB AQI): " + supplementary.measurements.map((item) =>
        item.parameter + " " + item.value + (item.unit ? " " + item.unit : "") + " at " + (timeLabel(item.measuredAt) ?? "unverified time")
      ).join("; ") + ". Each sensor may have a different timestamp.");
  } else {
    lines.push("OpenAQ supplementary measurements: " + supplementary.status + ". " + supplementary.message);
  }
  return lines.join("\n");
}

export async function POST(request: Request) {
  if (isRateLimited("assistant:" + clientKey(request), 12, 60_000)) {
    return NextResponse.json(
      { error: "rate_limited", message: "Please wait before sending another question." },
      { status: 429 }
    );
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 20_000) return NextResponse.json({ error: "request_too_large" }, { status: 413 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = assistantBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { city, latitude, longitude, messages, preferences } = parsed.data;
  const question = [...messages].reverse().find((message) => message.role === "user")?.content;
  if (!question) return NextResponse.json({ error: "invalid_request", message: "A user question is required." }, { status: 400 });

  const offlineOnly = isAirwiseOfflineTestMode();
  const cloudflareOnly = !offlineOnly && isCloudflareOnlyLiveTest();
  const data = offlineOnly
    ? airwiseOfflineTestData(city)
    : cloudflareOnly
      ? cloudflareLiveTestData(city)
    : await getAirQuality({ city, latitude, longitude });
  const verifiedData = formatVerifiedData(data);
  const limitationNotice = cloudflareOnly || offlineOnly
    ? "No verified CPCB AQI or OpenAQ readings were retrieved for this check. Those sources were not queried, so current local air conditions are unknown."
    : undefined;
  const asksAboutCurrent = /\b(?:current|today|now|tonight|this (?:morning|afternoon|evening)|safe to|is it safe|AQI|air quality|pollution level|outside conditions|outdoor conditions|should I (?:go|walk|run|exercise|cycle) outside|morning walk)\b/i.test(question);

  if (offlineOnly) {
    const advice = buildStandardAdvice(data, preferences);
    return NextResponse.json({
      answer: "AI providers and live data sources are disabled in offline test mode. This is standard AIRWISE guidance, not AI-generated.",
      advice, responseMode: "standard_guidance", provider: "AIRWISE rules",
      providerNotice: "Offline test mode prevented all external service calls.", verifiedData, limitationNotice,
      sources: { cpcbStatus: data.official.status, openAqStatus: data.supplementary.status }
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  if (!cloudflareOnly && asksAboutCurrent && !(data.official.status === "live" && data.official.aqi !== null)) {
    const reason = data.official.status === "stale"
      ? "The last official AQI is stale."
      : "No live official CPCB AQI is available.";
    const advice = buildStandardAdvice(data, preferences);
    return NextResponse.json({
      answer: "I cannot assess current outdoor conditions for " + (city || "your selected location") + ". " + reason +
        " Check CPCB before making a time-sensitive decision. " + advice.summary,
      advice,
      responseMode: "standard_guidance",
      provider: "AIRWISE rules",
      verifiedData,
      sources: { cpcbStatus: data.official.status, openAqStatus: data.supplementary.status }
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  if (cloudflareOnly) {
    const configuredModel = process.env.CLOUDFLARE_AI_MODEL?.trim();
    if (!getCloudflareHealth().configured || !configuredModel ||
        configuredModel.length > 160 || !/^[A-Za-z0-9@/._:-]+$/.test(configuredModel)) {
      const advice = buildStandardAdvice(data, preferences);
      return NextResponse.json({
        error: "cloudflare_live_test_not_configured",
        message: "Cloudflare Workers AI is unavailable. The recommendations below are Standard AIRWISE guidance, not AI-generated.",
        failedProvider: "Cloudflare Workers AI", provider: "AIRWISE rules", responseMode: "standard_guidance",
        advice, providerNotice: "No validated Cloudflare Workers AI response was available.", verifiedData, limitationNotice,
        upstreamHttpStatus: null,
        sources: { cpcbStatus: data.official.status, openAqStatus: data.supplementary.status }
      }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    const result = await requestCloudflareAdvice({ question, messages, data, preferences }, { maxRetries: 0 });
    if (!result.ok) {
      const advice = buildStandardAdvice(data, preferences);
      return NextResponse.json({
        error: "cloudflare_live_test_failed",
        message: "Cloudflare Workers AI is unavailable. The recommendations below are Standard AIRWISE guidance, not AI-generated.",
        failedProvider: "Cloudflare Workers AI", provider: "AIRWISE rules", responseMode: "standard_guidance",
        advice, providerNotice: result.message, diagnostics: { cloudflare: result.diagnostic },
        upstreamHttpStatus: result.diagnostic?.httpStatus ?? null, verifiedData, limitationNotice,
        sources: { cpcbStatus: data.official.status, openAqStatus: data.supplementary.status }
      }, { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    return NextResponse.json({
      answer: result.advice.summary, advice: result.advice,
      responseMode: "ai_generated", provider: "Cloudflare Workers AI",
      diagnostics: { cloudflare: result.diagnostic, gemini: undefined, openrouter: undefined, ollama: undefined },
      verifiedData, limitationNotice,
      sources: { cpcbStatus: data.official.status, openAqStatus: data.supplementary.status }
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  const resolution = await resolveAssistantAdvice({ question, messages, data, preferences });

  return NextResponse.json({
    answer: resolution.advice.summary,
    advice: resolution.advice,
    responseMode: resolution.mode,
    provider: resolution.provider,
    ...(resolution.providerNotice ? { providerNotice: resolution.providerNotice } : {}),
    diagnostics: resolution.diagnostics,
    verifiedData,
    sources: { cpcbStatus: data.official.status, openAqStatus: data.supplementary.status }
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
