export type RecommendationBasis =
  | "current_official_aqi"
  | "official_pollutant_observation"
  | "supplementary_measurement"
  | "selected_location"
  | "lifestyle_preferences"
  | "general_guidance";

export const USER_PREFERENCE_KEYS = ["ageGroup", "occupation", "commute", "outdoorActivity", "children", "olderAdults"] as const;
export type UserPreferenceKey = typeof USER_PREFERENCE_KEYS[number];
export type RecommendationGuidanceType = "personalized" | "general" | "conditional";

export type Recommendation = {
  action: string;
  reason: string;
  intendedProfile: string;
  expectedBenefit: string;
  practicalSteps: string[];
  environmentalImpact: string | null;
  basis: RecommendationBasis[];
  guidanceType: RecommendationGuidanceType;
  personalizedBy: UserPreferenceKey[];
  conditionalOn: UserPreferenceKey[];
};

export type AssistantAdvice = {
  summary: string;
  recommendations: Recommendation[];
  uncertainty: string;
};
