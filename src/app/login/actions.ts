"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export type LoginState = {
  status: "idle" | "sent" | "error";
  message?: string;
};

const emailSchema = z.email("That doesn't look like an email address");

async function resolveOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function sendMagicLink(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  if (!isSupabaseConfigured) {
    return {
      status: "error",
      message:
        "Supabase isn't connected yet. Add the keys from SETUP.md, or keep using preview mode.",
    };
  }

  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  const nextPath = String(formData.get("next") ?? "/");
  // Only allow same-site redirects — an attacker-supplied `next` must not be
  // able to bounce a freshly authenticated user off-site.
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//")
    ? nextPath
    : "/";

  const origin = await resolveOrigin();
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      // Handles both link styles: the default template lands on /auth/callback
      // with a PKCE code, a customised one lands on /auth/confirm with a
      // token_hash. Both routes exist.
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
    },
  });

  if (error) {
    return { status: "error", message: error.message };
  }

  return {
    status: "sent",
    message: `Check ${parsed.data} for a sign-in link. It expires in an hour.`,
  };
}
