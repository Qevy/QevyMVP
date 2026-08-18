/**
 * Provider-agnostic calendar shapes.
 *
 * These are deliberately the intersection of what iCloud CalDAV can do and
 * what the app needs — nothing Google-specific, nothing CalDAV-specific.
 * `calendarId` is an opaque string: for CalDAV it is the collection URL.
 */

export type CalendarRef = {
  /** Opaque, stable. CalDAV: the collection URL. */
  id: string;
  displayName: string;
  readOnly: boolean;
  /** Hex colour reported by the server, if any. */
  color?: string | null;
};

export type CalendarEvent = {
  /** iCalendar UID. Unique within a calendar. */
  uid: string;
  calendarId: string;
  /** CalDAV ETag, needed for If-Match on update/delete. Null for mock. */
  etag: string | null;
  title: string;
  /** UTC ISO 8601. */
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  /**
   * True when this row is one expanded instance of a recurring master.
   * Providers MUST expand RRULEs before returning — the rest of the app
   * never sees a recurrence rule.
   */
  recurring: boolean;
  location?: string | null;
  description?: string | null;
};

export type EventDraft = {
  title: string;
  description?: string;
  /** UTC ISO 8601. */
  startsAt: string;
  endsAt: string;
};

export type EventWriteResult = {
  uid: string;
  etag: string | null;
};

/**
 * Thrown when a write is rejected because the event changed on the server
 * since we last read it (CalDAV 412 Precondition Failed). Callers should
 * re-sync and surface the conflict rather than clobbering.
 */
export class CalendarConflictError extends Error {
  constructor(
    public readonly uid: string,
    message = "Event changed on the server since it was last read",
  ) {
    super(message);
    this.name = "CalendarConflictError";
  }
}

export class CalendarAuthError extends Error {
  constructor(message = "Calendar credentials were rejected") {
    super(message);
    this.name = "CalendarAuthError";
  }
}

export interface CalendarProvider {
  readonly kind: "mock" | "icloud";

  listCalendars(): Promise<CalendarRef[]>;

  /**
   * Find or create the dedicated calendar the app writes its blocks to.
   * Everything this app creates lives here, so it can be hidden or deleted
   * wholesale without touching real commitments.
   */
  ensurePlannerCalendar(displayName: string): Promise<CalendarRef>;

  /**
   * Expanded event instances overlapping [from, to). Both UTC ISO 8601.
   */
  listEvents(
    calendarIds: string[],
    from: string,
    to: string,
  ): Promise<CalendarEvent[]>;

  createEvent(calendarId: string, draft: EventDraft): Promise<EventWriteResult>;

  updateEvent(
    calendarId: string,
    uid: string,
    etag: string | null,
    draft: EventDraft,
  ): Promise<EventWriteResult>;

  deleteEvent(
    calendarId: string,
    uid: string,
    etag: string | null,
  ): Promise<void>;
}
