import { DateTime, Interval } from "luxon";

/**
 * Everything in this app is stored as UTC ISO strings and rendered in the
 * user's configured IANA timezone. The one rule that prevents an entire class
 * of bug: never construct a local `Date` and never do arithmetic on raw hours.
 * Go through luxon with an explicit zone.
 */

export const SLOT_BUCKETS = [
  "early_morning",
  "morning",
  "midday",
  "afternoon",
  "evening",
  "night",
] as const;

export type SlotBucket = (typeof SLOT_BUCKETS)[number];

export const SLOT_BUCKET_LABELS: Record<SlotBucket, string> = {
  early_morning: "Early morning (5–8am)",
  morning: "Morning (8am–12pm)",
  midday: "Midday (12–2pm)",
  afternoon: "Afternoon (2–5pm)",
  evening: "Evening (5–9pm)",
  night: "Night (9pm–5am)",
};

/**
 * The bucket is the axis adaptation learns on. "7am editing" and "7:30am
 * editing" are the same lesson, so they have to land in the same bucket.
 */
export function slotBucketFor(iso: string, zone: string): SlotBucket {
  const hour = DateTime.fromISO(iso, { zone }).hour;
  if (hour >= 5 && hour < 8) return "early_morning";
  if (hour >= 8 && hour < 12) return "morning";
  if (hour >= 12 && hour < 14) return "midday";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/** ISO weekday: 1 = Monday … 7 = Sunday, matching luxon and the DB check constraint. */
export function weekdayFor(iso: string, zone: string): number {
  return DateTime.fromISO(iso, { zone }).weekday;
}

/** Monday 00:00 of the week containing `reference`, in the given zone. */
export function startOfWeek(reference: DateTime, zone: string): DateTime {
  return reference.setZone(zone).startOf("week");
}

export function weekWindow(
  reference: DateTime,
  zone: string,
): { from: string; to: string; days: DateTime[] } {
  const start = startOfWeek(reference, zone);
  const end = start.plus({ days: 7 });
  const days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  return { from: start.toUTC().toISO()!, to: end.toUTC().toISO()!, days };
}

export function toInterval(startsAt: string, endsAt: string, zone: string): Interval {
  return Interval.fromDateTimes(
    DateTime.fromISO(startsAt, { zone }),
    DateTime.fromISO(endsAt, { zone }),
  );
}

export function formatTime(iso: string, zone: string): string {
  return DateTime.fromISO(iso, { zone }).toFormat("HH:mm");
}

export function formatRange(startsAt: string, endsAt: string, zone: string): string {
  return `${formatTime(startsAt, zone)}–${formatTime(endsAt, zone)}`;
}

/** Minutes from midnight, used to position blocks on the week grid. */
export function minutesFromMidnight(iso: string, zone: string): number {
  const dt = DateTime.fromISO(iso, { zone });
  return dt.hour * 60 + dt.minute;
}

export function durationMinutes(startsAt: string, endsAt: string): number {
  return Math.round(
    DateTime.fromISO(endsAt).diff(DateTime.fromISO(startsAt), "minutes").minutes,
  );
}
