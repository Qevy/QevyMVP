"use client";

import { useEffect, useRef, useState } from "react";
import {
  sendCheckinMessage,
  type CheckinResponse,
  type CheckinTurn,
} from "./actions";
import { cn } from "@/lib/ui";

type Captured = CheckinResponse["captured"][number];

export function CheckinChat({
  openingPrompt,
  ready,
  initialTranscript = [],
  initialCaptured = [],
}: {
  openingPrompt: string;
  ready: boolean;
  /** Persisted server-side, so a reload resumes rather than restarts. */
  initialTranscript?: CheckinTurn[];
  initialCaptured?: Captured[];
}) {
  const [turns, setTurns] = useState<CheckinTurn[]>(initialTranscript);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Captured[]>(initialCaptured);
  const [finished, setFinished] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [started, setStarted] = useState(initialTranscript.length > 0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy, captured]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const next: CheckinTurn[] = [...turns, { role: "user", content: trimmed }];
    setTurns(next);
    setInput("");
    setBusy(true);
    setError(null);

    const response = await sendCheckinMessage(next);
    setBusy(false);

    if (!response.ok) {
      setError(response.error ?? "Something went wrong.");
      return;
    }

    setTurns([...next, { role: "assistant", content: response.reply }]);
    if (response.captured.length > 0) {
      setCaptured((prev) => [...prev, ...response.captured]);
    }
    if (response.finished) {
      setFinished(true);
      setSummary(response.summary);
    }
  }

  if (!started) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-400">
          I&apos;ll go through what you scheduled last week and ask about
          anything that didn&apos;t happen. What you tell me gets stored in your
          words and used when planning future weeks.
        </p>
        <div>
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              setStarted(true);
              send(openingPrompt);
            }}
            className="rounded-md bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-50"
          >
            Start check-in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-h-[16rem] flex-col gap-4">
        {/* The opening prompt is scaffolding, not something the user typed. */}
        {turns.slice(1).map((turn, index) => (
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
            Thinking…
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
            {error}
          </p>
        )}

        <div ref={endRef} />
      </div>

      {captured.length > 0 && (
        <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">
            Recorded so far
          </h2>
          <ul className="flex flex-col gap-2">
            {captured.map((item, index) => (
              <li key={index} className="text-xs">
                <span className="text-slate-400">{item.blockTitle}</span>
                <span className="mt-0.5 block text-slate-500">
                  &ldquo;{item.reasonText}&rdquo;
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-slate-600">
            Stored in your words. Future schedules will take these into account.
          </p>
        </section>
      )}

      {finished ? (
        <div
          role="status"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-200"
        >
          <p className="font-medium">Check-in complete.</p>
          {summary && <p className="mt-1 text-emerald-200/80">{summary}</p>}
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={busy}
            placeholder="Type your answer…"
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-purple-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-md bg-purple-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-purple-500 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
