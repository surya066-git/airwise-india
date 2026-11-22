import { describe, expect, it } from "vitest";
import { diagnoseAssistantAdvice, validateAssistantAdvice, type AdviceContext } from "@/lib/validation/advice";
import { USER_PREFERENCE_KEYS } from "@/types/recommendation";
import type { UserPreferences } from "@/types/preferences";

function contextWith(suppliedPreferenceValues: Partial<UserPreferences> = {}): AdviceContext {
  const allowedPreferenceKeys = Object.keys(suppliedPreferenceValues) as AdviceContext["allowedPreferenceKeys"];
  return {
    hasLiveOfficialAqi: false,
    hasOfficialPollutants: false,
    hasSupplementaryMeasurements: false,
    hasLocation: true,
    hasPersonalPreferences: allowedPreferenceKeys.length > 0,
    allowedPreferenceKeys,
    suppliedPreferenceValues,
    unconfirmedPreferenceKeys: USER_PREFERENCE_KEYS.filter((key) => !allowedPreferenceKeys.includes(key))
  };
}

const generalRecommendation = {
  action: "Compare route options before leaving",
  reason: "Less congested routes may be a practical choice for some trips.",
  intendedProfile: "Residents in Hyderabad",
  expectedBenefit: "Supports a more considered travel choice.",
  practicalSteps: ["Compare available routes before setting out."],
  environmentalImpact: null,
  basis: ["general_guidance"],
  guidanceType: "general",
  personalizedBy: [],
  conditionalOn: []
};

function adviceFor(recommendation: unknown = generalRecommendation) {
  return {
    summary: "Use practical travel choices and check sources when available.",
    recommendations: [recommendation],
    uncertainty: "Current outdoor conditions are unverified."
  };
}

describe("AI advice personalization and source validation", () => {
  it("accepts daily commute advice when its selected commute value is cited as evidence", () => {
    const context = contextWith({ commute: "Public transit" });
    const personalized = {
      ...generalRecommendation,
      action: "Plan around your selected public transit route",
      reason: "You selected public transit, so grouping errands around that journey uses the commute preference you supplied.",
      intendedProfile: "Public transit commuters in Hyderabad",
      personalizedBy: ["commute"],
      guidanceType: "personalized"
    };
    expect(validateAssistantAdvice(adviceFor(personalized), context)).not.toBeNull();
  });

  it("rejects a commute mode that conflicts with the selected commute value", () => {
    const contradictory = {
      ...generalRecommendation,
      action: "Group errands around the route you take",
      reason: "Because you commute by bus, plan errands around that public transit route.",
      intendedProfile: "Public transit commuters in Hyderabad",
      personalizedBy: ["commute"],
      guidanceType: "personalized"
    };
    expect(diagnoseAssistantAdvice(adviceFor(contradictory), contextWith({ commute: "Car" }))).toMatchObject({
      valid: false, reason: "unsupported_personalization"
    });
  });

  it("does not infer a daily commute frequency from a selected commute mode", () => {
    const frequencyClaim = {
      ...generalRecommendation,
      reason: "You are a daily commuter, so compare your usual route before leaving.",
      personalizedBy: ["commute"],
      guidanceType: "personalized"
    };
    expect(diagnoseAssistantAdvice(adviceFor(frequencyClaim), contextWith({ commute: "Car" }))).toMatchObject({
      valid: false, reason: "unsupported_personalization"
    });
  });

  it("rejects a recommendation that cites an unselected household preference", () => {
    const unsupported = {
      ...generalRecommendation,
      personalizedBy: ["children"],
      guidanceType: "personalized"
    };
    expect(diagnoseAssistantAdvice(adviceFor(unsupported), contextWith())).toMatchObject({
      valid: false, reason: "unsupported_personalization"
    });
  });

  it("rejects unsupported medical information", () => {
    const medical = {
      ...generalRecommendation,
      reason: "Because you have asthma, change your route before travelling."
    };
    expect(diagnoseAssistantAdvice(adviceFor(medical), contextWith())).toMatchObject({
      valid: false, reason: "medical_claim"
    });
  });

  it("accepts useful general advice without any selected profile", () => {
    expect(validateAssistantAdvice(adviceFor(), contextWith())).not.toBeNull();
  });

  it("accepts a clearly conditional recommendation for an unconfirmed household circumstance", () => {
    const conditional = {
      ...generalRecommendation,
      action: "If your household includes children, keep an indoor option available",
      reason: "This is a conditional suggestion and does not assume children are in your household.",
      intendedProfile: "Households that include children, if applicable",
      guidanceType: "conditional",
      conditionalOn: ["children"]
    };
    expect(validateAssistantAdvice(adviceFor(conditional), contextWith())).not.toBeNull();
  });

  it("treats a missing user profile as general guidance rather than invented personalization", () => {
    const profileClaim = {
      ...generalRecommendation,
      reason: "Because you are a daily commuter, use your usual bus route."
    };
    const commuteClaim = {
      ...generalRecommendation,
      reason: "You commute by bus, so group errands around that route."
    };
    expect(diagnoseAssistantAdvice(adviceFor(profileClaim), contextWith())).toMatchObject({
      valid: false, reason: "unsupported_personalization"
    });
    expect(diagnoseAssistantAdvice(adviceFor(commuteClaim), contextWith())).toMatchObject({
      valid: false, reason: "unsupported_personalization"
    });
    expect(validateAssistantAdvice(adviceFor(), contextWith())).not.toBeNull();
  });

  it("rejects preference identifiers outside the application's preference model", () => {
    const invalidIdentifier = {
      ...generalRecommendation,
      guidanceType: "personalized",
      personalizedBy: ["medicalCondition"]
    };
    expect(diagnoseAssistantAdvice(adviceFor(invalidIdentifier), contextWith())).toMatchObject({
      valid: false, reason: "invalid_preference_identifier"
    });
  });

  it("rejects a supplied preference whose value is outside the accepted enum", () => {
    const invalidContext = contextWith({ commute: "Teleport" as UserPreferences["commute"] });
    const advice = {
      ...adviceFor({
        ...generalRecommendation,
        guidanceType: "personalized",
        personalizedBy: ["commute"]
      })
    };
    expect(diagnoseAssistantAdvice(advice, invalidContext)).toMatchObject({
      valid: false, reason: "invalid_preference_value"
    });
  });

  it("does not treat an application default as explicit preference evidence", () => {
    const defaultContext = contextWith({ commute: "Not applicable" });
    expect(diagnoseAssistantAdvice(adviceFor(), defaultContext)).toMatchObject({
      valid: false, reason: "invalid_preference_context"
    });
  });

  it("accepts multiple explicitly selected preferences when both support the recommendation", () => {
    const context = contextWith({ commute: "Public transit", outdoorActivity: "Most days" });
    const personalized = {
      ...generalRecommendation,
      action: "Plan an outdoor break around your selected routine",
      reason: "Your selected commute and outdoor activity frequency inform this flexible reminder.",
      intendedProfile: "Public transit commuters who are active outdoors in Hyderabad",
      guidanceType: "personalized",
      personalizedBy: ["commute", "outdoorActivity"]
    };
    expect(validateAssistantAdvice(adviceFor(personalized), context)).not.toBeNull();
  });

  it("accepts general advice with no personalization evidence", () => {
    const general = adviceFor();
    expect(general.recommendations[0]).toMatchObject({
      guidanceType: "general", personalizedBy: [], conditionalOn: []
    });
    expect(validateAssistantAdvice(general, contextWith())).not.toBeNull();
  });

  it("rejects unsupported live-data, station, numeric impact, and category claims", () => {
    const invalid = [
      { ...generalRecommendation, reason: "The AQI is 178 today, so change your plan." },
      { ...generalRecommendation, reason: "The AQI is not current at 11:30." },
      { ...generalRecommendation, reason: "PM2.5 is 44, so the air is unhealthy." },
      { ...generalRecommendation, reason: "PM2.5 measured 20 ug/m3, so conditions are poor." },
      { ...generalRecommendation, reason: "The current air quality is Severe, so postpone activity." },
      { ...generalRecommendation, reason: "The central monitoring station confirms this result." },
      { ...generalRecommendation, environmentalImpact: "Cuts 20% of emissions." }
    ];
    for (const recommendation of invalid) {
      expect(validateAssistantAdvice(adviceFor(recommendation), contextWith())).toBeNull();
    }
  });

  it("rejects basis tags that exceed actual source context", () => {
    const unsupported = {
      ...generalRecommendation,
      basis: ["current_official_aqi"]
    };
    expect(validateAssistantAdvice(adviceFor(unsupported), contextWith())).toBeNull();
  });

  it("rejects a conditional claim without its condition evidence", () => {
    const unmarked = {
      ...generalRecommendation,
      action: "If your household includes children, keep an indoor option available"
    };
    expect(diagnoseAssistantAdvice(adviceFor(unmarked), contextWith())).toMatchObject({
      valid: false, reason: "unsupported_personalization"
    });
  });

  it("rejects malformed recommendation structure", () => {
    expect(validateAssistantAdvice({ answer: "trust me", aqi: 180 }, contextWith())).toBeNull();
    expect(validateAssistantAdvice(adviceFor({ action: "Only an action" }), contextWith())).toBeNull();
  });
});
