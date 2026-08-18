"use server";

import { revalidatePath } from "next/cache";
import { DateTime } from "luxon";
import type { ModelMessage } from "ai";
import { getProfile, requireUser } from "@/lib/auth";
import { LlmNotConfiguredError, modelLabel } from "@/lib/ai/provider";
import { runCheckinTurn } from "@/lib/ai/checkin";
import {
  currentCheckinPeriod,
  openCheckin,
  saveCheckin,
} from "@/lib/repository/reasons";

export type CheckinTurn = { role: "user" | "assistant"; content: string };

export type CheckinResponse = {
  ok: boolean;
  reply: string;
  captured: { blockTitle: string; reasonText: string }[];
  finished: boolean;
  summary: string | null;
  error?: string;
};

/**
 * Advance the check-in by one turn.
 *
 * The transcript is persisted after every turn rather than at the end: a
 * check-in abandoned halfway still leaves the reasons it captured, and those
 * are the valuable part.
 */
export async function sendCheckinMessage(
  history: CheckinTurn[],
): Promise<CheckinResponse> {
  const user = await requireUser();
  const profile = await getProfile(user);

  const { periodStart, periodEnd } = currentCheckinPeriod(
    profile,
    DateTime.now(),
  );
  const checkin = await openCheckin(user, periodStart, periodEnd);

  const messages: ModelMessage[] = history.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  try {
    const result = await runCheckinTurn({ user, profile, checkin, messages });

    const transcript = [
      ...history,
      { role: "assistant" as const, content: result.reply },
    ];

    await saveCheckin(user, checkin.id, {
      transcript,
      status: result.finished ? "completed" : "in_progress",
      summary: result.summary ?? undefined,
      completedAt: result.finished ? new Date().toISOString() : undefined,
    });

    revalidatePath("/checkin");
    revalidatePath("/today");

    return {
      ok: true,
      reply: result.reply,
      captured: result.captured,
      finished: result.finished,
      summary: result.summary,
    };
  } catch (error) {
    if (error instanceof LlmNotConfiguredError) {
      return {
        ok: false,
        reply: "",
        captured: [],
        finished: false,
        summary: null,
        error: error.message,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    const rateLimited = /rate.?limit|429|quota/i.test(message);
    return {
      ok: false,
      reply: "",
      captured: [],
      finished: false,
      summary: null,
      error: rateLimited
        ? `${modelLabel()} is rate limited. Wait a moment and try again.`
        : message,
    };
  }
}
