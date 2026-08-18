import "server-only";
import { DateTime } from "luxon";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { resolveModel } from "./provider";
import type { SessionUser } from "@/lib/auth";
import type { Profile } from "@/lib/profile";
import { getProviderForUser } from "@/lib/calendar/connection";
import {
  getCalendarSettings,
  readableCalendarIds,
} from "@/lib/calendar/registry";
import {
  findOpenSlots,
  fitsInOpenSlot,
  overlapsAny,
  type BusyInterval,
  type OpenSlot,
} from "@/lib/scheduling/slots";
import { listBlocks, normaliseTaskType } from "@/lib/repository/plan";
import { getAdaptation } from "@/lib/repository/adaptation";
import { activeRules } from "@/lib/adaptation/rules";
import { SLOT_BUCKET_LABELS } from "@/lib/time";

export type ProposedBlock = {
  title: string;
  taskType: string;
  plannedStart: string;
  plannedEnd: string;
  rationale?: string;
};

export type AppliedRule = {
  taskType: string;
  slotLabel: string;
  timesMissed: number;
  /** The user's own words, verbatim. */
  quotes: string[];
};

export type PlannerResult = {
  reply: string;
  proposal: ProposedBlock[] | null;
  /** Present when the model produced blocks the validator rejected outright. */
  warnings: string[];
  /**
   * Rules that shaped this proposal. Surfaced by the app rather than left to
   * the model: whether adaptation is visible should not depend on a small
   * model remembering to mention it.
   */
  appliedRules: AppliedRule[];
};

const MAX_STEPS = 8;
const HORIZON_DAYS = 14;

/**
 * Runs one planning turn.
 *
 * The model can read the calendar and the open slots, and it can *propose* a
 * schedule. There is deliberately no tool that writes to the calendar —
 * committing is a button the user presses. That boundary is what makes it
 * safe to run this on a small free-tier model.
 */
export async function runPlannerTurn(params: {
  user: SessionUser;
  profile: Profile;
  messages: ModelMessage[];
}): Promise<PlannerResult> {
  const { user, profile, messages } = params;
  const zone = profile.timezone;
  const now = DateTime.now().setZone(zone);

  const windowStart = now.startOf("day");
  const windowEnd = windowStart.plus({ days: HORIZON_DAYS });
  const from = windowStart.toUTC().toISO()!;
  const to = windowEnd.toUTC().toISO()!;

  // Read the calendar once per turn and reuse it for every tool call.
  const busy = await loadBusy(user, profile, from, to);
  const slotsFor = (minMinutes: number) =>
    findOpenSlots({
      profile,
      busy,
      from,
      to,
      minMinutes,
      now: now.toUTC().toISO()!,
    });

  let proposal: ProposedBlock[] | null = null;
  const warnings: string[] = [];
  const consultedRules = new Map<string, AppliedRule>();

  const tools = {
    get_week_overview: tool({
      description:
        "List the user's fixed commitments and already-scheduled blocks for the next two weeks.",
      inputSchema: z.object({}),
      execute: async () => ({
        timezone: zone,
        today: now.toFormat("cccc d LLLL yyyy"),
        commitments: busy.map((item) => ({
          title: item.title ?? "(busy)",
          day: DateTime.fromISO(item.startsAt).setZone(zone).toFormat("ccc d LLL"),
          time: item.allDay
            ? "all day"
            : `${DateTime.fromISO(item.startsAt).setZone(zone).toFormat("HH:mm")}–${DateTime.fromISO(item.endsAt).setZone(zone).toFormat("HH:mm")}`,
        })),
      }),
    }),

    get_open_slots: tool({
      description:
        "Free time the user is available to be scheduled in, already excluding fixed commitments and buffers. Only propose blocks that fit inside these.",
      inputSchema: z.object({
        min_minutes: z
          .number()
          .int()
          .min(15)
          .max(480)
          .describe("Shortest useful slot for the task at hand."),
      }),
      execute: async ({ min_minutes }) => ({
        timezone: zone,
        slots: slotsFor(min_minutes).map((slot) => describeSlot(slot, zone)),
      }),
    }),

    get_adaptation_context: tool({
      description:
        "Reasons the user previously gave for missing this kind of task, and the scheduling rules derived from them. ALWAYS call this before proposing times.",
      inputSchema: z.object({
        task_types: z
          .array(z.string())
          .describe("Normalised task types, e.g. ['editing', 'filming']"),
      }),
      execute: async ({ task_types }) => {
        const normalised = task_types.map(normaliseTaskType);
        const snapshot = await getAdaptation(user, { taskTypes: normalised });
        const live = activeRules(snapshot.rules);

        if (live.length === 0 && snapshot.emerging.length === 0) {
          return {
            rules: [],
            note: "Nothing on record for these task types yet. Schedule normally.",
          };
        }

        for (const rule of live) {
          consultedRules.set(rule.taskType, {
            taskType: rule.taskType,
            slotLabel: SLOT_BUCKET_LABELS[rule.bucket],
            timesMissed: rule.confidenceCount,
            quotes: rule.reasons.map((reason) => reason.reasonText),
          });
        }

        return {
          rules: live.map((rule) => ({
            task_type: rule.taskType,
            avoid_slot: SLOT_BUCKET_LABELS[rule.bucket],
            times_missed: rule.confidenceCount,
            // Verbatim, so the proposal can quote rather than paraphrase.
            their_words: rule.reasons.map((reason) => reason.reasonText),
          })),
          watching: snapshot.emerging.map((pattern) => ({
            task_type: pattern.taskType,
            slot: SLOT_BUCKET_LABELS[pattern.bucket],
            times_missed: pattern.reasons.length,
          })),
          instruction:
            "Do not schedule these task types in the slots listed under `rules`. In your reply, say which slot you moved away from and quote their words back to them.",
        };
      },
    }),

    propose_schedule: tool({
      description:
        "Propose blocks for the user to review. This does NOT write to their calendar — they approve it separately. Returns validation errors if any block is invalid; fix them and call again.",
      inputSchema: z.object({
        blocks: z
          .array(
            z.object({
              title: z.string().min(1).describe("What the user will be doing."),
              task_type: z
                .string()
                .min(1)
                .describe("Short category, e.g. 'editing', 'filming', 'gym'."),
              start: z
                .string()
                .describe("ISO 8601 with offset, e.g. 2026-08-12T18:00:00-05:00"),
              end: z.string().describe("ISO 8601 with offset."),
              rationale: z
                .string()
                .optional()
                .describe("One short line on why this time."),
            }),
          )
          .min(1)
          .max(20),
      }),
      execute: async ({ blocks }) => {
        const slots = slotsFor(15);
        const accepted: ProposedBlock[] = [];
        const errors: string[] = [];

        for (const block of blocks) {
          const start = DateTime.fromISO(block.start, { zone });
          const end = DateTime.fromISO(block.end, { zone });
          const label = `"${block.title}"`;

          if (!start.isValid || !end.isValid) {
            errors.push(`${label}: unparseable start or end time.`);
            continue;
          }
          if (end <= start) {
            errors.push(`${label}: end is not after start.`);
            continue;
          }
          const minutes = end.diff(start, "minutes").minutes;
          if (minutes < 5 || minutes > 720) {
            errors.push(`${label}: ${Math.round(minutes)} minutes is out of range (5–720).`);
            continue;
          }
          if (start < now) {
            errors.push(`${label}: ${start.toFormat("ccc d LLL HH:mm")} is in the past. Today is ${now.toFormat("cccc d LLLL yyyy")}.`);
            continue;
          }

          const candidate = {
            startsAt: start.toUTC().toISO()!,
            endsAt: end.toUTC().toISO()!,
          };

          if (!fitsInOpenSlot(candidate, slots)) {
            errors.push(
              `${label} at ${start.toFormat("ccc HH:mm")}–${end.toFormat("HH:mm")}: outside the user's available hours or clashes with a commitment. Call get_open_slots and pick a time inside one of those.`,
            );
            continue;
          }
          if (overlapsAny(candidate, accepted.map((b) => ({ startsAt: b.plannedStart, endsAt: b.plannedEnd })))) {
            errors.push(`${label}: overlaps another block in this same proposal.`);
            continue;
          }

          accepted.push({
            title: block.title,
            taskType: normaliseTaskType(block.task_type),
            plannedStart: candidate.startsAt,
            plannedEnd: candidate.endsAt,
            rationale: block.rationale,
          });
        }

        if (errors.length > 0 && accepted.length === 0) {
          // Hand the errors back so the model can correct itself this turn.
          return { accepted: 0, errors, hint: "Every block was rejected. Fix them and call propose_schedule again." };
        }

        proposal = accepted;
        warnings.push(...errors);

        return {
          accepted: accepted.length,
          errors,
          message:
            errors.length > 0
              ? "Some blocks were rejected; the rest are shown to the user for approval."
              : "Proposal shown to the user for approval. Summarise it briefly and stop.",
        };
      },
    }),
  };

  const result = await withToolCallRetry(() =>
    generateText({
      model: resolveModel(),
      system: systemPrompt(profile, now),
      messages,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
    }),
  );

  // The cast defeats TypeScript's narrowing: `proposal` is only ever assigned
  // inside a tool callback, which control-flow analysis cannot see, so it
  // still believes the value is null here.
  const finalProposal = proposal as ProposedBlock[] | null;
  const proposedTypes = new Set(
    (finalProposal ?? []).map((block) => block.taskType),
  );
  const appliedRules = [...consultedRules.values()].filter((rule) =>
    proposedTypes.has(rule.taskType),
  );

  return {
    reply: result.text.trim(),
    proposal,
    warnings,
    appliedRules,
  };
}

// ---------------------------------------------------------------------------

/**
 * Smaller models occasionally emit a malformed tool call and the provider
 * rejects the whole generation. It is transient — the same prompt usually
 * succeeds on the next attempt — so retry once rather than surfacing a
 * meaningless error. Rate limits are NOT retried here: they need a wait, and
 * hammering makes them worse.
 */
async function withToolCallRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transient = /failed to call a function|tool.?call/i.test(message);
    const rateLimited = /rate.?limit|429|quota/i.test(message);
    if (!transient || rateLimited) throw error;

    return run();
  }
}

async function loadBusy(
  user: SessionUser,
  profile: Profile,
  from: string,
  to: string,
): Promise<BusyInterval[]> {
  const { provider, connected } = await getProviderForUser(user, {
    zone: profile.timezone,
  });

  const settings = connected ? await getCalendarSettings(user) : [];
  const calendarIds = connected
    ? readableCalendarIds(settings)
    : (await provider.listCalendars()).map((calendar) => calendar.id);

  const events = await provider.listEvents(calendarIds, from, to);

  // Blocks already on the calendar count as busy too, so a second planning
  // turn doesn't double-book time the first one claimed.
  const existing = await listBlocks(user, { from, to });

  return [
    ...events.map((event) => ({
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      title: event.title,
      allDay: event.allDay,
    })),
    ...existing
      .filter((block) => block.status === "committed" || block.status === "proposed")
      .map((block) => ({
        startsAt: block.plannedStart,
        endsAt: block.plannedEnd,
        title: block.title,
      })),
  ];
}

function describeSlot(slot: OpenSlot, zone: string) {
  const start = DateTime.fromISO(slot.startsAt).setZone(zone);
  const end = DateTime.fromISO(slot.endsAt).setZone(zone);
  return {
    day: start.toFormat("cccc d LLL"),
    from: start.toFormat("HH:mm"),
    to: end.toFormat("HH:mm"),
    minutes: slot.minutes,
    // Full offset form, so the model can copy it straight back without
    // having to reason about timezones.
    start_iso: start.toISO(),
    end_iso: end.toISO(),
  };
}

function systemPrompt(profile: Profile, now: DateTime): string {
  const availability = Object.entries(profile.working_hours)
    .map(([day, windows]) => {
      const name = now.set({ weekday: Number(day) as 1 }).toFormat("cccc");
      return windows.length === 0
        ? `${name}: unavailable`
        : `${name}: ${windows.map((w) => `${w.start}–${w.end}`).join(", ")}`;
    })
    .join("\n");

  return `You help one person plan their week. You are direct and brief.

# Right now
Today is ${now.toFormat("cccc d LLLL yyyy")} and the local time is ${now.toFormat("HH:mm")}.
Their timezone is ${profile.timezone}.
You do not know the date from your training data — always use the date above, and prefer the exact ISO strings returned by get_open_slots over composing your own.

# When they are available
${availability}

These hours are the outer boundary of when anything may be scheduled — they are not their job. Their fixed commitments come from their calendar. Never propose a time outside these hours.

# How to work
1. If the request is vague about scope, duration, or deadline, ask ONE clarifying question before proposing anything. Do not ask more than one; do not ask about things you can look up.
2. Call get_adaptation_context for the task types involved, then get_open_slots.
3. Call propose_schedule with concrete blocks.
4. If propose_schedule returns errors, fix those blocks and call it again. Do not apologise at length — just correct it.
5. Once a proposal is accepted, write two or three sentences on what you scheduled and why. Then stop.

# Rules
- Never claim you have added anything to their calendar. You propose; they approve. Say "here's a proposal" and nothing stronger.
- Treat get_adaptation_context as binding. If it lists a slot to avoid for a task type, do not put that task type there — pick a different slot.
- When you avoid a slot because of it, say so in one short sentence and quote what they said, e.g.: moving editing off the early morning — you said "I just wasn't awake yet". Never adapt silently, and never invent a reason they did not give.
- Break big goals into concrete sessions ("Edit video 2", not "video work").
- Leave the day some slack. Filling every open slot is a plan nobody follows.
- Use their words for task types where you can.`;
}
