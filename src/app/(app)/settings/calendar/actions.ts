"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getProfile, requireUser, updateProfile } from "@/lib/auth";
import { isEncryptionConfigured } from "@/lib/crypto";
import { PLANNER_CALENDAR_NAME } from "@/lib/config";
import {
  deleteConnection,
  getProviderForUser,
  saveConnection,
  verifyCredentials,
} from "@/lib/calendar/connection";
import {
  setPlannerCalendar,
  setReadEnabled,
  syncCalendarList,
} from "@/lib/calendar/registry";
import { CalendarAuthError } from "@/lib/calendar/types";

export type ConnectState = {
  status: "idle" | "connected" | "error";
  message?: string;
};

const connectSchema = z.object({
  appleId: z.email("That doesn't look like an Apple ID email address"),
  // Apple formats these as xxxx-xxxx-xxxx-xxxx. Accept them with or without
  // the dashes, and with stray whitespace from copy-paste.
  appPassword: z
    .string()
    .transform((value) => value.replace(/[\s-]/g, ""))
    .refine((value) => value.length === 16, {
      message:
        "An app-specific password is 16 characters, like abcd-efgh-ijkl-mnop",
    }),
});

export async function connectICloud(
  _prevState: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const user = await requireUser();

  if (!isEncryptionConfigured()) {
    return {
      status: "error",
      message:
        "APP_ENCRYPTION_KEY isn't set, so the password can't be stored safely. See SETUP.md — it takes one command.",
    };
  }

  const parsed = connectSchema.safeParse({
    appleId: formData.get("apple_id"),
    appPassword: formData.get("app_password"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const profile = await getProfile(user);

  try {
    // Prove the credentials work before storing them, so a typo surfaces here
    // rather than as a mysterious empty calendar later.
    const { calendarCount } = await verifyCredentials(
      parsed.data,
      profile.timezone,
    );

    await saveConnection(user, parsed.data);

    const { provider } = await getProviderForUser(user, {
      zone: profile.timezone,
    });
    await syncCalendarList(user, provider);

    revalidatePath("/settings/calendar");
    revalidatePath("/");

    return {
      status: "connected",
      message: `Connected. Found ${calendarCount} calendar${calendarCount === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    if (error instanceof CalendarAuthError) {
      return { status: "error", message: error.message };
    }
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Could not reach iCloud. Check your connection and try again.",
    };
  }
}

export async function disconnectICloud() {
  const user = await requireUser();
  await deleteConnection(user);
  await updateProfile(user, { planner_calendar_id: null });
  revalidatePath("/settings/calendar");
  revalidatePath("/");
}

export async function refreshCalendars() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const { provider } = await getProviderForUser(user, { zone: profile.timezone });
  await syncCalendarList(user, provider);
  revalidatePath("/settings/calendar");
}

export async function toggleCalendarRead(formData: FormData) {
  const user = await requireUser();
  const providerId = String(formData.get("provider_id"));
  const enabled = formData.get("enabled") === "true";
  await setReadEnabled(user, providerId, enabled);
  revalidatePath("/settings/calendar");
  revalidatePath("/");
}

/**
 * Find or create the calendar the app writes to. Everything it schedules
 * lands here, so it can be hidden or deleted wholesale without touching a
 * real commitment.
 */
export async function createPlannerCalendar() {
  const user = await requireUser();
  const profile = await getProfile(user);
  const { provider } = await getProviderForUser(user, { zone: profile.timezone });

  const planner = await provider.ensurePlannerCalendar(PLANNER_CALENDAR_NAME);
  const settings = await syncCalendarList(user, provider);

  // Reconcile against what the registry actually stored. If the provider and
  // the listing disagree on the id, the listing wins — that's the id every
  // other read and write goes through.
  const stored =
    settings.find((setting) => setting.providerId === planner.id) ??
    settings.find(
      (setting) =>
        setting.displayName.trim().toLowerCase() ===
        PLANNER_CALENDAR_NAME.trim().toLowerCase(),
    );

  if (!stored) {
    throw new Error(
      `Created ${PLANNER_CALENDAR_NAME} but it is not in the calendar list. Try Refresh list.`,
    );
  }

  await setPlannerCalendar(user, stored.providerId);
  await updateProfile(user, { planner_calendar_id: stored.providerId });

  revalidatePath("/settings/calendar");
  revalidatePath("/");
}

/**
 * Writes a throwaway event 30 minutes from now and deletes it again. This is
 * the only way to prove the whole write path — auth, ICS generation, PUT,
 * ETag, DELETE — actually works against Apple's server.
 */
export async function testWrite(): Promise<ConnectState> {
  const user = await requireUser();
  const profile = await getProfile(user);

  if (!profile.planner_calendar_id) {
    return { status: "error", message: "Create the Planner calendar first." };
  }

  const { provider, connected } = await getProviderForUser(user, {
    zone: profile.timezone,
  });
  if (!connected) {
    return { status: "error", message: "Connect iCloud first." };
  }

  const start = new Date(Date.now() + 30 * 60_000);
  const end = new Date(start.getTime() + 30 * 60_000);

  try {
    const created = await provider.createEvent(profile.planner_calendar_id, {
      title: "Planner connection test",
      description: "Created by Planner to verify write access. Safe to ignore.",
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });

    await provider.deleteEvent(
      profile.planner_calendar_id,
      created.uid,
      created.etag,
    );

    return {
      status: "connected",
      message: "Write test passed — created and deleted a test event.",
    };
  } catch (error) {
    return {
      status: "error",
      message: `Write test failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
