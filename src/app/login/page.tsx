import Link from "next/link";
import { isPreviewMode, isSupabaseConfigured } from "@/lib/supabase/config";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in · Planner" };

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const rawNext = searchParams.next;
  const next = typeof rawNext === "string" && rawNext.startsWith("/") ? rawNext : "/";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <header>
        <h1 className="text-lg font-semibold text-slate-100">Planner</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sign in with a link sent to your email. No password to remember.
        </p>
      </header>

      {isSupabaseConfigured ? (
        <LoginForm next={next} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            <p className="font-medium">Supabase isn&apos;t connected yet.</p>
            <p className="mt-1 text-amber-200/80">
              Add <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
              and{" "}
              <code className="font-mono text-xs">
                NEXT_PUBLIC_SUPABASE_ANON_KEY
              </code>{" "}
              to <code className="font-mono text-xs">.env.local</code>. Steps are
              in SETUP.md.
            </p>
          </div>

          {isPreviewMode && (
            <Link
              href="/"
              className="rounded-md border border-slate-700 px-4 py-2.5 text-center text-sm text-slate-300 transition hover:border-slate-500"
            >
              Continue in preview mode
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
