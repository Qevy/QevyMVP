"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { connectICloud, type ConnectState } from "./actions";

const INITIAL: ConnectState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-soft disabled:opacity-60"
    >
      {pending ? "Checking with iCloud…" : "Connect iCloud"}
    </button>
  );
}

export function ConnectForm({ defaultAppleId }: { defaultAppleId?: string }) {
  const [state, formAction] = useActionState(connectICloud, INITIAL);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="apple_id" className="text-xs font-medium text-text-dim">
          Apple ID
        </label>
        <input
          id="apple_id"
          name="apple_id"
          type="email"
          required
          defaultValue={defaultAppleId}
          autoComplete="username"
          className="rounded-md border border-line-strong bg-surface-2 px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="app_password"
          className="text-xs font-medium text-text-dim"
        >
          App-specific password
        </label>
        <input
          id="app_password"
          name="app_password"
          type="password"
          required
          placeholder="abcd-efgh-ijkl-mnop"
          autoComplete="off"
          spellCheck={false}
          className="rounded-md border border-line-strong bg-surface-2 px-3 py-2.5 font-mono text-sm text-text outline-none placeholder:text-text-faint focus:border-accent"
        />
        <p className="text-xs text-text-faint">
          Not your Apple password. Generate one at{" "}
          <a
            href="https://account.apple.com"
            target="_blank"
            rel="noreferrer noopener"
            className="text-text underline underline-offset-2"
          >
            account.apple.com
          </a>{" "}
          → Sign-In and Security → App-Specific Passwords. It is encrypted on
          the server the moment you submit it, and never sent back to this page.
        </p>
      </div>

      {state.status === "error" && (
        <p role="alert" className="text-xs text-bad">
          {state.message}
        </p>
      )}
      {state.status === "connected" && (
        <p role="status" className="text-xs text-good">
          {state.message}
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
