import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { getConnection } from "@/lib/calendar/connection";
import { SettingsForm } from "./SettingsForm";

export const metadata = { title: "Settings · Planner" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const connection = await getConnection(user);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
        {user.isPreview && (
          <p className="mt-1 text-xs text-amber-300/80">
            Preview mode — changes are held in memory and reset when the dev
            server restarts.
          </p>
        )}
      </header>

      <Link
        href="/settings/calendar"
        className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4 transition hover:border-slate-600"
      >
        <span>
          <span className="block text-sm font-medium text-slate-200">
            iCloud Calendar
          </span>
          <span className="block text-xs text-slate-500">
            {connection
              ? `Connected as ${connection.appleId}`
              : "Not connected — using sample data"}
          </span>
        </span>
        <span aria-hidden className="text-slate-600">
          →
        </span>
      </Link>

      <SettingsForm profile={profile} />
    </main>
  );
}
