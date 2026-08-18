/**
 * Seed a finished week of blocks into the LOCAL preview store so the weekly
 * check-in and adaptation can be exercised without waiting a real week.
 *
 * Writes nothing to iCloud. Remove with: npm run seed:week -- --clear
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DateTime } from "luxon";
import { currentCheckinPeriod } from "../src/lib/repository/reasons";
import type { Profile } from "../src/lib/profile";

const ZONE = process.env.DEFAULT_TIMEZONE ?? "America/Chicago";
const USER = "00000000-0000-0000-0000-000000000001";
const storePath = join(process.cwd(), ".preview-store.json");
const store = JSON.parse(readFileSync(storePath, "utf8"));

if (process.argv.includes("--clear")) {
  for (const key of Object.keys(store)) {
    if (/^(blocks|tasks|reasons|checkins):/.test(key)) store[key] = [];
  }
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  console.log("Cleared seeded blocks, tasks, reasons and check-ins.");
  process.exit(0);
}

const BUCKETS: Record<number, string> = {};
function bucketFor(hour: number): string {
  if (hour >= 5 && hour < 8) return "early_morning";
  if (hour >= 8 && hour < 12) return "morning";
  if (hour >= 12 && hour < 14) return "midday";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

// Derive the window from the app's own function rather than re-deriving it.
// A seed script that computes the period independently will drift from the
// check-in and silently seed the wrong week.
const seedProfile = {
  timezone: ZONE,
  working_hours: {},
  buffer_minutes: 15,
  checkin_weekday: Number(process.env.SEED_CHECKIN_WEEKDAY ?? 7),
  checkin_hour: 18,
  planner_calendar_id: null,
} as Profile;

const period = currentCheckinPeriod(seedProfile, DateTime.now());
const periodStart = DateTime.fromISO(period.periodStart, { zone: ZONE });
const periodEnd = DateTime.fromISO(period.periodEnd, { zone: ZONE });

type Spec = {
  offsetDays: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  title: string;
  taskType: string;
  status: string;
};

// Deliberately shaped so a pattern exists to find: 7am editing, missed twice.
const SPECS: Spec[] = [
  { offsetDays: 1, hour: 7, minute: 0, durationMinutes: 90, title: "Edit video 1", taskType: "editing", status: "missed" },
  { offsetDays: 2, hour: 19, minute: 0, durationMinutes: 60, title: "Film intro for video 1", taskType: "filming", status: "done" },
  { offsetDays: 3, hour: 7, minute: 0, durationMinutes: 90, title: "Edit video 2", taskType: "editing", status: "missed" },
  { offsetDays: 4, hour: 20, minute: 0, durationMinutes: 60, title: "Write script for video 3", taskType: "scripting", status: "done" },
  { offsetDays: 5, hour: 7, minute: 0, durationMinutes: 90, title: "Edit video 3", taskType: "editing", status: "committed" },
  { offsetDays: 6, hour: 10, minute: 0, durationMinutes: 120, title: "Film video 3", taskType: "filming", status: "partial" },
];

const tasks: unknown[] = [];
const blocks: unknown[] = [];

for (const spec of SPECS) {
  const start = periodStart
    .plus({ days: spec.offsetDays })
    .set({ hour: spec.hour, minute: spec.minute, second: 0, millisecond: 0 });
  const end = start.plus({ minutes: spec.durationMinutes });
  const taskId = randomUUID();

  tasks.push({
    id: taskId,
    title: spec.title,
    taskType: spec.taskType,
    estimatedMinutes: spec.durationMinutes,
    goalId: null,
  });

  blocks.push({
    id: randomUUID(),
    taskId,
    title: spec.title,
    taskType: spec.taskType,
    plannedStart: start.toUTC().toISO(),
    plannedEnd: end.toUTC().toISO(),
    status: spec.status,
    bucket: bucketFor(spec.hour),
    dayOfWeek: start.weekday,
    // Seeded blocks were never written to iCloud, so no UID. Marking them
    // committed without one is fine locally and keeps cleanup a no-op.
    caldavUid: null,
    caldavEtag: null,
    completionNote: null,
    completedAt: spec.status === "committed" ? null : end.toUTC().toISO(),
  });
}

store[`tasks:${USER}`] = tasks;
store[`blocks:${USER}`] = blocks;
store[`reasons:${USER}`] = [];
store[`checkins:${USER}`] = [];
writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");

console.log(`\nSeeded week ${periodStart.toISODate()} → ${periodEnd.toISODate()} (${ZONE})\n`);
for (const spec of SPECS) {
  const start = periodStart.plus({ days: spec.offsetDays }).set({ hour: spec.hour, minute: spec.minute });
  console.log(`  ${start.toFormat("ccc d LLL HH:mm")}  ${spec.title.padEnd(28)} ${spec.status}`);
}
console.log("\nNothing was written to iCloud.\n");
