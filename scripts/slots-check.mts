import { DateTime } from "luxon";
import { findOpenSlots, fitsInOpenSlot, overlapsAny } from "../src/lib/scheduling/slots";
import type { Profile } from "../src/lib/profile";

const ZONE = "America/Chicago";

function profileWith(overrides: Partial<Profile> = {}): Profile {
  return {
    display_name: null,
    timezone: ZONE,
    working_hours: {
      "1": [{ start: "18:00", end: "22:00" }],
      "2": [{ start: "18:00", end: "22:00" }],
      "3": [{ start: "18:00", end: "22:00" }],
      "4": [{ start: "18:00", end: "22:00" }],
      "5": [{ start: "18:00", end: "22:00" }],
      "6": [{ start: "09:00", end: "22:00" }],
      "7": [],
    },
    buffer_minutes: 15,
    checkin_weekday: 7,
    checkin_hour: 18,
    planner_calendar_id: null,
    ...overrides,
  };
}

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, JSON.stringify(detail ?? "", null, 2));
  }
}

/** Monday 10 Aug 2026 → Monday 17 Aug, in local time. */
const from = DateTime.fromISO("2026-08-10T00:00:00", { zone: ZONE }).toUTC().toISO()!;
const to = DateTime.fromISO("2026-08-17T00:00:00", { zone: ZONE }).toUTC().toISO()!;
const local = (iso: string) => DateTime.fromISO(iso).setZone(ZONE).toFormat("ccc HH:mm");

// --- 1. Empty calendar: availability windows are the only authority --------
console.log("\nEmpty calendar (the real situation — no 9-5 in iCloud):");
const empty = findOpenSlots({ profile: profileWith(), busy: [], from, to });

check("one slot per weekday evening + Saturday = 6", empty.length === 6, empty.map((s) => local(s.startsAt)));
check("Sunday excluded (empty availability array)", !empty.some((s) => DateTime.fromISO(s.startsAt).setZone(ZONE).weekday === 7), empty.map((s) => local(s.startsAt)));
check("weekday slot starts 18:00 local", local(empty[0].startsAt) === "Mon 18:00", local(empty[0].startsAt));
check("weekday slot is 4 hours", empty[0].minutes === 240, empty[0].minutes);
check("Saturday slot is 13 hours", empty.find((s) => DateTime.fromISO(s.startsAt).setZone(ZONE).weekday === 6)?.minutes === 780);

// --- 2. Buffer is applied on both sides ------------------------------------
console.log("\nBuffer around a commitment:");
const withEvent = findOpenSlots({
  profile: profileWith(),
  busy: [{
    startsAt: DateTime.fromISO("2026-08-10T19:00:00", { zone: ZONE }).toUTC().toISO()!,
    endsAt: DateTime.fromISO("2026-08-10T20:00:00", { zone: ZONE }).toUTC().toISO()!,
    title: "Gym",
  }],
  from,
  to,
});
const monday = withEvent.filter((s) => DateTime.fromISO(s.startsAt).setZone(ZONE).weekday === 1);
check("Monday splits into two slots", monday.length === 2, monday.map((s) => `${local(s.startsAt)}–${local(s.endsAt)}`));
check("first ends 15 min before the event (18:45)", local(monday[0]?.endsAt) === "Mon 18:45", local(monday[0]?.endsAt));
check("second starts 15 min after (20:15)", local(monday[1]?.startsAt) === "Mon 20:15", local(monday[1]?.startsAt));

// --- 3. minMinutes drops fragments -----------------------------------------
console.log("\nminMinutes filtering:");
const bigOnly = findOpenSlots({
  profile: profileWith(),
  busy: [{
    startsAt: DateTime.fromISO("2026-08-10T18:30:00", { zone: ZONE }).toUTC().toISO()!,
    endsAt: DateTime.fromISO("2026-08-10T20:00:00", { zone: ZONE }).toUTC().toISO()!,
  }],
  from,
  to,
  minMinutes: 90,
});
const mondayBig = bigOnly.filter((s) => DateTime.fromISO(s.startsAt).setZone(ZONE).weekday === 1);
check("15-minute fragment before the event is dropped", mondayBig.length === 1, mondayBig.map((s) => `${local(s.startsAt)} ${s.minutes}m`));
check("remaining slot is the 105-minute tail", mondayBig[0]?.minutes === 105, mondayBig[0]?.minutes);

// --- 4. Overlapping events merge -------------------------------------------
console.log("\nOverlapping busy intervals:");
const overlapping = findOpenSlots({
  profile: profileWith(),
  busy: [
    { startsAt: DateTime.fromISO("2026-08-11T18:30:00", { zone: ZONE }).toUTC().toISO()!, endsAt: DateTime.fromISO("2026-08-11T20:00:00", { zone: ZONE }).toUTC().toISO()! },
    { startsAt: DateTime.fromISO("2026-08-11T19:30:00", { zone: ZONE }).toUTC().toISO()!, endsAt: DateTime.fromISO("2026-08-11T21:00:00", { zone: ZONE }).toUTC().toISO()! },
  ],
  from,
  to,
});
const tuesday = overlapping.filter((s) => DateTime.fromISO(s.startsAt).setZone(ZONE).weekday === 2);
check("merged into one blocked span, not two", tuesday.length <= 2, tuesday.map((s) => `${local(s.startsAt)}–${local(s.endsAt)}`));
check("free time resumes at 21:15", tuesday.some((s) => local(s.startsAt) === "Tue 21:15"), tuesday.map((s) => local(s.startsAt)));

// --- 5. All-day event consumes the day -------------------------------------
console.log("\nAll-day event:");
const allDay = findOpenSlots({
  profile: profileWith(),
  busy: [{
    startsAt: DateTime.fromISO("2026-08-12T00:00:00", { zone: ZONE }).toUTC().toISO()!,
    endsAt: DateTime.fromISO("2026-08-13T00:00:00", { zone: ZONE }).toUTC().toISO()!,
    allDay: true,
    title: "Travelling",
  }],
  from,
  to,
});
check("Wednesday has no slots at all", !allDay.some((s) => DateTime.fromISO(s.startsAt).setZone(ZONE).weekday === 3), allDay.map((s) => local(s.startsAt)));
check("other days unaffected", allDay.length === 5, allDay.length);

// --- 6. Every day off-limits ------------------------------------------------
console.log("\nNo availability configured:");
const noneConfigured = findOpenSlots({
  profile: profileWith({ working_hours: { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] } }),
  busy: [],
  from,
  to,
});
check("returns nothing rather than the whole week", noneConfigured.length === 0, noneConfigured);

// --- 7. Split availability windows in one day ------------------------------
console.log("\nSplit day (morning + evening):");
const split = findOpenSlots({
  profile: profileWith({
    working_hours: { "1": [{ start: "06:00", end: "08:00" }, { start: "18:00", end: "22:00" }], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] },
  }),
  busy: [],
  from,
  to,
});
check("both windows returned", split.length === 2, split.map((s) => `${local(s.startsAt)}–${local(s.endsAt)}`));
check("sorted chronologically", split[0].startsAt < split[1].startsAt);

// --- 8. Past slots are excluded --------------------------------------------
console.log("\nSlots already in the past:");
const withNow = findOpenSlots({
  profile: profileWith(),
  busy: [],
  from,
  to,
  now: DateTime.fromISO("2026-08-12T20:00:00", { zone: ZONE }).toUTC().toISO()!,
});
check("Mon and Tue dropped entirely", !withNow.some((s) => DateTime.fromISO(s.startsAt).setZone(ZONE).weekday <= 2), withNow.map((s) => local(s.startsAt)));
check("Wednesday truncated to the remaining 2h", withNow[0]?.minutes === 120 && local(withNow[0].startsAt) === "Wed 20:00", `${local(withNow[0]?.startsAt)} ${withNow[0]?.minutes}m`);

// --- 9. DST boundary --------------------------------------------------------
console.log("\nDST spring-forward week (8 Mar 2026, US):");
const dstFrom = DateTime.fromISO("2026-03-08T00:00:00", { zone: ZONE }).toUTC().toISO()!;
const dstTo = DateTime.fromISO("2026-03-09T00:00:00", { zone: ZONE }).toUTC().toISO()!;
const dst = findOpenSlots({
  profile: profileWith({ working_hours: { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [{ start: "09:00", end: "22:00" }] } }),
  busy: [],
  from: dstFrom,
  to: dstTo,
});
check("Sunday slot exists across the DST change", dst.length === 1, dst);
check("still 13 wall-clock hours (not 12 or 14)", dst[0]?.minutes === 780, dst[0]?.minutes);

// --- 10. Validation helpers -------------------------------------------------
console.log("\nProposal validation helpers:");
const slots = findOpenSlots({ profile: profileWith(), busy: [], from, to });
const insideSlot = { startsAt: DateTime.fromISO("2026-08-10T19:00:00", { zone: ZONE }).toUTC().toISO()!, endsAt: DateTime.fromISO("2026-08-10T20:00:00", { zone: ZONE }).toUTC().toISO()! };
const outsideHours = { startsAt: DateTime.fromISO("2026-08-10T10:00:00", { zone: ZONE }).toUTC().toISO()!, endsAt: DateTime.fromISO("2026-08-10T11:00:00", { zone: ZONE }).toUTC().toISO()! };
const straddles = { startsAt: DateTime.fromISO("2026-08-10T21:30:00", { zone: ZONE }).toUTC().toISO()!, endsAt: DateTime.fromISO("2026-08-10T23:00:00", { zone: ZONE }).toUTC().toISO()! };

check("valid block accepted", fitsInOpenSlot(insideSlot, slots));
check("10am on a workday rejected", !fitsInOpenSlot(outsideHours, slots));
check("block running past 22:00 rejected", !fitsInOpenSlot(straddles, slots));
check("overlap detected", overlapsAny(insideSlot, [{ startsAt: DateTime.fromISO("2026-08-10T19:30:00", { zone: ZONE }).toUTC().toISO()!, endsAt: DateTime.fromISO("2026-08-10T20:30:00", { zone: ZONE }).toUTC().toISO()! }]));
check("adjacent blocks are not an overlap", !overlapsAny(insideSlot, [{ startsAt: DateTime.fromISO("2026-08-10T20:00:00", { zone: ZONE }).toUTC().toISO()!, endsAt: DateTime.fromISO("2026-08-10T21:00:00", { zone: ZONE }).toUTC().toISO()! }]));

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
