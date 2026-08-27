"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/ui";
import { SparkleIcon, MicIcon, ArrowRightIcon } from "@/components/icons";

const SUGGESTIONS = [
  "What should I focus on today?",
  "Summarise my week",
  "Help me plan tomorrow",
];

type Phase = "idle" | "recording" | "transcribing" | "error";

/**
 * The assistant panel, with speech as the primary way in.
 *
 * Recording happens in the browser; the audio is posted to /api/transcribe
 * and comes back as text, which is then handed to the planner conversation
 * exactly as if it had been typed. Nothing is stored: the blob is discarded
 * as soon as the transcript returns.
 */
export function AssistantPanel({ name }: { name: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setSeconds(0);
  }

  async function startRecording() {
    setError(null);

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPhase("error");
      setError("This browser can't record audio. Type your request instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        // Release the microphone as soon as we have the audio.
        stream.getTracks().forEach((track) => track.stop());
        stopTimer();

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        chunksRef.current = [];

        if (blob.size === 0) {
          setPhase("idle");
          return;
        }

        setPhase("transcribing");
        try {
          const body = new FormData();
          body.append("audio", blob, "speech.webm");
          const response = await fetch("/api/transcribe", { method: "POST", body });
          const data = (await response.json()) as { text?: string; error?: string };

          if (!response.ok || !data.text) {
            setPhase("error");
            setError(data.error ?? "Could not transcribe that.");
            return;
          }

          setPhase("idle");
          router.push(`/plan?say=${encodeURIComponent(data.text)}`);
        } catch {
          setPhase("error");
          setError("Could not reach the transcription service.");
        }
      };

      recorder.start();
      recorderRef.current = recorder;
      setPhase("recording");
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setPhase("error");
      setError("Microphone permission was denied.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  const busy = phase === "transcribing";

  return (
    <div className="card flex h-full flex-col p-5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <SparkleIcon className="size-[18px] text-accent-soft" />
          <span className="text-[15px] font-medium text-text">AI Assistant</span>
        </span>
      </div>

      <div className="mt-8">
        <p className="text-lg font-medium text-text">Hi {name},</p>
        <p className="text-sm text-text-dim">How can I help you today?</p>
      </div>

      <div className="mt-5 flex flex-col gap-2.5">
        {SUGGESTIONS.map((suggestion) => (
          <a
            key={suggestion}
            href={`/plan?say=${encodeURIComponent(suggestion)}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-text-dim transition hover:border-line-strong hover:text-text"
          >
            {suggestion}
            <ArrowRightIcon className="size-4 shrink-0 text-text-faint" />
          </a>
        ))}
      </div>

      <div className="mt-auto flex flex-col items-center gap-3 pt-8">
        <button
          type="button"
          onClick={phase === "recording" ? stopRecording : startRecording}
          disabled={busy}
          aria-label={phase === "recording" ? "Stop recording" : "Tap to speak"}
          className={cn(
            "grid size-[76px] place-items-center rounded-full border transition active:scale-95 disabled:opacity-60",
            phase === "recording"
              ? "mic-recording border-cat-pink/60 bg-cat-pink/15 text-cat-pink"
              : "mic-halo border-accent/50 bg-accent/10 text-accent-soft",
          )}
        >
          <MicIcon className="size-7" />
        </button>

        <p className="text-xs text-text-dim">
          {phase === "recording"
            ? `Listening… ${seconds}s — tap to stop`
            : busy
              ? "Transcribing…"
              : "Tap to speak"}
        </p>

        {error && (
          <p role="alert" className="text-center text-xs text-bad">
            {error}
          </p>
        )}

        <p className="text-center text-[11px] text-text-faint">
          AI can make mistakes. Check important info.
        </p>
      </div>
    </div>
  );
}
