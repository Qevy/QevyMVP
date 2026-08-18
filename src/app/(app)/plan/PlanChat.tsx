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
};

const SUGGESTIONS = [
  "I want to make 4 AI videos this week",
  "Find me two hours to work on the edit before Friday",
  "Plan my evenings around the gym this week",
];

export function PlanChat({ zone, modelLabel, plannerReady }: Props) {
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
            <p className="text-sm text-slate-400">
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
                  className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200 disabled:opacity-40"
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
                ? "self-end bg-purple-600/20 text-purple-100"
                : "self-start bg-slate-800/60 text-slate-200",
            )}
          >
            {turn.content}
          </div>
        ))}

        {busy && (
          <div className="self-start rounded-lg bg-slate-800/60 px-3.5 py-2.5 text-sm text-slate-500">
            Checking your calendar…
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            {error}
          </p>
        )}

        <div ref={endRef} />
      </div>

      {proposal && proposal.length > 0 && (
        <section className="rounded-lg border border-purple-500/40 bg-purple-500/5 p-4">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-purple-200">
              Proposed schedule
            </h2>
            <p className="text-xs text-slate-500">
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
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/60 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-slate-100">{block.title}</p>
                    <p className="text-xs text-slate-400">
                      {start.toFormat("cccc d LLL")} · {start.toFormat("HH:mm")}–
                      {end.toFormat("HH:mm")} ·{" "}
                      {Math.round(end.diff(start, "minutes").minutes)} min
                    </p>
                    {block.rationale && (
                      <p className="mt-1 text-xs text-slate-500">{block.rationale}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dropBlock(index)}
                    disabled={busy}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-500 transition hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-40"
                  >
                    Drop
                  </button>
                </li>
              );
            })}
          </ul>

          {appliedRules.length > 0 && (
            <div className="mb-4 rounded-md border border-slate-700 bg-slate-900/60 p-3">
              <p className="text-xs font-medium text-slate-300">
                Adapted from your check-ins
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {appliedRules.map((rule) => (
                  <li key={rule.taskType} className="text-xs text-slate-400">
                    Kept{" "}
                    <span className="text-slate-200">{rule.taskType}</span> out
                    of the {rule.slotLabel.toLowerCase()} — missed{" "}
                    {rule.timesMissed} times. You said:
                    <ul className="mt-1 flex flex-col gap-0.5 pl-3">
                      {rule.quotes.map((quote) => (
                        <li key={quote} className="text-slate-500">
                          &ldquo;{quote}&rdquo;
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-600">
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
                <li key={warning} className="text-xs text-amber-300/80">
                  {warning}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={commit}
            disabled={busy}
            className="rounded-md bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-60"
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
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-amber-500/40 bg-amber-500/10 text-amber-200",
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
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-purple-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !plannerReady || input.trim().length === 0}
            className="rounded-md bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-40"
          >
            Send
          </button>
        </div>
        <p className="text-[11px] text-slate-600">
          {modelLabel} · the model proposes, you commit
        </p>
      </form>
    </div>
  );
}
