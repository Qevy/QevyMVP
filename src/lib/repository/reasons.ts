import "server-only";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { createClient } from "@/lib/supabase/server";
import { previewGet, previewSet } from "@/lib/preview-store";
import type { SessionUser } from "@/lib/auth";
import type { Profile } from "@/lib/profile";
import type { SlotBucket } from "@/lib/time";

/**
 * Weekly check-ins and the reasons they capture.
 *
 * reasonText holds the user's own words, verbatim. Adaptation quotes it back
 * rather than paraphrasing, and there is deliberately nowhere to store a
 * reason the user did not actually say.
 */

export const REASON_CATEGORIES = [
  "sleep",
  "energy",
  "time_conflict",
  "motivation",
  "underestimated",
  "external",
  "other",
] as const;

export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export type Reason = {
  id: string;
  scheduledBlockId: string | null;
  checkinId: string | null;
  taskType: string;
  bucket: SlotBucket;
  dayOfWeek: number | null;
  reasonText: string;
  category: ReasonCategory;
  source: "checkin" | "chat";
  statedAt: string;
};

export type CheckinStatus = "open" | "in_progress" | "completed";

export type Checkin = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: CheckinStatus;
  transcript: { role: "user" | "assistant"; content: string }[];
  summary: string | null;
  completedAt: string | null;
};

const reasonsKey = (user: SessionUser) => `reasons:${user.id}`;
const checkinsKey = (user: SessionUser) => `checkins:${user.id}`;

// ---------------------------------------------------------------------------
// Check-in windows
// ---------------------------------------------------------------------------

/**
 * The week a check-in covers: the seven days ending on the most recent
 * check-in day. Reviewing a week you are still living makes no sense.
 */
export function currentCheckinPeriod(
  profile: Profile,
  now: DateTime,
): { periodStart: string; periodEnd: string } {
  const local = now.setZone(profile.timezone);

  let end = local.set({ weekday: profile.checkin_weekday as 1 }).startOf("day");
  if (end > local.startOf("day")) end = end.minus({ weeks: 1 });

  return {
    periodStart: end.minus({ days: 7 }).toISODate()!,
    periodEnd: end.toISODate()!,
  };
}

/** Has the chosen day and hour passed for the current period? */
export function isCheckinDue(profile: Profile, now: DateTime): boolean {
  const local = now.setZone(profile.timezone);
  const { periodEnd } = currentCheckinPeriod(profile, now);

  const dueAt = DateTime.fromISO(periodEnd, { zone: profile.timezone }).set({
    hour: profile.checkin_hour,
  });

  return local >= dueAt;
}

// ---------------------------------------------------------------------------
// Check-ins
// ---------------------------------------------------------------------------

export async function getCheckin(
  user: SessionUser,
  periodStart: string,
): Promise<Checkin | null> {
  if (user.isPreview) {
    const all = previewGet<Checkin[]>(checkinsKey(user)) ?? [];
    return all.find((c) => c.periodStart === periodStart) ?? null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("checkins")
    .select(
      "id, period_start, period_end, status, transcript, summary, completed_at",
    )
    .eq("user_id", user.id)
    .eq("period_start", periodStart)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    periodStart: data.period_start,
    periodEnd: data.period_end,
    status: data.status as CheckinStatus,
    transcript: (data.transcript ?? []) as Checkin["transcript"],
    summary: data.summary,
    completedAt: data.completed_at,
  };
}

export async function openCheckin(
  user: SessionUser,
  periodStart: string,
  periodEnd: string,
): Promise<Checkin> {
  const existing = await getCheckin(user, periodStart);
  if (existing) return existing;

  const checkin: Checkin = {
    id: randomUUID(),
    periodStart,
    periodEnd,
    status: "in_progress",
    transcript: [],
    summary: null,
    completedAt: null,
  };

  if (user.isPreview) {
    previewSet(checkinsKey(user), [
      ...(previewGet<Checkin[]>(checkinsKey(user)) ?? []),
      checkin,
    ]);
    return checkin;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("checkins").insert({
    id: checkin.id,
    user_id: user.id,
    period_start: periodStart,
    period_end: periodEnd,
    status: checkin.status,
  });
  if (error) throw error;

  return checkin;
}

export async function saveCheckin(
  user: SessionUser,
  checkinId: string,
  patch: Partial<
    Pick<Checkin, "status" | "transcript" | "summary" | "completedAt">
  >,
): Promise<void> {
  // Drop undefined keys before merging: spreading `{summary: undefined}`
  // over a stored check-in would erase a summary that was already written.
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );

  if (user.isPreview) {
    const all = previewGet<Checkin[]>(checkinsKey(user)) ?? [];
    previewSet(
      checkinsKey(user),
      all.map((c) => (c.id === checkinId ? { ...c, ...defined } : c)),
    );
    return;
  }

  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.transcript !== undefined) row.transcript = patch.transcript;
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;

  const { error } = await supabase
    .from("checkins")
    .update(row)
    .eq("user_id", user.id)
    .eq("id", checkinId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Reasons
// ---------------------------------------------------------------------------

/**
 * Store why a block did not happen.
 *
 * Idempotent per (check-in, block): a model re-reading the conversation will
 * happily call this again for a block it already covered, and duplicates are
 * not harmless here — adaptation promotes a rule at two matching reasons, so
 * a double-write would turn one statement into a fake pattern. The latest
 * wording wins, which is also what you want when the user elaborates.
 */
export async function recordReason(
  user: SessionUser,
  reason: Omit<Reason, "id" | "statedAt">,
): Promise<Reason> {
  const stored: Reason = {
    ...reason,
    id: randomUUID(),
    statedAt: new Date().toISOString(),
  };

  const isDuplicate = (candidate: Reason) =>
    candidate.checkinId !== null &&
    candidate.checkinId === reason.checkinId &&
    candidate.scheduledBlockId !== null &&
    candidate.scheduledBlockId === reason.scheduledBlockId;

  if (user.isPreview) {
    const all = previewGet<Reason[]>(reasonsKey(user)) ?? [];
    const existing = all.find(isDuplicate);

    if (existing) {
      const updated = { ...existing, ...reason, id: existing.id, statedAt: stored.statedAt };
      previewSet(
        reasonsKey(user),
        all.map((item) => (item.id === existing.id ? updated : item)),
      );
      return updated;
    }

    previewSet(reasonsKey(user), [...all, stored]);
    return stored;
  }

  if (reason.checkinId && reason.scheduledBlockId) {
    const supabaseDedupe = await createClient();
    const { data: prior, error: priorError } = await supabaseDedupe
      .from("reasons")
      .select("id")
      .eq("user_id", user.id)
      .eq("checkin_id", reason.checkinId)
      .eq("scheduled_block_id", reason.scheduledBlockId)
      .maybeSingle();
    if (priorError) throw priorError;

    if (prior) {
      const { error: updateError } = await supabaseDedupe
        .from("reasons")
        .update({
          reason_text: stored.reasonText,
          category: stored.category,
          stated_at: stored.statedAt,
        })
        .eq("user_id", user.id)
        .eq("id", prior.id);
      if (updateError) throw updateError;
      return { ...stored, id: prior.id };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("reasons").insert({
    id: stored.id,
    user_id: user.id,
    scheduled_block_id: stored.scheduledBlockId,
    checkin_id: stored.checkinId,
    task_type: stored.taskType,
    bucket: stored.bucket,
    day_of_week: stored.dayOfWeek,
    reason_text: stored.reasonText,
    category: stored.category,
    source: stored.source,
    stated_at: stored.statedAt,
  });
  if (error) throw error;

  return stored;
}

export async function listReasons(
  user: SessionUser,
  filter?: { taskTypes?: string[] },
): Promise<Reason[]> {
  if (!user.isPreview) {
    const supabase = await createClient();
    let query = supabase
      .from("reasons")
      .select(
        "id, scheduled_block_id, checkin_id, task_type, bucket, day_of_week, reason_text, category, source, stated_at",
      )
      .eq("user_id", user.id)
      .order("stated_at", { ascending: false });

    if (filter?.taskTypes && filter.taskTypes.length > 0) {
      query = query.in("task_type", filter.taskTypes);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((row) => ({
      id: row.id,
      scheduledBlockId: row.scheduled_block_id,
      checkinId: row.checkin_id,
      taskType: row.task_type,
      bucket: row.bucket as SlotBucket,
      dayOfWeek: row.day_of_week,
      reasonText: row.reason_text,
      category: row.category as ReasonCategory,
      source: row.source as Reason["source"],
      statedAt: row.stated_at,
    }));
  }

  let all = previewGet<Reason[]>(reasonsKey(user)) ?? [];
  if (filter?.taskTypes && filter.taskTypes.length > 0) {
    const wanted = new Set(filter.taskTypes);
    all = all.filter((reason) => wanted.has(reason.taskType));
  }

  return all.sort((a, b) => b.statedAt.localeCompare(a.statedAt));
}
