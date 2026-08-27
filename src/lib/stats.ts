import { DateTime } from "luxon";
import type { ScheduledBlock } from "@/lib/repository/plan";

/**
 * The numbers the dashboard shows.
 *
 * Deliberately about follow-through, not volume. "You scheduled 40 hours" is
 * a vanity metric; "you did what you said 6 times out of 9" is the thing this
 * app is actually about. Partial counts as a half — it happened, just not
 * fully, and rounding it to zero would misrepresent the week.
 */

export type FollowThrough = {
  done: number;
  partial: number;
  missed: number;
  unmarked: number;
  /** Blocks that have been resolved one way or another. */
  resolved: number;
  total: number;
  /** 0–100, or null when there is nothing to measure yet. */
  rate: number | null;
};

export function followThrough(blocks: ScheduledBlock[]): FollowThrough {
  const done = blocks.filter((b) => b.status === "done").length;
  const partial = blocks.filter((b) => b.status === "partial").length;
  const missed = blocks.filter((b) => b.status === "missed").length;
  const unmarked = blocks.filter((b) => b.status === "committed").length;
  const resolved = done + partial + missed;

  return {
    done,
    partial,
    missed,
    unmarked,
    resolved,
    total: blocks.length,
    rate: resolved === 0 ? null : Math.round(((done + partial * 0.5) / resolved) * 100),
  };
}

/**
 * Consecutive days, counting back from the most recent day that had any
 * blocks at all, on which nothing was missed.
 *
 * Days you scheduled nothing are skipped rather than breaking the run — a
 * rest day is not a failure, and treating it as one is exactly the kind of
 * guilt-tripping this app is supposed to avoid.
 */
export function consistencyRun(
  blocks: ScheduledBlock[],
  zone: string,
  now: DateTime,
): number {
  const byDay = new Map<string, ScheduledBlock[]>();
  for (const block of blocks) {
    const day = DateTime.fromISO(block.plannedStart).setZone(zone).toISODate();
    if (!day) continue;
    const list = byDay.get(day);
    if (list) list.push(block);
    else byDay.set(day, [block]);
  }

  let run = 0;
  let cursor = now.setZone(zone).startOf("day");

  // Look back at most a season; beyond that the number stops being useful.
  for (let i = 0; i < 120; i++) {
    const day = cursor.toISODate()!;
    const dayBlocks = byDay.get(day);

    if (dayBlocks && dayBlocks.length > 0) {
      const resolved = dayBlocks.filter((b) => b.status !== "committed");
      // A day still entirely unmarked is unknown, not a success.
      if (resolved.length === 0) {
        if (i > 0) break;
      } else if (resolved.some((b) => b.status === "missed")) {
        break;
      } else {
        run++;
      }
    }

    cursor = cursor.minus({ days: 1 });
  }

  return run;
}

/** How the week splits across kinds of work, biggest first. */
export function byTaskType(
  blocks: ScheduledBlock[],
): { taskType: string; minutes: number }[] {
  const totals = new Map<string, number>();

  for (const block of blocks) {
    const minutes = Math.round(
      (Date.parse(block.plannedEnd) - Date.parse(block.plannedStart)) / 60_000,
    );
    totals.set(block.taskType, (totals.get(block.taskType) ?? 0) + minutes);
  }

  return [...totals.entries()]
    .map(([taskType, minutes]) => ({ taskType, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
}
