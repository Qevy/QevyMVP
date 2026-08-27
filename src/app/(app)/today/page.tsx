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
  done: "border-good/40 bg-good/10 text-good",
  missed: "border-bad/40 bg-bad/10 text-bad",
  partial: "border-warn/40 bg-warn/10 text-warn",
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
            : "border-line-strong text-text-dim hover:border-line-strong hover:text-text",
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
    <li className="flex flex-col gap-3 border-b border-line py-3 last:border-b-0">
      <div>
        <p className="text-sm text-text">{block.title}</p>
        <p className="text-xs text-text-faint">
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
        <h1 className="text-xl font-semibold text-text">Today</h1>
        <p className="text-xs text-text-faint">{now.toFormat("cccc d LLLL")}</p>
      </header>

      {checkinDue && (
        <Link
          href="/checkin"
          className="flex items-center justify-between gap-3 rounded-card border border-line-strong bg-surface p-4 transition hover:border-line-strong"
        >
          <span>
            <span className="block text-sm font-medium text-text">
              Weekly check-in is ready
            </span>
            <span className="block text-xs text-text-dim">
              Go through what happened last week
            </span>
          </span>
          <span aria-hidden className="text-text-dim">
            →
          </span>
        </Link>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-text-dim">
          Scheduled today
        </h2>
        {blocks.length === 0 ? (
          <p className="rounded-card border border-dashed border-line-strong p-4 text-xs text-text-faint">
            Nothing scheduled today.{" "}
            <Link href="/plan" className="text-text underline underline-offset-2">
              Plan something
            </Link>
            .
          </p>
        ) : (
          <ul className="rounded-card border border-line bg-surface px-4">
            {blocks.map((block) => (
              <BlockRow key={block.id} block={block} zone={zone} />
            ))}
          </ul>
        )}
      </section>

      {earlier.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-text-dim">
            Still unmarked from this week
          </h2>
          <p className="mb-2 text-xs text-text-faint">
            Marking these now saves the check-in asking about them.
          </p>
          <ul className="rounded-card border border-line bg-surface px-4">
            {earlier.map((block) => (
              <BlockRow key={block.id} block={block} zone={zone} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
