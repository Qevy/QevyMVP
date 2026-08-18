import { DateTime, Interval } from "luxon";
import type { Profile } from "@/lib/profile";

/**
 * Finds the gaps a block could go in.
 *
 * Deliberately pure and synchronous — no database, no network, no clock
 * beyond what's passed in. That makes it directly testable
 * (`npm run check:slots`) and keeps the scheduling rules in one readable
 * place rather than smeared through the AI plumbing.
 *
 * The authority on WHEN scheduling is allowed is `profile.working_hours`.
 * The calendar contributes conflicts, not permission — Hadi's 9-5 is not in
 * iCloud, so an empty calendar must not mean "the whole day is free".
 */

export type BusyInterval = {
  startsAt: string;
  endsAt: string;
  title?: string;
  allDay?: boolean;
};

export type OpenSlot = {
  /** UTC ISO 8601. */
  startsAt: string;
  endsAt: string;
  minutes: number;
};

export function findOpenSlots(params: {
  profile: Profile;
  busy: BusyInterval[];
  /** UTC ISO 8601 window bounds. */
  from: string;
  to: string;
  minMinutes?: number;
  /** Slots ending before this are dropped. Defaults to no filtering. */
  now?: string;
}): OpenSlot[] {
  const { profile, busy, from, to } = params;
  const minMinutes = params.minMinutes ?? 30;
  const zone = profile.timezone;
  const buffer = profile.buffer_minutes;

  const windowStart = DateTime.fromISO(from, { zone });
  const windowEnd = DateTime.fromISO(to, { zone });
  if (!windowStart.isValid || !windowEnd.isValid) return [];

  const now = params.now ? DateTime.fromISO(params.now, { zone }) : null;

  // Busy intervals padded by the buffer, so a block never butts up against a
  // commitment. All-day events consume their whole day.
  const blocked: Interval[] = [];
  for (const item of busy) {
    const start = DateTime.fromISO(item.startsAt, { zone });
    const end = DateTime.fromISO(item.endsAt, { zone });
    if (!start.isValid || !end.isValid || end <= start) continue;

    const padded = item.allDay
      ? Interval.fromDateTimes(start.startOf("day"), end > start.startOf("day").plus({ days: 1 })
          ? end
          : start.plus({ days: 1 }).startOf("day"))
      : Interval.fromDateTimes(
          start.minus({ minutes: buffer }),
          end.plus({ minutes: buffer }),
        );

    if (padded.isValid) blocked.push(padded);
  }

  const merged = mergeIntervals(blocked);

  const slots: OpenSlot[] = [];
  let day = windowStart.startOf("day");

  while (day < windowEnd) {
    const weekday = String(day.weekday); // 1 = Monday
    const windows = profile.working_hours[weekday] ?? [];

    for (const window of windows) {
      const available = availabilityInterval(day, window, zone);
      if (!available) continue;

      // Clamp to the requested window — a Monday availability window is
      // irrelevant if the caller only asked about Wednesday onward.
      const clamped = available.intersection(
        Interval.fromDateTimes(windowStart, windowEnd),
      );
      if (!clamped || !clamped.isValid || clamped.length("minutes") <= 0) continue;

      for (const free of subtract(clamped, merged)) {
        const minutes = Math.floor(free.length("minutes"));
        if (minutes < minMinutes) continue;
        // A slot that has already ended is not schedulable.
        if (now && free.end && free.end <= now) continue;

        // If the slot is partly in the past, offer only the remainder.
        const usable =
          now && free.start && free.start < now
            ? Interval.fromDateTimes(now, free.end!)
            : free;
        const usableMinutes = Math.floor(usable.length("minutes"));
        if (usableMinutes < minMinutes) continue;

        slots.push({
          startsAt: usable.start!.toUTC().toISO()!,
          endsAt: usable.end!.toUTC().toISO()!,
          minutes: usableMinutes,
        });
      }
    }

    day = day.plus({ days: 1 });
  }

  return slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Does a candidate block sit entirely inside one of the open slots?
 * Used to validate what the model proposes before it ever reaches the UI.
 */
export function fitsInOpenSlot(
  candidate: { startsAt: string; endsAt: string },
  slots: OpenSlot[],
): boolean {
  const start = DateTime.fromISO(candidate.startsAt);
  const end = DateTime.fromISO(candidate.endsAt);
  if (!start.isValid || !end.isValid || end <= start) return false;

  return slots.some((slot) => {
    const slotStart = DateTime.fromISO(slot.startsAt);
    const slotEnd = DateTime.fromISO(slot.endsAt);
    return start >= slotStart && end <= slotEnd;
  });
}

export function overlapsAny(
  candidate: { startsAt: string; endsAt: string },
  others: { startsAt: string; endsAt: string }[],
): boolean {
  const start = DateTime.fromISO(candidate.startsAt);
  const end = DateTime.fromISO(candidate.endsAt);

  return others.some((other) => {
    const otherStart = DateTime.fromISO(other.startsAt);
    const otherEnd = DateTime.fromISO(other.endsAt);
    return start < otherEnd && end > otherStart;
  });
}

// ---------------------------------------------------------------------------

function availabilityInterval(
  day: DateTime,
  window: { start: string; end: string },
  zone: string,
): Interval | null {
  const [startHour, startMinute] = window.start.split(":").map(Number);
  const [endHour, endMinute] = window.end.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some(Number.isNaN)) {
    return null;
  }

  const start = day
    .setZone(zone)
    .set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });
  const end = day
    .setZone(zone)
    .set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });

  // A DST spring-forward can make a wall-clock time not exist; luxon shifts
  // it forward, which can invert the interval.
  if (end <= start) return null;

  const interval = Interval.fromDateTimes(start, end);
  return interval.isValid ? interval : null;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort(
    (a, b) => a.start!.toMillis() - b.start!.toMillis(),
  );

  const merged: Interval[] = [sorted[0]];
  for (const interval of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    // `abutsStart` catches back-to-back intervals that overlaps() misses.
    if (interval.overlaps(last) || interval.abutsStart(last) || last.abutsStart(interval)) {
      merged[merged.length - 1] = Interval.fromDateTimes(
        last.start!,
        interval.end! > last.end! ? interval.end! : last.end!,
      );
    } else {
      merged.push(interval);
    }
  }

  return merged;
}

/** `available` minus every blocked interval, as the remaining free pieces. */
function subtract(available: Interval, blocked: Interval[]): Interval[] {
  let free: Interval[] = [available];

  for (const block of blocked) {
    const next: Interval[] = [];
    for (const piece of free) {
      if (!piece.overlaps(block)) {
        next.push(piece);
        continue;
      }
      // difference() returns whatever is left of `piece` once `block` is cut out.
      next.push(...piece.difference(block));
    }
    free = next;
  }

  return free.filter((interval) => interval.isValid && interval.length("minutes") > 0);
}
