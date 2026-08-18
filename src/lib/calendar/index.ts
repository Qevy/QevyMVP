import { CALENDAR_PROVIDER, DEFAULT_TIMEZONE } from "@/lib/config";
import { MockCalendarProvider } from "./mock";
import type { CalendarProvider } from "./types";

export * from "./types";
export { MOCK_PLANNER_CALENDAR, MOCK_PERSONAL_CALENDAR, MOCK_WORK_CALENDAR } from "./mock";

/**
 * Resolve the calendar provider for a user.
 *
 * Phase 0 always returns the mock. Phase 2 adds the iCloud CalDAV
 * implementation behind this same call, so nothing upstream changes.
 */
export function getCalendarProvider(
  options: { zone?: string } = {},
): CalendarProvider {
  const zone = options.zone ?? DEFAULT_TIMEZONE;

  switch (CALENDAR_PROVIDER) {
    case "icloud":
      throw new Error(
        "The iCloud CalDAV provider arrives in Phase 2. Unset CALENDAR_PROVIDER to use the mock.",
      );
    case "mock":
    default:
      return new MockCalendarProvider(zone);
  }
}
