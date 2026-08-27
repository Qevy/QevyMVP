import Link from "next/link";

export const metadata = { title: "Sign-in problem · Planner" };

const FRIENDLY: Record<string, string> = {
  "missing-code": "That link didn't carry a sign-in code. It may have been opened twice.",
  "missing-token": "That link was missing its token. Request a fresh one.",
};

export default async function AuthErrorPage(props: PageProps<"/auth/error">) {
  const searchParams = await props.searchParams;
  const raw = searchParams.reason;
  const reason = typeof raw === "string" ? raw : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-lg font-semibold text-text">Couldn&apos;t sign you in</h1>
      <p className="text-sm text-text-dim">
        {(reason && FRIENDLY[reason]) ??
          reason ??
          "The sign-in link was invalid or has expired."}
      </p>
      <p className="text-xs text-text-faint">
        Magic links are single-use and expire after an hour.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-accent px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-accent-soft"
      >
        Request a new link
      </Link>
    </main>
  );
}
