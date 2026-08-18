import "server-only";
import { DateTime } from "luxon";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { resolveModel } from "./provider";
import type { SessionUser } from "@/lib/auth";
import type { Profile } from "@/lib/profile";
import { listBlocks, type ScheduledBlock } from "@/lib/repository/plan";
import {
  recordReason,
  REASON_CATEGORIES,
  type Checkin,
} from "@/lib/repository/reasons";
import { SLOT_BUCKET_LABELS } from "@/lib/time";

export type CheckinTurnResult = {
  reply: string;
  /** Reasons captured during this turn, for optimistic display. */
  captured: { blockTitle: string; reasonText: string }[];
  finished: boolean;
  summary: string | null;
};

const MAX_STEPS = 10;

/**
 * One turn of the weekly check-in.
 *
 * The model's job is to have a real conversation about what did and didn't
 * happen, and to write down the reason in the user's own words. It is
 * explicitly forbidden from inventing a reason — an unanswered block simply
 * stays unanswered, because a fabricated reason would poison every future
 * schedule that consults it.
 */
export async function runCheckinTurn(params: {
  user: SessionUser;
  profile: Profile;
  checkin: Checkin;
  messages: ModelMessage[];
}): Promise<CheckinTurnResult> {
  const { user, profile, checkin, messages } = params;
  const zone = profile.timezone;

  const blocks = await loadPeriodBlocks(user, profile, checkin);
  const byId = new Map(blocks.map((block) => [block.id, block]));

  const captured: CheckinTurnResult["captured"] = [];
  let finished = false;
  let summary: string | null = null;

  const tools = {
    get_unresolved_blocks: tool({
      description:
        "Blocks from the review week that were missed, only partly done, or never marked. These are what the conversation is about.",
      inputSchema: z.object({}),
      execute: async () => ({
        timezone: zone,
        blocks: blocks
          .filter((block) => block.status !== "done")
          .map((block) => describeBlock(block, zone)),
        completed: blocks.filter((block) => block.status === "done").length,
      }),
    }),

    record_reason: tool({
      description:
        "Store why a block did not happen, in the user's own words. Only call this after they have actually told you. Never invent or guess a reason.",
      inputSchema: z.object({
        block_id: z.string().describe("id from get_unresolved_blocks"),
        reason_text: z
          .string()
          .min(3)
          .describe(
            "The user's own words, quoted as closely as possible. Not your paraphrase.",
          ),
        category: z
          .enum(REASON_CATEGORIES)
          .describe(
            "sleep, energy, time_conflict, motivation, underestimated, external, or other",
          ),
      }),
      execute: async ({ block_id, reason_text, category }) => {
        const block = byId.get(block_id);
        if (!block) {
          return {
            ok: false,
            error: `No block with id ${block_id}. Use an id from get_unresolved_blocks.`,
          };
        }

        await recordReason(user, {
          scheduledBlockId: block.id,
          checkinId: checkin.id,
          taskType: block.taskType,
          bucket: block.bucket,
          dayOfWeek: block.dayOfWeek,
          reasonText: reason_text.trim(),
          category,
          source: "checkin",
        });

        captured.push({ blockTitle: block.title, reasonText: reason_text.trim() });

        return {
          ok: true,
          message: `Recorded against ${block.taskType} in the ${SLOT_BUCKET_LABELS[block.bucket].toLowerCase()} slot.`,
        };
      },
    }),

    finish_checkin: tool({
      description:
        "End the check-in once every block has been discussed or the user wants to stop.",
      inputSchema: z.object({
        summary: z
          .string()
          .min(1)
          .describe("Two or three sentences on the week and any pattern you noticed."),
      }),
      execute: async ({ summary: text }) => {
        finished = true;
        summary = text.trim();
        return { ok: true };
      },
    }),
  };

  const result = await generateText({
    model: resolveModel(),
    system: systemPrompt(profile, checkin, blocks, zone),
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  return { reply: result.text.trim(), captured, finished, summary };
}

// ---------------------------------------------------------------------------

async function loadPeriodBlocks(
  user: SessionUser,
  profile: Profile,
  checkin: Checkin,
): Promise<ScheduledBlock[]> {
  const from = DateTime.fromISO(checkin.periodStart, { zone: profile.timezone })
    .startOf("day")
    .toUTC()
    .toISO()!;
  const to = DateTime.fromISO(checkin.periodEnd, { zone: profile.timezone })
    .plus({ days: 1 })
    .startOf("day")
    .toUTC()
    .toISO()!;

  const blocks = await listBlocks(user, { from, to });
  // Proposals that were never committed never existed as far as the week is
  // concerned — asking about them would be asking about a plan the user
  // declined.
  return blocks.filter((block) => block.status !== "proposed" && block.status !== "cancelled");
}

function describeBlock(block: ScheduledBlock, zone: string) {
  const start = DateTime.fromISO(block.plannedStart).setZone(zone);
  const end = DateTime.fromISO(block.plannedEnd).setZone(zone);
  return {
    id: block.id,
    title: block.title,
    task_type: block.taskType,
    when: `${start.toFormat("cccc d LLL")} ${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`,
    slot: SLOT_BUCKET_LABELS[block.bucket],
    status:
      block.status === "committed" ? "not marked either way" : block.status,
  };
}

function systemPrompt(
  profile: Profile,
  checkin: Checkin,
  blocks: ScheduledBlock[],
  zone: string,
): string {
  const start = DateTime.fromISO(checkin.periodStart, { zone });
  const end = DateTime.fromISO(checkin.periodEnd, { zone });
  const done = blocks.filter((b) => b.status === "done").length;

  return `You are running a weekly check-in with one person about the week of ${start.toFormat("d LLLL")} to ${end.toFormat("d LLLL yyyy")}.

They scheduled ${blocks.length} block${blocks.length === 1 ? "" : "s"} that week and completed ${done}.

# What this is for
Later, when planning their week, the app looks up the reasons they gave here and stops proposing times that demonstrably do not work for them. That only works if what you record is what they actually said. A reason you made up would quietly corrupt every future schedule.

# How to run it
1. Call get_unresolved_blocks first.
2. Open with what went well — mention the blocks they did complete before asking about the rest.
3. Take the unfinished blocks a couple at a time, not as an interrogation. Ask what happened.
4. When they give you a reason, call record_reason with their own words. Quote them; do not tidy their phrasing into something more presentable.
5. If an answer is vague ("just didn't get to it", "no reason"), ask ONE follow-up to find the actual obstacle — were they tired, was something else running over, did the task turn out bigger than expected? If they still have nothing concrete, accept it, record what they said as-is with category "other", and move on. Do not press twice.
6. When everything has been covered, or they want to stop, call finish_checkin.

# Rules
- Never invent a reason. If they did not say it, do not record it.
- Never record your own interpretation in place of their words. You may set the category yourself; reason_text is theirs.
- Do not lecture, moralise, or tell them how to fix it. You are taking notes, not coaching.
- One question at a time. Keep replies to a few sentences.
- If they mention a pattern themselves ("mornings never work for me"), that is worth recording against the relevant blocks.
- Their timezone is ${profile.timezone}. Today is ${DateTime.now().setZone(zone).toFormat("cccc d LLLL yyyy")}.`;
}
