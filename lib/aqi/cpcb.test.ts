import { describe, expect, it } from "vitest";
import { parseCpcbResponse } from "@/lib/aqi/cpcb";

describe("parseCpcbResponse", () => {
  it("uses an explicit AQI and never substitutes another city", () => {
    const result = parseCpcbResponse({
      records: [{
        city: "Pune", station: "Test station", state: "Maharashtra", aqi: "83",
        last_update: "2026-11-20T08:00:00Z", pollutant_id: "PM2.5",
        pollutant_avg: "26", pollutant_unit: "ug/m3"
      }]
    }, "Pune", Date.parse("2026-11-20T08:05:00Z"));

    expect(result.aqi).toBe(83);
    expect(result.category).toBe("Satisfactory");
    expect(result.station).toBe("Test station");
    expect(result.pollutants[0]?.value).toBe(26);

    const otherCity = parseCpcbResponse({
      records: [{ city: "Mumbai", station: "Other", aqi: 43 }]
    }, "Pune");
    expect(otherCity.aqi).toBeNull();
    expect(otherCity.station).toBeNull();
    expect(otherCity.status).toBe("unavailable");
  });

  it("does not calculate an AQI from pollutant-only rows", () => {
    const result = parseCpcbResponse({
      records: [{
        city: "Pune", station: "Test station", last_update: "2026-11-20T08:00:00Z",
        pollutant_id: "PM2.5", pollutant_avg: "26", pollutant_unit: "ug/m3"
      }]
    }, "Pune", Date.parse("2026-11-20T08:05:00Z"));

    expect(result.aqi).toBeNull();
    expect(result.category).toBeNull();
    expect(result.status).toBe("unverified");
    expect(result.pollutants).toHaveLength(1);
    expect(result.message).toContain("has not calculated an index");
  });

  it("marks stale and missing timestamps without claiming live status", () => {
    const stale = parseCpcbResponse({
      records: [{
        city: "Pune", station: "Test station", aqi: 40,
        last_update: "2026-11-20T02:00:00Z"
      }]
    }, "Pune", Date.parse("2026-11-20T08:00:00Z"));
    expect(stale.status).toBe("stale");

    const missingTimestamp = parseCpcbResponse({
      records: [{ city: "Pune", station: "Test station", aqi: 40 }]
    }, "Pune");
    expect(missingTimestamp.status).toBe("unverified");
    expect(missingTimestamp.updatedAt).toBeNull();
  });

  it("rejects a malformed provider payload", () => {
    const result = parseCpcbResponse({ values: [] }, "Pune");
    expect(result.status).toBe("unverified");
    expect(result.aqi).toBeNull();
  });
});
