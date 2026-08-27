"use client";

import { useState, useRef, useEffect } from "react";
import { DateTime } from "luxon";
import type { AppliedRule, ProposedBlock } from "@/lib/ai/planner";
import {
  commitProposal,
  sendPlannerMessage,
  type ChatTurn,
  type CommitResult,
} from "./actions";
import { cn } from "@/lib/ui";

type Props = {
  zone: string;
  modelLabel: string;
  plannerReady: boolean;
  /** Spoken or tapped on the dashboard; sent automatically on arrival. */
  opening?: string;
};

const SUGGESTIONS = [
  "I want to make 4 AI videos this week",
  "Find me two hours to work on the edit before Friday",
  "Plan my evenings around the gym this week",
];

export function PlanChat({ zone, modelLabel, plannerReady, opening }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposedBlock[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [appliedRules, setAppliedRules] = useState<AppliedRule[]>([]);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, proposal, busy]);

  // Fire the opening message once. The ref guard stops React's development
  // double-mount from sending it twice.
  const openingSent = useRef(false);
  useEffect(() => {
    if (!opening || openingSent.current || !plannerReady) return;
    openingSent.current = true;
    void send(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, plannerReady]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const next: ChatTurn[] = [...turns, { role: "user", content: trimmed }];
    setTurns(next);
    setInput("");
    setBusy(true);
    setError(null);
    setProposal(null);
    setWarnings([]);
    setAppliedRules([]);
    setCommitResult(null);

    const response = await sendPlannerMessage(next);
    setBusy(false);

    if (!response.ok) {
      setError(response.error ?? "Something went wrong.");
      return;
    }

    setTurns([...next, { role: "assistant", content: response.reply }]);
    setProposal(response.proposal);
    setWarnings(response.warnings);
    setAppliedRules(response.appliedRules);
  }

  async function commit() {
    if (!proposal || busy) return;
    setBusy(true);
    const result = await commitProposal(proposal);
    setBusy(false);
    setCommitResult(result);
    if (result.failed.length === 0) setProposal(null);
  }

  function dropBlock(index: number) {
    if (!proposal) return;
    const next = proposal.filter((_, i) => i !== index);
    setProposal(next.length > 0 ? next : null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-[18rem] flex-col gap-4">
        {turns.length === 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-dim">
              Tell me what you want to get done. I&apos;ll check your calendar and
              propose times — nothing reaches your calendar until you approve it.
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={!plannerReady}
                  onClick={() => send(suggestion)}
                  className="rounded-full border border-line-strong px-3 py-1.5 text-xs text-text-dim transition hover:border-line-strong hover:text-text disabled:opacity-40"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={cn(
              "max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap",
              turn.role === "user"
                ? "self-end bg-accent/20 text-text"
                : "self-start bg-surface text-text",
            )}
          >
            {turn.content}
          </div>
        ))}

        {busy && (
          <div className="self-start rounded-lg bg-surface px-3.5 py-2.5 text-sm text-text-faint">
            Checking your calendar…
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-bad/40 bg-bad/10 p-3 text-xs text-bad">
            {error}
          </p>
        )}

        <div ref={endRef} />
      </div>

      {proposal && proposal.length > 0 && (
        <section className="rounded-card border border-line-strong bg-surface p-4">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-text">
              Proposed schedule
            </h2>
            <p className="text-xs text-text-faint">
              Not on your calendar yet
            </p>
          </header>

          <ul className="mb-4 flex flex-col gap-2">
            {proposal.map((block, index) => {
              const start = DateTime.fromISO(block.plannedStart).setZone(zone);
              const end = DateTime.fromISO(block.plannedEnd).setZone(zone);
              return (
                <li
                  key={`${block.plannedStart}-${index}`}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-line bg-surface p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-text">{block.title}</p>
                    <p className="text-xs text-text-dim">
                      {start.toFormat("cccc d LLL")} · {start.toFormat("HH:mm")}–
                      {end.toFormat("HH:mm")} ·{" "}
                      {Math.round(end.diff(start, "minutes").minutes)} min
                    </p>
                    {block.rationale && (
                      <p className="mt-1 text-xs text-text-faint">{block.rationale}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dropBlock(index)}
                    disabled={busy}
                    className="rounded-md border border-line-strong px-2 py-1 text-xs text-text-faint transition hover:border-bad/60 hover:text-bad disabled:opacity-40"
                  >
                    Drop
                  </button>
                </li>
              );
            })}
          </ul>

          {appliedRules.length > 0 && (
            <div className="mb-4 rounded-md border border-line-strong bg-surface p-3">
              <p className="text-xs font-medium text-text-dim">
                Adapted from your check-ins
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {appliedRules.map((rule) => (
                  <li key={rule.taskType} className="text-xs text-text-dim">
                    Kept{" "}
                    <span className="text-text">{rule.taskType}</span> out
                    of the {rule.slotLabel.toLowerCase()} — missed{" "}
                    {rule.timesMissed} times. You said:
                    <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                      {rule.quotes.map((quote) => (
                        <li key={quote} className="text-text-faint">
                          &ldquo;{quote}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-text-faint">
                <a href="/patterns" className="underline underline-offset-2">
                  Switch this off
                </a>{" "}
                if it is no longer true.
              </p>
            </div>
          )}

          {warnings.length > 0 && (
            <ul className="mb-3 flex flex-col gap-1">
              {warnings.map((warning) => (
                <li key={warning} className="text-xs text-text-dim">
                  {warning}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={commit}
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-soft disabled:opacity-60"
          >
            {busy ? "Writing to calendar…" : `Commit ${proposal.length} block${proposal.length === 1 ? "" : "s"} to calendar`}
          </button>
        </section>
      )}

      {commitResult && (
        <div
          role="status"
          className={cn(
            "rounded-md border p-3 text-xs",
            commitResult.failed.length === 0
              ? "border-good/40 bg-good/10 text-good"
              : "border-warn/40 bg-warn/10 text-warn",
          )}
        >
          <p>
            {commitResult.committed} block
            {commitResult.committed === 1 ? "" : "s"} written to your Planner
            calendar.
          </p>
          {commitResult.failed.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {commitResult.failed.map((failure) => (
                <li key={failure.title}>
                  <span className="font-medium">{failure.title}</span> failed:{" "}
                  {failure.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
        className="flex flex-col gap-2"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={busy || !plannerReady}
            placeholder={
              plannerReady
                ? "What do you want to get done?"
                : "Add GROQ_API_KEY to .env.local first"
            }
            className="flex-1 rounded-md border border-line-strong bg-surface-2 px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !plannerReady || input.trim().length === 0}
            className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-soft disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="text-[11px] text-text-faint">
          {modelLabel} · the model proposes, you commit
        </p>
      </form>
    </div>
  );
}
