"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { setRuleMuted } from "@/lib/repository/adaptation";

export async function toggleRule(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("rule_key"));
  const muted = formData.get("muted") === "true";

  await setRuleMuted(user, key, muted);

  revalidatePath("/patterns");
  revalidatePath("/plan");
}
