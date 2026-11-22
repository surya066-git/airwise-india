import type { AirQualityResponse } from "@/types/air-quality";

function unavailableSourceData(city: string, testLabel: string): AirQualityResponse {
  return {
    location: { label: city || null, latitude: null, longitude: null },
    official: {
      status: "unavailable", source: "CPCB / data.gov.in", requestedCity: city || null,
      city: null, station: null, state: null, distanceMeters: null, aqi: null, category: null,
      interpretation: null, updatedAt: null, pollutants: [], pagination: null,
      message: `No CPCB request was made during ${testLabel}; current official AQI is unverified.`
    },
    supplementary: {
      status: "unavailable", source: "OpenAQ", station: null, distanceMeters: null,
      updatedAt: null, measurements: [],
      message: `No OpenAQ request was made during ${testLabel}; supplementary measurements are unavailable.`
    },
    fetchedAt: new Date().toISOString()
  };
}

/** Deliberately empty source state used only when the Cloudflare-only dev test skips AQI providers. */
export function cloudflareLiveTestData(city: string): AirQualityResponse {
  return unavailableSourceData(city, "the Cloudflare-only verification");
}

/** Empty source state used by offline tests; it never contains generated or live measurements. */
export function airwiseOfflineTestData(city: string): AirQualityResponse {
  return unavailableSourceData(city, "offline test mode");
}
