import type { DataStatus, PollutantReading, SupplementaryReading } from "@/types/air-quality";
import { fetchProviderWithRetry } from "@/lib/utils/provider-fetch";

const API_BASE = "https://api.openaq.org/v3";
const SEARCH_RADIUS_METERS = 25_000;
const FRESH_FOR_MS = 3 * 60 * 60 * 1000;
const MAX_MEASUREMENT_VALUE = 1_000_000;
const POLLUTANT_PARAMETERS = new Set([
  "pm1", "pm25", "pm25mass", "pm10", "pm10mass", "no", "no2", "no2mass", "nox",
  "so2", "so2mass", "co", "comass", "o3", "o3mass", "nh3", "nh3mass", "pb", "bc", "blackcarbon"
]);
type JsonRecord = Record<string, unknown>;
type Coordinates = { latitude: number; longitude: number };

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCoordinatePair(value: unknown): Coordinates | null {
  if (!isRecord(value)) return null;
  const { latitude, longitude } = value;
  if (typeof latitude !== "number" || typeof longitude !== "number" ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function isPollutantParameter(value: string): boolean {
  return POLLUTANT_PARAMETERS.has(value.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function validTimestamp(value: unknown): string | null {
  if (!isRecord(value) || typeof value.utc !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.utc)) return null;
  const time = Date.parse(value.utc);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function distanceMeters(a: Coordinates, b: Coordinates): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function empty(status: DataStatus, message: string): SupplementaryReading {
  return {
    status, source: "OpenAQ", station: null, distanceMeters: null,
    updatedAt: null, measurements: [], message
  };
}

function statusFor(timestamp: string, now: number): "live" | "stale" | "unverified" {
  const age = now - Date.parse(timestamp);
  if (age < -5 * 60 * 1000) return "unverified";
  return age > FRESH_FOR_MS ? "stale" : "live";
}

async function getJson(url: URL, headers: HeadersInit): Promise<{ response: Response; payload: unknown }> {
  const response = await fetchProviderWithRetry(url, { headers, cache: "no-store" }, 8_000);
  if (!response.ok) return { response, payload: null };
  return { response, payload: await response.json() as unknown };
}

function failureFor(response: Response, stage: string): SupplementaryReading {
  if (response.status === 401 || response.status === 403) {
    return empty("not_configured", "OpenAQ rejected the configured API key. Check OPENAQ_API_KEY on the server.");
  }
  if (response.status === 429) {
    return empty("unavailable", "OpenAQ's request limit was reached. Try again later.");
  }
  return empty("unavailable", "OpenAQ could not return " + stage + ".");
}

export async function fetchOpenAqNear(
  latitude: number,
  longitude: number,
  now = Date.now()
): Promise<SupplementaryReading> {
  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) {
    return empty("not_configured", "OpenAQ supplementary measurements are not configured. Add an API key on the server.");
  }
  const requested = { latitude, longitude };
  if (!validCoordinatePair(requested)) {
    return empty("unavailable", "OpenAQ needs a valid coordinate pair for the selected location.");
  }
  const headers = { "X-API-Key": apiKey, Accept: "application/json" };

  try {
    const locationsUrl = new URL(API_BASE + "/locations");
    locationsUrl.searchParams.set("coordinates", latitude + "," + longitude);
    locationsUrl.searchParams.set("radius", String(SEARCH_RADIUS_METERS));
    locationsUrl.searchParams.set("iso", "IN");
    locationsUrl.searchParams.set("limit", "100");
    locationsUrl.searchParams.set("page", "1");

    const locationsResult = await getJson(locationsUrl, headers);
    if (!locationsResult.response.ok) return failureFor(locationsResult.response, "nearby locations");
    const locations = isRecord(locationsResult.payload) && Array.isArray(locationsResult.payload.results)
      ? locationsResult.payload.results.filter(isRecord) : [];
    const nearest = locations.flatMap((location) => {
      const id = location.id;
      const coordinates = validCoordinatePair(location.coordinates);
      const country = isRecord(location.country) ? location.country.code : undefined;
      if (typeof id !== "number" || !Number.isInteger(id) || !coordinates ||
          location.isMonitor !== true || (typeof country === "string" && country.toUpperCase() !== "IN")) return [];
      const distance = distanceMeters(requested, coordinates);
      return distance <= SEARCH_RADIUS_METERS ? [{ location, id, distance }] : [];
    }).sort((left, right) => left.distance - right.distance)[0];

    if (!nearest) {
      return empty("unavailable", "OpenAQ returned no Indian reference monitor within 25 km of the selected coordinates.");
    }

    const sensorsUrl = new URL(API_BASE + "/locations/" + nearest.id + "/sensors");
    sensorsUrl.searchParams.set("limit", "100");
    sensorsUrl.searchParams.set("page", "1");
    const sensorsResult = await getJson(sensorsUrl, headers);
    if (!sensorsResult.response.ok) return failureFor(sensorsResult.response, "sensor details");
    const sensorRecords = isRecord(sensorsResult.payload) && Array.isArray(sensorsResult.payload.results)
      ? sensorsResult.payload.results.filter(isRecord) : [];
    const sensorNames = new Map<number, { name: string; unit: string | null }>();
    for (const sensor of sensorRecords) {
      if (typeof sensor.id !== "number" || !Number.isInteger(sensor.id) || !isRecord(sensor.parameter)) continue;
      const parameter = sensor.parameter;
      if (typeof parameter.name !== "string" || !parameter.name.trim() || !isPollutantParameter(parameter.name)) continue;
      sensorNames.set(sensor.id, {
        name: typeof parameter.displayName === "string" && parameter.displayName.trim()
          ? parameter.displayName.trim() : parameter.name.trim(),
        unit: typeof parameter.units === "string" && parameter.units.trim() ? parameter.units.trim() : null
      });
    }

    const latestUrl = new URL(API_BASE + "/locations/" + nearest.id + "/latest");
    latestUrl.searchParams.set("limit", "100");
    latestUrl.searchParams.set("page", "1");
    const latestResult = await getJson(latestUrl, headers);
    if (!latestResult.response.ok) return failureFor(latestResult.response, "latest measurements");
    const latestRecords = isRecord(latestResult.payload) && Array.isArray(latestResult.payload.results)
      ? latestResult.payload.results.filter(isRecord) : [];
    let invalidCount = 0;
    const bySensor = new Map<number, PollutantReading>();
    for (const record of latestRecords) {
      if (record.locationsId !== nearest.id || typeof record.sensorsId !== "number") continue;
      const sensor = sensorNames.get(record.sensorsId);
      if (!sensor) continue;
      const timestamp = validTimestamp(record.datetime);
      const value = record.value;
      if (!timestamp || typeof value !== "number" || !Number.isFinite(value) ||
          value < 0 || value > MAX_MEASUREMENT_VALUE) {
        invalidCount += 1;
        continue;
      }
      const freshness = statusFor(timestamp, now);
      const existing = bySensor.get(record.sensorsId);
      if (!existing || Date.parse(timestamp) > Date.parse(existing.measuredAt ?? "")) {
        bySensor.set(record.sensorsId, {
          parameter: sensor.name,
          value,
          unit: sensor.unit,
          measuredAt: timestamp,
          freshness
        });
      }
    }

    const measurements = [...bySensor.values()].sort((a, b) =>
      Date.parse(b.measuredAt ?? "") - Date.parse(a.measuredAt ?? ""));
    const station = typeof nearest.location.name === "string" && nearest.location.name.trim()
      ? nearest.location.name.trim() : null;
    const distance = Math.round(nearest.distance);
    if (measurements.length === 0) {
      return {
        ...empty("unverified", "OpenAQ returned no latest values that could be matched to a sensor, unit, and timestamp."),
        station, distanceMeters: distance
      };
    }

    const updatedAt = measurements[0].measuredAt;
    const latestFreshness = measurements[0].freshness ?? "unverified";
    const status: DataStatus = invalidCount > 0 ? "unverified" : latestFreshness;
    return {
      status,
      source: "OpenAQ",
      station,
      distanceMeters: distance,
      updatedAt,
      measurements,
      message: invalidCount > 0
        ? "Some OpenAQ records were invalid and omitted. Each displayed sensor keeps its own observation timestamp."
        : "OpenAQ sensor measurements from one nearby location. Each pollutant keeps its own timestamp; these are not an official CPCB AQI."
    };
  } catch {
    return empty("unavailable", "OpenAQ did not return a valid response. No AQI has been inferred from its measurements.");
  }
}
