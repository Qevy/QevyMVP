/**
 * Central place to read environment configuration.
 *
 * The app is designed to boot with nothing configured: every integration
 * degrades to a clearly-labelled stub rather than crashing, so each phase is
 * usable before the next phase's credentials exist.
 */

export const DEFAULT_TIMEZONE = process.env.DEFAULT_TIMEZONE ?? "Europe/London";

export const PLANNER_CALENDAR_NAME =
  process.env.PLANNER_CALENDAR_NAME ?? "Planner";

/** "mock" until iCloud credentials are connected in Phase 2. */
export const CALENDAR_PROVIDER =
  (process.env.CALENDAR_PROVIDER as "mock" | "icloud" | undefined) ?? "mock";

export const featureStatus = {
  supabase: Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  encryption: Boolean(process.env.APP_ENCRYPTION_KEY),
} as const;

export type FeatureName = keyof typeof featureStatus;
