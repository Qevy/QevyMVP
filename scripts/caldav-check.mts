import { DateTime } from "luxon";
import { buildICS, expandCalendarObject } from "../src/lib/calendar/ics";

const ZONE = "Europe/London";
const windowStart = DateTime.fromISO("2026-08-03T00:00:00", { zone: ZONE }).toUTC();
const windowEnd = windowStart.plus({ days: 7 });

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}`, detail ?? "");
  }
}

// --- 1. Weekly recurring event with a TZID and one modified instance -------
const recurringIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly-standup
DTSTAMP:20260101T000000Z
DTSTART;TZID=Europe/London:20250106T090000
DTEND;TZID=Europe/London:20250106T093000
RRULE:FREQ=WEEKLY;BYDAY=MO
SUMMARY:Day job standup
END:VEVENT
BEGIN:VEVENT
UID:weekly-standup
RECURRENCE-ID;TZID=Europe/London:20260803T090000
DTSTAMP:20260101T000000Z
DTSTART;TZID=Europe/London:20260803T140000
DTEND;TZID=Europe/London:20260803T143000
SUMMARY:Standup (moved)
END:VEVENT
END:VCALENDAR`;

console.log("\nRecurring weekly event, 18 months of history, one override:");
const recurring = expandCalendarObject({
  ics: recurringIcs,
  calendarId: "cal-1",
  etag: '"abc"',
  windowStart,
  windowEnd,
  zone: ZONE,
});

check("expands to exactly one instance inside the week", recurring.length === 1, recurring);
if (recurring[0]) {
  const local = DateTime.fromISO(recurring[0].startsAt).setZone(ZONE);
  check("override is applied (14:00, not 09:00)", local.hour === 14, local.toISO());
  check("override summary wins", recurring[0].title === "Standup (moved)", recurring[0].title);
  check("marked recurring", recurring[0].recurring === true);
  check("BST offset handled (UTC 13:00)", recurring[0].startsAt.startsWith("2026-08-03T13:00"), recurring[0].startsAt);
}

// --- 2. All-day event ------------------------------------------------------
const allDayIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:all-day-1
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260805
DTEND;VALUE=DATE:20260806
SUMMARY:Bank holiday
END:VEVENT
END:VCALENDAR`;

console.log("\nAll-day event:");
const allDay = expandCalendarObject({
  ics: allDayIcs,
  calendarId: "cal-1",
  etag: null,
  windowStart,
  windowEnd,
  zone: ZONE,
});
check("returned", allDay.length === 1, allDay);
if (allDay[0]) {
  check("flagged allDay", allDay[0].allDay === true);
  const local = DateTime.fromISO(allDay[0].startsAt).setZone(ZONE);
  check("lands on 5 Aug in the user's zone", local.toISODate() === "2026-08-05", local.toISO());
}

// --- 3. Single timed event outside the window ------------------------------
const outsideIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:outside-1
DTSTAMP:20260101T000000Z
DTSTART:20260901T090000Z
DTEND:20260901T100000Z
SUMMARY:Next month
END:VEVENT
END:VCALENDAR`;

console.log("\nEvent outside the window:");
const outside = expandCalendarObject({
  ics: outsideIcs,
  calendarId: "cal-1",
  etag: null,
  windowStart,
  windowEnd,
  zone: ZONE,
});
check("filtered out", outside.length === 0, outside);

// --- 4. Event straddling the window start ----------------------------------
const straddleIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:straddle-1
DTSTAMP:20260101T000000Z
DTSTART:20260802T220000Z
DTEND:20260803T020000Z
SUMMARY:Overnight
END:VEVENT
END:VCALENDAR`;

console.log("\nEvent straddling the window boundary:");
const straddle = expandCalendarObject({
  ics: straddleIcs,
  calendarId: "cal-1",
  etag: null,
  windowStart,
  windowEnd,
  zone: ZONE,
});
check("kept (overlap, not containment)", straddle.length === 1, straddle);

// --- 5. ICS generation -----------------------------------------------------
console.log("\nICS generation:");
const ics = buildICS({
  uid: "planner-test",
  draft: {
    title: "Edit video; part 2, take 3",
    description: "Line one\nLine two",
    startsAt: "2026-08-04T07:00:00.000Z",
    endsAt: "2026-08-04T08:30:00.000Z",
  },
});

check("CRLF line endings", ics.includes("\r\n") && !/[^\r]\n/.test(ics));
check("DTSTART in UTC basic format", ics.includes("DTSTART:20260804T070000Z"), ics);
check("DTEND in UTC basic format", ics.includes("DTEND:20260804T083000Z"));
check("semicolon escaped", ics.includes("Edit video\\; part 2\\, take 3"), ics);
check("newline escaped", ics.includes("Line one\\nLine two"));
check("tagged as ours", ics.includes("X-PLANNER-MANAGED:1"));

// Round-trip it through the parser to prove it's actually valid.
const roundTripped = expandCalendarObject({
  ics,
  calendarId: "cal-1",
  etag: null,
  windowStart,
  windowEnd,
  zone: ZONE,
});
check("round-trips through the parser", roundTripped.length === 1, roundTripped);
if (roundTripped[0]) {
  check("title survives escaping", roundTripped[0].title === "Edit video; part 2, take 3", roundTripped[0].title);
  check("start time preserved", roundTripped[0].startsAt.startsWith("2026-08-04T07:00"), roundTripped[0].startsAt);
}

// --- 6. Long line folding --------------------------------------------------
console.log("\nLong summary (line folding):");
const longIcs = buildICS({
  uid: "planner-long",
  draft: {
    title: "A".repeat(200),
    startsAt: "2026-08-04T07:00:00.000Z",
    endsAt: "2026-08-04T08:00:00.000Z",
  },
});
check(
  "no line exceeds 75 octets",
  longIcs.split("\r\n").every((line) => Buffer.byteLength(line, "utf8") <= 75),
  longIcs.split("\r\n").map((l) => Buffer.byteLength(l, "utf8")),
);
const longParsed = expandCalendarObject({
  ics: longIcs,
  calendarId: "cal-1",
  etag: null,
  windowStart,
  windowEnd,
  zone: ZONE,
});
check("folded line unfolds back to the original", longParsed[0]?.title === "A".repeat(200), longParsed[0]?.title?.length);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);



