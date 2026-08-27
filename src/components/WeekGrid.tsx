import type { CSSProperties } from "react";
import { DateTime } from "luxon";
import type { CalendarEvent } from "@/lib/calendar/types";
import { formatRange, minutesFromMidnight } from "@/lib/time";
import { cn } from "@/lib/ui";

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 23;
const PX_PER_HOUR = 52;

type Props = {
  days: DateTime[];
  events: CalendarEvent[];
  zone: string;
  /** Calendar ids whose events are blocks this app created. */
  plannerCalendarIds?: string[];
};

function eventsForDay(events: CalendarEvent[], day: DateTime, zone: string) {
  const dayKey = day.toISODate();
  return events.filter(
    (event) => DateTime.fromISO(event.startsAt, { zone }).toISODate() === dayKey,
  );
}

function EventChip({
  event,
  zone,
  isPlanned,
  className,
  style,
}: {
  event: CalendarEvent;
  zone: string;
  isPlanned: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn(
        "overflow-hidden rounded-md border px-1.5 py-1 text-[11px] leading-tight",
        isPlanned
          ? "border-line-strong bg-surface text-text"
          : "border-line-strong bg-surface text-text",
        className,
      )}
    >
      <div className="truncate font-medium">{event.title}</div>
      <div className="truncate opacity-70">
        {formatRange(event.startsAt, event.endsAt, zone)}
      </div>
    </div>
  );
}

export function WeekGrid({ days, events, zone, plannerCalendarIds = [] }: Props) {
  const hours = Array.from(
    { length: DAY_END_HOUR - DAY_START_HOUR },
    (_, i) => DAY_START_HOUR + i,
  );
  const gridHeight = hours.length * PX_PER_HOUR;
  const today = DateTime.now().setZone(zone).toISODate();

  return (
    <>
      {/* Phone: a plain agenda. A 7-column grid is unreadable at 375px. */}
      <div className="flex flex-col gap-4 md:hidden">
        {days.map((day) => {
          const dayEvents = eventsForDay(events, day, zone);
          const isToday = day.toISODate() === today;
          return (
            <section key={day.toISO()}>
              <h3
                className={cn(
                  "mb-2 text-sm font-semibold",
                  isToday ? "text-text-dim" : "text-text-dim",
                )}
              >
                {day.toFormat("cccc d LLL")}
                {isToday && " · today"}
              </h3>
              {dayEvents.length === 0 ? (
                <p className="rounded-md border border-dashed border-line-strong px-3 py-2 text-xs text-text-faint">
                  Nothing scheduled
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {dayEvents.map((event) => (
                    <EventChip
                      key={`${event.uid}-${event.startsAt}`}
                      event={event}
                      zone={zone}
                      isPlanned={plannerCalendarIds.includes(event.calendarId)}
                      className="text-xs"
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Desktop: time-positioned columns. */}
      <div className="hidden md:block">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-line">
          <div />
          {days.map((day) => {
            const isToday = day.toISODate() === today;
            return (
              <div
                key={day.toISO()}
                className={cn(
                  "border-l border-line px-2 pb-2 text-center text-xs",
                  isToday ? "text-text-dim" : "text-text-dim",
                )}
              >
                <div className="font-semibold">{day.toFormat("ccc")}</div>
                <div className="opacity-70">{day.toFormat("d LLL")}</div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          <div className="relative" style={{ height: gridHeight }}>
            {hours.map((hour, index) => (
              <div
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-text-faint"
                style={{ top: index * PX_PER_HOUR }}
              >
                {String(hour).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {days.map((day) => {
            const dayEvents = eventsForDay(events, day, zone);
            return (
              <div
                key={day.toISO()}
                className="relative border-l border-line"
                style={{ height: gridHeight }}
              >
                {hours.map((hour, index) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-line"
                    style={{ top: index * PX_PER_HOUR }}
                  />
                ))}

                {dayEvents.map((event) => {
                  const startMinutes = minutesFromMidnight(event.startsAt, zone);
                  const endMinutes = minutesFromMidnight(event.endsAt, zone);
                  const gridStart = DAY_START_HOUR * 60;
                  // Clamp so an event running past the visible window still
                  // renders, rather than overflowing the column.
                  const top = Math.max(0, ((startMinutes - gridStart) / 60) * PX_PER_HOUR);
                  const bottom = Math.min(
                    gridHeight,
                    ((endMinutes - gridStart) / 60) * PX_PER_HOUR,
                  );
                  const height = Math.max(18, bottom - top);
                  if (bottom <= 0 || top >= gridHeight) return null;

                  return (
                    <EventChip
                      key={`${event.uid}-${event.startsAt}`}
                      event={event}
                      zone={zone}
                      isPlanned={plannerCalendarIds.includes(event.calendarId)}
                      className="absolute inset-x-1"
                      // Inline because the values are data-derived.
                      style={{ top, height }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
