import type { Reason } from "@/lib/repository/reasons";
import { SLOT_BUCKET_LABELS, type SlotBucket } from "@/lib/time";

/**
 * Turns stated reasons into scheduling rules.
 *
 * Deliberately deterministic arithmetic, not a model call: a rule that
 * changes where your week goes has to be explainable, reproducible, and
 * traceable to the exact sentences that produced it. Every rule carries the
 * reasons it came from so the planner can quote them and the user can audit
 * or switch it off.
 *
 * Pure — no I/O — so `npm run check:adaptation` can exercise it directly.
 */

/** Two matching reasons is a pattern. One is an anecdote. */
export const DEFAULT_MIN_REASONS = 2;

export type AdaptationRule = {
  /** Stable identity for muting: task type + slot. */
  key: string;
  taskType: string;
  bucket: SlotBucket;
  directive: "avoid";
  /** How many separate times the user said this. */
  confidenceCount: number;
  reasons: Reason[];
  /** One line, quoting the user, suitable for showing in a proposal. */
  rationale: string;
  muted: boolean;
};

export function ruleKey(taskType: string, bucket: SlotBucket): string {
  return `${taskType}:${bucket}`;
}

export function deriveRules(
  reasons: Reason[],
  options: { minReasons?: number; mutedKeys?: Set<string> } = {},
): AdaptationRule[] {
  const minReasons = options.minReasons ?? DEFAULT_MIN_REASONS;
  const mutedKeys = options.mutedKeys ?? new Set<string>();

  const groups = new Map<string, Reason[]>();
  for (const reason of reasons) {
    const key = ruleKey(reason.taskType, reason.bucket);
    const group = groups.get(key);
    if (group) group.push(reason);
    else groups.set(key, [reason]);
  }

  const rules: AdaptationRule[] = [];

  for (const [key, group] of groups) {
    if (group.length < minReasons) continue;

    // Newest first: if the user's explanation has evolved, the recent
    // wording is the one worth quoting back.
    const sorted = [...group].sort((a, b) => b.statedAt.localeCompare(a.statedAt));
    const [first] = sorted;

    rules.push({
      key,
      taskType: first.taskType,
      bucket: first.bucket,
      directive: "avoid",
      confidenceCount: sorted.length,
      reasons: sorted,
      rationale: buildRationale(sorted),
      muted: mutedKeys.has(key),
    });
  }

  // Strongest evidence first, then alphabetical so the order is stable.
  return rules.sort(
    (a, b) => b.confidenceCount - a.confidenceCount || a.key.localeCompare(b.key),
  );
}

/** Only the rules the planner should actually act on. */
export function activeRules(rules: AdaptationRule[]): AdaptationRule[] {
  return rules.filter((rule) => !rule.muted);
}

/**
 * Reasons that have not yet reached the threshold. Worth surfacing so the
 * user can see what the app is watching but not yet acting on.
 */
export function emergingPatterns(
  reasons: Reason[],
  options: { minReasons?: number } = {},
): { key: string; taskType: string; bucket: SlotBucket; reasons: Reason[] }[] {
  const minReasons = options.minReasons ?? DEFAULT_MIN_REASONS;
  const groups = new Map<string, Reason[]>();

  for (const reason of reasons) {
    const key = ruleKey(reason.taskType, reason.bucket);
    const group = groups.get(key);
    if (group) group.push(reason);
    else groups.set(key, [reason]);
  }

  return [...groups.entries()]
    .filter(([, group]) => group.length > 0 && group.length < minReasons)
    .map(([key, group]) => ({
      key,
      taskType: group[0].taskType,
      bucket: group[0].bucket,
      reasons: group,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function buildRationale(reasons: Reason[]): string {
  const [first] = reasons;
  const slot = SLOT_BUCKET_LABELS[first.bucket].toLowerCase();
  const times =
    reasons.length === 2 ? "twice" : `${reasons.length} times`;

  return `${first.taskType} in the ${slot} has been missed ${times} — you said "${first.reasonText}"`;
}
