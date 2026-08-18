import Link from "next/link";
import { DateTime } from "luxon";
import { getProfile, requireUser } from "@/lib/auth";
import { isLlmConfigured } from "@/lib/ai/provider";
import { listBlocks } from "@/lib/repository/plan";
import {
  currentCheckinPeriod,
  getCheckin,
  isCheckinDue,
  listReasons,
} from "@/lib/repository/reasons";
import { WEEKDAY_NAMES } from "@/lib/profile";
import { CheckinChat } from "./CheckinChat";

export const metadata = { title: "Check-in · Planner" };
export const dynamic = "force-dynamic";

export default async function CheckinPage() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);

  const { periodStart, periodEnd } = currentCheckinPeriod(profile, now);
  const existing = await getCheckin(user, periodStart);
  const due = isCheckinDue(profile, now);

  const blocks = await listBlocks(user, {
    from: DateTime.fromISO(periodStart, { zone }).startOf("day").toUTC().toISO()!,
    to: DateTime.fromISO(periodEnd, { zone }).plus({ days: 1 }).startOf("day").toUTC().toISO()!,
  });
  const reviewable = blocks.filter(
    (block) => block.status !== "proposed" && block.status !== "cancelled",
  );
  const done = reviewable.filter((block) => block.status === "done").length;

  // Reasons already captured for this check-in, so a resumed conversation
  // shows what it has on record rather than looking like it forgot.
  const blockTitles = new Map(reviewable.map((block) => [block.id, block.title]));
  const captured = (await listReasons(user))
    .filter((reason) => reason.checkinId === existing?.id)
    .map((reason) => ({
      blockTitle: blockTitles.get(reason.scheduledBlockId ?? "") ?? "(block)",
      reasonText: reason.reasonText,
    }))
    .reverse();

  const start = DateTime.fromISO(periodStart, { zone });
  const end = DateTime.fromISO(periodEnd, { zone });
  const periodLabel = `${start.toFormat("d LLL")} – ${end.toFormat("d LLL yyyy")}`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Weekly check-in</h1>
        <p className="text-xs text-slate-500">
          {periodLabel} · {done} of {reviewable.length} completed
        </p>
      </header>

      {existing?.status === "completed" ? (
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <p className="font-medium">This week&apos;s check-in is done.</p>
            {existing.summary && (
              <p className="mt-1 text-emerald-200/80">{existing.summary}</p>
            )}
          </div>
          <p className="text-xs text-slate-500">
            The next one opens on{" "}
            {WEEKDAY_NAMES[String(profile.checkin_weekday)]} from{" "}
            {String(profile.checkin_hour).padStart(2, "0")}:00.{" "}
            <Link href="/settings" className="text-purple-400 underline underline-offset-2">
              Change that
            </Link>
            .
          </p>
        </div>
      ) : reviewable.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          <p>Nothing was scheduled for {periodLabel}, so there is nothing to review.</p>
          <p className="mt-2 text-xs text-slate-500">
            Once you&apos;ve committed some blocks and lived a week with them, this
            is where the app asks what actually happened.{" "}
            <Link href="/plan" className="text-purple-400 underline underline-offset-2">
              Plan a week
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          {!due && (
            <p className="rounded-md border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-400">
              This check-in isn&apos;t due until{" "}
              {WEEKDAY_NAMES[String(profile.checkin_weekday)]} at{" "}
              {String(profile.checkin_hour).padStart(2, "0")}:00 — you can start
              it early if you want.
            </p>
          )}

          {!isLlmConfigured() && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              No LLM key configured, so the conversation can&apos;t run. Add
              GROQ_API_KEY to .env.local.
            </p>
          )}

          <CheckinChat
            ready={isLlmConfigured()}
            openingPrompt={`Let's do my weekly check-in for ${periodLabel}.`}
            initialTranscript={existing?.transcript ?? []}
            initialCaptured={captured}
          />
        </>
      )}
    </main>
  );
}
