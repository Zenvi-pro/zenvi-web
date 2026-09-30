/**
 * Redirect URI rules (OAuth 2.1 §2.3.1, RFC 8252 §7).
 *
 * Registration accepts https URLs, http only on loopback hosts, and private-use
 * schemes for native apps (`cursor://…`). Matching is exact string comparison,
 * except that loopback redirects ignore the port: native apps listen on an
 * ephemeral port (Claude Code declares `http://localhost/callback`).
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "about:", "blob:", "ws:", "wss:", "ftp:", "chrome:"]);
const MAX_URIS = 10;
const MAX_LENGTH = 2048;

export function isLoopbackRedirect(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** Why a redirect URI cannot be registered, or null when it is acceptable. */
export function redirectUriProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "") return "redirect_uris must be non-empty strings";
  if (raw.length > MAX_LENGTH) return "redirect URI is too long";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `not an absolute URI: ${raw}`;
  }
  if (url.hash !== "" || raw.includes("#")) return "redirect URIs must not contain a fragment";
  if (url.username || url.password) return "redirect URIs must not contain credentials";
  if (url.protocol === "https:") return url.hostname === "" ? "redirect URI has no host" : null;
  if (url.protocol === "http:") return isLoopbackRedirect(url) ? null : "http redirect URIs are only allowed on localhost / 127.0.0.1 / [::1]";
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return `the ${url.protocol} scheme is not allowed`;
  if (!/^[a-z][a-z0-9+.-]*:$/.test(url.protocol)) return "invalid scheme";
  return null;
}

export function validateRedirectUris(value: unknown): { uris: string[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: "redirect_uris is required" };
  if (value.length > MAX_URIS) return { error: `at most ${MAX_URIS} redirect_uris` };
  for (const uri of value) {
    const problem = redirectUriProblem(uri);
    if (problem) return { error: problem };
  }
  return { uris: [...new Set(value as string[])] };
}

/** Does the requested redirect URI match one registered for the client? */
export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let asked: URL;
  try {
    asked = new URL(requested);
  } catch {
    return false;
  }
  if (!isLoopbackRedirect(asked) || asked.hash !== "") return false;
  return registered.some((candidate) => {
    let reg: URL;
    try {
      reg = new URL(candidate);
    } catch {
      return false;
    }
    return (
      isLoopbackRedirect(reg) &&
      reg.hostname === asked.hostname &&
      reg.pathname === asked.pathname &&
      reg.search === asked.search
    );
  });
}

/** Append OAuth response parameters to a redirect URI, keeping its own query. */
export function withParams(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}
