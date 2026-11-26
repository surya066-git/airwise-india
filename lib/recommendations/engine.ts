import type { AirQualityResponse } from "@/types/air-quality";
import type { UserPreferences } from "@/types/preferences";
import type { Recommendation, RecommendationBasis, UserPreferenceKey } from "@/types/recommendation";

function intendedProfile(preferences: UserPreferences, location: string | null, evidence: UserPreferenceKey[]): string {
  const group: string[] = [];
  if (evidence.includes("ageGroup")) group.push(preferences.ageGroup + " age group");
  if (evidence.includes("occupation") && preferences.occupation !== "Resident") group.push(preferences.occupation.toLowerCase() + "s");
  if (evidence.includes("children") && preferences.children) group.push("households with children");
  if (evidence.includes("olderAdults") && preferences.olderAdults) group.push("households with older adults");
  if (evidence.includes("commute") && preferences.commute !== "Not applicable") group.push(preferences.commute.toLowerCase() + " commuters");
  return group.length
    ? [...new Set(group)].join(", ") + (location ? " in " + location : "")
    : location ? "Residents in " + location : "Residents and households";
}

function selectedPreferenceKeys(preferences: UserPreferences): UserPreferenceKey[] {
  return [
    ...(preferences.ageGroup !== "Prefer not to say" ? ["ageGroup" as const] : []),
    ...(preferences.occupation !== "Resident" ? ["occupation" as const] : []),
    ...(preferences.commute !== "Not applicable" ? ["commute" as const] : []),
    ...(preferences.outdoorActivity !== "Sometimes" ? ["outdoorActivity" as const] : []),
    ...(preferences.children ? ["children" as const] : []),
    ...(preferences.olderAdults ? ["olderAdults" as const] : [])
  ];
}

function preferenceStep(preferences: UserPreferences): string | null {
  if (preferences.occupation === "Outdoor worker") return "Before an outdoor shift, check the current official source and follow workplace guidance; if readings are unavailable, treat conditions as unknown.";
  if (preferences.occupation === "Student") return "Check the official source before school or campus outdoor activities, and keep an indoor option if conditions are uncertain.";
  if (preferences.occupation === "Office worker") return "Check the official source before an outdoor break or commute and keep a flexible option when conditions are uncertain.";
  if (preferences.children || preferences.olderAdults) return "Keep a flexible indoor option for shared household activities and check official updates before plans.";
  return null;
}

export function buildRecommendations(
  air: AirQualityResponse | null,
  preferences: UserPreferences
): Recommendation[] {
  const official = air?.official;
  const liveAqi = official?.status === "live" && official.aqi !== null;
  const elevated = liveAqi && ["Moderate", "Poor", "Very Poor", "Severe"].includes(official.category ?? "");
  const locationLabel = air?.location.label ?? official?.city ?? null;
  const selectedPreferences = selectedPreferenceKeys(preferences);
  const activityPreferenceKeys = selectedPreferences.filter((key) => ["outdoorActivity", "occupation", "children", "olderAdults"].includes(key));
  const activityBasis: RecommendationBasis[] = liveAqi
    ? ["current_official_aqi", ...(air?.location.label ? ["selected_location" as const] : []), ...(activityPreferenceKeys.length ? ["lifestyle_preferences" as const] : [])]
    : ["general_guidance", ...(activityPreferenceKeys.length ? ["lifestyle_preferences" as const] : [])];
  const pollutantObservations = official?.pollutants
    .filter((item) => item.freshness === "live" && item.measuredAt !== null)
    .slice(0, 1) ?? [];
  const supplementaryObservations = air?.supplementary.status === "live"
    ? air.supplementary.measurements.filter((item) => item.freshness === "live" && item.measuredAt !== null).slice(0, 1)
    : [];
  const formatObservationTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return "time unavailable";
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata"
    }).format(date) + " IST";
  };
  const pollutantObservationsLabel = pollutantObservations.map((item) =>
    "CPCB " + item.parameter + "=" + item.value + (item.unit ? " " + item.unit : "") +
      " at " + formatObservationTime(item.measuredAt!)
  ).concat(supplementaryObservations.map((item) =>
    "OpenAQ " + item.parameter + "=" + item.value + (item.unit ? " " + item.unit : "") +
      " at " + formatObservationTime(item.measuredAt!) + ", " +
      (air?.supplementary.station ?? "station name unavailable")
  )).join("; ");

  const activity = elevated
    ? {
        action: "Plan outdoor activity around the official reading",
        reason: "The live CPCB category is " + official.category + ". Use this station as a local signal and check public advisories before changing a strenuous outdoor plan." +
          (preferences.outdoorActivity !== "Sometimes" ? " Your selected outdoor activity frequency informs this planning suggestion." : ""),
        expectedBenefit: "May help you make a more informed timing choice; AIRWISE does not predict an individual health outcome.",
        practicalSteps: [
          preferences.outdoorActivity === "Most days"
            ? "Choose a flexible time or an indoor alternative when the current category is elevated."
            : "Check the current official source before planning optional outdoor activity.",
          preferenceStep(preferences) ?? "Recheck the station reading before the activity because conditions can change."
        ],
        environmentalImpact: null,
        basis: activityBasis,
        personalizedBy: activityPreferenceKeys
      }
    : {
        action: "Check the official reading before outdoor plans",
        reason: liveAqi
          ? "The current official category is " + official.category + ". A station reading is a local signal, and conditions can vary across a city."
          : "A live official AQI is not available, so current conditions cannot be verified from AIRWISE." +
            (preferences.outdoorActivity !== "Sometimes" ? " Your selected outdoor activity frequency informs the reminder to check before planning." : ""),
        expectedBenefit: "Helps keep outdoor plans tied to a recent official source instead of an estimate.",
        practicalSteps: [
          preferenceStep(preferences) ?? "Refresh AIRWISE or check the CPCB source before a longer outdoor activity.",
          "If the official reading is missing or stale, treat conditions as unknown."
        ],
        environmentalImpact: null,
        basis: activityBasis,
        personalizedBy: activityPreferenceKeys
      };

  const householdPreferences = selectedPreferences.filter((key) => ["children", "olderAdults"].includes(key) ||
    (key === "ageGroup" && (preferences.ageGroup === "Under 18" || preferences.ageGroup === "60+")));
  const indoorBasis: RecommendationBasis[] = [
    ...(pollutantObservations.length ? ["official_pollutant_observation" as const] : []),
    ...(supplementaryObservations.length ? ["supplementary_measurement" as const] : []),
    ...(air?.location.label ? ["selected_location" as const] : []),
    ...(householdPreferences.length ? ["lifestyle_preferences" as const] : [])
  ];
  if (indoorBasis.length === 0) indoorBasis.push("general_guidance");
  const indoorReason = pollutantObservationsLabel
    ? "Verified raw pollutant observations: " + pollutantObservationsLabel + ". These are not an AQI; timestamps are sensor-specific."
    : "AIRWISE has no verified current CPCB pollutant observation for this location, so this is general indoor-air guidance.";
  const householdReason = preferences.children || preferences.olderAdults || preferences.ageGroup === "Under 18" || preferences.ageGroup === "60+"
    ? "Household-profile steps are practical and make no medical assumption. "
    : "";

  const commuteAction = preferences.commute === "Car" || preferences.commute === "Two-wheeler"
    ? "Try one lower-emission trip when practical"
    : preferences.commute === "Public transit"
      ? "Keep using shared transport when it fits"
      : preferences.commute === "Walk or cycle"
        ? "Combine nearby errands into one trip"
        : "Combine errands or choose shared transport";
  const commuteSteps = preferences.commute === "Car" || preferences.commute === "Two-wheeler"
    ? ["Combine errands to avoid separate trips.", "Consider transit, a shared ride, walking, or cycling when safe and practical."]
    : preferences.commute === "Public transit"
      ? ["Group errands around an existing transit journey.", "Choose a shared trip when it fits the route and schedule."]
      : preferences.commute === "Walk or cycle"
        ? ["Combine nearby errands into one outing.", "Choose a route and time that are comfortable and safe for you."]
        : ["Combine errands into fewer trips.", "Consider public transit or ride sharing when practical for the route."];

  const recommendations: Recommendation[] = [
    {
      action: activity.action,
      reason: activity.reason,
      intendedProfile: intendedProfile(preferences, locationLabel, activity.personalizedBy),
      expectedBenefit: activity.expectedBenefit,
      practicalSteps: activity.practicalSteps,
      environmentalImpact: activity.environmentalImpact,
      basis: activity.basis,
      guidanceType: activity.personalizedBy.length ? "personalized" : "general",
      personalizedBy: activity.personalizedBy,
      conditionalOn: []
    },
    {
      action: "Reduce indoor pollution and time ventilation",
      reason: householdReason + indoorReason,
      intendedProfile: intendedProfile(preferences, locationLabel, householdPreferences),
      expectedBenefit: "May reduce indoor sources and help you choose a ventilation time using local source data.",
      practicalSteps: [
        "Avoid smoking indoors and reduce smoke from cooking or burning materials where possible.",
        "Use a damp cloth or wet mop for routine dusting where practical; avoid dry sweeping that can stir up settled dust.",
        "Ventilate when outdoor conditions are suitable; follow the device instructions if you use an air cleaner."
      ],
      environmentalImpact: null,
      basis: indoorBasis,
      guidanceType: householdPreferences.length ? "personalized" : "general",
      personalizedBy: householdPreferences,
      conditionalOn: []
    },
    {
      action: commuteAction,
      reason: "Fewer separate private-vehicle trips or a shared mode can reduce some trip-related emissions; the amount depends on the route and vehicle." +
        (preferences.commute !== "Not applicable" ? " This step reflects your selected commute type: " + preferences.commute + "." : ""),
      intendedProfile: intendedProfile(preferences, locationLabel, selectedPreferences.filter((key) => key === "commute")),
      expectedBenefit: "A practical option to reduce vehicle use without assuming a fixed emissions saving.",
      practicalSteps: commuteSteps,
      environmentalImpact: "May avoid some vehicle emissions; no numerical impact is estimated.",
      basis: selectedPreferences.includes("commute") ? ["lifestyle_preferences", "general_guidance"] : ["general_guidance"],
      guidanceType: selectedPreferences.includes("commute") ? "personalized" : "general",
      personalizedBy: selectedPreferences.filter((key) => key === "commute"),
      conditionalOn: []
    },
    {
      action: "Check the latest official reading before evening plans",
      reason: liveAqi
        ? "The official station reports " + official.category + ". Use it as a local snapshot before evening outdoor activity; conditions can differ across the city."
        : "A current official AQI is not available, so AIRWISE cannot verify conditions for an evening activity.",
      intendedProfile: locationLabel ? "Residents in " + locationLabel : "Residents and households",
      expectedBenefit: "Helps keep evening activity decisions connected to a recent official reading instead of an estimate.",
      practicalSteps: [
        "Refresh AIRWISE or check the CPCB source before an outdoor evening activity.",
        "If a current reading is unavailable or stale, treat conditions as unknown and keep an indoor option."
      ],
      environmentalImpact: null,
      basis: liveAqi
        ? ["current_official_aqi", ...(air?.location.label ? ["selected_location" as const] : [])]
        : ["general_guidance"],
      guidanceType: "general",
      personalizedBy: [],
      conditionalOn: []
    }
  ];

  return recommendations;
}
