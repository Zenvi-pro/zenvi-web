/**
 * Supabase auth, shared with zenvi.pro.
 *
 * The client uses supabase-js defaults (implicit flow, `localStorage`, the
 * default `sb-<project-ref>-auth-token` storage key), exactly like the website,
 * so a zenvi.pro sign-in carries over to /editor (same origin via rewrite) and
 * the other way round.
 */
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { create } from "zustand";
import { authEnabled, config, editorUrl } from "./env";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!authEnabled()) return null;
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

export type AuthStatus = "loading" | "signed-in" | "signed-out" | "disabled";

export interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
}

export const useAuth = create<AuthState>(() => ({
  status: authEnabled() ? "loading" : "disabled",
  session: null,
  user: null,
}));

function apply(session: Session | null): void {
  useAuth.setState({ status: session ? "signed-in" : "signed-out", session, user: session?.user ?? null });
}

let started = false;

/** Start listening for session changes. Safe to call more than once. */
export function initAuth(): void {
  if (started) return;
  started = true;
  const supabase = getSupabase();
  if (!supabase) return;
  supabase.auth
    .getSession()
    .then(({ data }) => apply(data.session))
    .catch(() => apply(null));
  supabase.auth.onAuthStateChange((_event, session) => apply(session));
}

/** A current access token (refreshed by supabase-js when needed), or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function displayName(user: User | null): string {
  if (!user) return "";
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const name = (meta?.full_name ?? meta?.name ?? meta?.user_name) as string | undefined;
  return name || user.email || "Account";
}

export function avatarUrl(user: User | null): string | undefined {
  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const url = meta?.avatar_url ?? meta?.picture;
  return typeof url === "string" ? url : undefined;
}

function requireClient(): SupabaseClient {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Sign-in is not configured for this build.");
  return supabase;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await requireClient().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
}

/** Returns true when the account needs email confirmation before first sign-in. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await requireClient().auth.signUp({ email: email.trim().toLowerCase(), password });
  if (error) throw error;
  return !data.session;
}

/**
 * Only same-app relative paths are accepted as post-login destinations, so a
 * crafted `next` cannot bounce the session to another site.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

export async function signInWithOAuth(provider: "github" | "google", next: string): Promise<void> {
  const redirectTo = `${editorUrl("/login")}?next=${encodeURIComponent(safeNext(next))}`;
  const { error } = await requireClient().auth.signInWithOAuth({ provider, options: { redirectTo } });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}
