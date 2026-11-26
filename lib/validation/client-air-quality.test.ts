import { describe, expect, it } from "vitest";
import { isAirQualityResponse } from "@/lib/validation/client-air-quality";

const validResponse = {
  location: { label: "Pune", latitude: 18.52, longitude: 73.85 },
  official: {
    status: "live", source: "CPCB / data.gov.in", requestedCity: "Pune", city: "Pune",
    station: "Station A", state: "Maharashtra", distanceMeters: 500, aqi: 83,
    category: "Satisfactory", interpretation: null, updatedAt: "2026-11-20T11:00:00.000Z",
    pollutants: [{ parameter: "PM2.5", value: 28, unit: "µg/m³", measuredAt: "2026-11-20T11:00:00.000Z", freshness: "live" }],
    pagination: null, message: "live"
  },
  supplementary: {
    status: "not_configured", source: "OpenAQ", station: null, distanceMeters: null,
    updatedAt: null, measurements: [], message: "missing key"
  },
  fetchedAt: "2026-11-20T11:01:00.000Z"
};

describe("client air-quality response guard", () => {
  it("accepts the validated API response shape", () => {
    expect(isAirQualityResponse(validResponse)).toBe(true);
  });

  it.each([
    { ...validResponse, official: { ...validResponse.official, source: "OpenAQ" } },
    { ...validResponse, official: { ...validResponse.official, aqi: 501 } },
    { ...validResponse, supplementary: { ...validResponse.supplementary, measurements: [{ parameter: "PM2.5", value: -1 }] } },
    { ...validResponse, fetchedAt: "yesterday" }
  ])("rejects invalid source data or malformed responses", (payload) => {
    expect(isAirQualityResponse(payload)).toBe(false);
  });
});
