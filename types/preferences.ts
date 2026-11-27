export const AGE_GROUP_OPTIONS = ["Prefer not to say", "Under 18", "18-59", "60+"] as const;
export const OCCUPATION_OPTIONS = ["Resident", "Student", "Office worker", "Outdoor worker"] as const;
export const COMMUTE_OPTIONS = ["Not applicable", "Walk or cycle", "Public transit", "Two-wheeler", "Car", "Mixed"] as const;
export const OUTDOOR_ACTIVITY_OPTIONS = ["Rarely", "Sometimes", "Most days"] as const;

export type UserPreferences = {
  ageGroup: (typeof AGE_GROUP_OPTIONS)[number];
  occupation: (typeof OCCUPATION_OPTIONS)[number];
  commute: (typeof COMMUTE_OPTIONS)[number];
  outdoorActivity: (typeof OUTDOOR_ACTIVITY_OPTIONS)[number];
  children: boolean;
  olderAdults: boolean;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  ageGroup: "Prefer not to say",
  occupation: "Resident",
  commute: "Not applicable",
  outdoorActivity: "Sometimes",
  children: false,
  olderAdults: false
};
