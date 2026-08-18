import ICAL from "ical.js";
import { DateTime } from "luxon";
import type { CalendarEvent, EventDraft } from "./types";

/**
 * iCalendar parsing and generation. Deliberately free of any network or
 * server dependency so it can be exercised directly — see
 * `scripts/caldav-check.mts`.
 */

/**
 * Safety valve for recurrence expansion. A daily event running for a decade
 * is ~3650 instances; beyond this the RRULE is malformed and we should stop
 * rather than hang the request.
 */
const MAX_OCCURRENCES = 10_000;

/** CalDAV wants basic-format UTC: 20260803T000000Z */
export function toCalDavTime(value: DateTime): string {
  return value.toUTC().toFormat("yyyyLLdd'T'HHmmss'Z'");
}

/**
 * Turn one .ics resource into concrete event instances inside the window.
 *
 * A single resource can hold a recurring master plus any number of modified
 * instances (each carrying RECURRENCE-ID). ICAL.Event resolves the
 * relationship once the exceptions are attached to the master.
 */
export function expandCalendarObject(params: {
  ics: string;
  calendarId: string;
  etag: string | null;
  windowStart: DateTime;
  windowEnd: DateTime;
  zone: string;
}): CalendarEvent[] {
  const { ics, calendarId, etag, windowStart, windowEnd, zone } = params;

  const root = new ICAL.Component(ICAL.parse(ics));

  // Register any VTIMEZONE the file carries, otherwise ICAL cannot resolve
  // TZID references and silently treats those times as floating.
  for (const vtimezone of root.getAllSubcomponents("vtimezone")) {
    const timezone = new ICAL.Timezone(vtimezone);
    if (!ICAL.TimezoneService.has(timezone.tzid)) {
      ICAL.TimezoneService.register(timezone, timezone.tzid);
    }
  }

  const vevents = root.getAllSubcomponents("vevent");
  if (vevents.length === 0) return [];

  const masters = vevents.filter((v) => !v.hasProperty("recurrence-id"));
  const overrides = vevents.filter((v) => v.hasProperty("recurrence-id"));

  const events: CalendarEvent[] = [];

  for (const master of masters) {
    const event = new ICAL.Event(master);

    for (const override of overrides) {
      if (override.getFirstPropertyValue("uid") === event.uid) {
        event.relateException(override);
      }
    }

    const allDay = event.startDate?.isDate ?? false;

    if (!event.isRecurring()) {
      const instance = toEvent({
        uid: event.uid,
        calendarId,
        etag,
        title: event.summary,
        location: event.location,
        description: event.description,
        start: event.startDate,
        end: event.endDate,
        allDay,
        recurring: false,
        zone,
      });
      if (overlaps(instance, windowStart, windowEnd)) events.push(instance);
      continue;
    }

    const iterator = event.iterator();
    let occurrence = iterator.next();
    let guard = 0;

    while (occurrence && guard++ < MAX_OCCURRENCES) {
      const details = event.getOccurrenceDetails(occurrence);

      const instance = toEvent({
        uid: event.uid,
        calendarId,
        etag,
        title: details.item.summary || event.summary,
        location: details.item.location || event.location,
        description: details.item.description || event.description,
        start: details.startDate,
        end: details.endDate,
        allDay,
        recurring: true,
        zone,
      });

      // The iterator runs forward in time, so once past the window there is
      // nothing left to find.
      if (DateTime.fromISO(instance.startsAt) >= windowEnd) break;
      if (overlaps(instance, windowStart, windowEnd)) events.push(instance);

      occurrence = iterator.next();
    }
  }

  return events;
}

function overlaps(event: CalendarEvent, start: DateTime, end: DateTime) {
  return (
    DateTime.fromISO(event.endsAt) > start &&
    DateTime.fromISO(event.startsAt) < end
  );
}

function toEvent(params: {
  uid: string;
  calendarId: string;
  etag: string | null;
  title: string | null;
  location: string | null;
  description: string | null;
  start: ICAL.Time;
  end: ICAL.Time;
  allDay: boolean;
  recurring: boolean;
  zone: string;
}): CalendarEvent {
  return {
    uid: params.uid,
    calendarId: params.calendarId,
    etag: params.etag,
    title: params.title?.trim() || "(busy)",
    startsAt: icalTimeToUtcIso(params.start, params.zone),
    endsAt: icalTimeToUtcIso(params.end, params.zone),
    allDay: params.allDay,
    recurring: params.recurring,
    location: params.location ?? null,
    description: params.description ?? null,
  };
}

/**
 * All-day events are floating dates with no zone — "5 August" means 5 August
 * wherever you are. Anchoring them in the user's zone is the only reading
 * that keeps them on the right day in the grid.
 */
function icalTimeToUtcIso(time: ICAL.Time, zone: string): string {
  if (time.isDate) {
    return DateTime.fromObject(
      { year: time.year, month: time.month, day: time.day },
      { zone },
    )
      .toUTC()
      .toISO()!;
  }
  return DateTime.fromJSDate(time.toJSDate()).toUTC().toISO()!;
}

/** Minimal, valid VCALENDAR. All times in UTC so there is nothing to misread. */
export function buildICS({
  uid,
  draft,
}: {
  uid: string;
  draft: EventDraft;
}): string {
  const stamp = toCalDavTime(DateTime.utc());
  const start = toCalDavTime(DateTime.fromISO(draft.startsAt));
  const end = toCalDavTime(DateTime.fromISO(draft.endsAt));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Planner//Adaptive Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeICSText(draft.title)}`,
    ...(draft.description
      ? [`DESCRIPTION:${escapeICSText(draft.description)}`]
      : []),
    // Marks the event as ours, so a later sync can tell app-created blocks
    // apart from anything else living in the same calendar.
    "X-PLANNER-MANAGED:1",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

function escapeICSText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 caps content lines at 75 octets; continuations start with a space. */
function foldLine(line: string): string {
  if (Buffer.byteLength(line, "utf8") <= 75) return line;

  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    // 73 leaves room for the leading space a continuation line carries.
    if (Buffer.byteLength(current + char, "utf8") > 73) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);

  return parts.join("\r\n ");
}
