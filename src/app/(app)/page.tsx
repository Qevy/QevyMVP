import Link from "next/link";
import { DateTime } from "luxon";
import { WeekGrid } from "@/components/WeekGrid";
import { SetupChecklist } from "@/components/SetupChecklist";
import { getProfile, requireUser } from "@/lib/auth";
import { getProviderForUser } from "@/lib/calendar/connection";
import type { CalendarEvent } from "@/lib/calendar/types";
import {
  getCalendarSettings,
  readableCalendarIds,
} from "@/lib/calendar/registry";
import { weekWindow } from "@/lib/time";

// The calendar is external state, and this page is where you check whether a
// block actually landed. Never serve it from cache.
export const dynamic = "force-dynamic";

export default async function WeekPage() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const zone = profile.timezone;

  const { provider, connected } = await getProviderForUser(user, { zone });
  const { from, to, days } = weekWindow(DateTime.now(), zone);

  // When iCloud is connected we read only the calendars the user ticked;
  // the mock has no registry, so read everything it offers.
  const settings = connected ? await getCalendarSettings(user) : [];
  const calendarIds = connected
    ? readableCalendarIds(settings)
    : (await provider.listCalendars()).map((calendar) => calendar.id);

  const plannerIds = connected
    ? settings.filter((s) => s.isPlanner).map((s) => s.providerId)
    : [(await provider.ensurePlannerCalendar("Planner")).id];

  let events: CalendarEvent[] = [];
  let loadError: string | null = null;
  try {
    events = await provider.listEvents(calendarIds, from, to);
  } catch (error) {
    // A calendar outage should degrade to an empty grid with an explanation,
    // not a crashed page.
    loadError =
      error instanceof Error ? error.message : "Could not reach the calendar";
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">This week</h1>
          <p className="text-xs text-slate-500">
            {days[0].toFormat("d LLL")} – {days[6].toFormat("d LLL yyyy")} · {zone}
          </p>
        </div>
        {!connected && (
          <Link
            href="/settings/calendar"
            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition hover:border-amber-400"
          >
            Sample data — connect iCloud →
          </Link>
        )}
      </header>

      {loadError && (
        <p role="alert" className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          {loadError}
        </p>
      )}

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 sm:p-4">
        <WeekGrid
          days={days}
          events={events}
          zone={zone}
          plannerCalendarIds={plannerIds}
        />
      </div>

      <SetupChecklist calendarConnected={connected} />
    </main>
  );
}
