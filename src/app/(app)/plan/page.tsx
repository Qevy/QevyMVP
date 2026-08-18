import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { isLlmConfigured, modelLabel } from "@/lib/ai/provider";
import { PlanChat } from "./PlanChat";

export const metadata = { title: "Plan · Planner" };
export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const plannerReady = isLlmConfigured();

  const hasAvailability = Object.values(profile.working_hours).some(
    (windows) => windows.length > 0,
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Plan</h1>
        <p className="text-xs text-slate-500">
          Scheduling inside your available hours, around what&apos;s already on
          your calendar.
        </p>
      </header>

      {!plannerReady && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-medium">No LLM key configured.</p>
          <p className="mt-1 text-amber-200/80">
            Add <code className="font-mono text-xs">GROQ_API_KEY</code> to{" "}
            <code className="font-mono text-xs">.env.local</code> (free at
            console.groq.com), then restart the dev server.
          </p>
        </div>
      )}

      {!hasAvailability && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <p className="font-medium">Every day is marked unavailable.</p>
          <p className="mt-1 text-amber-200/80">
            There is nowhere to schedule anything.{" "}
            <Link href="/settings" className="underline underline-offset-2">
              Set your available hours
            </Link>{" "}
            first.
          </p>
        </div>
      )}

      <PlanChat
        zone={profile.timezone}
        modelLabel={modelLabel()}
        plannerReady={plannerReady && hasAvailability}
      />
    </main>
  );
}
