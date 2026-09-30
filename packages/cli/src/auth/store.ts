/**
 * `~/.config/zenvi/auth.json` (mode 0600): the CLI's sign-in.
 *
 * Two kinds: a Supabase session from the browser handoff (works for Zenvi
 * Cloud and the Zenvi backend), or a Zenvi personal token (`zvn_pat_…`) from
 * device login (Zenvi Cloud only). The CLI never reuses the desktop's
 * `~/.openshot_qt/zenvi_auth.json`: Supabase rotates refresh tokens, so two
 * apps sharing one would sign each other out.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZenviConfig } from "../config.js";

export interface SupabaseAuth {
  kind: "supabase";
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at?: number;
  user_id?: string;
  user_email?: string;
  saved_at: string;
}

export interface PatAuth {
  kind: "pat";
  token: string;
  token_id?: string;
  user_id?: string;
  user_email?: string;
  saved_at: string;
}

export type StoredAuth = SupabaseAuth | PatAuth;

export function authFile(config: ZenviConfig): string {
  return path.join(config.configDir, "auth.json");
}

function isStoredAuth(value: unknown): value is StoredAuth {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.kind === "supabase") return typeof v.access_token === "string" && typeof v.refresh_token === "string";
  if (v.kind === "pat") return typeof v.token === "string";
  return false;
}

export async function readAuth(config: ZenviConfig): Promise<StoredAuth | undefined> {
  try {
    const parsed = JSON.parse(await readFile(authFile(config), "utf8")) as unknown;
    return isStoredAuth(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Write atomically, readable only by the user. */
export async function writeAuth(config: ZenviConfig, auth: StoredAuth): Promise<void> {
  const file = authFile(config);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => undefined);
  await rename(tmp, file);
}

export async function clearAuth(config: ZenviConfig): Promise<boolean> {
  try {
    await rm(authFile(config));
    return true;
  } catch {
    return false;
  }
}

/** `exp` claim of a JWT (seconds), without verifying it. */
export function jwtExpiry(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : undefined;
  } catch {
    return undefined;
  }
}

/** `sub`/`email` claims of a JWT, without verifying it. */
export function jwtIdentity(token: string): { sub?: string; email?: string } {
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as Record<string, unknown>;
    return { sub: typeof json.sub === "string" ? json.sub : undefined, email: typeof json.email === "string" ? json.email : undefined };
  } catch {
    return {};
  }
}
