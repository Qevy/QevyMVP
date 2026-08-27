@AGENTS.md

# Planner — architecture and settled decisions

A single-user web app that plans the week around fixed commitments and adapts
to **reasons the user actually stated** for missing things.

Everything below is decided. Do not relitigate without a reason to.

---

## Status (2026-08-26)

**All five planned features are built and verified against real infrastructure.
The UI has been redesigned. Nothing is deployed.**

| Area | State |
|---|---|
| Auth + RLS schema | Written. **Supabase is not connected** — the app runs in preview mode (see below) |
| iCloud CalDAV | Verified end to end against the real account: login, MKCALENDAR, create, delete |
| Planning chat | Working on Groq free tier, proposal validated server-side |
| Weekly check-in | Working, records reasons verbatim |
| Adaptation | Working, derived rules change proposals and are quoted back |
| Voice input | Working via Groq Whisper |
| UI | Dark dashboard, sidebar + card grid, mobile tab bar |
| Tests | `npm run check` → 96 assertions, no network, no keys |

**What's actually left**, in the order it matters:

1. **Set real availability hours in Settings.** Still the default 07:00–22:00 on
   weekdays, so the planner treats the workday as free. Since the 9-5 is not in
   the calendar, this setting is the *only* thing keeping it out. Highest-value
   thing anyone can do next, and it takes seconds.
2. **Connect Supabase.** Unlocks real login and phone access, and is the
   prerequisite for the friends leaderboard. Steps in `SETUP.md`.
3. **Deploy to Vercel.**
4. Local test data may still be present — `npm run seed:week -- --clear` wipes it.
   `npm run cleanup:planner` removes anything the app wrote to iCloud.

Nothing is half-finished. The items above are choices not yet made, not work
left dangling.

---

## The one idea that matters

Existing tools solve half of this. Reclaim auto-reschedules a missed block but
never asks why. Sunsama runs a guided weekly reflection but the reflection
never feeds back into scheduling. This app joins the two: **the reflection is
the scheduling input.**

Two invariants protect that, and both are load-bearing:

1. **No inferred reasons, ever.** A reason exists only because the user said
   it, in a check-in, in their own words. There is deliberately nowhere in the
   schema or code to store a guessed one. A fabricated reason would silently
   corrupt every future schedule that consults it.
2. **The model proposes; the human commits.** No tool exposed to the LLM can
   write to the calendar. Committing is a button. This is what makes it safe
   to run the whole thing on a free-tier model.

---

## Stack

| Piece | Choice | Note |
|---|---|---|
| Framework | **Next.js 16** (App Router, Server Actions) | Not 15 — see "Next 16 gotchas" |
| DB / auth | **Supabase** (Postgres + magic link) | Optional at boot — see "Preview mode" |
| Calendar | **iCloud CalDAV** via `tsdav` + `ical.js` | Not Google. Apple has no OAuth for calendar |
| LLM | **Vercel AI SDK v7**, Groq now / Anthropic later | Swappable via two env vars |
| Time | **Luxon**, always with an explicit zone | Never construct a bare `Date` |

---

## Settled decisions

**Calendar is iCloud, not Google.** Hadi's calendar lives in iCloud.
Consequences: no OAuth (app-specific password, AES-256-GCM encrypted), no push
notifications (poll on load), and recurring events arrive as a master VEVENT +
RRULE that must be expanded locally.

**`working_hours` is the sole authority on when scheduling may happen.**
This reverses the original plan. Hadi's 9-5 is *not* in his calendar and he
does not want to add it. So the calendar contributes **conflicts**, not
permission — an empty calendar must never mean "the whole day is free".
If scheduling ever appears during his workday, this is why: check
`profile.working_hours`, not the calendar.

**Blocks are written to a dedicated "Planner" calendar.** Created via
`MKCALENDAR`. Everything the app creates lives there, so it can be hidden or
deleted wholesale without touching a real commitment.

**Adaptation rules are derived on read, never stored.** `deriveRules()` is a
pure function over `reasons`. Persisting derived rules would let them drift
from their evidence — delete a reason and a stale rule would keep pushing the
schedule around with nothing behind it. The **only** persisted thing is the
user's mute (a decision, not a derivation).

**Two matching reasons make a rule.** One is an anecdote. Below the threshold,
patterns are shown as "Watching" rather than acted on.

**Adaptation is surfaced by the app, not the model.** `appliedRules` comes back
from the planner and the UI renders the verbatim quotes. Tested: a small model
will obey the rule and then forget to explain it. Visibility must not depend on
model goodwill.

**Model: `openai/gpt-oss-120b` on Groq, not `llama-3.3-70b`.** Measured over
repeated runs against the real tool set, llama intermittently returned
`Failed to call a function` and once summarised times that contradicted the
blocks it had just proposed. Verify any replacement with `npm run check:llm`.

**Free-tier models need a server-side validator.** `propose_schedule` checks
every block against the open slots and hands errors *back to the model* to fix
within the same turn (capped at 2 rounds). This caught a real "5 minutes in the
past" block on the very first live run.

---

## UI decisions

- **Dark dashboard, violet accent**, built to a mockup the owner supplied
  (references: Zest, Cashpilot, Uber). Sidebar on desktop, bottom tab bar on
  phone. An earlier hours-of-day palette was replaced by this — do not
  reintroduce it.
- **Design tokens live in `globals.css` under `@theme`.** Use them
  (`bg-surface`, `text-text-dim`, `border-line`) rather than raw Tailwind
  palette classes, or the next restyle turns into another find-and-replace.
- **Icons are drawn in `icons.tsx`**, 24-box / 1.6 stroke / currentColor. No
  icon dependency.
- **Dashboard numbers measure follow-through, not volume.** "Scheduled 40
  hours" is a vanity metric. A day with nothing scheduled does **not** break a
  consistency run — a rest day is not a failure, and this app should not
  guilt-trip.
- **Nothing on the dashboard is invented.** The mockup showed a "best streak"
  figure; it was left out rather than faked, because the app does not record
  one. Keep that rule.

## Voice

`/api/transcribe` → Groq `whisper-large-v3-turbo`. Deliberately **not** the
browser SpeechRecognition API, which does not work in iOS Safari — the phone is
where this gets spoken to. Audio is posted, transcribed, discarded; the
transcript reaches the planner via `?say=` exactly as if typed. Needs
`localhost` or `https` for microphone permission.

## Layout

```
src/lib/
  scheduling/slots.ts     pure slot finder — no I/O, directly tested
  adaptation/rules.ts     pure rule derivation — no I/O, directly tested
  calendar/
    types.ts              provider interface (mock | icloud)
    ics.ts                pure iCalendar parse/generate + RRULE expansion
    icloud.ts             CalDAV via tsdav
    connection.ts         encrypted credentials + provider resolution
    registry.ts           which calendars to read, which to write
  repository/
    plan.ts               goals, tasks, scheduled blocks
    reasons.ts            check-ins + stated reasons
    adaptation.ts         derive rules + persist mutes
  ai/
    provider.ts           model resolution (one place)
    planner.ts            planning tools + loop
    checkin.ts            check-in tools + loop
  stats.ts                dashboard figures (follow-through, streak, split)

src/components/
  Sidebar.tsx             desktop sidebar + mobile tab bar
  icons.tsx               the whole icon set, drawn not imported
  dashboard/Charts.tsx    donut, week bars, sparkline — plain SVG
  dashboard/AssistantPanel.tsx  suggestion pills + tap-to-speak mic

src/app/
  (app)/page.tsx          dashboard (home)
  (app)/week/             calendar grid        (app)/today/     mark done/missed
  (app)/plan/             planning chat        (app)/checkin/   weekly check-in
  (app)/patterns/         rules + evidence     (app)/settings/  profile, calendar
  api/transcribe/         speech to text
```

The two pure modules (`slots.ts`, `rules.ts`) hold the rules that matter and
are tested without network, database, or model. Keep them that way.

---

## Next 16 gotchas

- `middleware.ts` is now **`proxy.ts`** (`src/proxy.ts`).
- `cookies()` / `headers()` are **async only**.
- Turbopack is the default; **it does not reliably pick up newly added
  imports** — a `X is not defined` ReferenceError at runtime usually means
  restart the dev server, not that the code is wrong.
- `revalidateTag` needs a second `cacheLife` argument.
- Read `node_modules/next/dist/docs/` before writing framework code.

---

## Preview mode

With no Supabase keys the app runs fully: real UI, no login, state in a
gitignored `.preview-store.json`.

- Disabled when `NODE_ENV === "production"` — a deployed app with no keys
  shows the login page rather than serving a shared anonymous account.
- The store is read from disk on **every** access. An in-memory cache went
  stale the moment anything edited the file, which is constant in development.

---

## Recurring traps (each of these has bitten once)

**Never write `.env.local` with PowerShell `Set-Content`.** It adds a UTF-8
BOM, which silently shadows the *first* variable in the file. This has happened
twice. Use the Write tool or a heredoc.

**iCloud returns a normalised URL for a created calendar.** Match a calendar by
display name, not by the URL you asked `MKCALENDAR` for.

**`tsdav` wants extended ISO 8601 for `timeRange`** and converts to CalDAV
basic format itself. Passing basic format is rejected before a request is sent.

**Tool writes must be idempotent.** A model re-reading the conversation will
call `record_reason` again for a block it already covered. Duplicates are not
harmless — the rule threshold is a count, so a double-write invents a pattern.

**Spreading a patch with `undefined` values erases stored fields.** Strip
undefined before merging into preview-store records.

---

## Commands

```bash
npm run dev              # http://localhost:3000
npm run check            # all pure suites + tsc — run before claiming done
npm run check:llm        # verify a model can drive the tool loop
npm run probe:icloud     # read-only: what does iCloud actually return?
npm run seed:week        # fake a finished week locally (no iCloud writes)
npm run cleanup:planner  # delete everything the app wrote to iCloud
```

`npm run check` covers the slot finder, rule derivation, check-in windows,
iCalendar handling, and encryption — ~96 assertions, no network.

---

## Deliberately not built

- **Friends + weekly leaderboard.** Wanted, deferred. Needs real multi-user.
  There is an unresolved design problem recorded in
  `docs/superpowers/specs/2026-08-14-planning-chat-design.md`: a leaderboard
  rewards *looking* productive, which is a direct incentive to lie in the
  check-in — and the check-in is the app's only source of truth. Decide what
  gets scored before building it.
- **Best-streak history.** No table records it, so the dashboard omits it.
- **Streaming responses.** Non-streaming reads fine at current latency.
- **`external_events` cache / CalDAV sync tokens.** The table exists. A
  planning turn currently takes ~30s, most of it reading iCloud. Add the cache
  when that becomes annoying.
- Payments, native app, multi-user UI.
