import {
  AGE_GROUP_OPTIONS,
  COMMUTE_OPTIONS,
  DEFAULT_PREFERENCES,
  OCCUPATION_OPTIONS,
  OUTDOOR_ACTIVITY_OPTIONS,
  type UserPreferences
} from "@/types/preferences";

const allowedKeys = new Set([
  "ageGroup", "occupation", "commute", "outdoorActivity", "children", "olderAdults"
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOption<const Options extends readonly string[]>(
  value: unknown,
  options: Options,
  fallback: Options[number]
): Options[number] | null {
  if (value === undefined) return fallback;
  return options.find((option) => option === value) ?? null;
}

function readBoolean(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined) return fallback;
  return typeof value === "boolean" ? value : null;
}

/** Restore only a complete, recognized preference profile; malformed storage resets safely. */
export function normalizePreferences(value: unknown): UserPreferences {
  if (!isRecord(value)) return DEFAULT_PREFERENCES;
  const candidate = { ...value };
  if (candidate.occupation === undefined && typeof candidate.routine === "string") {
    candidate.occupation = candidate.routine;
  }
  delete candidate.routine;

  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return DEFAULT_PREFERENCES;

  const ageGroup = readOption(candidate.ageGroup, AGE_GROUP_OPTIONS, DEFAULT_PREFERENCES.ageGroup);
  const occupation = readOption(candidate.occupation, OCCUPATION_OPTIONS, DEFAULT_PREFERENCES.occupation);
  const commute = readOption(candidate.commute, COMMUTE_OPTIONS, DEFAULT_PREFERENCES.commute);
  const outdoorActivity = readOption(candidate.outdoorActivity, OUTDOOR_ACTIVITY_OPTIONS, DEFAULT_PREFERENCES.outdoorActivity);
  const children = readBoolean(candidate.children, DEFAULT_PREFERENCES.children);
  const olderAdults = readBoolean(candidate.olderAdults, DEFAULT_PREFERENCES.olderAdults);

  if (ageGroup === null || occupation === null || commute === null || outdoorActivity === null || children === null || olderAdults === null) {
    return DEFAULT_PREFERENCES;
  }

  return { ageGroup, occupation, commute, outdoorActivity, children, olderAdults };
}
