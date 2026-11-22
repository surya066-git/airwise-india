import { z } from "zod";
import { USER_PREFERENCE_KEYS, type AssistantAdvice, type Recommendation, type RecommendationBasis, type UserPreferenceKey } from "@/types/recommendation";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@/types/preferences";
import { preferenceValueSchemas } from "@/lib/validation/schemas";

const recommendationBasis = z.enum([
  "current_official_aqi",
  "official_pollutant_observation",
  "supplementary_measurement",
  "selected_location",
  "lifestyle_preferences",
  "general_guidance"
]);
const userPreferenceKey = z.enum(USER_PREFERENCE_KEYS);

export const recommendationSchema = z.object({
  action: z.string().trim().min(4).max(160),
  reason: z.string().trim().min(8).max(400),
  intendedProfile: z.string().trim().min(2).max(180),
  expectedBenefit: z.string().trim().min(4).max(240),
  practicalSteps: z.array(z.string().trim().min(3).max(180)).min(1).max(4),
  environmentalImpact: z.string().trim().max(240).nullable(),
  basis: z.array(recommendationBasis).min(1).max(6),
  guidanceType: z.enum(["personalized", "general", "conditional"]),
  personalizedBy: z.array(userPreferenceKey).max(6),
  conditionalOn: z.array(userPreferenceKey).max(6)
}).strict();

export const assistantAdviceSchema = z.object({
  summary: z.string().trim().min(8).max(700),
  recommendations: z.array(recommendationSchema).min(1).max(4),
  uncertainty: z.string().trim().min(5).max(300)
}).strict();

export type AdviceContext = {
  hasLiveOfficialAqi: boolean;
  officialCategory?: string | null;
  hasOfficialPollutants: boolean;
  hasSupplementaryMeasurements: boolean;
  hasLocation: boolean;
  hasPersonalPreferences: boolean;
  allowedPreferenceKeys: UserPreferenceKey[];
  suppliedPreferenceValues: Partial<UserPreferences>;
  unconfirmedPreferenceKeys: UserPreferenceKey[];
};

const FORBIDDEN_CURRENT_DATA = /\bAQI\s*(?:(?:is|at|of)\s*)?(?:[:=]\s*)?\d{1,3}\b|\b\d{1,2}:\d{2}\b|\b\d{4}-\d{2}-\d{2}\b/i;
const POLLUTANT_VALUE_CLAIM = /\b(?:PM\s*2\.5|PM\s*10|NO2|SO2|O3|OZONE|CO|NH3)\b\s*(?:(?:is|at|of|=|:)\s*)\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:µg\/m³|ug\/m3|mg\/m³|ppm)\s*(?:of\s+)?(?:PM\s*2\.5|PM\s*10|NO2|SO2|O3|OZONE|CO|NH3)\b/i;
const NUMERIC_ENVIRONMENT_CLAIM = /\b\d+(?:\.\d+)?\s*(?:%|(?:kg|kilograms?|grams?|tonnes?|tons?|t\s*co2e?|co2|carbon dioxide)\b)/i;
const STATION_CLAIM = /\b(?:monitoring\s+)?station\b/i;
const POLLUTANT_NUMERIC_CLAIM = /\b(?:PM\s*2\.5|PM\s*10|NO2|SO2|O3|OZONE|CO|NH3)\b.{0,60}\b\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\b.{0,60}\b(?:PM\s*2\.5|PM\s*10|NO2|SO2|O3|OZONE|CO|NH3)\b/i;
const UNSUPPORTED_MEDICAL_CLAIM = /\b(?:causes?|will cause|can cause|may cause|triggers?|will trigger|can trigger|may trigger|prevents?|will prevent|can prevent|may prevent|treats?|cures?|diagnoses?|increases? (?:the )?risk of|reduces? (?:the )?risk of)\b|\b(?:asthma|heart attack|stroke|lung disease|respiratory disease|cardiovascular disease|COPD|pregnan(?:cy|t)|diabetes|hypertension|heart disease|immunocompromised|medical condition)\b/i;
const CATEGORY_CLAIM = /\b(?:AQI|official air quality|air quality|category|reading)\b.{0,60}\b(Good|Satisfactory|Moderate|Poor|Very Poor|Severe)\b|\b(Good|Satisfactory|Moderate|Poor|Very Poor|Severe)\b.{0,60}\b(?:AQI|air quality|category)\b/i;

const PERSONAL_PROFILE_CLAIMS: Record<UserPreferenceKey, RegExp> = {
  ageGroup: /\b(?:you are (?:under 18|over 60|a minor|a senior|elderly)|as a (?:minor|senior|teenager|person over 60)|your age group)\b/i,
  occupation: /\b(?:you are (?:a|an) (?:student|office worker|outdoor worker)|as an? (?:student|office worker|outdoor worker)|your outdoor shift)\b/i,
  commute: /\b(?:you are (?:a )?(?:daily )?commuter|your (?:daily )?commute (?:is|uses|involves)|because you (?:commute|travel) by|you (?:drive|cycle|walk) to work|you take (?:the )?(?:bus|metro|train|public transit))\b/i,
  outdoorActivity: /\b(?:you (?:walk|run|cycle|exercise) (?:daily|regularly|most days|sometimes|occasionally|rarely)|your daily (?:walk|run|ride|outdoor routine))\b/i,
  children: /\b(?:your (?:children|child|kids|son|daughter)|your household includes (?:young )?(?:children|kids)|you (?:have|live with|care for) (?:young )?(?:children|kids|a child)|because you have (?:children|kids))\b/i,
  olderAdults: /\b(?:your (?:older adults|elderly|senior (?:parent|relative)|grandparents?)|your household includes older adults|you (?:live with|care for) (?:an? )?(?:older adult|senior|elderly)|because your household includes older adults)\b/i
};

const SPECIFIC_PROFILE_VALUE_CLAIMS: Record<UserPreferenceKey, Array<{ value: string | boolean; claim: RegExp }>> = {
  ageGroup: [
    { value: "Under 18", claim: /\b(?:you are under 18|you are a minor|as a minor|as a teenager)\b/i },
    { value: "60+", claim: /\b(?:you are over 60|you are a senior|you are elderly|as a senior|as an elderly person)\b/i },
    { value: "18-59", claim: /\b(?:you are 18[- ]59|as an adult)\b/i }
  ],
  occupation: [
    { value: "Student", claim: /\b(?:you are a student|as a student)\b/i },
    { value: "Office worker", claim: /\b(?:you are an? office worker|as an? office worker|you work in an office)\b/i },
    { value: "Outdoor worker", claim: /\b(?:you are an? outdoor worker|as an? outdoor worker|your outdoor shift)\b/i },
    { value: "Resident", claim: /\b(?:you are a resident|as a resident)\b/i }
  ],
  commute: [
    { value: "Public transit", claim: /\b(?:you (?:take|use) (?:the )?(?:bus|metro|train|public transit)|you commute by (?:bus|metro|train|public transit)|your commute (?:uses|involves) (?:the )?(?:bus|metro|train|public transit))\b/i },
    { value: "Car", claim: /\b(?:you drive(?: to work)?|you commute by car|you travel by car|your commute (?:uses|involves) (?:a )?car)\b/i },
    { value: "Two-wheeler", claim: /\b(?:you ride (?:a )?(?:two[- ]wheeler|scooter|motorcycle)|you commute by (?:two[- ]wheeler|scooter|motorcycle))\b/i },
    { value: "Walk or cycle", claim: /\b(?:you (?:walk|cycle|bike) to work|you commute by (?:walking|cycling|bike))\b/i },
    { value: "Mixed", claim: /\b(?:you use mixed[- ]mode travel|your commute uses multiple modes)\b/i }
  ],
  outdoorActivity: [
    { value: "Rarely", claim: /\b(?:you (?:walk|run|cycle|exercise) (?:daily|regularly|most days)|your daily (?:walk|run|ride|outdoor routine))\b/i },
    { value: "Sometimes", claim: /\b(?:you (?:walk|run|cycle|exercise) (?:daily|regularly|most days|rarely)|your daily (?:walk|run|ride|outdoor routine))\b/i },
    { value: "Most days", claim: /\b(?:you (?:walk|run|cycle|exercise) (?:rarely|sometimes|occasionally))\b/i }
  ],
  children: [{ value: true, claim: /\b(?:your (?:children|child|kids|son|daughter)|your household includes (?:young )?(?:children|kids)|you (?:have|live with|care for) (?:young )?(?:children|kids|a child)|because you have (?:children|kids))\b/i }],
  olderAdults: [{ value: true, claim: /\b(?:your (?:older adults|elderly|senior (?:parent|relative)|grandparents?)|your household includes older adults|you (?:live with|care for) (?:an? )?(?:older adult|senior|elderly)|because your household includes older adults)\b/i }]
};

const UNSUPPORTED_COMMUTE_FREQUENCY = /\b(?:you are (?:a )?(?:daily|regular) commuter|your daily commute)\b/i;

function hasPersonalProfileClaim(key: UserPreferenceKey, text: string): boolean {
  return PERSONAL_PROFILE_CLAIMS[key].test(text) ||
    SPECIFIC_PROFILE_VALUE_CLAIMS[key].some(({ claim }) => claim.test(text));
}

const CONDITIONAL_PROFILE_CLAIMS: Record<UserPreferenceKey, RegExp> = {
  ageGroup: /\bif\s+you\s+(?:are|fall within)\s+(?:under 18|over 60|a minor|a senior|the 60\+ age group)\b/i,
  occupation: /\bif\s+you\s+(?:work outdoors|are (?:a )?student|work in an office)\b/i,
  commute: /\bif\s+you\s+(?:commute|travel)\s+by\s+(?:public transit|car|two-wheeler|walking|cycling|a mixed mode)\b/i,
  outdoorActivity: /\bif\s+you\s+(?:walk|run|cycle|exercise|spend time outdoors)\b/i,
  children: /\bif\s+(?:you|your household)\s+(?:have|has|include|includes)\s+(?:young\s+)?(?:children|kids|a child)\b/i,
  olderAdults: /\bif\s+(?:you|your household)\s+(?:live with|have|has|include|includes)\s+(?:an?\s+)?(?:older adult|senior|elderly|grandparent)\b/i
};

function allowedBases(context: AdviceContext): Set<RecommendationBasis> {
  const allowed = new Set<RecommendationBasis>(["general_guidance"]);
  if (context.hasLiveOfficialAqi) allowed.add("current_official_aqi");
  if (context.hasOfficialPollutants) allowed.add("official_pollutant_observation");
  if (context.hasSupplementaryMeasurements) allowed.add("supplementary_measurement");
  if (context.hasLocation) allowed.add("selected_location");
  if (context.hasPersonalPreferences) allowed.add("lifestyle_preferences");
  return allowed;
}

export type AdviceValidationResult =
  | { valid: true; advice: AssistantAdvice }
  | {
      valid: false;
      reason: string;
      issuePaths?: string[];
      validationIssues?: Array<{
        path: string;
        expectedType?: string;
        actualType: string;
        missingField?: string;
      }>;
    };

const SAFE_SCHEMA_FIELDS = new Set([
  "summary", "recommendations", "action", "reason", "intendedProfile", "expectedBenefit",
  "practicalSteps", "environmentalImpact", "basis", "guidanceType", "personalizedBy", "conditionalOn", "uncertainty"
]);

function preferenceContextIssue(context: AdviceContext): string | null {
  const suppliedKeys = Object.keys(context.suppliedPreferenceValues);
  const allowedKeys = new Set<string>();
  for (const key of suppliedKeys) {
    if (!USER_PREFERENCE_KEYS.includes(key as UserPreferenceKey)) return "invalid_preference_identifier";
    const preferenceKey = key as UserPreferenceKey;
    if (!preferenceValueSchemas[preferenceKey].safeParse(context.suppliedPreferenceValues[preferenceKey]).success) {
      return "invalid_preference_value";
    }
    if (context.suppliedPreferenceValues[preferenceKey] === DEFAULT_PREFERENCES[preferenceKey]) {
      return "invalid_preference_context";
    }
    allowedKeys.add(key);
  }
  const declaredAllowed = new Set(context.allowedPreferenceKeys);
  const expectedUnconfirmed = USER_PREFERENCE_KEYS.filter((key) => !allowedKeys.has(key));
  const declaredUnconfirmed = new Set(context.unconfirmedPreferenceKeys);
  if (declaredAllowed.size !== context.allowedPreferenceKeys.length || declaredAllowed.size !== allowedKeys.size ||
      [...allowedKeys].some((key) => !declaredAllowed.has(key as UserPreferenceKey)) ||
      declaredUnconfirmed.size !== context.unconfirmedPreferenceKeys.length || declaredUnconfirmed.size !== expectedUnconfirmed.length ||
      expectedUnconfirmed.some((key) => !declaredUnconfirmed.has(key)) ||
      context.hasPersonalPreferences !== (allowedKeys.size > 0)) {
    return "invalid_preference_context";
  }
  return null;
}

function recommendationText(item: z.infer<typeof recommendationSchema>): string {
  return [item.action, item.reason, item.intendedProfile, item.expectedBenefit,
    ...item.practicalSteps, item.environmentalImpact ?? ""].join(" ");
}

function personalizationIssue(
  item: z.infer<typeof recommendationSchema>,
  context: AdviceContext
): string | null {
  const selected = new Set(context.allowedPreferenceKeys);
  const personalizedBy = new Set(item.personalizedBy);
  const conditionalOn = new Set(item.conditionalOn);

  if (item.guidanceType === "personalized") {
    if (item.personalizedBy.length === 0 || item.conditionalOn.length > 0) return "missing_preference_information";
  } else if (item.guidanceType === "general") {
    if (item.personalizedBy.length > 0 || item.conditionalOn.length > 0) return "unsupported_personalization";
  } else if (item.personalizedBy.length > 0 || item.conditionalOn.length === 0) {
    return "missing_preference_information";
  }

  if (item.personalizedBy.some((key) => !selected.has(key))) return "unsupported_personalization";
  const text = recommendationText(item);

  for (const key of item.conditionalOn) {
    if (selected.has(key)) return "unsupported_personalization";
    if (!CONDITIONAL_PROFILE_CLAIMS[key].test(text)) return "missing_preference_information";
  }

  for (const key of USER_PREFERENCE_KEYS) {
    if (!hasPersonalProfileClaim(key, text)) continue;
    if (personalizedBy.has(key) && selected.has(key)) continue;
    if (conditionalOn.has(key) && !selected.has(key) && CONDITIONAL_PROFILE_CLAIMS[key].test(text)) continue;
    return "unsupported_personalization";
  }
  for (const key of item.personalizedBy) {
    const suppliedValue = context.suppliedPreferenceValues[key];
    if (SPECIFIC_PROFILE_VALUE_CLAIMS[key].some(({ value, claim }) =>
      value !== suppliedValue && claim.test(text)
    )) return "unsupported_personalization";
  }
  if (personalizedBy.has("commute") && UNSUPPORTED_COMMUTE_FREQUENCY.test(text)) {
    return "unsupported_personalization";
  }
  return null;
}

function dataType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value;
}

function readPath(payload: unknown, path: PropertyKey[]): { found: boolean; value?: unknown } {
  let current: unknown = payload;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === "number") {
      if (segment < 0 || segment >= current.length) return { found: false };
      current = current[segment];
      continue;
    }
    if (typeof current !== "object" || current === null || typeof segment !== "string" ||
        !Object.prototype.hasOwnProperty.call(current, segment)) return { found: false };
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function safeIssuePath(path: PropertyKey[]): string {
  if (!path.length) return "root";
  return path.map((part) => typeof part === "number"
    ? `[${part}]`
    : typeof part === "string" && SAFE_SCHEMA_FIELDS.has(part) ? part : "[unknown]").join(".");
}

function schemaIssueDetails(payload: unknown, issues: Array<{ path: PropertyKey[]; expected?: unknown }>) {
  return issues.slice(0, 12).map((issue) => {
    const resolved = readPath(payload, issue.path);
    const expectedType = typeof issue.expected === "string" &&
      ["string", "number", "boolean", "null", "object", "array", "undefined"].includes(issue.expected)
      ? issue.expected
      : undefined;
    const path = safeIssuePath(issue.path);
    const leaf = issue.path.at(-1);
    const missingField = !resolved.found && typeof leaf === "string" && SAFE_SCHEMA_FIELDS.has(leaf)
      ? leaf
      : undefined;
    return {
      path,
      ...(expectedType ? { expectedType } : {}),
      actualType: resolved.found ? dataType(resolved.value) : "missing",
      ...(missingField ? { missingField } : {})
    };
  });
}

/** Validate model output and return only structural reason codes, never generated text. */
export function diagnoseAssistantAdvice(payload: unknown, context: AdviceContext): AdviceValidationResult {
  const contextIssue = preferenceContextIssue(context);
  if (contextIssue) return { valid: false, reason: contextIssue };

  const parsed = assistantAdviceSchema.safeParse(payload);
  if (!parsed.success) {
    const validationIssues = schemaIssueDetails(payload, parsed.error.issues);
    const issuePaths = [...new Set(validationIssues.map((issue) => issue.path))];
    const invalidPreferenceIdentifier = parsed.error.issues.some((issue) =>
      issue.code === "invalid_value" && (issue.path.includes("personalizedBy") || issue.path.includes("conditionalOn"))
    );
    return {
      valid: false,
      reason: invalidPreferenceIdentifier ? "invalid_preference_identifier" : "schema_invalid",
      issuePaths,
      validationIssues
    };
  }
  const allowed = allowedBases(context);
  const strings = [parsed.data.summary, parsed.data.uncertainty];
  if (strings.some((value) => USER_PREFERENCE_KEYS.some((key) => hasPersonalProfileClaim(key, value)))) {
    return { valid: false, reason: "unsupported_personalization" };
  }
  for (const item of parsed.data.recommendations) {
    strings.push(item.action, item.reason, item.intendedProfile, item.expectedBenefit, ...item.practicalSteps);
    if (item.environmentalImpact) {
      if (NUMERIC_ENVIRONMENT_CLAIM.test(item.environmentalImpact)) {
        return { valid: false, reason: "unsupported_environmental_number" };
      }
      strings.push(item.environmentalImpact);
    }
    if (item.basis.some((basis) => !allowed.has(basis))) {
      return { valid: false, reason: "unsupported_evidence_tag" };
    }
    const profileIssue = personalizationIssue(item, context);
    if (profileIssue) return { valid: false, reason: profileIssue };
  }
  if (strings.some((value) => FORBIDDEN_CURRENT_DATA.test(value) || POLLUTANT_VALUE_CLAIM.test(value) ||
      POLLUTANT_NUMERIC_CLAIM.test(value) || STATION_CLAIM.test(value) || UNSUPPORTED_MEDICAL_CLAIM.test(value))) {
    const hasCurrentClaim = strings.some((value) => FORBIDDEN_CURRENT_DATA.test(value));
    const hasPollutantClaim = strings.some((value) => POLLUTANT_VALUE_CLAIM.test(value) || POLLUTANT_NUMERIC_CLAIM.test(value));
    const hasStationClaim = strings.some((value) => STATION_CLAIM.test(value));
    const hasMedicalClaim = strings.some((value) => UNSUPPORTED_MEDICAL_CLAIM.test(value));
    return { valid: false, reason: hasCurrentClaim ? "current_data_claim" : hasPollutantClaim
      ? "pollutant_value_claim" : hasStationClaim ? "station_claim" : hasMedicalClaim ? "medical_claim" : "disallowed_claim" };
  }
  for (const value of strings) {
    const claim = CATEGORY_CLAIM.exec(value);
    const claimedCategory = claim?.[1] ?? claim?.[2];
    if (claimedCategory && (!context.hasLiveOfficialAqi ||
        claimedCategory.toLowerCase() !== context.officialCategory?.toLowerCase())) {
      return { valid: false, reason: "unsupported_aqi_category" };
    }
  }
  return { valid: true, advice: parsed.data };
}

/** Return validated advice only; the diagnostic variant deliberately omits model text. */
export function validateAssistantAdvice(payload: unknown, context: AdviceContext): AssistantAdvice | null {
  const result = diagnoseAssistantAdvice(payload, context);
  return result.valid ? result.advice : null;
}

const recommendationJsonSchema = {
  type: "object",
  properties: {
    action: { type: "string" },
    reason: { type: "string" },
    intendedProfile: { type: "string" },
    expectedBenefit: { type: "string" },
    practicalSteps: { type: "array", items: { type: "string" } },
    environmentalImpact: { type: ["string", "null"] },
    basis: {
      type: "array",
      items: { type: "string", enum: [
        "current_official_aqi", "official_pollutant_observation", "supplementary_measurement",
        "selected_location", "lifestyle_preferences", "general_guidance"
      ] }
    },
    guidanceType: { type: "string", enum: ["personalized", "general", "conditional"] },
    personalizedBy: { type: "array", items: { type: "string", enum: [...USER_PREFERENCE_KEYS] } },
    conditionalOn: { type: "array", items: { type: "string", enum: [...USER_PREFERENCE_KEYS] } }
  },
  required: ["action", "reason", "intendedProfile", "expectedBenefit", "practicalSteps", "environmentalImpact", "basis", "guidanceType", "personalizedBy", "conditionalOn"],
  additionalProperties: false
};

export const GEMINI_ADVICE_JSON_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    recommendations: { type: "array", items: recommendationJsonSchema },
    uncertainty: { type: "string" }
  },
  required: ["summary", "recommendations", "uncertainty"],
  additionalProperties: false
};

export function validateRecommendation(value: unknown): Recommendation | null {
  const parsed = recommendationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
