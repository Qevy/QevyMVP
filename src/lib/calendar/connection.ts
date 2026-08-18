import "server-only";
import { createClient } from "@/lib/supabase/server";
import { decrypt, encrypt, type EncryptedValue } from "@/lib/crypto";
import { previewDelete, previewGet, previewSet } from "@/lib/preview-store";
import type { SessionUser } from "@/lib/auth";
import { DEFAULT_TIMEZONE } from "@/lib/config";
import { ICloudCalendarProvider, type ICloudCredentials } from "./icloud";
import { MockCalendarProvider } from "./mock";
import type { CalendarProvider } from "./types";

export type StoredConnection = {
  appleId: string;
  encrypted: EncryptedValue;
  lastVerifiedAt: string | null;
};

/** Preview mode has no database; the connection is kept on disk instead. */
const previewKey = (user: SessionUser) => `connection:${user.id}`;

export async function getConnection(
  user: SessionUser,
): Promise<StoredConnection | null> {
  if (user.isPreview) return previewGet<StoredConnection>(previewKey(user));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_credentials")
    .select("apple_id, encrypted_password, iv, auth_tag, last_verified_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    appleId: data.apple_id,
    encrypted: {
      ciphertext: data.encrypted_password,
      iv: data.iv,
      authTag: data.auth_tag,
    },
    lastVerifiedAt: data.last_verified_at,
  };
}

export async function saveConnection(
  user: SessionUser,
  credentials: ICloudCredentials,
): Promise<void> {
  const encrypted = encrypt(credentials.appPassword);
  const now = new Date().toISOString();

  if (user.isPreview) {
    previewSet<StoredConnection>(previewKey(user), {
      appleId: credentials.appleId,
      encrypted,
      lastVerifiedAt: now,
    });
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("calendar_credentials").upsert(
    {
      user_id: user.id,
      apple_id: credentials.appleId,
      encrypted_password: encrypted.ciphertext,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      last_verified_at: now,
    },
    { onConflict: "user_id" },
  );

  if (error) throw error;
}

export async function deleteConnection(user: SessionUser): Promise<void> {
  if (user.isPreview) {
    previewDelete(previewKey(user));
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_credentials")
    .delete()
    .eq("user_id", user.id);

  if (error) throw error;
}

/**
 * The one place that decrypts. Keep it that way — the plaintext password
 * should never be held anywhere it could be serialised to a client component
 * or a log line.
 */
async function getCredentials(
  user: SessionUser,
): Promise<ICloudCredentials | null> {
  const connection = await getConnection(user);
  if (!connection) return null;

  return {
    appleId: connection.appleId,
    appPassword: decrypt(connection.encrypted),
  };
}

/**
 * Resolve the calendar provider for a user: real iCloud once connected,
 * the mock until then. Everything upstream calls this and stays unaware.
 */
export async function getProviderForUser(
  user: SessionUser,
  options: { zone?: string } = {},
): Promise<{ provider: CalendarProvider; connected: boolean }> {
  const zone = options.zone ?? DEFAULT_TIMEZONE;
  const credentials = await getCredentials(user);

  if (!credentials) {
    return { provider: new MockCalendarProvider(zone), connected: false };
  }

  return {
    provider: new ICloudCalendarProvider(credentials, zone),
    connected: true,
  };
}

/** Verify a candidate credential pair by actually talking to iCloud. */
export async function verifyCredentials(
  credentials: ICloudCredentials,
  zone: string,
): Promise<{ calendarCount: number }> {
  const provider = new ICloudCalendarProvider(credentials, zone);
  const calendars = await provider.listCalendars();
  return { calendarCount: calendars.length };
}
