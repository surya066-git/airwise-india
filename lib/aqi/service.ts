import { fetchCpcbByLocation } from "@/lib/aqi/cpcb";
import { fetchOpenAqNear } from "@/lib/aqi/openaq";
import type { AirQualityResponse, SupplementaryReading } from "@/types/air-quality";

export async function getAirQuality(input: {
  city?: string;
  latitude?: number;
  longitude?: number;
}): Promise<AirQualityResponse> {
  const city = input.city?.trim() || "";
  const hasCoordinates = typeof input.latitude === "number" && typeof input.longitude === "number";

  const [official, supplementary] = await Promise.all([
    fetchCpcbByLocation(city, input.latitude, input.longitude),
    hasCoordinates
      ? fetchOpenAqNear(input.latitude!, input.longitude!)
      : Promise.resolve<SupplementaryReading>({
          status: "unavailable",
          source: "OpenAQ",
          station: null,
          distanceMeters: null,
          updatedAt: null,
          measurements: [],
          message: "Add a location with coordinates to look for nearby supplementary measurements."
        })
  ]);

  return {
    location: {
      label: city || official.city,
      latitude: hasCoordinates ? input.latitude! : null,
      longitude: hasCoordinates ? input.longitude! : null
    },
    official,
    supplementary,
    fetchedAt: new Date().toISOString()
  };
}
