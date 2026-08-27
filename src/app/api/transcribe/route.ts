import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";

/**
 * Speech to text via Groq Whisper.
 *
 * Deliberately not the browser's SpeechRecognition API: that is unavailable
 * in iOS Safari, which is where this app will mostly be spoken to. Recording
 * audio and posting it works everywhere, at the cost of one round trip.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: NextRequest) {
  // Transcription costs money and quota; do not run it for anonymous callers.
  await requireUser();

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GROQ_API_KEY is not set, so speech can't be transcribed." },
      { status: 501 },
    );
  }

  const form = await request.formData();
  const audio = form.get("audio");

  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "No audio in request." }, { status: 400 });
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: "Recording was empty." }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That recording is too long. Keep it under a couple of minutes." },
      { status: 413 },
    );
  }

  const upstream = new FormData();
  upstream.append("file", audio, audio.name || "speech.webm");
  upstream.append("model", "whisper-large-v3-turbo");
  upstream.append("response_format", "json");
  // Nudges the model towards this app's vocabulary rather than generic prose.
  upstream.append(
    "prompt",
    "Scheduling a week: editing, filming, scripting, gym, deep work, times like 7am and 6:30pm.",
  );

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: upstream,
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const rateLimited = response.status === 429;
      return NextResponse.json(
        {
          error: rateLimited
            ? "Transcription is rate limited right now. Try again in a moment."
            : `Transcription failed (${response.status}). ${detail.slice(0, 200)}`,
        },
        { status: rateLimited ? 429 : 502 },
      );
    }

    const { text } = (await response.json()) as { text?: string };
    const transcript = (text ?? "").trim();

    if (!transcript) {
      return NextResponse.json(
        { error: "Nothing was picked up. Try again a bit closer to the mic." },
        { status: 422 },
      );
    }

    return NextResponse.json({ text: transcript });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not reach the transcription service.",
      },
      { status: 502 },
    );
  }
}
