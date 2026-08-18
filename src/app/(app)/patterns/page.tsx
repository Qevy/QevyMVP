import Link from "next/link";
import { DateTime } from "luxon";
import { getProfile, requireUser } from "@/lib/auth";
import { getAdaptation } from "@/lib/repository/adaptation";
import { DEFAULT_MIN_REASONS } from "@/lib/adaptation/rules";
import { SLOT_BUCKET_LABELS } from "@/lib/time";
import { cn } from "@/lib/ui";
import { toggleRule } from "./actions";

export const metadata = { title: "Patterns · Planner" };
export const dynamic = "force-dynamic";

export default async function PatternsPage() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const { rules, emerging, totalReasons } = await getAdaptation(user);

  const stated = (iso: string) =>
    DateTime.fromISO(iso).setZone(profile.timezone).toFormat("d LLL");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Patterns</h1>
        <p className="max-w-2xl text-xs text-slate-500">
          Everything here comes from what you said in a check-in. Nothing is
          inferred, and every rule shows the words behind it.
        </p>
      </header>

      {totalReasons === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          <p>No reasons recorded yet.</p>
          <p className="mt-2 text-xs text-slate-500">
            After a{" "}
            <Link href="/checkin" className="text-purple-400 underline underline-offset-2">
              weekly check-in
            </Link>
            , the times that repeatedly do not work for you show up here — and
            the planner starts avoiding them.
          </p>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">
                Active rules
              </h2>
              <p className="text-xs text-slate-500">
                The planner will not schedule these task types in these slots.
              </p>
            </div>

            {rules.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-700 p-4 text-xs text-slate-500">
                Nothing has been said {DEFAULT_MIN_REASONS} times yet, so there
                is no rule to apply.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {rules.map((rule) => (
                  <li
                    key={rule.key}
                    className={cn(
                      "rounded-lg border p-4",
                      rule.muted
                        ? "border-slate-800 bg-slate-900/30 opacity-60"
                        : "border-purple-500/30 bg-purple-500/5",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-100">
                          Avoid{" "}
                          <span className="font-medium">{rule.taskType}</span> in
                          the{" "}
                          <span className="font-medium">
                            {SLOT_BUCKET_LABELS[rule.bucket].toLowerCase()}
                          </span>
                        </p>
                        <p className="text-xs text-slate-500">
                          Missed {rule.confidenceCount} times
                          {rule.muted && " · switched off"}
                        </p>
                      </div>

                      <form action={toggleRule}>
                        <input type="hidden" name="rule_key" value={rule.key} />
                        <input
                          type="hidden"
                          name="muted"
                          value={String(!rule.muted)}
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                        >
                          {rule.muted ? "Switch on" : "Switch off"}
                        </button>
                      </form>
                    </div>

                    <ul className="mt-3 flex flex-col gap-1.5 border-t border-slate-800 pt-3">
                      {rule.reasons.map((reason) => (
                        <li key={reason.id} className="text-xs text-slate-400">
                          <span className="text-slate-600">
                            {stated(reason.statedAt)}
                          </span>{" "}
                          &ldquo;{reason.reasonText}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {emerging.length > 0 && (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-200">
                  Watching
                </h2>
                <p className="text-xs text-slate-500">
                  Said once so far. Becomes a rule if it happens again — one
                  bad week is not a pattern.
                </p>
              </div>
              <ul className="rounded-lg border border-slate-800 bg-slate-900/40 px-4">
                {emerging.map((pattern) => (
                  <li
                    key={pattern.key}
                    className="border-b border-slate-800/60 py-3 text-xs last:border-b-0"
                  >
                    <p className="text-slate-300">
                      {pattern.taskType} ·{" "}
                      {SLOT_BUCKET_LABELS[pattern.bucket].toLowerCase()}
                    </p>
                    {pattern.reasons.map((reason) => (
                      <p key={reason.id} className="mt-1 text-slate-500">
                        &ldquo;{reason.reasonText}&rdquo;
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
