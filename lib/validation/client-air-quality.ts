import type { AirQualityResponse, CpcbPaginationAudit, DataStatus, PollutantReading } from "@/types/air-quality";

const dataStatuses = new Set<DataStatus>(["live", "stale", "unavailable", "unverified", "not_configured"]);
const paginationStatuses = new Set<CpcbPaginationAudit["status"]>(["complete", "overlap", "conflict", "incomplete", "rate_limited"]);
const freshnessValues = new Set(["live", "stale", "unverified"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown, minimum = -Infinity, maximum = Infinity): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum);
}

function isPollutantReading(value: unknown): value is PollutantReading {
  if (!isRecord(value)) return false;
  return typeof value.parameter === "string" && value.parameter.length > 0 &&
    typeof value.value === "number" && Number.isFinite(value.value) && value.value >= 0 && value.value <= 1_000_000 &&
    isNullableString(value.unit) && (value.measuredAt === null || isTimestamp(value.measuredAt)) &&
    (value.freshness === undefined || freshnessValues.has(value.freshness as string));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeInteger(value);
}

function isPagination(value: unknown): value is CpcbPaginationAudit {
  if (!isRecord(value) || !paginationStatuses.has(value.status as CpcbPaginationAudit["status"]) ||
      typeof value.requestedLimit !== "number" || !Number.isInteger(value.requestedLimit) || value.requestedLimit < 1 ||
      !isNonNegativeInteger(value.pageCount) || !isNullableNonNegativeInteger(value.reportedTotal) ||
      !isNonNegativeInteger(value.recordsReturned) || !isNonNegativeInteger(value.uniqueRecords) ||
      !isNonNegativeInteger(value.duplicateRows) || !isNonNegativeInteger(value.conflictingRows) ||
      !Array.isArray(value.pages) || value.pages.length > 50) return false;

  return value.pages.every((page) => isRecord(page) &&
    isNonNegativeInteger(page.requestedOffset) && isNullableNonNegativeInteger(page.reportedOffset) &&
    (page.reportedLimit === null || (typeof page.reportedLimit === "number" && Number.isInteger(page.reportedLimit) && page.reportedLimit > 0)) &&
    isNullableNonNegativeInteger(page.reportedCount) && isNonNegativeInteger(page.actualCount));
}

/** Lightweight client boundary check; the API route performs the complete Zod validation. */
export function isAirQualityResponse(value: unknown): value is AirQualityResponse {
  if (!isRecord(value) || !isRecord(value.location) || !isRecord(value.official) || !isRecord(value.supplementary)) return false;
  const location = value.location;
  const official = value.official;
  const supplementary = value.supplementary;

  return isNullableString(location.label) && isNullableNumber(location.latitude, -90, 90) &&
    isNullableNumber(location.longitude, -180, 180) && dataStatuses.has(official.status as DataStatus) &&
    official.source === "CPCB / data.gov.in" && isNullableString(official.requestedCity) &&
    isNullableString(official.city) && isNullableString(official.station) && isNullableString(official.state) &&
    isNullableNumber(official.distanceMeters, 0) &&
    (official.aqi === null || (typeof official.aqi === "number" && Number.isInteger(official.aqi) && official.aqi >= 0 && official.aqi <= 500)) &&
    isNullableString(official.category) && isNullableString(official.interpretation) &&
    (official.updatedAt === null || isTimestamp(official.updatedAt)) &&
    Array.isArray(official.pollutants) && official.pollutants.every(isPollutantReading) &&
    (official.pagination === undefined || official.pagination === null || isPagination(official.pagination)) &&
    typeof official.message === "string" && dataStatuses.has(supplementary.status as DataStatus) &&
    supplementary.source === "OpenAQ" && isNullableString(supplementary.station) &&
    isNullableNumber(supplementary.distanceMeters, 0) &&
    (supplementary.updatedAt === null || isTimestamp(supplementary.updatedAt)) &&
    Array.isArray(supplementary.measurements) && supplementary.measurements.every(isPollutantReading) &&
    typeof supplementary.message === "string" && isTimestamp(value.fetchedAt);
}
