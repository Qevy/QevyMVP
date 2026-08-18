import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { getConnection } from "@/lib/calendar/connection";
import { getCalendarSettings } from "@/lib/calendar/registry";
import { isEncryptionConfigured } from "@/lib/crypto";
import { PLANNER_CALENDAR_NAME } from "@/lib/config";
import { ConnectForm } from "./ConnectForm";
import { TestWriteButton } from "./TestWriteButton";
import {
  createPlannerCalendar,
  disconnectICloud,
  refreshCalendars,
  toggleCalendarRead,
} from "./actions";

export const metadata = { title: "Calendar · Planner" };
export const dynamic = "force-dynamic";

export default async function CalendarSettingsPage() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const connection = await getConnection(user);
  const calendars = connection ? await getCalendarSettings(user) : [];
  const planner = calendars.find((calendar) => calendar.isPlanner);
  const encryptionReady = isEncryptionConfigured();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-1">
        <Link href="/settings" className="text-xs text-slate-500 hover:text-slate-300">
          ← Settings
        </Link>
        <h1 className="text-xl font-semibold text-slate-100">iCloud Calendar</h1>
        <p className="text-sm text-slate-500">
          Read your fixed commitments, and write scheduled blocks to a
          calendar of their own.
        </p>
      </header>

      {!encryptionReady && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-medium">Set APP_ENCRYPTION_KEY first.</p>
          <p className="mt-1 text-amber-200/80">
            Your app-specific password is encrypted before it&apos;s stored, and
            that needs a key. One command:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-950/60 p-2 font-mono text-[11px] text-amber-100">
            node -e &quot;console.log(require(&apos;crypto&apos;).randomBytes(32).toString(&apos;base64&apos;))&quot;
          </pre>
        </div>
      )}

      {!connection ? (
        <ConnectForm defaultAppleId={undefined} />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <div>
                <p className="text-sm text-slate-200">
                  Connected as{" "}
                  <span className="font-medium">{connection.appleId}</span>
                </p>
                <p className="text-xs text-slate-500">
                  {connection.lastVerifiedAt
                    ? `Last verified ${new Date(connection.lastVerifiedAt).toLocaleString()}`
                    : "Not yet verified"}
                </p>
              </div>
              <form action={disconnectICloud}>
                <button
                  type="submit"
                  className="rounded-md border border-rose-500/40 px-3 py-2 text-xs text-rose-300 transition hover:border-rose-400"
                >
                  Disconnect
                </button>
              </form>
            </div>
            <p className="text-xs text-slate-600">
              Disconnecting deletes the stored password here. To revoke it at
              Apple&apos;s end too, delete the entry at account.apple.com.
            </p>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">
                  Calendars to read
                </h2>
                <p className="text-xs text-slate-500">
                  Blocks are scheduled around everything ticked here.
                </p>
              </div>
              <form action={refreshCalendars}>
                <button
                  type="submit"
                  className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-500"
                >
                  Refresh list
                </button>
              </form>
            </div>

            <ul className="rounded-lg border border-slate-800 bg-slate-900/40">
              {calendars.length === 0 && (
                <li className="p-4 text-xs text-slate-500">
                  No calendars found. Try Refresh list.
                </li>
              )}
              {calendars.map((calendar) => (
                <li
                  key={calendar.providerId}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/60 p-3 last:border-b-0"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: calendar.color ?? "#64748b" }}
                    />
                    <span className="truncate text-sm text-slate-200">
                      {calendar.displayName}
                    </span>
                    {calendar.isPlanner && (
                      <span className="rounded-full border border-purple-400/40 bg-purple-500/10 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                        Planner
                      </span>
                    )}
                  </div>

                  <form action={toggleCalendarRead}>
                    <input
                      type="hidden"
                      name="provider_id"
                      value={calendar.providerId}
                    />
                    <input
                      type="hidden"
                      name="enabled"
                      value={String(!calendar.readEnabled)}
                    />
                    <button
                      type="submit"
                      className={
                        calendar.readEnabled
                          ? "rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300"
                          : "rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-500"
                      }
                    >
                      {calendar.readEnabled ? "Reading" : "Ignored"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">
                Where blocks get written
              </h2>
              <p className="max-w-xl text-xs text-slate-500">
                A calendar of its own, named {PLANNER_CALENDAR_NAME}. It shows up
                alongside your others on your phone, and you can hide or delete
                all of it at once without touching a real commitment.
              </p>
            </div>

            {planner ? (
              <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="text-sm text-slate-200">
                  Writing to{" "}
                  <span className="font-medium">{planner.displayName}</span>
                </p>
                <TestWriteButton />
              </div>
            ) : (
              <form action={createPlannerCalendar}>
                <button
                  type="submit"
                  className="rounded-md bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500"
                >
                  Create the {PLANNER_CALENDAR_NAME} calendar
                </button>
              </form>
            )}
          </section>
        </>
      )}
    </main>
  );
}
