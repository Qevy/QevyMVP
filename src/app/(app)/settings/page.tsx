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
        <h1 className="text-xl font-semibold text-text">Settings</h1>
        {user.isPreview && (
          <p className="mt-1 text-xs text-text-dim">
            Preview mode — changes are held in memory and reset when the dev
            server restarts.
          </p>
        )}
      </header>

      <Link
        href="/settings/calendar"
        className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-4 transition hover:border-line-strong"
      >
        <span>
          <span className="block text-sm font-medium text-text">
            iCloud Calendar
          </span>
          <span className="block text-xs text-text-faint">
            {connection
              ? `Connected as ${connection.appleId}`
              : "Not connected — using sample data"}
          </span>
        </span>
        <span aria-hidden className="text-text-faint">
          →
        </span>
      </Link>

      <SettingsForm profile={profile} />
    </main>
  );
}
