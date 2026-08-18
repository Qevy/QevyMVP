import { z } from "zod";
import { DEFAULT_TIMEZONE } from "@/lib/config";

/**
 * `working_hours` is the window the app is ALLOWED to schedule within — the
 * outer boundary of your day. It is not your 9-5: fixed commitments come from
 * the calendar as real events. Keyed by ISO weekday, 1 = Monday.
 *
 * The array shape supports split days (a morning window and an evening one).
 * The settings UI edits a single range per day; the extra shape costs nothing
 * and saves a migration if that turns out to be too coarse.
 */

const timeString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24-hour");

export const availabilityWindowSchema = z
  .object({ start: timeString, end: timeString })
  .refine((window) => window.end > window.start, {
    message: "End must be after start",
    path: ["end"],
  });

// Keys are ISO weekday strings. Deliberately not z.enum: an enum key in Zod 4
// demands every key be present, which would reject an otherwise-valid row
// that is merely missing a day.
export const workingHoursSchema = z.record(
  z.string().regex(/^[1-7]$/),
  z.array(availabilityWindowSchema),
);

export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;
export type WorkingHours = Record<string, AvailabilityWindow[]>;

export const profileSchema = z.object({
  timezone: z.string().min(1),
  working_hours: workingHoursSchema,
  buffer_minutes: z.number().int().min(0).max(120),
  checkin_weekday: z.number().int().min(1).max(7),
  checkin_hour: z.number().int().min(0).max(23),
  planner_calendar_id: z.string().nullable(),
});

export type Profile = z.infer<typeof profileSchema>;

export const WEEKDAY_NAMES: Record<string, string> = {
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
  "7": "Sunday",
};

export const WEEKDAY_KEYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

/** Mirrors the column defaults in 0001_init.sql. */
export const DEFAULT_PROFILE: Profile = {
  timezone: DEFAULT_TIMEZONE,
  working_hours: {
    "1": [{ start: "07:00", end: "22:00" }],
    "2": [{ start: "07:00", end: "22:00" }],
    "3": [{ start: "07:00", end: "22:00" }],
    "4": [{ start: "07:00", end: "22:00" }],
    "5": [{ start: "07:00", end: "22:00" }],
    "6": [{ start: "09:00", end: "22:00" }],
    "7": [{ start: "09:00", end: "22:00" }],
  },
  buffer_minutes: 15,
  checkin_weekday: 7,
  checkin_hour: 18,
  planner_calendar_id: null,
};

/**
 * A common IANA subset. Free text is still accepted on save — this only
 * exists so the settings page has a sane dropdown.
 */
export const COMMON_TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Athens",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
];
