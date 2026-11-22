export type UserPreferences = {
  ageGroup: "Prefer not to say" | "Under 18" | "18-59" | "60+";
  occupation: "Resident" | "Student" | "Office worker" | "Outdoor worker";
  commute: "Not applicable" | "Walk or cycle" | "Public transit" | "Two-wheeler" | "Car" | "Mixed";
  outdoorActivity: "Rarely" | "Sometimes" | "Most days";
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
