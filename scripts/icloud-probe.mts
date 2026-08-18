/**
 * Diagnostic: talk to iCloud with the stored credentials and report what
 * actually comes back. Read-only — it never writes.
 *
 *   npm run probe:icloud
 *
 * Output stays on your machine. It prints event counts and a handful of
 * titles so you can tell "the read is broken" apart from "that week is
 * genuinely empty".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DateTime } from "luxon";
import { decrypt } from "../src/lib/crypto";
import { ICloudCalendarProvider } from "../src/lib/calendar/icloud";

const store = JSON.parse(
  readFileSync(join(process.cwd(), ".preview-store.json"), "utf8"),
);

const connectionKey = Object.keys(store).find((key) =>
  key.startsWith("connection:"),
);
if (!connectionKey) {
  console.error("No iCloud connection stored. Connect via Settings first.");
  process.exit(1);
}

const connection = store[connectionKey];
const provider = new ICloudCalendarProvider(
  { appleId: connection.appleId, appPassword: decrypt(connection.encrypted) },
  process.env.DEFAULT_TIMEZONE ?? "Europe/London",
);

console.log(`\nConnected as ${connection.appleId}\n`);

const calendars = await provider.listCalendars();
console.log(`Calendars (${calendars.length}):`);
for (const calendar of calendars) {
  console.log(
    `  - ${calendar.displayName}${calendar.readOnly ? " [read-only]" : ""}`,
  );
  console.log(`      ${calendar.id}`);
}

const zone = process.env.DEFAULT_TIMEZONE ?? "Europe/London";
const windows: [string, DateTime, DateTime][] = [
  [
    "this week",
    DateTime.now().setZone(zone).startOf("week"),
    DateTime.now().setZone(zone).startOf("week").plus({ days: 7 }),
  ],
  [
    "last 90 days",
    DateTime.now().setZone(zone).minus({ days: 90 }),
    DateTime.now().setZone(zone),
  ],
  [
    "next 90 days",
    DateTime.now().setZone(zone),
    DateTime.now().setZone(zone).plus({ days: 90 }),
  ],
];

const ids = calendars.map((calendar) => calendar.id);

for (const [label, start, end] of windows) {
  const events = await provider.listEvents(
    ids,
    start.toUTC().toISO()!,
    end.toUTC().toISO()!,
  );
  console.log(`\n${label}: ${events.length} event(s)`);
  for (const event of events.slice(0, 8)) {
    const local = DateTime.fromISO(event.startsAt).setZone(zone);
    console.log(
      `  ${local.toFormat("ccc d LLL HH:mm")}  ${event.title}${event.recurring ? "  (recurring)" : ""}`,
    );
  }
  if (events.length > 8) console.log(`  … and ${events.length - 8} more`);
}

console.log("");
