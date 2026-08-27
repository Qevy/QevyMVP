import Link from "next/link";
import { DateTime } from "luxon";
import { getProfile, requireUser } from "@/lib/auth";
import { listBlocks, type ScheduledBlock } from "@/lib/repository/plan";
import { getAdaptation } from "@/lib/repository/adaptation";
import { activeRules } from "@/lib/adaptation/rules";
import {
  currentCheckinPeriod,
  getCheckin,
  isCheckinDue,
} from "@/lib/repository/reasons";
import { followThrough, consistencyRun, byTaskType } from "@/lib/stats";
import { SLOT_BUCKET_LABELS } from "@/lib/time";
import { DonutRing, WeekBars, Sparkline, type DayBar } from "@/components/dashboard/Charts";
import { AssistantPanel } from "@/components/dashboard/AssistantPanel";
import {
  BarsIcon,
  FlameIcon,
  ChevronRightIcon,
  PlanIcon,
} from "@/components/icons";

export const metadata = { title: "Planner" };
export const dynamic = "force-dynamic";

const CATEGORY_COLORS = [
  "var(--color-cat-violet)",
  "var(--color-cat-blue)",
  "var(--color-cat-amber)",
  "var(--color-cat-green)",
  "var(--color-cat-pink)",
];

export default async function DashboardPage() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);
  // A real name if they gave one; otherwise greet without one rather than
  // addressing them by an email stub.
  const name = profile.display_name?.trim() || null;

  const dayStart = now.startOf("day");
  const weekStart = now.startOf("week");

  const [today, thisWeek, recent, adaptation] = await Promise.all([
    listBlocks(user, {
      from: dayStart.toUTC().toISO()!,
      to: dayStart.plus({ days: 1 }).toUTC().toISO()!,
    }),
    listBlocks(user, {
      from: weekStart.toUTC().toISO()!,
      to: weekStart.plus({ days: 7 }).toUTC().toISO()!,
    }),
    listBlocks(user, {
      from: now.minus({ days: 60 }).toUTC().toISO()!,
      to: now.plus({ days: 14 }).toUTC().toISO()!,
    }),
    getAdaptation(user),
  ]);

  const week = followThrough(thisWeek);
  const run = consistencyRun(recent, zone, now);
  const rules = activeRules(adaptation.rules);

  const todayDone = today.filter((b) => b.status === "done").length;
  const todayRemaining = today.filter((b) => b.status === "committed").length;

  // Days on track: a day with blocks where nothing was missed.
  const dayGroups = groupByDay(thisWeek, zone);
  const daysOnTrack = [...dayGroups.values()].filter(
    (blocks) =>
      blocks.some((b) => b.status !== "committed") &&
      !blocks.some((b) => b.status === "missed"),
  ).length;
  const daysMissed = [...dayGroups.values()].filter((blocks) =>
    blocks.some((b) => b.status === "missed"),
  ).length;

  const bars: DayBar[] = Array.from({ length: 7 }, (_, i) => {
    const day = weekStart.plus({ days: i });
    const key = day.toISODate()!;
    const blocks = dayGroups.get(key) ?? [];
    const minutes = blocks.reduce(
      (sum, b) => sum + (Date.parse(b.plannedEnd) - Date.parse(b.plannedStart)) / 60_000,
      0,
    );
    return {
      label: day.toFormat("ccc"),
      hours: Math.round((minutes / 60) * 10) / 10,
      isToday: key === now.toISODate(),
    };
  });

  const split = byTaskType(thisWeek).slice(0, 4);
  const splitMax = split[0]?.minutes ?? 1;

  const upcoming = recent
    .filter(
      (b) =>
        b.status === "committed" &&
        DateTime.fromISO(b.plannedStart).setZone(zone) >= now,
    )
    .slice(0, 4);

  const { periodStart } = currentCheckinPeriod(profile, now);
  const checkin = await getCheckin(user, periodStart);
  const checkinWaiting = isCheckinDue(profile, now) && checkin?.status !== "completed";

  const trend = bars.map((b) => b.hours);
  const bestBucket = bestPerformingBucket(recent);

  const greeting =
    now.hour < 5 ? "Still up" : now.hour < 12 ? "Good morning" : now.hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-text lg:text-[30px]">
            {greeting}{name ? `, ${name}` : ""} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-sm text-text-dim">
            Here&apos;s your overview for {now.toFormat("cccc, d LLLL")}
          </p>
        </div>
      </header>

      {checkinWaiting && (
        <Link
          href="/checkin"
          className="card mb-5 flex items-center justify-between gap-4 p-4 transition hover:border-line-strong"
        >
          <span>
            <span className="block text-sm font-medium text-text">
              Your week is ready to review
            </span>
            <span className="block text-xs text-text-dim">
              A few minutes talking through what actually happened
            </span>
          </span>
          <ChevronRightIcon className="size-5 shrink-0 text-text-faint" />
        </Link>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr_320px]">
        {/* ---- Consistency ---- */}
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-medium text-text">Consistency this week</h2>
            <BarsIcon className="size-[18px] text-text-faint" />
          </div>
          <div className="flex items-center gap-5">
            <DonutRing
              percent={week.rate}
              label={week.rate === null ? "—" : `${week.rate}%`}
              caption={ratingFor(week.rate)}
            />
            <dl className="flex flex-col gap-3">
              <Stat value={daysOnTrack} label="Days on track" />
              <Stat value={daysMissed} label="Days missed" />
              <Stat value={week.resolved} label="Blocks logged" />
            </dl>
          </div>
        </section>

        {/* ---- Today ---- */}
        <section className="card flex flex-col p-5">
          <h2 className="text-[15px] font-medium text-text">Today</h2>
          <div className="mt-4">
            <p className="tabular text-[40px] leading-none font-semibold text-text">
              {today.length}
            </p>
            <p className="mt-1 text-sm text-text-dim">
              {today.length === 1 ? "Block scheduled" : "Blocks scheduled"}
            </p>
          </div>
          <div className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-4">
            <Split value={todayDone} label="Completed" color="var(--color-good)" />
            <Split value={todayRemaining} label="Remaining" color="var(--color-warn)" />
          </div>
        </section>

        {/* ---- Streak ---- */}
        <section className="card flex flex-col p-5">
          <h2 className="text-[15px] font-medium text-text">Current streak</h2>
          <span
            className="mt-4 grid size-14 place-items-center rounded-2xl"
            style={{ background: "rgba(124,92,255,0.15)" }}
          >
            <FlameIcon className="size-7 text-cat-pink" />
          </span>
          <p className="tabular mt-4 text-[40px] leading-none font-semibold text-text">
            {run}
          </p>
          <p className="mt-1 text-sm text-text-dim">
            {run === 1 ? "Day in a row" : "Days in a row"}
          </p>
          <p className="mt-auto pt-4 text-xs text-text-faint">
            {run === 0
              ? "Mark something done today to start one"
              : "Days you missed nothing you scheduled"}
          </p>
        </section>

        {/* ---- Assistant ---- */}
        <section className="xl:row-span-2">
          <AssistantPanel name={name ?? "there"} />
        </section>

        {/* ---- This week ---- */}
        <section className="card p-5 xl:col-span-2">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[15px] font-medium text-text">This week</h2>
            <span className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs text-text-dim">
              Hours scheduled
            </span>
          </div>
          <WeekBars days={bars} target={targetHours(profile)} />
        </section>

        {/* ---- What you worked on ---- */}
        <section className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-medium text-text">What you worked on</h2>
            <Link href="/week" className="text-xs text-text-dim hover:text-text">
              View all
            </Link>
          </div>

          {split.length === 0 ? (
            <p className="text-sm text-text-faint">Nothing scheduled this week yet.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {split.map((entry, i) => (
                <li key={entry.taskType} className="flex items-center gap-3">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-xl text-white"
                    style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                  >
                    <PlanIcon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-text capitalize">
                        {entry.taskType}
                      </span>
                      <span className="tabular text-xs text-text-dim">
                        {Math.round((entry.minutes / 60) * 10) / 10}h
                      </span>
                    </span>
                    <span className="mt-1.5 block h-1.5 rounded-full bg-surface-3">
                      <span
                        className="block h-1.5 rounded-full"
                        style={{
                          width: `${Math.max(8, (entry.minutes / splitMax) * 100)}%`,
                          background: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
                        }}
                      />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---- Upcoming ---- */}
        <section className="card p-5 xl:col-span-2">
          <h2 className="mb-4 text-[15px] font-medium text-text">Upcoming</h2>

          {upcoming.length === 0 ? (
            <div className="py-2">
              <p className="text-sm text-text-dim">Nothing scheduled ahead.</p>
              <Link href="/plan" className="mt-1 inline-block text-xs text-accent-soft">
                Plan something →
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col">
              {upcoming.map((block, i) => {
                const start = DateTime.fromISO(block.plannedStart).setZone(zone);
                const relative = start.hasSame(now, "day")
                  ? "Today"
                  : start.hasSame(now.plus({ days: 1 }), "day")
                    ? "Tomorrow"
                    : start.toFormat("ccc, d LLL");
                return (
                  <li key={block.id}>
                    <Link
                      href="/today"
                      className="flex items-center gap-3 border-b border-line py-3.5 last:border-b-0"
                    >
                      <span className="size-[18px] shrink-0 rounded-full border-[1.5px] border-line-strong" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">
                          {block.title}
                        </span>
                        <span
                          className="block text-xs capitalize"
                          style={{ color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                        >
                          {block.taskType}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-text-dim">
                        {relative}
                        <span
                          className="size-1.5 rounded-full"
                          style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                        />
                      </span>
                      <ChevronRightIcon className="size-4 shrink-0 text-text-faint" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ---- Insights ---- */}
        <section className="card flex flex-col p-5">
          <h2 className="text-[15px] font-medium text-text">Insights</h2>
          <div className="my-4">
            <Sparkline points={trend} />
          </div>

          {rules.length > 0 ? (
            <>
              <p className="text-sm text-text-dim">You keep missing</p>
              <p className="text-lg font-semibold text-text">
                {sentenceCase(rules[0].taskType)} in the{" "}
                {SLOT_BUCKET_LABELS[rules[0].bucket].split(" (")[0].toLowerCase()}
              </p>
              <p className="mt-2 line-clamp-2 text-xs text-text-faint italic">
                &ldquo;{rules[0].reasons[0].reasonText}&rdquo;
              </p>
              <Link href="/patterns" className="mt-auto pt-3 text-xs text-accent-soft">
                See all patterns →
              </Link>
            </>
          ) : bestBucket ? (
            <>
              <p className="text-sm text-text-dim">You get most done</p>
              <p className="text-lg font-semibold text-text">
                in the {SLOT_BUCKET_LABELS[bestBucket].split(" (")[0].toLowerCase()}
              </p>
              <p className="mt-auto pt-3 text-xs text-text-faint">
                Based on what you actually completed.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-text-dim">Not enough history yet</p>
              <p className="mt-1 text-xs text-text-faint">
                Mark a few blocks done or missed and patterns start showing up here.
              </p>
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <dd className="tabular text-xl font-semibold text-text">{value}</dd>
      <dt className="text-xs text-text-dim">{label}</dt>
    </div>
  );
}

function Split({
  value,
  label,
  color,
}: {
  value: number;
  label: string;
  color: string;
}) {
  return (
    <div>
      <p className="tabular text-xl font-semibold" style={{ color }}>
        {value}
      </p>
      <p className="flex items-center gap-1.5 text-xs text-text-dim">
        <span className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </p>
    </div>
  );
}

/** First letter only — "Editing in the early morning", not Title Case. */
function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ratingFor(rate: number | null) {
  if (rate === null) return "No data";
  if (rate >= 80) return "Strong";
  if (rate >= 55) return "Steady";
  if (rate >= 30) return "Patchy";
  return "Slipping";
}

function groupByDay(blocks: ScheduledBlock[], zone: string) {
  const map = new Map<string, ScheduledBlock[]>();
  for (const block of blocks) {
    const key = DateTime.fromISO(block.plannedStart).setZone(zone).toISODate();
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(block);
    else map.set(key, [block]);
  }
  return map;
}

/** Rough daily ceiling from the availability windows, so the target is theirs. */
function targetHours(profile: { working_hours: Record<string, { start: string; end: string }[]> }) {
  const spans = Object.values(profile.working_hours).flatMap((windows) =>
    windows.map((w) => {
      const [sh, sm] = w.start.split(":").map(Number);
      const [eh, em] = w.end.split(":").map(Number);
      return eh + em / 60 - (sh + sm / 60);
    }),
  );
  if (spans.length === 0) return 8;
  return Math.max(2, Math.round(spans.reduce((a, b) => a + b, 0) / spans.length / 2));
}

/** The slot with the best completion record — the opposite of a rule. */
function bestPerformingBucket(blocks: ScheduledBlock[]) {
  const tally = new Map<string, { done: number; total: number }>();

  for (const block of blocks) {
    if (block.status === "committed" || block.status === "proposed") continue;
    const entry = tally.get(block.bucket) ?? { done: 0, total: 0 };
    entry.total++;
    if (block.status === "done") entry.done++;
    tally.set(block.bucket, entry);
  }

  let best: { bucket: string; rate: number } | null = null;
  for (const [bucket, { done, total }] of tally) {
    if (total < 2) continue;
    const rate = done / total;
    if (!best || rate > best.rate) best = { bucket, rate };
  }

  return best && best.rate > 0.5
    ? (best.bucket as keyof typeof SLOT_BUCKET_LABELS)
    : null;
}
