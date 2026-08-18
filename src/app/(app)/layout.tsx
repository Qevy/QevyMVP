import { AppNav } from "@/components/AppNav";
import { requireUser } from "@/lib/auth";
import { signOut } from "./actions";

export default async function AppLayout({
  children,
}: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-slate-100">Planner</span>
            <AppNav />
          </div>

          <div className="flex items-center gap-3 text-xs">
            {user.isPreview ? (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-medium text-amber-300">
                Preview mode — no login
              </span>
            ) : (
              <>
                <span className="hidden text-slate-500 sm:inline">{user.email}</span>
                <form action={signOut}>
                  <button
                    type="submit"
                    className="rounded-md border border-slate-700 px-2.5 py-1.5 text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
                  >
                    Sign out
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
