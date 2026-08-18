"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { testWrite, type ConnectState } from "./actions";

const INITIAL: ConnectState = { status: "idle" };

function Button() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md border border-slate-700 px-3 py-2 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-60"
    >
      {pending ? "Testing…" : "Run write test"}
    </button>
  );
}

export function TestWriteButton() {
  const [state, formAction] = useActionState(
    async () => testWrite(),
    INITIAL,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button />
      {state.status === "connected" && (
        <span role="status" className="text-xs text-emerald-300">
          {state.message}
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="text-xs text-rose-300">
          {state.message}
        </span>
      )}
    </form>
  );
}
