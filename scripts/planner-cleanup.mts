/**
 * Delete every event the app created in the Planner calendar, and clear the
 * matching local blocks. Useful after testing.
 *
 *   npm run cleanup:planner -- --dry-run   (default: lists, deletes nothing)
 *   npm run cleanup:planner -- --confirm
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DateTime } from "luxon";
import { decrypt } from "../src/lib/crypto";
import { ICloudCalendarProvider } from "../src/lib/calendar/icloud";

const confirm = process.argv.includes("--confirm");
const storePath = join(process.cwd(), ".preview-store.json");
const store = JSON.parse(readFileSync(storePath, "utf8"));

const connectionKey = Object.keys(store).find((k) => k.startsWith("connection:"));
if (!connectionKey) {
  console.error("No iCloud connection stored.");
  process.exit(1);
}

const zone = process.env.DEFAULT_TIMEZONE ?? "America/Chicago";
const connection = store[connectionKey];
const provider = new ICloudCalendarProvider(
  { appleId: connection.appleId, appPassword: decrypt(connection.encrypted) },
  zone,
);

const calendars = await provider.listCalendars();
const planner = calendars.find(
  (c) => c.displayName.trim().toLowerCase() === "planner",
);
if (!planner) {
  console.error("No Planner calendar found.");
  process.exit(1);
}

const from = DateTime.now().minus({ days: 90 }).toUTC().toISO()!;
const to = DateTime.now().plus({ days: 180 }).toUTC().toISO()!;
const events = await provider.listEvents([planner.id], from, to);

console.log(`\n${events.length} event(s) in the Planner calendar:\n`);
for (const event of events) {
  console.log(
    `  ${DateTime.fromISO(event.startsAt).setZone(zone).toFormat("ccc d LLL HH:mm")}  ${event.title}`,
  );
}

if (!confirm) {
  console.log("\nDry run. Re-run with --confirm to delete these.\n");
  process.exit(0);
}

let deleted = 0;
for (const event of events) {
  try {
    await provider.deleteEvent(planner.id, event.uid, event.etag);
    deleted++;
  } catch (error) {
    console.error(`  failed to delete ${event.title}:`, error instanceof Error ? error.message : error);
  }
}

// Clear the local blocks too, so the app doesn't show phantom commitments.
for (const key of Object.keys(store)) {
  if (key.startsWith("blocks:") || key.startsWith("tasks:")) store[key] = [];
}
if (existsSync(storePath)) {
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

console.log(`\nDeleted ${deleted} event(s) and cleared local blocks.\n`);
