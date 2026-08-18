import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { previewGet, previewSet } from "@/lib/preview-store";
import type { SessionUser } from "@/lib/auth";
import { slotBucketFor, weekdayFor, type SlotBucket } from "@/lib/time";

/**
 * Goals, tasks and scheduled blocks.
 *
 * Same dual-backend split used elsewhere: Supabase when configured, the
 * on-disk preview store otherwise. Kept in one module because a committed
 * plan writes tasks and blocks together and they are only ever read together.
 */

export type BlockStatus =
  | "proposed"
  | "committed"
  | "done"
  | "missed"
  | "partial"
  | "cancelled";

export type Task = {
  id: string;
  title: string;
  /** Normalised slug — the axis adaptation learns on. */
  taskType: string;
  estimatedMinutes: number;
  goalId: string | null;
};

export type ScheduledBlock = {
  id: string;
  taskId: string;
  title: string;
  taskType: string;
  plannedStart: string;
  plannedEnd: string;
  status: BlockStatus;
  bucket: SlotBucket;
  dayOfWeek: number;
  caldavUid: string | null;
  caldavEtag: string | null;
  completionNote: string | null;
  completedAt: string | null;
};

export type NewBlock = {
  title: string;
  taskType: string;
  plannedStart: string;
  plannedEnd: string;
};

/** Lowercase, hyphenated. "Video Editing" and "video editing" must not diverge. */
export function normaliseTaskType(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "other"
  );
}

const tasksKey = (user: SessionUser) => `tasks:${user.id}`;
const blocksKey = (user: SessionUser) => `blocks:${user.id}`;

export async function listBlocks(
  user: SessionUser,
  window?: { from: string; to: string },
): Promise<ScheduledBlock[]> {
  let all: ScheduledBlock[];

  if (user.isPreview) {
    all = previewGet<ScheduledBlock[]>(blocksKey(user)) ?? [];
  } else {
    const supabase = await createClient();
    let query = supabase
      .from("scheduled_blocks")
      .select(
        "id, task_id, planned_start, planned_end, status, task_type, bucket, day_of_week, caldav_uid, caldav_etag, completion_note, completed_at, tasks(title)",
      )
      .eq("user_id", user.id)
      .order("planned_start");

    if (window) {
      query = query.gte("planned_start", window.from).lt("planned_start", window.to);
    }

    const { data, error } = await query;
    if (error) throw error;

    all = (data ?? []).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      title:
        (row.tasks as unknown as { title?: string } | null)?.title ?? "(untitled)",
      taskType: row.task_type,
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end,
      status: row.status as BlockStatus,
      bucket: row.bucket as SlotBucket,
      dayOfWeek: row.day_of_week,
      caldavUid: row.caldav_uid,
      caldavEtag: row.caldav_etag,
      completionNote: row.completion_note,
      completedAt: row.completed_at,
    }));
    return all;
  }

  if (!window) return all.sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
  return all
    .filter((b) => b.plannedStart >= window.from && b.plannedStart < window.to)
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
}

/**
 * Persist an approved proposal as tasks + `proposed` blocks.
 * Writing to the calendar is a separate step — see the commit action.
 */
export async function createPlan(
  user: SessionUser,
  blocks: NewBlock[],
  zone: string,
): Promise<ScheduledBlock[]> {
  const created: ScheduledBlock[] = [];
  const tasks: Task[] = [];

  for (const block of blocks) {
    const taskType = normaliseTaskType(block.taskType);
    const taskId = randomUUID();
    const minutes = Math.round(
      (Date.parse(block.plannedEnd) - Date.parse(block.plannedStart)) / 60_000,
    );

    tasks.push({
      id: taskId,
      title: block.title,
      taskType,
      estimatedMinutes: Math.max(5, Math.min(720, minutes)),
      goalId: null,
    });

    created.push({
      id: randomUUID(),
      taskId,
      title: block.title,
      taskType,
      plannedStart: block.plannedStart,
      plannedEnd: block.plannedEnd,
      status: "proposed",
      bucket: slotBucketFor(block.plannedStart, zone),
      dayOfWeek: weekdayFor(block.plannedStart, zone),
      caldavUid: null,
      caldavEtag: null,
      completionNote: null,
      completedAt: null,
    });
  }

  if (user.isPreview) {
    previewSet(tasksKey(user), [
      ...(previewGet<Task[]>(tasksKey(user)) ?? []),
      ...tasks,
    ]);
    previewSet(blocksKey(user), [
      ...(previewGet<ScheduledBlock[]>(blocksKey(user)) ?? []),
      ...created,
    ]);
    return created;
  }

  const supabase = await createClient();

  const { error: taskError } = await supabase.from("tasks").insert(
    tasks.map((task) => ({
      id: task.id,
      user_id: user.id,
      title: task.title,
      task_type: task.taskType,
      estimated_minutes: task.estimatedMinutes,
      status: "scheduled",
    })),
  );
  if (taskError) throw taskError;

  const { error: blockError } = await supabase.from("scheduled_blocks").insert(
    created.map((block) => ({
      id: block.id,
      user_id: user.id,
      task_id: block.taskId,
      planned_start: block.plannedStart,
      planned_end: block.plannedEnd,
      status: block.status,
      task_type: block.taskType,
      bucket: block.bucket,
      day_of_week: block.dayOfWeek,
    })),
  );
  if (blockError) throw blockError;

  return created;
}

export async function markCommitted(
  user: SessionUser,
  blockId: string,
  caldavUid: string,
  caldavEtag: string | null,
): Promise<void> {
  await updateBlock(user, blockId, {
    status: "committed",
    caldavUid,
    caldavEtag,
  });
}

export async function updateBlock(
  user: SessionUser,
  blockId: string,
  patch: Partial<
    Pick<
      ScheduledBlock,
      "status" | "caldavUid" | "caldavEtag" | "completionNote" | "completedAt"
    >
  >,
): Promise<void> {
  if (user.isPreview) {
    const blocks = previewGet<ScheduledBlock[]>(blocksKey(user)) ?? [];
    previewSet(
      blocksKey(user),
      blocks.map((block) =>
        block.id === blockId ? { ...block, ...patch } : block,
      ),
    );
    return;
  }

  const supabase = await createClient();
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.caldavUid !== undefined) row.caldav_uid = patch.caldavUid;
  if (patch.caldavEtag !== undefined) row.caldav_etag = patch.caldavEtag;
  if (patch.completionNote !== undefined) row.completion_note = patch.completionNote;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  if (patch.status === "committed") row.committed_at = new Date().toISOString();

  const { error } = await supabase
    .from("scheduled_blocks")
    .update(row)
    .eq("user_id", user.id)
    .eq("id", blockId);
  if (error) throw error;
}

export async function deleteBlock(
  user: SessionUser,
  blockId: string,
): Promise<void> {
  if (user.isPreview) {
    const blocks = previewGet<ScheduledBlock[]>(blocksKey(user)) ?? [];
    previewSet(
      blocksKey(user),
      blocks.filter((block) => block.id !== blockId),
    );
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("scheduled_blocks")
    .delete()
    .eq("user_id", user.id)
    .eq("id", blockId);
  if (error) throw error;
}
