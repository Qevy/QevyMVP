import "server-only";
import { createClient } from "@/lib/supabase/server";
import { previewGet, previewSet } from "@/lib/preview-store";
import type { SessionUser } from "@/lib/auth";
import { listReasons } from "./reasons";
import {
  deriveRules,
  emergingPatterns,
  type AdaptationRule,
} from "@/lib/adaptation/rules";
import type { SlotBucket } from "@/lib/time";

/**
 * Rules are DERIVED from reasons on every read, never cached as rows.
 *
 * The alternative — persisting each derived rule and keeping it in sync —
 * buys nothing and can drift: delete a reason and a stale rule would keep
 * pushing your schedule around with no evidence behind it. Deriving on read
 * makes that impossible by construction.
 *
 * The only thing persisted here is the user's own override: which rules they
 * have switched off. That is a decision, not a derivation, so it has to
 * survive.
 */

const mutesKey = (user: SessionUser) => `rule-mutes:${user.id}`;

export async function getMutedKeys(user: SessionUser): Promise<Set<string>> {
  if (user.isPreview) {
    return new Set(previewGet<string[]>(mutesKey(user)) ?? []);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("adaptation_rules")
    .select("task_type, bucket")
    .eq("user_id", user.id)
    .eq("active", false);

  if (error) throw error;
  return new Set((data ?? []).map((row) => `${row.task_type}:${row.bucket}`));
}

export async function setRuleMuted(
  user: SessionUser,
  key: string,
  muted: boolean,
): Promise<void> {
  if (user.isPreview) {
    const current = new Set(previewGet<string[]>(mutesKey(user)) ?? []);
    if (muted) current.add(key);
    else current.delete(key);
    previewSet(mutesKey(user), [...current]);
    return;
  }

  const [taskType, bucket] = key.split(":") as [string, SlotBucket];
  const supabase = await createClient();

  if (!muted) {
    const { error } = await supabase
      .from("adaptation_rules")
      .delete()
      .eq("user_id", user.id)
      .eq("task_type", taskType)
      .eq("bucket", bucket);
    if (error) throw error;
    return;
  }

  // A mute row carries no evidence of its own — the rule it silences is
  // re-derived from reasons each time. confidence_count 0 keeps it inside
  // the table's own check constraint.
  const { error } = await supabase.from("adaptation_rules").upsert(
    {
      user_id: user.id,
      task_type: taskType,
      bucket,
      day_of_week: null,
      directive: "avoid",
      confidence_count: 0,
      derived_from_reason_ids: [],
      active: false,
      muted_at: new Date().toISOString(),
    },
    { onConflict: "user_id,task_type,bucket" },
  );
  if (error) throw error;
}

export type AdaptationSnapshot = {
  rules: AdaptationRule[];
  emerging: ReturnType<typeof emergingPatterns>;
  totalReasons: number;
};

export async function getAdaptation(
  user: SessionUser,
  filter?: { taskTypes?: string[] },
): Promise<AdaptationSnapshot> {
  const [reasons, mutedKeys] = await Promise.all([
    listReasons(user, filter),
    getMutedKeys(user),
  ]);

  return {
    rules: deriveRules(reasons, { mutedKeys }),
    emerging: emergingPatterns(reasons),
    totalReasons: reasons.length,
  };
}
