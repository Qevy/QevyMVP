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
        <h1 className="text-xl font-semibold text-text">Patterns</h1>
        <p className="max-w-2xl text-xs text-text-faint">
          Everything here comes from what you said in a check-in. Nothing is
          inferred, and every rule shows the words behind it.
        </p>
      </header>

      {totalReasons === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong p-4 text-sm text-text-dim">
          <p>No reasons recorded yet.</p>
          <p className="mt-2 text-xs text-text-faint">
            After a{" "}
            <Link href="/checkin" className="text-text underline underline-offset-2">
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
              <h2 className="text-sm font-semibold text-text">
                Active rules
              </h2>
              <p className="text-xs text-text-faint">
                The planner will not schedule these task types in these slots.
              </p>
            </div>

            {rules.length === 0 ? (
              <p className="rounded-card border border-dashed border-line-strong p-4 text-xs text-text-faint">
                Nothing has been said {DEFAULT_MIN_REASONS} times yet, so there
                is no rule to apply.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {rules.map((rule) => (
                  <li
                    key={rule.key}
                    className={cn(
                      "rounded-card border p-4",
                      rule.muted
                        ? "border-line bg-surface opacity-60"
                        : "border-line-strong bg-surface",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm text-text">
                          Avoid{" "}
                          <span className="font-medium">{rule.taskType}</span> in
                          the{" "}
                          <span className="font-medium">
                            {SLOT_BUCKET_LABELS[rule.bucket].toLowerCase()}
                          </span>
                        </p>
                        <p className="text-xs text-text-faint">
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
                          className="rounded-md border border-line-strong px-2.5 py-1.5 text-xs text-text-dim transition hover:border-line-strong hover:text-text"
                        >
                          {rule.muted ? "Switch on" : "Switch off"}
                        </button>
                      </form>
                    </div>

                    <ul className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
                      {rule.reasons.map((reason) => (
                        <li key={reason.id} className="text-xs text-text-dim">
                          <span className="text-text-faint">
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
                <h2 className="text-sm font-semibold text-text">
                  Watching
                </h2>
                <p className="text-xs text-text-faint">
                  Said once so far. Becomes a rule if it happens again — one
                  bad week is not a pattern.
                </p>
              </div>
              <ul className="rounded-card border border-line bg-surface px-4">
                {emerging.map((pattern) => (
                  <li
                    key={pattern.key}
                    className="border-b border-line py-3 text-xs last:border-b-0"
                  >
                    <p className="text-text-dim">
                      {pattern.taskType} ·{" "}
                      {SLOT_BUCKET_LABELS[pattern.bucket].toLowerCase()}
                    </p>
                    {pattern.reasons.map((reason) => (
                      <p key={reason.id} className="mt-1 text-text-faint">
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
