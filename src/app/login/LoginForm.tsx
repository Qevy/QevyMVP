"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { sendMagicLink, type LoginState } from "./actions";

const INITIAL: LoginState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Sending…" : "Email me a sign-in link"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(sendMagicLink, INITIAL);

  if (state.status === "sent") {
    return (
      <div
        role="status"
        className="rounded-md border border-good/40 bg-good/10 p-4 text-sm text-good"
      >
        {state.message}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-xs font-medium text-text-dim">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          className="rounded-md border border-line-strong bg-surface-2 px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-xs text-bad">
          {state.message}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
