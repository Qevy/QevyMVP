import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Disk-backed state for preview mode (no Supabase configured).
 *
 * Module memory looked sufficient until every source edit hot-reloaded the
 * dev server and silently dropped the iCloud connection. This keeps preview
 * mode usable across reloads and restarts.
 *
 * Development only:
 *  - `isPreviewMode` is false in production, so nothing here ever runs there.
 *  - The file is gitignored.
 *  - The Apple password inside it is still AES-256-GCM encrypted; this stores
 *    the same ciphertext Supabase would hold, not a plaintext secret.
 */

const STORE_PATH = join(process.cwd(), ".preview-store.json");

type Store = Record<string, unknown>;

/**
 * Read from disk every time. An in-memory cache here went stale the moment
 * the file was edited by anything other than this process, which is exactly
 * what happens during development. The file is a few kilobytes and this path
 * never runs in production, so the read is free.
 */
function load(): Store {
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, "utf8")) as Store;
    }
  } catch {
    // A corrupt store is not worth crashing over — start clean.
  }
  return {};
}

function save(store: Store) {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export function previewGet<T>(key: string): T | null {
  const value = load()[key];
  return value === undefined ? null : (value as T);
}

export function previewSet<T>(key: string, value: T): void {
  const store = load();
  store[key] = value;
  save(store);
}

export function previewDelete(key: string): void {
  const store = load();
  delete store[key];
  save(store);
}
