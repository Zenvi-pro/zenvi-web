/**
 * Runtime configuration, read once from Vite's `import.meta.env`.
 *
 * Every value is public (inlined into the bundle). Missing values disable the
 * feature that needs them instead of breaking the editor: no Supabase config
 * means signed-out only, no cloud URL means local projects only.
 */

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

export interface EditorConfig {
  supabaseUrl: string;
  supabaseKey: string;
  /** Zenvi backend origin; the chat WebSocket connects here directly. */
  backendUrl: string;
  /** Backend REST base (`/api/v1` on the backend): see `backendRestBaseFor`. */
  backendRestBase: string;
  /** Zenvi Cloud origin, or "" when cloud features are off. */
  cloudUrl: string;
  /** Router basename (Vite `base` without the trailing slash). */
  basename: string;
  /** `VITE_ZENVI_WEBSITE_CALLBACK`: the website's OAuth callback (absolute URL, or a path on the current origin). */
  websiteCallback: string;
  /** `VITE_ENABLE_OAUTH`: offer GitHub/Google sign-in on origins without the website callback. */
  oauthOutsideWebsite: boolean;
}

const base = clean(import.meta.env.BASE_URL) || "";

export const config: EditorConfig = {
  supabaseUrl: clean(import.meta.env.VITE_SUPABASE_URL),
  supabaseKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim(),
  backendUrl: clean(import.meta.env.VITE_ZENVI_BACKEND_URL) || "https://api.zenvi.pro",
  backendRestBase: backendRestBaseFor(import.meta.env.VITE_ZENVI_BACKEND_REST_URL, base),
  cloudUrl: clean(import.meta.env.VITE_ZENVI_CLOUD_URL),
  basename: base,
  websiteCallback: (import.meta.env.VITE_ZENVI_WEBSITE_CALLBACK ?? "").trim(),
  oauthOutsideWebsite: /^(1|true|yes)$/i.test((import.meta.env.VITE_ENABLE_OAUTH ?? "").trim()),
};

/**
 * Backend REST base: `VITE_ZENVI_BACKEND_REST_URL` when set (production calls
 * `https://api.zenvi.pro/api/v1` directly; the backend's CORS allows
 * zenvi.pro), else the same-origin proxy `<basename>/api/zenvi` that the Vite
 * dev server forwards to the backend.
 */
export function backendRestBaseFor(configured: string | undefined, basename: string): string {
  return clean(configured) || `${basename}/api/zenvi`;
}

/** Origins where the editor is mounted at /editor under zenvi.pro (the website owns /auth/callback there). */
const WEBSITE_ORIGINS = ["https://zenvi.pro", "https://www.zenvi.pro"];

/**
 * The website's OAuth callback when the editor runs under the website's
 * origin, else null. Supabase's redirect allowlist has `<site>/auth/callback`;
 * the website follows a sanitized `/editor…` `next` with a full page load.
 */
export function websiteCallbackFor(origin: string, configured: string = config.websiteCallback): string | null {
  if (configured) {
    if (configured.startsWith("/") && !configured.startsWith("//")) return `${origin}${configured}`;
    try {
      const url = new URL(configured);
      return url.origin === origin ? url.toString() : null;
    } catch {
      return null;
    }
  }
  return WEBSITE_ORIGINS.includes(origin) ? `${origin}/auth/callback` : null;
}

/**
 * Where an OAuth sign-in returns: the website's callback with the editor
 * path as `next` (under zenvi.pro), else the editor's own /login.
 */
export function oauthRedirectUrl(next: string, origin: string = window.location.origin): string {
  const callback = websiteCallbackFor(origin);
  if (callback) {
    const url = new URL(callback);
    url.searchParams.set("next", `${config.basename}${next}`);
    return url.toString();
  }
  return `${origin}${config.basename}/login?next=${encodeURIComponent(next)}`;
}

/** GitHub/Google buttons: always under the website, elsewhere only when VITE_ENABLE_OAUTH is set. */
export function oauthOffered(origin: string = window.location.origin): boolean {
  return websiteCallbackFor(origin) !== null || config.oauthOutsideWebsite;
}

export const authEnabled = (): boolean => config.supabaseUrl !== "" && config.supabaseKey !== "";
export const cloudEnabled = (): boolean => config.cloudUrl !== "";

/** `wss://…/api/v1/chat/ws` for the configured backend. */
export function chatSocketUrl(backendUrl: string = config.backendUrl): string {
  const url = new URL(backendUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/v1/chat/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Absolute URL of an editor route (for OAuth redirects and share links). */
export function editorUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${window.location.origin}${config.basename}${suffix}`;
}
