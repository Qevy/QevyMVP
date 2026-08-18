import "server-only";
import { createGroq } from "@ai-sdk/groq";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/**
 * One place that decides which model the planner talks to.
 *
 * Groq's free tier runs the flow during development; Claude Sonnet takes over
 * for real use. Swapping is two environment variables and no code change.
 */

export type LlmProviderName = "groq" | "anthropic";

export const LLM_PROVIDER =
  (process.env.LLM_PROVIDER as LlmProviderName | undefined) ?? "groq";

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  // gpt-oss-120b, not llama-3.3-70b. Measured over repeated runs against the
  // real tool set, llama intermittently returned "Failed to call a function"
  // and, when it did answer, sometimes summarised times that contradicted the
  // blocks it had just proposed. gpt-oss-120b drove the loop every time.
  // See `npm run check:llm`.
  groq: "openai/gpt-oss-120b",
  anthropic: "claude-sonnet-5",
};

export const LLM_MODEL = process.env.LLM_MODEL ?? DEFAULT_MODELS[LLM_PROVIDER];

export function isLlmConfigured(): boolean {
  return LLM_PROVIDER === "anthropic"
    ? Boolean(process.env.ANTHROPIC_API_KEY)
    : Boolean(process.env.GROQ_API_KEY);
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      LLM_PROVIDER === "anthropic"
        ? "ANTHROPIC_API_KEY is not set."
        : "GROQ_API_KEY is not set. Get one at https://console.groq.com.",
    );
    this.name = "LlmNotConfiguredError";
  }
}

export function resolveModel(): LanguageModel {
  if (!isLlmConfigured()) throw new LlmNotConfiguredError();

  if (LLM_PROVIDER === "anthropic") {
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })(
      LLM_MODEL,
    );
  }

  return createGroq({ apiKey: process.env.GROQ_API_KEY! })(LLM_MODEL);
}

/** Shown in the UI so it's never a mystery which model produced a plan. */
export function modelLabel(): string {
  return `${LLM_PROVIDER}:${LLM_MODEL}`;
}
