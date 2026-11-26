import { DEFAULT_PREFERENCES, type UserPreferences } from "@/types/preferences";

const allowedKeys = new Set([
  "ageGroup", "occupation", "commute", "outdoorActivity", "children", "olderAdults"
]);
const ageGroups = new Set(["Prefer not to say", "Under 18", "18-59", "60+"]);
const occupations = new Set(["Resident", "Student", "Office worker", "Outdoor worker"]);
const commutes = new Set(["Not applicable", "Walk or cycle", "Public transit", "Two-wheeler", "Car", "Mixed"]);
const outdoorActivityLevels = new Set(["Rarely", "Sometimes", "Most days"]);

/** Restore only a complete, recognized preference profile; malformed storage resets safely. */
export function normalizePreferences(value: unknown): UserPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_PREFERENCES;
  const candidate = { ...value } as Record<string, unknown>;
  if (candidate.occupation === undefined && typeof candidate.routine === "string") {
    candidate.occupation = candidate.routine;
  }
  delete candidate.routine;

  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return DEFAULT_PREFERENCES;
  if (candidate.ageGroup !== undefined && !ageGroups.has(candidate.ageGroup as string)) return DEFAULT_PREFERENCES;
  if (candidate.occupation !== undefined && !occupations.has(candidate.occupation as string)) return DEFAULT_PREFERENCES;
  if (candidate.commute !== undefined && !commutes.has(candidate.commute as string)) return DEFAULT_PREFERENCES;
  if (candidate.outdoorActivity !== undefined && !outdoorActivityLevels.has(candidate.outdoorActivity as string)) return DEFAULT_PREFERENCES;
  if (candidate.children !== undefined && typeof candidate.children !== "boolean") return DEFAULT_PREFERENCES;
  if (candidate.olderAdults !== undefined && typeof candidate.olderAdults !== "boolean") return DEFAULT_PREFERENCES;

  return {
    ageGroup: candidate.ageGroup as UserPreferences["ageGroup"] | undefined ?? DEFAULT_PREFERENCES.ageGroup,
    occupation: candidate.occupation as UserPreferences["occupation"] | undefined ?? DEFAULT_PREFERENCES.occupation,
    commute: candidate.commute as UserPreferences["commute"] | undefined ?? DEFAULT_PREFERENCES.commute,
    outdoorActivity: candidate.outdoorActivity as UserPreferences["outdoorActivity"] | undefined ?? DEFAULT_PREFERENCES.outdoorActivity,
    children: candidate.children as boolean | undefined ?? DEFAULT_PREFERENCES.children,
    olderAdults: candidate.olderAdults as boolean | undefined ?? DEFAULT_PREFERENCES.olderAdults
  };
}
