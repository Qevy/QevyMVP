"use server";

import { revalidatePath } from "next/cache";
import type { ModelMessage } from "ai";
import { getProfile, requireUser } from "@/lib/auth";
import { LlmNotConfiguredError, modelLabel } from "@/lib/ai/provider";
import {
  runPlannerTurn,
  type AppliedRule,
  type ProposedBlock,
} from "@/lib/ai/planner";
import { getProviderForUser } from "@/lib/calendar/connection";
import { createPlan, markCommitted, deleteBlock } from "@/lib/repository/plan";
import { CalendarAuthError } from "@/lib/calendar/types";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type PlannerResponse = {
  ok: boolean;
  reply: string;
  proposal: ProposedBlock[] | null;
  warnings: string[];
  appliedRules: AppliedRule[];
  error?: string;
};

export async function sendPlannerMessage(
  history: ChatTurn[],
): Promise<PlannerResponse> {
  const user = await requireUser();
  const profile = await getProfile(user);

  const messages: ModelMessage[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  try {
    const result = await runPlannerTurn({ user, profile, messages });
    return {
      ok: true,
      reply: result.reply,
      proposal: result.proposal,
      warnings: result.warnings,
      appliedRules: result.appliedRules,
    };
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      return { ok: false, reply: "", proposal: null, warnings: [], appliedRules: [], error: error.message };
    }
    if (error instanceof CalendarAuthError) {
      return {
        ok: false,
        reply: "",
        proposal: null,
        warnings: [],
        appliedRules: [],
        // Planning against an unknown calendar would be worse than refusing.
        error: `Can't read your calendar, so I won't guess at your availability. ${error.message}`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    const rateLimited = /rate.?limit|429|quota/i.test(message);
    return {
      ok: false,
      reply: "",
      proposal: null,
      warnings: [],
      appliedRules: [],
      error: rateLimited
        ? `${modelLabel()} is rate limited. Wait a moment and try again.`
        : message,
    };
  }
}

export type CommitResult = {
  committed: number;
  failed: { title: string; reason: string }[];
};

/**
 * The only path that writes to the calendar, and it runs because the user
 * clicked a button — never because the model decided to.
 *
 * Partial failure is reported per block rather than rolled back: a block that
 * reached iCloud stays committed, and the user is told exactly which didn't.
 */
export async function commitProposal(
  blocks: ProposedBlock[],
): Promise<CommitResult> {
  const user = await requireUser();
  const profile = await getProfile(user);

  if (!profile.planner_calendar_id) {
    return {
      committed: 0,
      failed: blocks.map((block) => ({
        title: block.title,
        reason: "No Planner calendar yet — create one in Settings → iCloud Calendar.",
      })),
    };
  }

  const { provider } = await getProviderForUser(user, { zone: profile.timezone });
  const stored = await createPlan(
    user,
    blocks.map((block) => ({
      title: block.title,
      taskType: block.taskType,
      plannedStart: block.plannedStart,
      plannedEnd: block.plannedEnd,
    })),
    profile.timezone,
  );

  const failed: CommitResult["failed"] = [];
  let committed = 0;

  for (const block of stored) {
    try {
      const written = await provider.createEvent(profile.planner_calendar_id, {
        title: block.title,
        description: "Scheduled by Planner.",
        startsAt: block.plannedStart,
        endsAt: block.plannedEnd,
      });
      await markCommitted(user, block.id, written.uid, written.etag);
      committed++;
    } catch (error) {
      // Leave no orphan: a block that never reached the calendar shouldn't
      // linger as a phantom commitment in the app either.
      await deleteBlock(user, block.id);
      failed.push({
        title: block.title,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  revalidatePath("/");
  revalidatePath("/plan");

  return { committed, failed };
}
