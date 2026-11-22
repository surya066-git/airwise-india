import { expect, test } from "@playwright/test";

const cities = [
  { city: "Vijayawada", latitude: 16.5062, longitude: 80.648 },
  { city: "Hyderabad", latitude: 17.385, longitude: 78.4867 },
  { city: "Delhi", latitude: 28.6139, longitude: 77.209 },
  { city: "Bengaluru", latitude: 12.9716, longitude: 77.5946 },
  { city: "Mumbai", latitude: 19.076, longitude: 72.8777 }
];

test("optional live CPCB and OpenAQ five-city smoke", async ({ request }) => {
  test.skip(process.env.AIRWISE_LIVE_TESTS !== "1", "Set AIRWISE_LIVE_TESTS=1 to contact real providers.");

  for (const [index, item] of cities.entries()) {
    const params = new URLSearchParams({
      city: item.city,
      latitude: String(item.latitude),
      longitude: String(item.longitude)
    });
    const response = await request.get(`/api/aqi?${params.toString()}`);
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(["live", "stale", "unavailable", "unverified", "not_configured"]).toContain(payload.official.status);
    expect(["live", "stale", "unavailable", "unverified", "not_configured"]).toContain(payload.supplementary.status);
    console.log(JSON.stringify({
      city: item.city,
      cpcb: {
        status: payload.official.status, aqi: payload.official.aqi,
        station: payload.official.station, updatedAt: payload.official.updatedAt,
        message: payload.official.message
      },
      openaq: {
        status: payload.supplementary.status,
        station: payload.supplementary.station,
        message: payload.supplementary.message,
        measurements: payload.supplementary.measurements.map((measurement: { parameter: string; value: number; unit: string | null; measuredAt: string | null; freshness: string }) => ({
          parameter: measurement.parameter, value: measurement.value, unit: measurement.unit,
          measuredAt: measurement.measuredAt, freshness: measurement.freshness
        }))
      }
    }));
    if (index < cities.length - 1) await new Promise((resolve) => setTimeout(resolve, 300));
  }

});
