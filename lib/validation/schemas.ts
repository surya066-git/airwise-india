import { z } from "zod";
import { DEFAULT_PREFERENCES } from "@/types/preferences";
export { normalizePreferences } from "@/lib/preferences";

const coordinate = z.coerce.number().finite();
const dataStatusSchema = z.enum(["live", "stale", "unavailable", "unverified", "not_configured"]);
const timestampSchema = z.string().datetime({ offset: true });
const pollutantReadingSchema = z.object({
  parameter: z.string().min(1),
  value: z.number().finite().min(0).max(1_000_000),
  unit: z.string().nullable(),
  measuredAt: timestampSchema.nullable(),
  freshness: z.enum(["live", "stale", "unverified"]).optional()
}).strict();
const cpcbPaginationSchema = z.object({
  status: z.enum(["complete", "overlap", "conflict", "incomplete", "rate_limited"]),
  requestedLimit: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
  reportedTotal: z.number().int().nonnegative().nullable(),
  recordsReturned: z.number().int().nonnegative(),
  uniqueRecords: z.number().int().nonnegative(),
  duplicateRows: z.number().int().nonnegative(),
  conflictingRows: z.number().int().nonnegative(),
  pages: z.array(z.object({
    requestedOffset: z.number().int().nonnegative(),
    reportedOffset: z.number().int().nonnegative().nullable(),
    reportedLimit: z.number().int().positive().nullable(),
    reportedCount: z.number().int().nonnegative().nullable(),
    actualCount: z.number().int().nonnegative()
  }).strict()).max(50)
}).strict();

export const airQualityResponseSchema = z.object({
  location: z.object({
    label: z.string().nullable(),
    latitude: z.number().finite().min(-90).max(90).nullable(),
    longitude: z.number().finite().min(-180).max(180).nullable()
  }).strict(),
  official: z.object({
    status: dataStatusSchema,
    source: z.literal("CPCB / data.gov.in"),
    requestedCity: z.string().nullable(),
    city: z.string().nullable(),
    station: z.string().nullable(),
    state: z.string().nullable(),
    distanceMeters: z.number().finite().min(0).nullable(),
    aqi: z.number().int().min(0).max(500).nullable(),
    category: z.string().nullable(),
    interpretation: z.string().nullable(),
    updatedAt: timestampSchema.nullable(),
    pollutants: z.array(pollutantReadingSchema),
    pagination: cpcbPaginationSchema.nullable().optional(),
    message: z.string()
  }).strict(),
  supplementary: z.object({
    status: dataStatusSchema,
    source: z.literal("OpenAQ"),
    station: z.string().nullable(),
    distanceMeters: z.number().finite().min(0).nullable(),
    updatedAt: timestampSchema.nullable(),
    measurements: z.array(pollutantReadingSchema),
    message: z.string()
  }).strict(),
  fetchedAt: timestampSchema
}).strict();

function validateCoordinates(
  value: { latitude?: number; longitude?: number },
  context: z.RefinementCtx
) {
  if ((value.latitude === undefined) !== (value.longitude === undefined)) {
    context.addIssue({ code: "custom", message: "Latitude and longitude must be supplied together." });
  }
  if (value.latitude !== undefined && (value.latitude < -90 || value.latitude > 90)) {
    context.addIssue({ code: "custom", path: ["latitude"], message: "Latitude is out of range." });
  }
  if (value.longitude !== undefined && (value.longitude < -180 || value.longitude > 180)) {
    context.addIssue({ code: "custom", path: ["longitude"], message: "Longitude is out of range." });
  }
}

export const locationQuerySchema = z.object({
  city: z.string().trim().max(100).optional().default(""),
  latitude: coordinate.optional(),
  longitude: coordinate.optional()
}).superRefine(validateCoordinates);

export const preferenceValueSchemas = {
  ageGroup: z.enum(["Prefer not to say", "Under 18", "18-59", "60+"]),
  occupation: z.enum(["Resident", "Student", "Office worker", "Outdoor worker"]),
  commute: z.enum(["Not applicable", "Walk or cycle", "Public transit", "Two-wheeler", "Car", "Mixed"]),
  outdoorActivity: z.enum(["Rarely", "Sometimes", "Most days"]),
  children: z.boolean(),
  olderAdults: z.boolean()
};

export const userPreferencesSchema = z.object({
  ageGroup: preferenceValueSchemas.ageGroup.default(DEFAULT_PREFERENCES.ageGroup),
  occupation: preferenceValueSchemas.occupation.default(DEFAULT_PREFERENCES.occupation),
  commute: preferenceValueSchemas.commute.default(DEFAULT_PREFERENCES.commute),
  outdoorActivity: preferenceValueSchemas.outdoorActivity.default(DEFAULT_PREFERENCES.outdoorActivity),
  children: preferenceValueSchemas.children.default(false),
  olderAdults: preferenceValueSchemas.olderAdults.default(false)
}).strict();

export const assistantBodySchema = z.object({
  city: z.string().trim().max(100).optional().default(""),
  latitude: coordinate.optional(),
  longitude: coordinate.optional(),
  preferences: userPreferencesSchema.optional().default(DEFAULT_PREFERENCES),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(1200)
  })).min(1).max(8)
}).superRefine(validateCoordinates);
