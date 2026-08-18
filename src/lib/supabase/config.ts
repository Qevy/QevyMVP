/**
 * Supabase is optional at boot. Until the keys exist the app runs in preview
 * mode: real UI, in-memory data, no login. See `src/lib/auth.ts`.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * Preview mode is a development affordance only. In production an
 * unconfigured app must fail closed rather than silently serving a shared
 * anonymous account.
 */
export const isPreviewMode =
  !isSupabaseConfigured && process.env.NODE_ENV !== "production";
