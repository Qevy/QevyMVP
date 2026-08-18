import { featureStatus } from "@/lib/config";
import { isEncryptionConfigured } from "@/lib/crypto";
import { isLlmConfigured, modelLabel } from "@/lib/ai/provider";
import { cn } from "@/lib/ui";

type Item = {
  label: string;
  ready: boolean;
  phase: string;
  hint: string;
};

/**
 * Shows which integrations are still stubbed. The app is built to run with
 * none of them configured, so this doubles as the setup progress bar.
 */
export function SetupChecklist({
  calendarConnected,
}: {
  calendarConnected: boolean;
}) {
  const items: Item[] = [
    {
      label: "Supabase (database + login)",
      ready: featureStatus.supabase,
      phase: "Phase 1",
      hint: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
    },
    {
      label: "Encryption key",
      ready: isEncryptionConfigured(),
      phase: "Phase 2",
      hint: "APP_ENCRYPTION_KEY — protects your Apple app-specific password",
    },
    {
      label: "iCloud Calendar",
      // Whether it's actually connected, not merely whether it's configured.
      ready: calendarConnected,
      phase: "Phase 2",
      hint: calendarConnected
        ? "Reading your real calendars"
        : "Until connected, the calendar above is sample data",
    },
    {
      label: "LLM provider key",
      ready: isLlmConfigured(),
      phase: "Phase 3",
      hint: isLlmConfigured()
        ? `Planning runs on ${modelLabel()}`
        : "GROQ_API_KEY (free) or ANTHROPIC_API_KEY — powers planning and check-in chat",
    },
  ];

  const remaining = items.filter((item) => !item.ready).length;

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Setup</h2>
        <p className="text-xs text-slate-500">
          {remaining === 0
            ? "All integrations connected"
            : `${remaining} still to connect — see SETUP.md`}
        </p>
      </header>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2.5 text-xs">
            <span
              aria-hidden
              className={cn(
                "mt-1 size-2 shrink-0 rounded-full",
                item.ready ? "bg-emerald-400" : "bg-slate-600",
              )}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    "font-medium",
                    item.ready ? "text-slate-200" : "text-slate-400",
                  )}
                >
                  {item.label}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-slate-600">
                  {item.phase}
                </span>
              </div>
              <p className="text-slate-500">{item.hint}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
