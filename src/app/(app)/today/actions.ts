"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { updateBlock, type BlockStatus } from "@/lib/repository/plan";

const MARKABLE: BlockStatus[] = ["done", "missed", "partial", "committed"];

/**
 * Mark what actually happened. "committed" doubles as un-marking, so a
 * mis-tap is one tap to undo — important, because the whole adaptation
 * engine trusts these values.
 */
export async function markBlock(formData: FormData) {
  const user = await requireUser();
  const blockId = String(formData.get("block_id"));
  const status = String(formData.get("status")) as BlockStatus;

  if (!MARKABLE.includes(status)) {
    throw new Error(`Refusing to set an unexpected status: ${status}`);
  }

  await updateBlock(user, blockId, {
    status,
    completedAt: status === "committed" ? null : new Date().toISOString(),
  });

  revalidatePath("/today");
  revalidatePath("/");
  revalidatePath("/checkin");
}
