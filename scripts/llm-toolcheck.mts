/**
 * Does the configured model actually drive the planner's tool loop?
 *
 * Free-tier models vary wildly on tool calling, and the failure mode is a
 * generic "Failed to call a function" that says nothing about which tool or
 * why. This exercises the real schemas against a candidate model so the
 * answer is a fact rather than a guess.
 *
 *   npm run check:llm            # the configured model
 *   npm run check:llm -- <model> # a candidate
 */
import { createGroq } from "@ai-sdk/groq";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

const model = process.argv[2] ?? process.env.LLM_MODEL ?? "llama-3.3-70b-versatile";
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY! });

const calls: string[] = [];
let proposed = 0;

const tools = {
  get_open_slots: tool({
    description:
      "Free time the user is available to be scheduled in. Only propose blocks that fit inside these.",
    inputSchema: z.object({
      min_minutes: z.number().int().min(15).max(480),
    }),
    execute: async () => {
      calls.push("get_open_slots");
      return {
        timezone: "America/Chicago",
        slots: [
          { day: "Tuesday 11 Aug", from: "18:00", to: "22:00", minutes: 240, start_iso: "2026-08-11T18:00:00-05:00", end_iso: "2026-08-11T22:00:00-05:00" },
          { day: "Wednesday 12 Aug", from: "18:00", to: "22:00", minutes: 240, start_iso: "2026-08-12T18:00:00-05:00", end_iso: "2026-08-12T22:00:00-05:00" },
        ],
      };
    },
  }),

  propose_schedule: tool({
    description:
      "Propose blocks for the user to review. Does NOT write to their calendar.",
    inputSchema: z.object({
      blocks: z
        .array(
          z.object({
            title: z.string().min(1),
            task_type: z.string().min(1),
            start: z.string().describe("ISO 8601 with offset"),
            end: z.string().describe("ISO 8601 with offset"),
            rationale: z.string().optional(),
          }),
        )
        .min(1)
        .max(20),
    }),
    execute: async ({ blocks }) => {
      calls.push("propose_schedule");
      proposed = blocks.length;
      return { accepted: blocks.length, errors: [], message: "Shown to the user. Summarise briefly and stop." };
    },
  }),
};

console.log(`\nModel: ${model}\n`);

try {
  const result = await generateText({
    model: groq(model),
    system:
      "You help one person plan their week. Today is Monday 10 August 2026, 16:00, timezone America/Chicago. Call get_open_slots, then propose_schedule with concrete blocks. Do not ask questions for this request.",
    messages: [
      { role: "user", content: "I want to make 2 AI videos this week. Schedule editing sessions." },
    ],
    tools,
    stopWhen: stepCountIs(6),
  });

  console.log(`  tool calls : ${calls.length > 0 ? calls.join(" → ") : "(none)"}`);
  console.log(`  blocks     : ${proposed}`);
  console.log(`  steps      : ${result.steps.length}`);
  console.log(`  reply      : ${result.text.trim().slice(0, 200) || "(empty)"}`);

  const ok = calls.includes("get_open_slots") && calls.includes("propose_schedule") && proposed > 0;
  console.log(ok ? "\n  PASS — drives the full tool loop.\n" : "\n  FAIL — did not complete the loop.\n");
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.log(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
  const cause = (error as { cause?: unknown })?.cause;
  if (cause) console.log(`  cause: ${JSON.stringify(cause).slice(0, 600)}`);
  const body = (error as { responseBody?: string })?.responseBody;
  if (body) console.log(`  body: ${body.slice(0, 900)}`);
  console.log("\n  FAIL\n");
  process.exit(1);
}
