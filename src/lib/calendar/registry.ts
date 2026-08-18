import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth";
import { previewGet, previewSet } from "@/lib/preview-store";
import type { CalendarProvider, CalendarRef } from "./types";

/**
 * Which of the user's calendars we read from, and which one we write to.
 *
 * Kept separately from the provider so the choice survives a reconnect, and
 * so a calendar disappearing from iCloud doesn't silently change behaviour.
 */

export type CalendarSetting = {
  providerId: string;
  displayName: string;
  color: string | null;
  readOnly: boolean;
  readEnabled: boolean;
  isPlanner: boolean;
  /** False when the row exists locally but the calendar is gone from iCloud. */
  present: boolean;
};

const previewKey = (user: SessionUser) => `calendars:${user.id}`;

function previewFor(user: SessionUser): CalendarSetting[] {
  return previewGet<CalendarSetting[]>(previewKey(user)) ?? [];
}

function savePreview(user: SessionUser, settings: CalendarSetting[]) {
  previewSet(previewKey(user), settings);
}

/**
 * Reconcile the local list against what iCloud reports.
 *
 * New calendars default to read-enabled — the point of the app is to schedule
 * around everything you're actually committed to, so opting out should be the
 * deliberate act, not opting in.
 */
export async function syncCalendarList(
  user: SessionUser,
  provider: CalendarProvider,
): Promise<CalendarSetting[]> {
  const remote = await provider.listCalendars();
  const existing = await getCalendarSettings(user, { includeMissing: true });
  const byId = new Map(existing.map((setting) => [setting.providerId, setting]));

  const merged: CalendarSetting[] = remote.map((calendar) => {
    const previous = byId.get(calendar.id);
    return {
      providerId: calendar.id,
      displayName: calendar.displayName,
      color: calendar.color ?? null,
      readOnly: calendar.readOnly,
      readEnabled: previous?.readEnabled ?? true,
      isPlanner: previous?.isPlanner ?? false,
      present: true,
    };
  });

  await persist(user, merged, remote);
  return merged;
}

async function persist(
  user: SessionUser,
  settings: CalendarSetting[],
  remote: CalendarRef[],
) {
  if (user.isPreview) {
    // `settings` is already reconciled against the remote list, so it is the
    // complete new state — calendars gone from iCloud simply aren't in it.
    savePreview(user, settings);
    return;
  }

  const supabase = await createClient();

  const { error: upsertError } = await supabase.from("calendars").upsert(
    settings.map((setting) => ({
      user_id: user.id,
      provider_id: setting.providerId,
      display_name: setting.displayName,
      color: setting.color,
      read_enabled: setting.readEnabled,
      is_planner: setting.isPlanner,
    })),
    { onConflict: "user_id,provider_id" },
  );
  if (upsertError) throw upsertError;

  // Drop calendars that no longer exist in iCloud.
  const remoteIds = remote.map((calendar) => calendar.id);
  if (remoteIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("calendars")
      .delete()
      .eq("user_id", user.id)
      .not("provider_id", "in", `(${remoteIds.map((id) => `"${id}"`).join(",")})`);
    if (deleteError) throw deleteError;
  }
}

export async function getCalendarSettings(
  user: SessionUser,
  options: { includeMissing?: boolean } = {},
): Promise<CalendarSetting[]> {
  if (user.isPreview) {
    return previewFor(user);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendars")
    .select("provider_id, display_name, color, read_enabled, is_planner")
    .eq("user_id", user.id)
    .order("display_name");

  if (error) throw error;

  return (data ?? []).map((row) => ({
    providerId: row.provider_id,
    displayName: row.display_name,
    color: row.color,
    readOnly: false,
    readEnabled: row.read_enabled,
    isPlanner: row.is_planner,
    present: options.includeMissing ? true : true,
  }));
}

export async function setReadEnabled(
  user: SessionUser,
  providerId: string,
  enabled: boolean,
): Promise<void> {
  if (user.isPreview) {
    savePreview(
      user,
      previewFor(user).map((setting) =>
        setting.providerId === providerId
          ? { ...setting, readEnabled: enabled }
          : setting,
      ),
    );
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendars")
    .update({ read_enabled: enabled })
    .eq("user_id", user.id)
    .eq("provider_id", providerId);
  if (error) throw error;
}

/** Exactly one planner calendar per user; the DB has a partial unique index. */
export async function setPlannerCalendar(
  user: SessionUser,
  providerId: string,
): Promise<void> {
  if (user.isPreview) {
    savePreview(
      user,
      previewFor(user).map((setting) => ({
        ...setting,
        isPlanner: setting.providerId === providerId,
      })),
    );
    return;
  }

  const supabase = await createClient();

  // Clear first — the unique index rejects a second planner mid-update.
  const { error: clearError } = await supabase
    .from("calendars")
    .update({ is_planner: false })
    .eq("user_id", user.id)
    .eq("is_planner", true);
  if (clearError) throw clearError;

  const { error } = await supabase
    .from("calendars")
    .update({ is_planner: true })
    .eq("user_id", user.id)
    .eq("provider_id", providerId);
  if (error) throw error;
}

export function readableCalendarIds(settings: CalendarSetting[]): string[] {
  return settings
    .filter((setting) => setting.readEnabled)
    .map((setting) => setting.providerId);
}
