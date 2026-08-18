"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser, updateProfile } from "@/lib/auth";
import {
  WEEKDAY_KEYS,
  availabilityWindowSchema,
  type WorkingHours,
} from "@/lib/profile";

export type SettingsState = {
  status: "idle" | "saved" | "error";
  message?: string;
};

const scalarsSchema = z.object({
  timezone: z.string().min(1, "Pick a timezone"),
  buffer_minutes: z.coerce.number<number>().int().min(0).max(120),
  checkin_weekday: z.coerce.number<number>().int().min(1).max(7),
  checkin_hour: z.coerce.number<number>().int().min(0).max(23),
});

export async function saveSettings(
  _prevState: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();

  const scalars = scalarsSchema.safeParse({
    timezone: formData.get("timezone"),
    buffer_minutes: formData.get("buffer_minutes"),
    checkin_weekday: formData.get("checkin_weekday"),
    checkin_hour: formData.get("checkin_hour"),
  });

  if (!scalars.success) {
    return { status: "error", message: scalars.error.issues[0].message };
  }

  // An unchecked "available" box means the day is off-limits entirely, which
  // is an empty array rather than a missing key.
  const working_hours: WorkingHours = {};
  for (const day of WEEKDAY_KEYS) {
    if (formData.get(`available_${day}`) !== "on") {
      working_hours[day] = [];
      continue;
    }

    const window = availabilityWindowSchema.safeParse({
      start: formData.get(`start_${day}`),
      end: formData.get(`end_${day}`),
    });

    if (!window.success) {
      return {
        status: "error",
        message: `${dayLabel(day)}: ${window.error.issues[0].message}`,
      };
    }
    working_hours[day] = [window.data];
  }

  try {
    await updateProfile(user, { ...scalars.data, working_hours });
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not save settings",
    };
  }

  revalidatePath("/settings");
  revalidatePath("/");

  return { status: "saved", message: "Settings saved" };
}

function dayLabel(day: string) {
  return (
    {
      "1": "Monday",
      "2": "Tuesday",
      "3": "Wednesday",
      "4": "Thursday",
      "5": "Friday",
      "6": "Saturday",
      "7": "Sunday",
    }[day] ?? day
  );
}
