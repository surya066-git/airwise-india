export type DataStatus = "live" | "stale" | "unavailable" | "unverified" | "not_configured";

export type PollutantReading = {
  parameter: string;
  value: number;
  unit: string | null;
  measuredAt: string | null;
  freshness?: "live" | "stale" | "unverified";
};

export type CpcbPaginationAudit = {
  status: "complete" | "overlap" | "conflict" | "incomplete" | "rate_limited";
  requestedLimit: number;
  pageCount: number;
  reportedTotal: number | null;
  recordsReturned: number;
  uniqueRecords: number;
  duplicateRows: number;
  conflictingRows: number;
  pages: Array<{
    requestedOffset: number;
    reportedOffset: number | null;
    reportedLimit: number | null;
    reportedCount: number | null;
    actualCount: number;
  }>;
};

export type OfficialReading = {
  status: DataStatus;
  source: "CPCB / data.gov.in";
  requestedCity: string | null;
  city: string | null;
  station: string | null;
  state: string | null;
  distanceMeters: number | null;
  aqi: number | null;
  category: string | null;
  interpretation: string | null;
  updatedAt: string | null;
  pollutants: PollutantReading[];
  pagination?: CpcbPaginationAudit | null;
  message: string;
};

export type SupplementaryReading = {
  status: DataStatus;
  source: "OpenAQ";
  station: string | null;
  distanceMeters: number | null;
  updatedAt: string | null;
  measurements: PollutantReading[];
  message: string;
};

export type AirQualityResponse = {
  location: { label: string | null; latitude: number | null; longitude: number | null };
  official: OfficialReading;
  supplementary: SupplementaryReading;
  fetchedAt: string;
};
