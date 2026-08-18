import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isPreviewMode, isSupabaseConfigured } from "@/lib/supabase/config";
import { DEFAULT_PROFILE, type Profile, profileSchema } from "@/lib/profile";
import { previewGet, previewSet } from "@/lib/preview-store";

export type SessionUser = {
  id: string;
  email: string | null;
  /** True when running without Supabase configured (development only). */
  isPreview: boolean;
};

/** Fixed id so preview-mode rows are recognisable if they ever reach a DB. */
export const PREVIEW_USER_ID = "00000000-0000-0000-0000-000000000001";

const PREVIEW_USER: SessionUser = {
  id: PREVIEW_USER_ID,
  email: "preview@localhost",
  isPreview: true,
};

/**
 * In preview mode the profile is kept on disk so the settings page is
 * genuinely usable before a database exists, and survives the hot reload
 * that follows every source edit.
 */
const previewProfileKey = (user: SessionUser) => `profile:${user.id}`;

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isSupabaseConfigured) {
    return isPreviewMode ? PREVIEW_USER : null;
  }

  const supabase = await createClient();
  // getClaims verifies the JWT signature rather than trusting the cookie.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  return {
    id: data.claims.sub,
    email: (data.claims.email as string | undefined) ?? null,
    isPreview: false,
  };
}

/**
 * For pages that require a session. `proxy.ts` already redirects
 * unauthenticated requests; this is the defence-in-depth check, because a
 * proxy matcher is one typo away from leaking a route.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function getProfile(user: SessionUser): Promise<Profile> {
  if (user.isPreview) {
    const stored = previewGet<Profile>(previewProfileKey(user));
    if (!stored) return DEFAULT_PROFILE;
    const parsed = profileSchema.safeParse(stored);
    return parsed.success ? parsed.data : DEFAULT_PROFILE;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "timezone, working_hours, buffer_minutes, checkin_weekday, checkin_hour, planner_calendar_id",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  // The on_auth_user_created trigger should have made this row, but a user
  // created before the trigger existed would not have one.
  if (!data) return DEFAULT_PROFILE;

  const parsed = profileSchema.safeParse(data);
  return parsed.success ? parsed.data : DEFAULT_PROFILE;
}

export async function updateProfile(
  user: SessionUser,
  patch: Partial<Profile>,
): Promise<Profile> {
  const next = profileSchema.parse({ ...(await getProfile(user)), ...patch });

  if (user.isPreview) {
    previewSet(previewProfileKey(user), next);
    return next;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update(next)
    .eq("id", user.id);

  if (error) throw error;
  return next;
}
