import { describe, expect, it } from "vitest";
import { buildRecommendations } from "@/lib/recommendations/engine";
import { recommendationSchema } from "@/lib/validation/advice";
import type { AirQualityResponse } from "@/types/air-quality";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@/types/preferences";

function makeAir(status: AirQualityResponse["official"]["status"], aqi: number | null): AirQualityResponse {
  return {
    location: { label: "Pune", latitude: 18.52, longitude: 73.85 },
    official: {
      status, source: "CPCB / data.gov.in", requestedCity: "Pune", city: "Pune",
      station: "Test station", state: "Maharashtra", distanceMeters: 900,
      aqi, category: aqi === null ? null : aqi >= 201 ? "Poor" : "Satisfactory",
      interpretation: null, updatedAt: "2026-11-20T11:00:00.000Z",
      pollutants: [{ parameter: "PM2.5", value: 28, unit: "µg/m³", measuredAt: "2026-11-20T11:00:00.000Z", freshness: "live" }],
      message: "source response"
    },
    supplementary: {
      status: "live", source: "OpenAQ", station: "Other sensor", distanceMeters: 1200,
      updatedAt: "2026-11-20T10:40:00.000Z",
      measurements: [{ parameter: "NO2", value: 13, unit: "µg/m³", measuredAt: "2026-11-20T10:40:00.000Z", freshness: "live" }],
      message: "raw data"
    },
    fetchedAt: "2026-11-20T11:01:00.000Z"
  };
}

describe("structured recommendation engine", () => {
  it("uses only live official AQI for current category-driven advice", () => {
    const recommendations = buildRecommendations(makeAir("live", 245), DEFAULT_PREFERENCES);
    expect(recommendations[0]?.action).toContain("official reading");
    expect(recommendations[0]?.reason).toContain("Poor");
    expect(recommendations[0]?.basis).toContain("current_official_aqi");
    expect(recommendations.every((item) => recommendationSchema.safeParse(item).success)).toBe(true);
  });

  it("never treats stale or missing official AQI as current, even when OpenAQ is live", () => {
    const stale = buildRecommendations(makeAir("stale", 245), DEFAULT_PREFERENCES);
    const unavailable = buildRecommendations(makeAir("unverified", null), DEFAULT_PREFERENCES);
    expect(stale[0]?.basis).not.toContain("current_official_aqi");
    expect(stale[0]?.reason).not.toContain("live CPCB category");
    expect(unavailable[0]?.reason).toContain("cannot be verified");
    expect(unavailable[0]?.basis).not.toContain("current_official_aqi");
  });

  it("personalizes occupation, age, commute, household, and activity fields", () => {
    const preferences: UserPreferences = {
      ageGroup: "60+", occupation: "Outdoor worker", commute: "Two-wheeler",
      outdoorActivity: "Most days", children: true, olderAdults: false
    };
    const recommendations = buildRecommendations(makeAir("live", 300), preferences);
    expect(recommendations[0]?.intendedProfile).toContain("outdoor worker");
    expect(recommendations[0]?.practicalSteps[0]).toContain("indoor alternative");
    expect(recommendations[2]?.action).toContain("lower-emission");
    expect(recommendations[2]?.intendedProfile).toContain("two-wheeler commuters");
    expect(recommendations[2]?.basis).toContain("lifestyle_preferences");
    expect(recommendations[0]?.intendedProfile).not.toContain("60+ age group");
    expect(recommendations[1]?.intendedProfile).toContain("60+ age group");
    expect(recommendations[2]?.intendedProfile).not.toContain("60+ age group");
    expect(recommendations[0]?.personalizedBy).toContain("outdoorActivity");
    expect(recommendations[0]?.basis).toContain("lifestyle_preferences");
    expect(recommendations[1]?.personalizedBy).toEqual(["ageGroup", "children"]);
    expect(recommendations[1]?.basis).toContain("lifestyle_preferences");
    expect(recommendations[2]?.personalizedBy).toEqual(["commute"]);
  });

  it("keeps OpenAQ readings out of official AQI reasoning and avoids numerical environmental claims", () => {
    const noOfficialAqi = buildRecommendations(makeAir("unverified", null), DEFAULT_PREFERENCES);
    expect(noOfficialAqi[0]?.basis).not.toContain("current_official_aqi");
    expect(noOfficialAqi[2]?.environmentalImpact).toContain("no numerical impact");
  });

  it("grounds indoor guidance in the selected CPCB pollutant value and its observation time", () => {
    const recommendation = buildRecommendations(makeAir("live", 85), DEFAULT_PREFERENCES)[1];
    expect(recommendation?.reason).toContain("CPCB PM2.5=28");
    expect(recommendation?.reason).toContain("20 Nov 2026");
    expect(recommendation?.reason).toContain("not an AQI");
    expect(recommendation?.basis).toContain("official_pollutant_observation");
    expect(recommendation?.basis).toContain("supplementary_measurement");
  });

  it("gives role-specific standard steps for students and outdoor workers without medical claims", () => {
    const student = buildRecommendations(makeAir("unverified", null), {
      ...DEFAULT_PREFERENCES, occupation: "Student", ageGroup: "Under 18", commute: "Public transit"
    });
    const worker = buildRecommendations(makeAir("unverified", null), {
      ...DEFAULT_PREFERENCES, occupation: "Outdoor worker", commute: "Two-wheeler", outdoorActivity: "Most days"
    });

    expect(student[0]?.practicalSteps.join(" ")).toContain("school or campus");
    expect(student[0]?.personalizedBy).toContain("occupation");
    expect(worker[0]?.practicalSteps.join(" ")).toContain("outdoor shift");
    expect(worker[2]?.personalizedBy).toContain("commute");
    expect(JSON.stringify([...student, ...worker]).toLowerCase()).not.toContain("asthma");
  });

  it("labels which preferences were used and leaves the general profile explicit", () => {
    const recommendations = buildRecommendations(makeAir("unverified", null), DEFAULT_PREFERENCES);
    expect(recommendations.every((item) => item.personalizedBy.length === 0)).toBe(true);
    expect(recommendations[0]?.basis).toContain("general_guidance");
    expect(recommendations[2]?.basis).toContain("general_guidance");
  });

  it("keeps evening planning useful without presenting missing or stale AQI as current", () => {
    const current = buildRecommendations(makeAir("live", 85), DEFAULT_PREFERENCES);
    const unavailable = buildRecommendations(makeAir("unverified", null), DEFAULT_PREFERENCES);
    const eveningCurrent = current.find((item) => item.action.includes("evening"));
    const eveningUnavailable = unavailable.find((item) => item.action.includes("evening"));

    expect(eveningCurrent?.basis).toContain("current_official_aqi");
    expect(eveningCurrent?.reason).toContain("local snapshot");
    expect(eveningUnavailable?.reason).toContain("cannot verify conditions");
    expect(eveningUnavailable?.practicalSteps.join(" ")).toContain("treat conditions as unknown");
    expect(eveningUnavailable?.guidanceType).toBe("general");
    expect(eveningUnavailable?.personalizedBy).toEqual([]);
    expect(recommendationSchema.safeParse(eveningUnavailable).success).toBe(true);
  });
});
