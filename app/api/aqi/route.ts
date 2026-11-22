import { NextResponse } from "next/server";
import { getAirQuality } from "@/lib/aqi/service";
import { airwiseOfflineTestData, cloudflareLiveTestData } from "@/lib/aqi/live-test-data";
import { isAirwiseOfflineTestMode, isCloudflareOnlyLiveTest } from "@/lib/ai/live-test-mode";
import { clientKey, isRateLimited } from "@/lib/utils/rate-limit";
import { airQualityResponseSchema, locationQuerySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (isRateLimited(`aqi:${clientKey(request)}`, 30, 60_000)) {
    return NextResponse.json(
      { error: "rate_limited", message: "Please wait before requesting another refresh." },
      { status: 429 }
    );
  }

  const params = new URL(request.url).searchParams;
  const parsed = locationQuerySchema.safeParse({
    city: params.get("city") ?? "",
    latitude: params.has("latitude") ? params.get("latitude") : undefined,
    longitude: params.has("longitude") ? params.get("longitude") : undefined
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_location", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const sourceData = isAirwiseOfflineTestMode()
    ? airwiseOfflineTestData(parsed.data.city)
    : isCloudflareOnlyLiveTest()
      ? cloudflareLiveTestData(parsed.data.city)
    : await getAirQuality(parsed.data);
  const data = airQualityResponseSchema.safeParse(sourceData);
  if (!data.success) {
    return NextResponse.json(
      { error: "invalid_provider_response", message: "The data service returned a response AIRWISE could not verify." },
      { status: 502 }
    );
  }
  return NextResponse.json(data.data, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
