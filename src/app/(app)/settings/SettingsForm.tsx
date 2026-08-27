"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  COMMON_TIMEZONES,
  WEEKDAY_KEYS,
  WEEKDAY_NAMES,
  type Profile,
} from "@/lib/profile";
import { saveSettings, type SettingsState } from "./actions";

const INITIAL: SettingsState = { status: "idle" };

const FIELD =
  "rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-sm text-text outline-none focus:border-accent";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-soft disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save settings"}
    </button>
  );
}

function DayRow({
  day,
  windows,
}: {
  day: string;
  windows: { start: string; end: string }[];
}) {
  const existing = windows[0];
  const [available, setAvailable] = useState(Boolean(existing));

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-b-0">
      <label className="flex w-36 shrink-0 items-center gap-2 text-sm text-text-dim">
        <input
          type="checkbox"
          name={`available_${day}`}
          checked={available}
          onChange={(event) => setAvailable(event.target.checked)}
          className="size-4 accent-[#7c5cff]"
        />
        {WEEKDAY_NAMES[day]}
      </label>

      <div className="flex items-center gap-2">
        <input
          type="time"
          name={`start_${day}`}
          defaultValue={existing?.start ?? "07:00"}
          disabled={!available}
          className={`${FIELD} disabled:opacity-40`}
          aria-label={`${WEEKDAY_NAMES[day]} start`}
        />
        <span className="text-xs text-text-faint">to</span>
        <input
          type="time"
          name={`end_${day}`}
          defaultValue={existing?.end ?? "22:00"}
          disabled={!available}
          className={`${FIELD} disabled:opacity-40`}
          aria-label={`${WEEKDAY_NAMES[day]} end`}
        />
      </div>

      {!available && (
        <span className="text-xs text-text-faint">Never schedule this day</span>
      )}
    </div>
  );
}

export function SettingsForm({ profile }: { profile: Profile }) {
  const [state, formAction] = useActionState(saveSettings, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Your name</h2>
          <p className="text-xs text-text-faint">
            Used to greet you on the dashboard. Leave it blank to skip that.
          </p>
        </div>
        <input
          name="display_name"
          defaultValue={profile.display_name ?? ""}
          maxLength={40}
          placeholder="Hadi"
          className={`${FIELD} max-w-xs`}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Timezone</h2>
          <p className="text-xs text-text-faint">
            Everything is stored in UTC and shown in this zone.
          </p>
        </div>
        <select
          name="timezone"
          defaultValue={profile.timezone}
          className={`${FIELD} max-w-xs`}
        >
          {(COMMON_TIMEZONES.includes(profile.timezone)
            ? COMMON_TIMEZONES
            : [profile.timezone, ...COMMON_TIMEZONES]
          ).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text">
            When the app may schedule
          </h2>
          <p className="max-w-2xl text-xs text-text-faint">
            The outer boundary of your day — not your 9-5. Your fixed
            commitments already come from your calendar; blocks are only ever
            placed in the gaps inside these windows.
          </p>
        </div>
        <div className="rounded-card border border-line bg-surface px-4">
          {WEEKDAY_KEYS.map((day) => (
            <DayRow
              key={day}
              day={day}
              windows={profile.working_hours[day] ?? []}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Buffer</h2>
          <p className="text-xs text-text-faint">
            Minimum gap left either side of a fixed commitment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            name="buffer_minutes"
            min={0}
            max={120}
            step={5}
            defaultValue={profile.buffer_minutes}
            className={`${FIELD} w-24`}
          />
          <span className="text-sm text-text-faint">minutes</span>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-text">Weekly check-in</h2>
          <p className="text-xs text-text-faint">
            When the check-in becomes available. It waits for you — it never
            emails or nags.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            name="checkin_weekday"
            defaultValue={String(profile.checkin_weekday)}
            className={FIELD}
          >
            {WEEKDAY_KEYS.map((day) => (
              <option key={day} value={day}>
                {WEEKDAY_NAMES[day]}
              </option>
            ))}
          </select>
          <span className="text-sm text-text-faint">from</span>
          <select
            name="checkin_hour"
            defaultValue={String(profile.checkin_hour)}
            className={FIELD}
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <SaveButton />
        {state.status === "saved" && (
          <span role="status" className="text-xs text-good">
            {state.message}
          </span>
        )}
        {state.status === "error" && (
          <span role="alert" className="text-xs text-bad">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
