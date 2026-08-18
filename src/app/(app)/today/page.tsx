import Link from "next/link";
import { DateTime } from "luxon";
import { getProfile, requireUser } from "@/lib/auth";
import { listBlocks, type ScheduledBlock } from "@/lib/repository/plan";
import { isCheckinDue } from "@/lib/repository/reasons";
import { cn } from "@/lib/ui";
import { markBlock } from "./actions";

export const metadata = { title: "Today · Planner" };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  missed: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

function MarkButton({
  blockId,
  status,
  label,
  active,
}: {
  blockId: string;
  status: string;
  label: string;
  active: boolean;
}) {
  return (
    <form action={markBlock}>
      <input type="hidden" name="block_id" value={blockId} />
      {/* Tapping the active state again clears it. */}
      <input type="hidden" name="status" value={active ? "committed" : status} />
      <button
        type="submit"
        aria-pressed={active}
        className={cn(
          "rounded-md border px-3 py-2 text-xs font-medium transition",
          active
            ? STATUS_STYLE[status]
            : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200",
        )}
      >
        {label}
      </button>
    </form>
  );
}

function BlockRow({ block, zone }: { block: ScheduledBlock; zone: string }) {
  const start = DateTime.fromISO(block.plannedStart).setZone(zone);
  const end = DateTime.fromISO(block.plannedEnd).setZone(zone);

  return (
    <li className="flex flex-col gap-3 border-b border-slate-800/60 py-3 last:border-b-0">
      <div>
        <p className="text-sm text-slate-100">{block.title}</p>
        <p className="text-xs text-slate-500">
          {start.toFormat("HH:mm")}–{end.toFormat("HH:mm")} · {block.taskType}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <MarkButton blockId={block.id} status="done" label="Done" active={block.status === "done"} />
        <MarkButton blockId={block.id} status="partial" label="Partly" active={block.status === "partial"} />
        <MarkButton blockId={block.id} status="missed" label="Missed" active={block.status === "missed"} />
      </div>
    </li>
  );
}

export default async function TodayPage() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);

  const dayStart = now.startOf("day");
  const blocks = await listBlocks(user, {
    from: dayStart.toUTC().toISO()!,
    to: dayStart.plus({ days: 1 }).toUTC().toISO()!,
  });

  // Anything still unmarked from earlier in the week is what the weekly
  // check-in will ask about, so surface it here first.
  const weekStart = now.startOf("week");
  const earlier = (
    await listBlocks(user, {
      from: weekStart.toUTC().toISO()!,
      to: dayStart.toUTC().toISO()!,
    })
  ).filter((block) => block.status === "committed");

  const checkinDue = isCheckinDue(profile, now);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-100">Today</h1>
        <p className="text-xs text-slate-500">{now.toFormat("cccc d LLLL")}</p>
      </header>

      {checkinDue && (
        <Link
          href="/checkin"
          className="flex items-center justify-between gap-3 rounded-lg border border-purple-500/40 bg-purple-500/10 p-4 transition hover:border-purple-400"
        >
          <span>
            <span className="block text-sm font-medium text-purple-200">
              Weekly check-in is ready
            </span>
            <span className="block text-xs text-purple-200/70">
              Go through what happened last week
            </span>
          </span>
          <span aria-hidden className="text-purple-300">
            →
          </span>
        </Link>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">
          Scheduled today
        </h2>
        {blocks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 p-4 text-xs text-slate-500">
            Nothing scheduled today.{" "}
            <Link href="/plan" className="text-purple-400 underline underline-offset-2">
              Plan something
            </Link>
            .
          </p>
        ) : (
          <ul className="rounded-lg border border-slate-800 bg-slate-900/40 px-4">
            {blocks.map((block) => (
              <BlockRow key={block.id} block={block} zone={zone} />
            ))}
          </ul>
        )}
      </section>

      {earlier.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-300">
            Still unmarked from this week
          </h2>
          <p className="mb-2 text-xs text-slate-500">
            Marking these now saves the check-in asking about them.
          </p>
          <ul className="rounded-lg border border-slate-800 bg-slate-900/40 px-4">
            {earlier.map((block) => (
              <BlockRow key={block.id} block={block} zone={zone} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
