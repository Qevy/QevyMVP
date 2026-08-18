import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

/**
 * Landing point for Supabase's default magic-link email, which arrives with a
 * PKCE `code` to exchange for a session.
 *
 * If the email template has been customised to send `token_hash` instead,
 * `/auth/confirm` handles that shape.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  // Supabase reports failures here rather than throwing.
  const errorDescription =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (errorDescription) {
    return NextResponse.redirect(
      new URL(`/auth/error?reason=${encodeURIComponent(errorDescription)}`, origin),
    );
  }

  if (!isSupabaseConfigured || !code) {
    return NextResponse.redirect(new URL("/auth/error?reason=missing-code", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/auth/error?reason=${encodeURIComponent(error.message)}`, origin),
    );
  }

  return NextResponse.redirect(new URL(next, origin));
}
