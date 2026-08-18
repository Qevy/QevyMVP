import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import type {
  CalendarEvent,
  CalendarProvider,
  CalendarRef,
  EventDraft,
  EventWriteResult,
} from "./types";
import { CalendarConflictError } from "./types";

/**
 * A stand-in for iCloud so the app is runnable before any credentials exist.
 *
 * Fixed commitments are generated deterministically from the requested date
 * window, which means the week grid looks the same on every reload and slot
 * finding has something realistic to work around. Blocks the app creates are
 * held in a module-level map — this is dev-only scaffolding and does not
 * survive a server restart. Phase 2 replaces this wholesale.
 */

export const MOCK_WORK_CALENDAR = "mock://work";
export const MOCK_PERSONAL_CALENDAR = "mock://personal";
export const MOCK_PLANNER_CALENDAR = "mock://planner";

const MOCK_CALENDARS: CalendarRef[] = [
  { id: MOCK_WORK_CALENDAR, displayName: "Work", readOnly: false, color: "#2563eb" },
  { id: MOCK_PERSONAL_CALENDAR, displayName: "Personal", readOnly: false, color: "#16a34a" },
  { id: MOCK_PLANNER_CALENDAR, displayName: "Planner", readOnly: false, color: "#9333ea" },
];

type StoredEvent = CalendarEvent & { version: number };

const writtenEvents = new Map<string, StoredEvent>();

type FixedCommitment = {
  title: string;
  calendarId: string;
  /** ISO weekdays this recurs on: 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  startHour: number;
  startMinute: number;
  durationMinutes: number;
};

const FIXED_COMMITMENTS: FixedCommitment[] = [
  {
    title: "Day job",
    calendarId: MOCK_WORK_CALENDAR,
    weekdays: [1, 2, 3, 4, 5],
    startHour: 9,
    startMinute: 0,
    durationMinutes: 8 * 60,
  },
  {
    title: "Gym",
    calendarId: MOCK_PERSONAL_CALENDAR,
    weekdays: [2, 4],
    startHour: 18,
    startMinute: 30,
    durationMinutes: 60,
  },
  {
    title: "Family lunch",
    calendarId: MOCK_PERSONAL_CALENDAR,
    weekdays: [7],
    startHour: 13,
    startMinute: 0,
    durationMinutes: 120,
  },
];

function expandFixedCommitments(
  calendarIds: string[],
  from: string,
  to: string,
  zone: string,
): CalendarEvent[] {
  const windowStart = DateTime.fromISO(from, { zone });
  const windowEnd = DateTime.fromISO(to, { zone });
  const events: CalendarEvent[] = [];

  let day = windowStart.startOf("day");
  while (day < windowEnd) {
    for (const commitment of FIXED_COMMITMENTS) {
      if (!calendarIds.includes(commitment.calendarId)) continue;
      if (!commitment.weekdays.includes(day.weekday)) continue;

      const starts = day.set({
        hour: commitment.startHour,
        minute: commitment.startMinute,
        second: 0,
        millisecond: 0,
      });
      const ends = starts.plus({ minutes: commitment.durationMinutes });

      // Overlap test, not containment — a block straddling the window edge
      // still constrains scheduling inside it.
      if (ends <= windowStart || starts >= windowEnd) continue;

      events.push({
        uid: `mock-fixed-${slug(commitment.title)}-${starts.toISODate()}`,
        calendarId: commitment.calendarId,
        etag: null,
        title: commitment.title,
        startsAt: starts.toUTC().toISO()!,
        endsAt: ends.toUTC().toISO()!,
        allDay: false,
        recurring: true,
      });
    }
    day = day.plus({ days: 1 });
  }

  return events;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export class MockCalendarProvider implements CalendarProvider {
  readonly kind = "mock" as const;

  constructor(private readonly zone: string) {}

  async listCalendars(): Promise<CalendarRef[]> {
    return MOCK_CALENDARS;
  }

  async ensurePlannerCalendar(): Promise<CalendarRef> {
    return MOCK_CALENDARS.find((c) => c.id === MOCK_PLANNER_CALENDAR)!;
  }

  async listEvents(
    calendarIds: string[],
    from: string,
    to: string,
  ): Promise<CalendarEvent[]> {
    const windowStart = DateTime.fromISO(from);
    const windowEnd = DateTime.fromISO(to);

    const written = [...writtenEvents.values()].filter((event) => {
      if (!calendarIds.includes(event.calendarId)) return false;
      const starts = DateTime.fromISO(event.startsAt);
      const ends = DateTime.fromISO(event.endsAt);
      return ends > windowStart && starts < windowEnd;
    });

    return [...expandFixedCommitments(calendarIds, from, to, this.zone), ...written].sort(
      (a, b) => a.startsAt.localeCompare(b.startsAt),
    );
  }

  async createEvent(
    calendarId: string,
    draft: EventDraft,
  ): Promise<EventWriteResult> {
    const uid = `mock-${randomUUID()}`;
    const stored: StoredEvent = {
      uid,
      calendarId,
      etag: `"1"`,
      title: draft.title,
      description: draft.description ?? null,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      allDay: false,
      recurring: false,
      version: 1,
    };
    writtenEvents.set(uid, stored);
    return { uid, etag: stored.etag };
  }

  async updateEvent(
    calendarId: string,
    uid: string,
    etag: string | null,
    draft: EventDraft,
  ): Promise<EventWriteResult> {
    const existing = writtenEvents.get(uid);
    if (!existing) throw new Error(`Unknown mock event ${uid}`);
    // Mirror CalDAV's If-Match semantics so callers exercise the conflict path.
    if (etag !== null && etag !== existing.etag) {
      throw new CalendarConflictError(uid);
    }
    const version = existing.version + 1;
    const updated: StoredEvent = {
      ...existing,
      calendarId,
      title: draft.title,
      description: draft.description ?? null,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      etag: `"${version}"`,
      version,
    };
    writtenEvents.set(uid, updated);
    return { uid, etag: updated.etag };
  }

  async deleteEvent(
    _calendarId: string,
    uid: string,
    etag: string | null,
  ): Promise<void> {
    const existing = writtenEvents.get(uid);
    if (!existing) return;
    if (etag !== null && etag !== existing.etag) {
      throw new CalendarConflictError(uid);
    }
    writtenEvents.delete(uid);
  }
}
