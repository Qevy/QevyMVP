import Link from "next/link";
import { getProfile, requireUser } from "@/lib/auth";
import { isLlmConfigured, modelLabel } from "@/lib/ai/provider";
import { PlanChat } from "./PlanChat";

export const metadata = { title: "Plan · Planner" };
export const dynamic = "force-dynamic";

export default async function PlanPage(props: PageProps<"/plan">) {
  const searchParams = await props.searchParams;
  const raw = searchParams.say;
  // Arrives from the dashboard mic (a transcript) or a suggestion pill.
  const opening = typeof raw === "string" ? raw.slice(0, 500) : undefined;

  const user = await requireUser();
  const profile = await getProfile(user);
  const plannerReady = isLlmConfigured();

  const hasAvailability = Object.values(profile.working_hours).some(
    (windows) => windows.length > 0,
  );

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-text">Plan</h1>
        <p className="text-xs text-text-faint">
          Scheduling inside your available hours, around what&apos;s already on
          your calendar.
        </p>
      </header>

      {!plannerReady && (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
          <p className="font-medium">No LLM key configured.</p>
          <p className="mt-1 text-text-dim">
            Add <code className="font-mono text-xs">GROQ_API_KEY</code> to{" "}
            <code className="font-mono text-xs">.env.local</code> (free at
            console.groq.com), then restart the dev server.
          </p>
        </div>
      )}

      {!hasAvailability && (
        <div className="rounded-md border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
          <p className="font-medium">Every day is marked unavailable.</p>
          <p className="mt-1 text-text-dim">
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
        opening={opening}
      />
    </main>
  );
}
