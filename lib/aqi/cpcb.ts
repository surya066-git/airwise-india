import { getCpcbCategory } from "@/lib/aqi/categories";
import { fetchProviderWithRetry } from "@/lib/utils/provider-fetch";
import type { CpcbPaginationAudit, DataStatus, OfficialReading, PollutantReading } from "@/types/air-quality";

const API_BASE = "https://api.data.gov.in/resource/";
const DEFAULT_CPCB_RESOURCE_ID = "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";
const FRESH_FOR_MS = 3 * 60 * 60 * 1000;
const MAX_STATION_DISTANCE_METERS = 50_000;
const MAX_POLLUTANT_VALUE = 1_000_000;
const REQUESTED_PAGE_LIMIT = 500;
const MAX_PAGE_COUNT = 50;
const MAX_TOTAL_RECORDS = 1_000;
const PAGE_GAP_MS = 200;
const CPCB_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RETRY_AFTER_WAIT_MS = 5_000;
type JsonRecord = Record<string, unknown>;
type Coordinates = { latitude: number; longitude: number };
type CachedCpcbPayload = { expiresAt: number; payload: unknown; pagination: CpcbPaginationAudit };

const cpcbCache = new Map<string, CachedCpcbPayload>();
const cpcbInFlight = new Map<string, Promise<{ payload?: unknown; pagination?: CpcbPaginationAudit; failure?: OfficialReading }>>();
let cpcbRequestQueue: Promise<void> = Promise.resolve();
let lastCpcbRequestAt = 0;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(record: JsonRecord, name: string): string | null {
  const value = record[name];
  if (typeof value !== "string" || !value.trim() || value.trim().toUpperCase() === "NA") return null;
  return value.trim();
}

function numberField(record: JsonRecord, name: string): number | null {
  const value = record[name];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && value.trim().toUpperCase() !== "NA") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pollutantAverage(record: JsonRecord): number | null {
  const field = record.pollutant_avg !== undefined ? "pollutant_avg" : "avg_value";
  return numberField(record, field);
}

function normalizeCity(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-IN").replace(/[_.,-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** CPCB's published station rows use DD-MM-YYYY HH:mm in India local time. */
export function parseCpcbTimestamp(value: string | null): string | null {
  if (!value) return null;
  const local = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (local) {
    const [, dayText, monthText, yearText, hourText, minuteText, secondText] = local;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const second = Number(secondText ?? "0");
    const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
    return new Date(check.getTime() - 330 * 60_000).toISOString();
  }

  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function freshnessStatus(timestamp: string | null, now: number): DataStatus {
  if (!timestamp) return "unverified";
  const age = now - Date.parse(timestamp);
  if (age < -5 * 60 * 1000) return "unverified";
  return age > FRESH_FOR_MS ? "stale" : "live";
}

function coordinatesFor(record: JsonRecord): Coordinates | null {
  const latitude = numberField(record, "latitude");
  const longitude = numberField(record, "longitude");
  if (latitude === null || longitude === null || latitude < -90 || latitude > 90 ||
      longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
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

function emptyOfficial(city: string | null, status: DataStatus, message: string): OfficialReading {
  return {
    status, source: "CPCB / data.gov.in", requestedCity: city, city: null, station: null,
    state: null, distanceMeters: null, aqi: null, category: null, interpretation: null,
    updatedAt: null, pollutants: [], pagination: null, message
  };
}

/**
 * Parse only the configured resource's explicit fields. The currently public
 * catalog describes station pollutant observations; it does not document an
 * explicit AQI column. An AQI is used only when a returned row has `aqi` or
 * `AQI` at the same station and observation time as the pollutant rows.
 */
export function parseCpcbResponse(
  payload: unknown,
  requestedCity: string,
  now = Date.now(),
  targetCoordinates?: Coordinates,
  pagination?: CpcbPaginationAudit
): OfficialReading {
  const city = requestedCity.trim();
  if (!city && !targetCoordinates) {
    return emptyOfficial(null, "unavailable", "Choose an Indian city or use a location with coordinates.");
  }
  if (!isRecord(payload) || !Array.isArray(payload.records)) {
    return emptyOfficial(city || null, "unverified", "The data.gov.in response did not match the expected records format.");
  }
  const reportedTotal = numberField(payload, "total");
  const offset = numberField(payload, "offset") ?? 0;
  if (reportedTotal !== null && offset + payload.records.length < reportedTotal) {
    return emptyOfficial(city || null, "unverified",
      "data.gov.in returned only " + payload.records.length + " of " + reportedTotal +
        " matching records. AIRWISE cannot verify station coverage from a partial result page.");
  }

  const cityKey = normalizeCity(city);
  const rows = payload.records.filter((value): value is JsonRecord => {
    if (!isRecord(value)) return false;
    const country = textField(value, "country");
    if (country && normalizeCity(country) !== "india") return false;
    if (cityKey && normalizeCity(textField(value, "city") ?? "") !== cityKey) return false;
    return true;
  });

  const groups = new Map<string, JsonRecord[]>();
  for (const row of rows) {
    const coords = coordinatesFor(row);
    const key = [
      normalizeCity(textField(row, "city") ?? ""),
      normalizeCity(textField(row, "state") ?? ""),
      textField(row, "station") ?? "",
      coords?.latitude ?? "",
      coords?.longitude ?? ""
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const candidates = [...groups.values()].map((stationRows) => {
    const stationCoords = stationRows.map(coordinatesFor).find((value) => value !== null) ?? null;
    const distance = targetCoordinates && stationCoords ? distanceMeters(targetCoordinates, stationCoords) : null;
    const latest = stationRows.map((row) => ({
      row,
      timestamp: parseCpcbTimestamp(textField(row, "last_update"))
    })).filter((item): item is { row: JsonRecord; timestamp: string } => item.timestamp !== null)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0] ?? null;
    return { rows: stationRows, stationCoords, distance, latest };
  }).filter((item) => {
    if (!targetCoordinates) return true;
    if (!item.stationCoords) return false;
    return (item.distance ?? Infinity) <= MAX_STATION_DISTANCE_METERS;
  }).sort((a, b) => {
    if (targetCoordinates && a.distance !== null && b.distance !== null && a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return Date.parse(b.latest?.timestamp ?? "") - Date.parse(a.latest?.timestamp ?? "");
  });

  const selected = candidates[0];
  if (!selected) {
    return emptyOfficial(city || null, "unavailable", city
      ? "No matching CPCB station was found in the selected city and nearby area. AIRWISE did not substitute another city."
      : "No CPCB station was found within 50 km of the selected coordinates.");
  }

  const updatedAt = selected.latest?.timestamp ?? null;
  const latestMillis = updatedAt ? Date.parse(updatedAt) : null;
  const observationRows = latestMillis === null
    ? selected.rows.slice(0, 1)
    : selected.rows.filter((row) => {
        const timestamp = parseCpcbTimestamp(textField(row, "last_update"));
        return timestamp !== null && Date.parse(timestamp) === latestMillis;
      });

  const pollutants: PollutantReading[] = observationRows.flatMap((row) => {
    const parameter = textField(row, "pollutant_id");
    const value = pollutantAverage(row);
    if (!parameter || value === null || value < 0 || value > MAX_POLLUTANT_VALUE) return [];
    return [{
      parameter,
      value,
      unit: textField(row, "pollutant_unit"),
      measuredAt: updatedAt,
      freshness: freshnessStatus(updatedAt, now) === "live" ? "live" :
        freshnessStatus(updatedAt, now) === "stale" ? "stale" : "unverified"
    }];
  });

  const invalidPollutant = observationRows.some((row) => {
    const raw = row.pollutant_avg !== undefined ? row.pollutant_avg : row.avg_value;
    const missing = raw === undefined || raw === null ||
      (typeof raw === "string" && raw.trim().toUpperCase() === "NA");
    const value = pollutantAverage(row);
    return !missing && (value === null || value < 0 || value > MAX_POLLUTANT_VALUE);
  });
  const explicitAqiValues = observationRows.map((row) => numberField(row, "aqi") ?? numberField(row, "AQI"))
    .filter((value): value is number => value !== null);
  const abnormalAqi = explicitAqiValues.some((value) => !Number.isInteger(value) || value < 0 || value > 500);
  const aqi = abnormalAqi ? null : explicitAqiValues[0] ?? null;
  const category = aqi === null ? null : getCpcbCategory(aqi);
  const status = freshnessStatus(updatedAt, now);
  const stationRow = selected.latest?.row ?? observationRows[0] ?? selected.rows[0];
  const station = textField(stationRow, "station");
  const sourceCity = textField(stationRow, "city");
  const state = textField(stationRow, "state");
  const distance = selected.distance === null ? null : Math.round(selected.distance);

  const base = {
    requestedCity: city || null,
    city: sourceCity,
    station,
    state,
    distanceMeters: distance,
    updatedAt,
    pollutants,
    ...(pagination ? { pagination } : {})
  };

  if (abnormalAqi || invalidPollutant) {
    return {
      ...emptyOfficial(city || null, "unverified", abnormalAqi
        ? "CPCB returned an AQI outside the supported integer scale of 0–500."
        : "CPCB returned an invalid or extreme pollutant value; the affected values were omitted."),
      ...base
    };
  }
  if (aqi === null || !category) {
    return {
      ...emptyOfficial(city || null, "unverified", pollutants.length
        ? "CPCB returned pollutant observations but no explicit valid AQI field at the same station and timestamp. AIRWISE has not calculated an index."
        : "A station row was returned, but it has no verifiable AQI or pollutant reading."),
      ...base,
      status: "unverified"
    };
  }

  return {
    ...emptyOfficial(city || null, status, status === "stale"
      ? "The latest explicit CPCB AQI is older than three hours."
      : status === "unverified"
        ? "The CPCB station timestamp could not be verified."
        : "Explicit AQI value returned by the configured CPCB resource."),
    ...base,
    status,
    aqi,
    category: category.label,
    interpretation: category.interpretation
  };
}

function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value?.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function rowFingerprint(row: JsonRecord): string {
  return JSON.stringify(Object.keys(row).sort().map((key) => [key, row[key]]));
}

function rowIdentity(row: JsonRecord): string | null {
  const city = normalizeCity(textField(row, "city") ?? "");
  const state = normalizeCity(textField(row, "state") ?? "");
  const station = normalizeCity(textField(row, "station") ?? "");
  const pollutant = normalizeCity(textField(row, "pollutant_id") ?? "");
  const timestamp = parseCpcbTimestamp(textField(row, "last_update"));
  if (!city || !station || !pollutant || !timestamp) return null;
  return [city, state, station, pollutant, timestamp].join("|");
}

async function requestCpcbPage(url: URL): Promise<Response> {
  const init = { headers: { Accept: "application/json" }, cache: "no-store" as RequestCache };
  const response = await fetchProviderWithRetry(url, init, 8_000);
  if (response.status !== 429) return response;

  const waitMs = retryAfterMs(response.headers.get("retry-after"));
  if (waitMs === null || waitMs > MAX_RETRY_AFTER_WAIT_MS) return response;
  try {
    await response.body?.cancel();
  } catch {
    // Keep the rate-limit response authoritative if its body cannot be discarded.
  }
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  return fetchProviderWithRetry(url, init, 8_000);
}

function enqueueCpcbPage(url: URL): Promise<Response> {
  const request = cpcbRequestQueue.then(async () => {
    const wait = Math.max(0, lastCpcbRequestAt + PAGE_GAP_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await requestCpcbPage(url);
    } finally {
      lastCpcbRequestAt = Date.now();
    }
  });
  cpcbRequestQueue = request.then(() => undefined, () => undefined);
  return request;
}

async function fetchCompleteCpcbDataset(city: string, apiKey: string, resourceId: string) {
  const records: JsonRecord[] = [];
  const identities = new Map<string, string>();
  let expectedTotal: number | null = null;
  let offset = 0;
  const audit: CpcbPaginationAudit = {
    status: "incomplete", requestedLimit: REQUESTED_PAGE_LIMIT, pageCount: 0,
    reportedTotal: null, recordsReturned: 0, uniqueRecords: 0,
    duplicateRows: 0, conflictingRows: 0, pages: []
  };
  const failure = (message: string, status: CpcbPaginationAudit["status"] = "incomplete", dataStatus: DataStatus = "unverified") => {
    audit.status = status;
    return { failure: { ...emptyOfficial(city, dataStatus, message), pagination: { ...audit } } };
  };

  for (let page = 0; page < MAX_PAGE_COUNT; page += 1) {
    const url = new URL(encodeURIComponent(resourceId), API_BASE);
    url.searchParams.set("api-key", apiKey);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", String(REQUESTED_PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("filters[city]", city);

    audit.pageCount += 1;
    const response = await enqueueCpcbPage(url);
    if (response.status === 401 || response.status === 403) {
      return failure("The configured data.gov.in credentials or resource access were rejected.", "incomplete", "not_configured");
    }
    if (response.status === 429) {
      const waitMs = retryAfterMs(response.headers.get("retry-after"));
      const waitLabel = waitMs === null ? "" : waitMs > MAX_RETRY_AFTER_WAIT_MS
        ? " The source asked clients to wait before retrying."
        : " The source is still rate limiting requests.";
      return failure("The data.gov.in request limit was reached." + waitLabel, "rate_limited", "unavailable");
    }
    if (!response.ok) {
      return failure("The CPCB/data.gov.in service could not return station records.", "incomplete", "unavailable");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return failure("data.gov.in returned a page that was not valid JSON.");
    }
    if (!isRecord(payload) || !Array.isArray(payload.records) ||
        payload.records.some((record) => !isRecord(record))) {
      return failure("data.gov.in returned a malformed station page.");
    }
    const pageRecords = payload.records as JsonRecord[];
    const reportedTotal = numberField(payload, "total");
    const reportedOffset = numberField(payload, "offset");
    const reportedLimit = numberField(payload, "limit");
    const reportedCount = numberField(payload, "count");
    audit.pages.push({
      requestedOffset: offset,
      reportedOffset: reportedOffset !== null && Number.isInteger(reportedOffset) && reportedOffset >= 0 ? reportedOffset : null,
      reportedLimit: reportedLimit !== null && Number.isInteger(reportedLimit) && reportedLimit > 0 ? reportedLimit : null,
      reportedCount: reportedCount !== null && Number.isInteger(reportedCount) && reportedCount >= 0 ? reportedCount : null,
      actualCount: pageRecords.length
    });
    if (reportedTotal === null || !Number.isInteger(reportedTotal) || reportedTotal < 0 ||
        reportedTotal > MAX_TOTAL_RECORDS || reportedOffset !== offset ||
        reportedLimit === null || !Number.isInteger(reportedLimit) || reportedLimit < 1 ||
        pageRecords.length > reportedLimit || (reportedCount !== null && reportedCount !== pageRecords.length)) {
      audit.reportedTotal = reportedTotal !== null && Number.isInteger(reportedTotal) && reportedTotal >= 0 ? reportedTotal : null;
      audit.recordsReturned += pageRecords.length;
      return failure("data.gov.in returned inconsistent pagination metadata; station coverage is unverified.");
    }
    audit.reportedTotal = reportedTotal;
    if (expectedTotal !== null && reportedTotal !== expectedTotal) {
      audit.recordsReturned += pageRecords.length;
      return failure("The data.gov.in result total changed during pagination; station coverage is unverified.");
    }
    expectedTotal = reportedTotal;
    const expectedPageRecords = Math.min(reportedLimit, Math.max(0, expectedTotal - offset));
    audit.recordsReturned += pageRecords.length;
    if (pageRecords.length !== expectedPageRecords) {
      return failure("data.gov.in returned an incomplete page before the reported total; station coverage is unverified.");
    }

    for (const row of pageRecords) {
      const identity = rowIdentity(row);
      if (!identity) {
        return failure("A CPCB row lacked a station, pollutant, or valid observation time needed to verify pagination identity.");
      }
      const fingerprint = rowFingerprint(row);
      const previous = identities.get(identity);
      if (previous !== undefined) {
        if (previous === fingerprint) {
          audit.duplicateRows += 1;
          return failure("data.gov.in repeated a station/pollutant/time row during pagination; station coverage is unverified.", "overlap");
        }
        audit.conflictingRows += 1;
        return failure("data.gov.in returned conflicting values for the same station/pollutant/time identity; station coverage is unverified.", "conflict");
      }
      identities.set(identity, fingerprint);
      records.push(row);
      audit.uniqueRecords += 1;
    }

    if (records.length === expectedTotal) {
      audit.status = "complete";
      return {
        payload: { records, total: expectedTotal, limit: records.length, offset: 0 },
        pagination: { ...audit }
      };
    }
    if (pageRecords.length === 0 || records.length > MAX_TOTAL_RECORDS) {
      return failure("data.gov.in returned an incomplete result set; station coverage is unverified.");
    }
    offset += pageRecords.length;
  }

  return failure("The safe CPCB pagination limit was reached before all city records were retrieved.");
}

export function clearCpcbCacheForTests() {
  cpcbCache.clear();
  cpcbInFlight.clear();
  cpcbRequestQueue = Promise.resolve();
  lastCpcbRequestAt = 0;
}

export async function fetchCpcbByLocation(
  city: string,
  latitude?: number,
  longitude?: number
): Promise<OfficialReading> {
  const apiKey = process.env.DATA_GOV_API_KEY;
  const resourceId = process.env.DATA_GOV_RESOURCE_ID?.trim() || DEFAULT_CPCB_RESOURCE_ID;
  const requestedCity = city.trim();
  if (!apiKey) {
    return emptyOfficial(requestedCity || null, "not_configured", "CPCB live data is not configured. Set the data.gov.in API key on the server.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resourceId)) {
    return emptyOfficial(requestedCity || null, "unverified", "The configured CPCB resource ID is not a valid resource identifier.");
  }
  if (!requestedCity) {
    return emptyOfficial(null, "unavailable", "Choose a city to verify CPCB station coverage. Coordinates alone are not used to scan the national resource.");
  }

  const targetCoordinates = latitude === undefined || longitude === undefined ? undefined : { latitude, longitude };
  const cacheKey = resourceId + "|" + normalizeCity(requestedCity);
  const cached = cpcbCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return parseCpcbResponse(cached.payload, requestedCity, Date.now(), targetCoordinates, cached.pagination);
  }
  cpcbCache.delete(cacheKey);

  try {
    let request = cpcbInFlight.get(cacheKey);
    if (!request) {
      request = fetchCompleteCpcbDataset(requestedCity, apiKey, resourceId);
      cpcbInFlight.set(cacheKey, request);
    }
    const result = await request;
    if (cpcbInFlight.get(cacheKey) === request) cpcbInFlight.delete(cacheKey);
    if (result.failure) return result.failure;
    if (!result.pagination) return emptyOfficial(requestedCity, "unverified", "The CPCB pagination audit was missing; station coverage is unverified.");
    cpcbCache.set(cacheKey, { payload: result.payload, pagination: result.pagination, expiresAt: Date.now() + CPCB_CACHE_TTL_MS });
    if (cpcbCache.size > 100) cpcbCache.delete(cpcbCache.keys().next().value!);
    return parseCpcbResponse(result.payload, requestedCity, Date.now(), targetCoordinates, result.pagination);
  } catch {
    cpcbInFlight.delete(cacheKey);
    return emptyOfficial(requestedCity, "unavailable", "The CPCB/data.gov.in service did not return a valid response. No AQI has been estimated.");
  }
}

export const fetchCpcbByCity = (city: string) => fetchCpcbByLocation(city);
