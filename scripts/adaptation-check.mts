import {
  deriveRules,
  activeRules,
  emergingPatterns,
  ruleKey,
} from "../src/lib/adaptation/rules";
import type { Reason } from "../src/lib/repository/reasons";
import type { SlotBucket } from "../src/lib/time";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, JSON.stringify(detail ?? ""));
  }
}

let seq = 0;
function reason(
  taskType: string,
  bucket: SlotBucket,
  text: string,
  overrides: Partial<Reason> = {},
): Reason {
  seq++;
  return {
    id: `r${seq}`,
    scheduledBlockId: `b${seq}`,
    checkinId: "c1",
    taskType,
    bucket,
    dayOfWeek: 1,
    reasonText: text,
    category: "sleep",
    source: "checkin",
    statedAt: `2026-08-${String(10 + seq).padStart(2, "0")}T12:00:00.000Z`,
    ...overrides,
  };
}

console.log("\nThreshold — one statement is not a pattern:");
{
  const rules = deriveRules([reason("editing", "early_morning", "wasn't awake")]);
  check("a single reason produces no rule", rules.length === 0, rules);

  const emerging = emergingPatterns([reason("editing", "early_morning", "wasn't awake")]);
  check("but it is surfaced as emerging", emerging.length === 1, emerging);
}
{
  const rules = deriveRules([
    reason("editing", "early_morning", "wasn't awake yet"),
    reason("editing", "early_morning", "slept through the alarm"),
  ]);
  check("two matching reasons produce one rule", rules.length === 1, rules);
  check("directive is avoid", rules[0]?.directive === "avoid");
  check("confidence counts both", rules[0]?.confidenceCount === 2);
  check("no longer listed as emerging", emergingPatterns([
    reason("editing", "early_morning", "a"),
    reason("editing", "early_morning", "b"),
  ]).length === 0);
}

console.log("\nGrouping is by task type AND slot:");
{
  const rules = deriveRules([
    reason("editing", "early_morning", "too early"),
    reason("editing", "evening", "too tired"),
  ]);
  check("same task, different slots — no rule", rules.length === 0, rules);
}
{
  const rules = deriveRules([
    reason("editing", "early_morning", "too early"),
    reason("filming", "early_morning", "too early"),
  ]);
  check("different tasks, same slot — no rule", rules.length === 0, rules);
}
{
  const rules = deriveRules([
    reason("editing", "early_morning", "a"),
    reason("editing", "early_morning", "b"),
    reason("filming", "evening", "c"),
    reason("filming", "evening", "d"),
  ]);
  check("two independent patterns produce two rules", rules.length === 2, rules.map((r) => r.key));
}

console.log("\nRationale quotes the user:");
{
  const rules = deriveRules([
    reason("editing", "early_morning", "wasn't awake yet", { statedAt: "2026-08-01T00:00:00.000Z" }),
    reason("editing", "early_morning", "mornings just dont work for editing", { statedAt: "2026-08-09T00:00:00.000Z" }),
  ]);
  const rationale = rules[0]?.rationale ?? "";
  check("quotes the most recent wording", rationale.includes("mornings just dont work for editing"), rationale);
  check("does not paraphrase it away", rationale.includes('"'), rationale);
  check("states how many times", rationale.includes("twice"), rationale);
  check("names the slot in plain language", rationale.toLowerCase().includes("early morning"), rationale);
}
{
  const rules = deriveRules([
    reason("editing", "early_morning", "a"),
    reason("editing", "early_morning", "b"),
    reason("editing", "early_morning", "c"),
  ]);
  check("three reasons reads as '3 times'", rules[0]?.rationale.includes("3 times"), rules[0]?.rationale);
}

console.log("\nOrdering:");
{
  const rules = deriveRules([
    reason("filming", "evening", "a"),
    reason("filming", "evening", "b"),
    reason("editing", "early_morning", "c"),
    reason("editing", "early_morning", "d"),
    reason("editing", "early_morning", "e"),
  ]);
  check("strongest evidence first", rules[0]?.taskType === "editing" && rules[0]?.confidenceCount === 3, rules.map((r) => `${r.key}:${r.confidenceCount}`));
}

console.log("\nMuting:");
{
  const reasons = [
    reason("editing", "early_morning", "a"),
    reason("editing", "early_morning", "b"),
  ];
  const key = ruleKey("editing", "early_morning");
  const rules = deriveRules(reasons, { mutedKeys: new Set([key]) });

  check("muted rule is still derived (so it stays visible)", rules.length === 1);
  check("and flagged as muted", rules[0]?.muted === true);
  check("but excluded from what the planner acts on", activeRules(rules).length === 0);
}
{
  const rules = deriveRules(
    [reason("editing", "early_morning", "a"), reason("editing", "early_morning", "b")],
    { mutedKeys: new Set(["filming:evening"]) },
  );
  check("an unrelated mute does not affect this rule", activeRules(rules).length === 1);
}

console.log("\nEdge cases:");
{
  check("no reasons at all", deriveRules([]).length === 0);
  check("no emerging patterns from nothing", emergingPatterns([]).length === 0);
}
{
  const rules = deriveRules(
    [reason("editing", "early_morning", "a"), reason("editing", "early_morning", "b")],
    { minReasons: 3 },
  );
  check("threshold is configurable", rules.length === 0);
}
{
  // Reason ids must survive so a rule can be traced back to its evidence.
  const rules = deriveRules([
    reason("editing", "early_morning", "a"),
    reason("editing", "early_morning", "b"),
  ]);
  check("carries its source reasons", rules[0]?.reasons.length === 2 && rules[0].reasons.every((r) => r.id));
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
