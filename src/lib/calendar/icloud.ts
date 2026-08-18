import "server-only";
import { randomUUID } from "node:crypto";
import { DAVClient, type DAVCalendar } from "tsdav";
import { DateTime } from "luxon";
import type {
  CalendarEvent,
  CalendarProvider,
  CalendarRef,
  EventDraft,
  EventWriteResult,
} from "./types";
import { CalendarAuthError, CalendarConflictError } from "./types";
import { buildICS, expandCalendarObject } from "./ics";

const ICLOUD_SERVER_URL = "https://caldav.icloud.com";

export type ICloudCredentials = {
  appleId: string;
  /** 16-character app-specific password, NOT the Apple account password. */
  appPassword: string;
};

/**
 * iCloud CalDAV.
 *
 * Three things about Apple's server that shape this code:
 *  - No OAuth. Basic auth with an app-specific password is the only route.
 *  - No push. Freshness comes from polling, so callers control when to sync.
 *  - Recurring events come back as a master VEVENT plus an RRULE, not as
 *    instances. Expansion happens here so nothing upstream ever sees a
 *    recurrence rule.
 */
export class ICloudCalendarProvider implements CalendarProvider {
  readonly kind = "icloud" as const;

  private client: DAVClient;
  private loggedIn = false;
  private calendarCache: DAVCalendar[] | null = null;

  constructor(
    credentials: ICloudCredentials,
    private readonly zone: string,
  ) {
    this.client = new DAVClient({
      serverUrl: ICLOUD_SERVER_URL,
      credentials: {
        username: credentials.appleId,
        password: credentials.appPassword,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
  }

  private async ensureLogin(): Promise<void> {
    if (this.loggedIn) return;
    try {
      await this.client.login();
      this.loggedIn = true;
    } catch (error) {
      // Apple returns 401 for both a wrong Apple ID and a revoked
      // app-specific password; we can't tell them apart, so say both.
      throw new CalendarAuthError(
        `iCloud rejected the connection. Check the Apple ID and that the app-specific password hasn't been revoked. (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
    }
  }

  private async davCalendars(): Promise<DAVCalendar[]> {
    if (this.calendarCache) return this.calendarCache;
    await this.ensureLogin();
    const all = await this.client.fetchCalendars();
    // Contact and reminder collections come back from the same home; only
    // VEVENT collections are calendars for our purposes.
    this.calendarCache = all.filter(
      (calendar) =>
        !calendar.components || calendar.components.includes("VEVENT"),
    );
    return this.calendarCache;
  }

  private async findDavCalendar(id: string): Promise<DAVCalendar> {
    const calendars = await this.davCalendars();
    const match = calendars.find((calendar) => calendar.url === id);
    if (!match) throw new Error(`Unknown iCloud calendar: ${id}`);
    return match;
  }

  async listCalendars(): Promise<CalendarRef[]> {
    const calendars = await this.davCalendars();
    return calendars.map((calendar) => ({
      id: calendar.url,
      displayName: readDisplayName(calendar),
      // iCloud exposes read-only subscribed calendars (holidays, shared
      // feeds). Writing to one fails at PUT time, so flag it up front.
      readOnly: isReadOnly(calendar),
      color: calendar.calendarColor ?? null,
    }));
  }

  async ensurePlannerCalendar(displayName: string): Promise<CalendarRef> {
    const existing = (await this.listCalendars()).find(
      (calendar) =>
        calendar.displayName.trim().toLowerCase() ===
        displayName.trim().toLowerCase(),
    );
    if (existing) return existing;

    await this.ensureLogin();
    const homeUrl = this.client.account?.homeUrl;
    if (!homeUrl) {
      throw new Error("Could not resolve the iCloud calendar home URL");
    }

    // MKCALENDAR needs a fresh collection URL we choose ourselves.
    const url = `${homeUrl.replace(/\/$/, "")}/${randomUUID()}/`;

    await this.client.makeCalendar({
      url,
      props: {
        displayname: displayName,
        "supported-calendar-component-set": {
          comp: { _attributes: { name: "VEVENT" } },
        },
      },
    });

    // Force a refetch so the new collection comes back with its real
    // server-assigned properties.
    this.calendarCache = null;
    const refetched = await this.listCalendars();

    // Match on display name, not on the URL we asked for. Apple serves the
    // collection back from a normalised URL (different host shard, encoding,
    // or trailing slash), so an id comparison silently misses and we end up
    // handing out an id that matches nothing else in the system.
    const created =
      refetched.find(
        (calendar) =>
          calendar.displayName.trim().toLowerCase() ===
          displayName.trim().toLowerCase(),
      ) ?? refetched.find((calendar) => calendar.id === url);

    if (!created) {
      throw new Error(
        `Created the ${displayName} calendar but iCloud did not list it back. Try Refresh list.`,
      );
    }

    return created;
  }

  async listEvents(
    calendarIds: string[],
    from: string,
    to: string,
  ): Promise<CalendarEvent[]> {
    await this.ensureLogin();

    const windowStart = DateTime.fromISO(from, { zone: "utc" });
    const windowEnd = DateTime.fromISO(to, { zone: "utc" });

    const results = await Promise.all(
      calendarIds.map(async (calendarId) => {
        const calendar = await this.findDavCalendar(calendarId);

        const objects = await this.client.fetchCalendarObjects({
          calendar,
          // Server-side pre-filter. It is deliberately NOT trusted as exact:
          // Apple includes recurring masters whose own DTSTART falls outside
          // the range, which is what we want, and may include some strays,
          // which expansion filters out below.
          // tsdav validates this as extended ISO 8601 and converts it to
          // CalDAV's basic format itself — passing the basic format here is
          // rejected before the request is even built.
          timeRange: {
            start: windowStart.toUTC().toISO()!,
            end: windowEnd.toUTC().toISO()!,
          },
          expand: false,
        });

        return objects.flatMap((object) => {
          if (typeof object.data !== "string") return [];
          try {
            return expandCalendarObject({
              ics: object.data,
              calendarId,
              etag: object.etag ?? null,
              windowStart,
              windowEnd,
              zone: this.zone,
            });
          } catch (error) {
            // One malformed event must not blank out the whole week.
            console.error(
              `Skipping unparseable event at ${object.url}:`,
              error instanceof Error ? error.message : error,
            );
            return [];
          }
        });
      }),
    );

    return results
      .flat()
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async createEvent(
    calendarId: string,
    draft: EventDraft,
  ): Promise<EventWriteResult> {
    const calendar = await this.findDavCalendar(calendarId);
    const uid = `planner-${randomUUID()}`;

    const response = await this.client.createCalendarObject({
      calendar,
      filename: `${uid}.ics`,
      iCalString: buildICS({ uid, draft }),
    });

    await assertOk(response, uid, "create");
    return { uid, etag: response.headers.get("etag") };
  }

  async updateEvent(
    calendarId: string,
    uid: string,
    etag: string | null,
    draft: EventDraft,
  ): Promise<EventWriteResult> {
    const response = await this.client.updateCalendarObject({
      calendarObject: {
        url: objectUrl(calendarId, uid),
        data: buildICS({ uid, draft }),
        // If-Match: refuse the write if it changed on the server since we read
        // it, rather than silently clobbering an edit made on the phone.
        etag: etag ?? undefined,
      },
    });

    await assertOk(response, uid, "update");
    return { uid, etag: response.headers.get("etag") };
  }

  async deleteEvent(
    calendarId: string,
    uid: string,
    etag: string | null,
  ): Promise<void> {
    const response = await this.client.deleteCalendarObject({
      calendarObject: {
        url: objectUrl(calendarId, uid),
        data: "",
        etag: etag ?? undefined,
      },
    });

    // Already gone is a success — the desired state holds either way.
    if (response.status === 404) return;
    await assertOk(response, uid, "delete");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function objectUrl(calendarId: string, uid: string): string {
  return `${calendarId.replace(/\/$/, "")}/${encodeURIComponent(uid)}.ics`;
}

async function assertOk(response: Response, uid: string, action: string) {
  if (response.ok) return;

  if (response.status === 412) {
    throw new CalendarConflictError(uid);
  }
  if (response.status === 401 || response.status === 403) {
    throw new CalendarAuthError(
      `iCloud refused to ${action} the event (${response.status}). The app-specific password may have been revoked, or the calendar is read-only.`,
    );
  }

  const body = await response.text().catch(() => "");
  throw new Error(
    `iCloud ${action} failed with ${response.status} ${response.statusText}. ${body.slice(0, 300)}`,
  );
}

function readDisplayName(calendar: DAVCalendar): string {
  const name = calendar.displayName;
  if (typeof name === "string") return name;
  // Some servers return displayname as an xml-js object rather than a string.
  if (name && typeof name === "object" && "_text" in name) {
    return String((name as Record<string, unknown>)._text ?? "Untitled");
  }
  return "Untitled";
}

function isReadOnly(calendar: DAVCalendar): boolean {
  const privileges = JSON.stringify(
    (calendar as unknown as { currentUserPrivilegeSet?: unknown })
      .currentUserPrivilegeSet ?? "",
  );
  if (!privileges || privileges === '""') return false;
  return !privileges.includes("write");
}

