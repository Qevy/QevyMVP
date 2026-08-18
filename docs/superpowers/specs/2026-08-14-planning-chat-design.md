# Design: Daily Planning Chat (Phase 3)

**Date:** 2026-08-14
**Status:** Approved
**Supersedes:** the Phase 3 sketch in the original project plan (model choice only)

## Context

Phases 0–2 are built and verified against real infrastructure: the schema exists,
auth works in preview mode, and iCloud CalDAV reads and writes are proven against
Hadi's actual account (`npm run probe:icloud`, `npm run check`).

This phase adds the conversational planner: describe a goal in plain language,
get a proposed schedule that fits the gaps in your week, adjust it, commit it to
iCloud.

Two decisions changed since the original plan:

1. **Model.** Testing runs on Groq's free tier, not Claude. Anthropic-tier models
   come later once the flow is proven. The provider must be swappable without
   code changes.
2. **The 9-5 is not in the calendar.** Hadi's iCloud has five events across six
   months and no recurring work block, and he does not want to add one. The
   scheduler therefore treats `profiles.working_hours` as the sole authority on
   when it may schedule, and the calendar purely as a source of one-off conflicts.
   This is a reversal: the original plan assumed the calendar carried the 9-5.

## Goals

- Conversational planning that asks clarifying questions before proposing.
- Proposals that respect availability windows, existing commitments, and buffers.
- Nothing reaches the calendar without an explicit human click.
- Provider-agnostic: Groq now, Claude later, one env var apart.

## Non-goals (deferred, with reasons)

| Deferred | Why |
|---|---|
| Friends + weekly leaderboard | Needs real multi-user, which needs Supabase. Own spec, after Phase 5. See "Deferred: social layer" below. |
| Streaming responses | Groq is fast enough that non-streaming reads fine; the tool loop is multi-step regardless. Cheap to add later. |
| `external_events` cache table | Reading live from iCloud is one request per planning turn. The cache earns its keep only when pulling months of history. |
| CalDAV `sync-collection` tokens | Same reason. A one-week time-range query is already cheap. |

## Architecture

### 1. LLM provider layer

Vercel AI SDK (`ai`, `@ai-sdk/groq`, `@ai-sdk/anthropic`) rather than a
hand-written adapter. The decisive factor: translating between OpenAI's
`tool_calls` shape and Anthropic's `tool_use` blocks is fiddly, and this session
has already produced three bugs that only surfaced against real servers. Not
hand-rolling a second protocol translation.

```
src/lib/ai/provider.ts   resolveModel() — reads env, returns a LanguageModel
src/lib/ai/tools.ts      tool definitions, provider-agnostic
src/lib/ai/planner.ts    system prompt + the planning loop
```

Environment:

```
LLM_PROVIDER=groq                    # or "anthropic"
LLM_MODEL=llama-3.3-70b-versatile    # or "claude-sonnet-5"
GROQ_API_KEY=…
ANTHROPIC_API_KEY=…                  # unused until LLM_PROVIDER=anthropic
```

Switching to Sonnet is two env vars and no code change.

This replaces the existing `CLAUDE_MODEL` constant in `src/lib/config.ts`, and
the Setup panel's "Anthropic API key" row becomes "LLM provider key", reporting
on whichever provider is selected. `.env.example` and `SETUP.md` change to match.

### 2. Slot finder — `src/lib/scheduling/slots.ts`

Pure, synchronous, no I/O. Everything it needs is passed in, which makes it
directly testable.

```
findOpenSlots({ profile, busy, from, to, minMinutes }) → Interval[]
```

Algorithm, per day in the window:

1. Take the availability windows from `working_hours[isoWeekday]`. Empty array
   means the day is off-limits.
2. Collect busy intervals: iCloud events plus already-committed planner blocks.
3. Expand each busy interval by `buffer_minutes` on both sides.
4. Merge overlapping busy intervals.
5. Subtract merged busy from availability.
6. Drop the remainder shorter than `minMinutes`.

All arithmetic goes through Luxon with an explicit zone. All-day events consume
their whole day.

### 3. Tools exposed to the model

Read-only, except the last, which only *proposes*.

| Tool | Purpose |
|---|---|
| `get_week_overview(week_offset)` | Fixed commitments and existing planner blocks |
| `get_open_slots(from, to, min_minutes)` | Free intervals from the slot finder |
| `get_active_goals()` | Goals in flight |
| `get_adaptation_context(task_types)` | Stored reasons and rules. Returns empty until Phase 5; wired now so Phase 5 changes no plumbing. |
| `propose_schedule(blocks[])` | Returns a proposal for rendering. Writes nothing. |

**There is deliberately no tool that writes to the calendar.** Committing is a
button. This is what makes running a weaker free model safe: a bad turn produces
a bad suggestion you reject, not a corrupted calendar.

### 4. Server-side proposal validation

`propose_schedule` validates before returning, and returns errors *to the model*
as a tool result so it can correct itself within the same turn:

- Every block falls inside an open slot.
- No block overlaps another proposed block.
- Duration is 5–720 minutes; end is after start.
- Nothing scheduled in the past.

A 70B model will produce overlapping or out-of-hours blocks. Catching it here
rather than in the UI means the user sees a correct proposal, not an error.
Capped at 2 correction rounds before surfacing what it managed.

### 5. Storage — `src/lib/repository/`

Goals, tasks and scheduled blocks need persistence, and Supabase does not exist
yet. Same split already used for profile and calendar settings:

```
goals.ts    tasks.ts    blocks.ts
```

Each reads/writes Supabase when configured, and `.preview-store.json` otherwise.
The preview path is dev-only and disabled in production.

### 6. Commit flow

1. Model calls `propose_schedule`; validated proposal is rendered as a card.
2. User edits times, drops blocks, or accepts.
3. **Commit to Calendar** (server action):
   - Create `tasks` rows (normalising `task_type` to a slug)
   - Create `scheduled_blocks` as `proposed`
   - Write each to the Planner calendar via the Phase 2 provider
   - Store `caldav_uid` / `caldav_etag`, flip status to `committed`
4. Partial failure: blocks that wrote successfully stay `committed`; the rest
   stay `proposed` and the UI reports exactly which failed. No silent half-state.

## Data flow

```
user message
  → planner loop (Groq)
      → get_open_slots  → slots.ts ← profile + live iCloud read
      → propose_schedule → validate → proposal
  → proposal card (editable)
  → [Commit] → repository + iCloud write
  → week grid
```

## Error handling

| Failure | Behaviour |
|---|---|
| iCloud unreachable | Planning refuses rather than proposing against unknown commitments. A wrong proposal is worse than none. |
| LLM rate limit (Groq free tier) | Surface "rate limited, try again in a moment" — not a stack trace. |
| Model emits no valid proposal after 2 corrections | Show its text reply and the open slots; let the user schedule manually. |
| Calendar write fails mid-commit | Per-block status; report which landed. |
| `working_hours` empty for every day | Explain that nothing can be scheduled and link to Settings. |

## Testing

Extends the existing `npm run check`.

- `scripts/slots-check.mts` — pure unit checks on the slot finder: buffers,
  overlapping events, all-day events, empty days, DST boundary days, events
  straddling midnight, availability fully consumed.
- `scripts/planner-check.mts` — proposal validation against fixtures: overlapping
  blocks rejected, out-of-hours rejected, past rejected, valid accepted.
- Manual end-to-end: ask for four videos this week, confirm the proposal avoids
  known commitments, commit, verify in the week grid and on the iPhone.

The slot finder is pure, so it is tested without network, database, or model.

## Deferred: social layer (friends + weekly leaderboard)

Recorded here so it is not lost. Needs its own spec.

**Dependencies:** Supabase project, real magic-link auth, more than one account.

**The design problem to solve first.** The adaptation engine depends on Hadi
honestly reporting what he missed and why — that is the entire product premise.
A leaderboard rewards *looking* productive, which is a direct incentive to mark
undone work as done. Those two features pull against each other.

The fix is a decision about what gets scored, not something to patch later.
Candidates to explore when we design it:

- Score *honesty and consistency* (check-ins completed, reasons given) rather
  than completion rate.
- Score completion but keep stated reasons strictly private, never shared.
- Compare each person against their own trend, not against each other.

Do not build the leaderboard before that decision is made.

## Verification checklist

- [ ] `npm run check` passes, including the two new script suites
- [ ] `npm run build` clean
- [ ] Planning conversation asks a clarifying question before proposing
- [ ] Proposal respects `working_hours`, buffers, and existing iCloud events
- [ ] Committed blocks appear in the Planner calendar on the iPhone
- [ ] Nothing reaches the calendar without a click
- [ ] Switching `LLM_PROVIDER` to `anthropic` works with no code change
