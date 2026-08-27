import { DateTime } from "luxon";
import { currentCheckinPeriod, isCheckinDue } from "../src/lib/repository/reasons";
import type { Profile } from "../src/lib/profile";

const ZONE = "America/Chicago";

function profileWith(overrides: Partial<Profile> = {}): Profile {
  return {
    display_name: null,
    timezone: ZONE,
    working_hours: {},
    buffer_minutes: 15,
    checkin_weekday: 7, // Sunday
    checkin_hour: 18,
    planner_calendar_id: null,
    ...overrides,
  };
}

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, JSON.stringify(detail ?? ""));
  }
}

const at = (iso: string) => DateTime.fromISO(iso, { zone: ZONE });

console.log("\nCheck-in period (Sunday check-in day):");
{
  // Wednesday 12 Aug 2026. Most recent Sunday is 9 Aug.
  const p = currentCheckinPeriod(profileWith(), at("2026-08-12T10:00:00"));
  check("mid-week reviews the week ending last Sunday", p.periodStart === "2026-08-02" && p.periodEnd === "2026-08-09", p);
}
{
  // On the check-in day itself, that day closes the period.
  const p = currentCheckinPeriod(profileWith(), at("2026-08-09T19:00:00"));
  check("on Sunday, the period ends today", p.periodEnd === "2026-08-09", p);
  check("and starts seven days earlier", p.periodStart === "2026-08-02", p);
}
{
  // Monday: the period must NOT jump forward to the coming Sunday.
  const p = currentCheckinPeriod(profileWith(), at("2026-08-10T09:00:00"));
  check("day after the check-in day still reviews the completed week", p.periodEnd === "2026-08-09", p);
}
{
  // Never reviews a week that hasn't happened.
  const now = at("2026-08-12T10:00:00");
  const p = currentCheckinPeriod(profileWith(), now);
  check("period end is never in the future", DateTime.fromISO(p.periodEnd, { zone: ZONE }) <= now, p);
}

console.log("\nCheck-in period (Friday check-in day):");
{
  const p = currentCheckinPeriod(profileWith({ checkin_weekday: 5 }), at("2026-08-12T10:00:00"));
  check("Wednesday reviews week ending Friday 7 Aug", p.periodStart === "2026-07-31" && p.periodEnd === "2026-08-07", p);
}

console.log("\nDue-ness:");
{
  const profile = profileWith(); // Sunday 18:00
  check("Sunday 17:59 — not yet due", !isCheckinDue(profile, at("2026-08-09T17:59:00")));
  check("Sunday 18:00 — due", isCheckinDue(profile, at("2026-08-09T18:00:00")));
  check("Monday morning — still due (unfinished business)", isCheckinDue(profile, at("2026-08-10T09:00:00")));
  check("Wednesday — due for the older period", isCheckinDue(profile, at("2026-08-12T09:00:00")));
}
{
  const profile = profileWith({ checkin_hour: 0 });
  check("midnight check-in hour is due all day", isCheckinDue(profile, at("2026-08-09T00:30:00")));
}
{
  // A period that ended days ago is due regardless of the hour.
  const profile = profileWith({ checkin_hour: 23 });
  check("late check-in hour, several days later — due", isCheckinDue(profile, at("2026-08-13T08:00:00")));
  check("late check-in hour, on the day before it — not due", !isCheckinDue(profile, at("2026-08-09T08:00:00")));
}

console.log("\nTimezone independence:");
{
  const london = profileWith({ timezone: "Europe/London" });
  const p = currentCheckinPeriod(london, DateTime.fromISO("2026-08-12T10:00:00", { zone: "Europe/London" }));
  check("works in another zone", p.periodEnd === "2026-08-09", p);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
