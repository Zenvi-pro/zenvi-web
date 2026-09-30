/**
 * OAuth scopes. Read covers listing/opening projects, frames and render
 * status; write covers every change (edits, imports, renders, new projects).
 * Personal access tokens carry both.
 */

export const SCOPE_READ = "projects.read";
export const SCOPE_WRITE = "projects.write";
/** Advertised in AS metadata only (MCP authorization: never in PRM or 401 challenges). */
export const SCOPE_OFFLINE = "offline_access";

export const RESOURCE_SCOPES = [SCOPE_READ, SCOPE_WRITE] as const;

export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [SCOPE_READ]: "See your Zenvi Cloud projects, media and renders",
  [SCOPE_WRITE]: "Edit your projects, import media and start renders",
  [SCOPE_OFFLINE]: "Stay connected until you disconnect it",
};

/**
 * Parse a requested `scope` string. Unknown scopes are dropped (servers may
 * issue a narrower grant, RFC 6749 §3.3); an empty result means the default.
 */
export function grantableScopes(requested: string | undefined): string[] {
  const known = new Set<string>(RESOURCE_SCOPES);
  const asked = (requested ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => known.has(s));
  const unique = [...new Set(asked)];
  if (unique.length === 0) return [...RESOURCE_SCOPES];
  // Write access implies read: every mutating flow reads the project first.
  if (unique.includes(SCOPE_WRITE) && !unique.includes(SCOPE_READ)) unique.unshift(SCOPE_READ);
  return RESOURCE_SCOPES.filter((s) => unique.includes(s));
}

export function hasScope(scopes: readonly string[], scope: string): boolean {
  return scopes.includes(scope);
}
