# Planner

A personal weekly planner that schedules around your real commitments — and
adapts based on **reasons you actually gave** for missing things.

Most planners let you schedule work. Few ask why you didn't do it, and none use
the answer. This one has a weekly conversation about what actually happened,
records your reasons in your own words, and stops proposing times that
demonstrably do not work for you.

> **Status:** feature-complete and redesigned. Runs locally; not deployed.
> Supabase is not connected yet, so it runs in preview mode (no login, state on
> disk). See [CLAUDE.md](./CLAUDE.md) for a full status breakdown and what's
> left.

---

## How it works

```
                  ┌──────────────────────────────────────────┐
                  │  1. PLAN                                 │
   "I want to     │  Conversation → proposal → you approve   │
    make 4 AI ───▶│  Blocks are written to a dedicated       │
    videos"       │  "Planner" calendar in iCloud            │
                  └──────────────────┬───────────────────────┘
                                     │
                  ┌──────────────────▼───────────────────────┐
                  │  2. LIVE THE WEEK                        │
                  │  Mark each block Done / Partly / Missed  │
                  └──────────────────┬───────────────────────┘
                                     │
                  ┌──────────────────▼───────────────────────┐
                  │  3. CHECK IN                             │
                  │  "What happened with Monday's edit?"     │
                  │  Your answer is stored verbatim          │
                  └──────────────────┬───────────────────────┘
                                     │
                  ┌──────────────────▼───────────────────────┐
                  │  4. ADAPT                                │
                  │  Said twice → becomes a rule             │
                  │  Next plan avoids that slot, and says    │
                  │  why, quoting you back                   │
                  └──────────────────────────────────────────┘
```

A real proposal from the app:

> **Proposed schedule**
> Editing session 1 — Wednesday 09:00–10:30
> Editing session 2 — Friday 14:00–15:30
>
> **Adapted from your check-ins**
> Kept *editing* out of the early morning (5–8am) — missed 3 times. You said:
> *"I just wasn't awake yet, 7am is way too early for me"*

---

## Two rules the whole design rests on

**1. No inferred reasons, ever.** A reason exists only because you said it, in
your own words. There is deliberately nowhere in the schema or the code to
store a guessed one. A fabricated reason would quietly corrupt every future
schedule that consults it.

**2. The model proposes; you commit.** No tool available to the language model
can write to your calendar. Committing is a button you press. That boundary is
what makes it safe to run the whole thing on a free-tier model — a bad model
turn produces a bad *suggestion* you reject, not a corrupted calendar.

Everything the model proposes is also validated server-side against your real
availability before you ever see it. Out-of-hours, overlapping, or past-dated
blocks are rejected and handed back to the model to fix.

---

## Features

| | |
|---|---|
| **Week view** | Your calendar plus scheduled blocks. Agenda on phone, grid on desktop |
| **Plan** | Conversational scheduling. Asks a clarifying question, then proposes |
| **Today** | One-tap Done / Partly / Missed. Tap again to undo |
| **Check-in** | Weekly conversation about what happened. Records reasons verbatim |
| **Patterns** | Every derived rule, the exact quotes behind it, and a switch to turn it off |
| **Settings** | Name, timezone, available hours, buffer, check-in day, iCloud connection |
| **Voice** | Tap the mic, talk, and it plans from your words — Groq Whisper, works in iOS Safari |

---

## Stack

- **Next.js 16** (App Router, Server Actions) — deployable to Vercel
- **Supabase** — Postgres + magic-link auth, with Row Level Security
- **iCloud Calendar** via CalDAV (`tsdav` + `ical.js`)
- **Vercel AI SDK** — Groq (free tier) or Anthropic, swappable via env vars
- **Luxon** for all time arithmetic
- **Tailwind CSS**

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

It boots with **zero configuration** — no database, no login, no calendar. Each
integration degrades to a clearly-labelled stub, so you can see the whole app
before connecting anything. Add credentials as you want them; see
[SETUP.md](./SETUP.md).

| Env var | For | Needed |
|---|---|---|
| `GROQ_API_KEY` | Planning + check-in conversations | Free, no card |
| `APP_ENCRYPTION_KEY` | Encrypts your Apple app-specific password | One command |
| `NEXT_PUBLIC_SUPABASE_*` | Login and persistence | Free tier |
| `ANTHROPIC_API_KEY` | Only if `LLM_PROVIDER=anthropic` | Optional |

### iCloud

Apple offers no OAuth for calendars, so this uses CalDAV with an
**app-specific password** (generated at account.apple.com, revocable, and only
valid for this one app). It is encrypted with AES-256-GCM before storage and is
never sent back to the browser.

Blocks are written to a dedicated **Planner** calendar, so everything the app
creates can be hidden or deleted wholesale without touching a real commitment.

---

## Testing

```bash
npm run check    # ~96 assertions, no network, no API keys
```

The two pieces of logic that matter — the slot finder and the rule derivation —
are pure functions with no I/O, tested directly. Coverage includes buffers,
all-day events, split availability, DST boundaries, past-slot truncation,
recurring-event expansion with overrides, line folding, and AES round-trips.

Useful extras:

```bash
npm run check:llm        # verify a model can actually drive the tool loop
npm run probe:icloud     # read-only: what does iCloud actually return?
npm run seed:week        # fake a finished week locally (writes nothing remote)
npm run cleanup:planner  # delete everything the app wrote to iCloud
```

---

## Project layout

```
src/lib/
  scheduling/slots.ts   pure slot finder      ← no I/O, directly tested
  adaptation/rules.ts   pure rule derivation  ← no I/O, directly tested
  calendar/             CalDAV provider, iCalendar handling, credentials
  repository/           goals, tasks, blocks, reasons, check-ins
  ai/                   model resolution, planner loop, check-in loop
```

Architecture decisions and the traps found while building are recorded in
[CLAUDE.md](./CLAUDE.md).

---

## Not built yet

- **Friends + weekly leaderboard.** Wanted. It has an unresolved design problem
  worth solving first: a leaderboard rewards *looking* productive, which is a
  direct incentive to lie in the check-in — and the check-in is the app's only
  source of truth. What gets scored has to be decided before it is built.
- **Deployment.** Runs locally only so far.
- Streaming responses, calendar caching, best-streak history, payments, native apps.
