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
  /** Same-origin proxy prefix for backend REST (`/api/v1` on the backend). */
  backendRestBase: string;
  /** Zenvi Cloud origin, or "" when cloud features are off. */
  cloudUrl: string;
  /** Router basename (Vite `base` without the trailing slash). */
  basename: string;
}

const base = clean(import.meta.env.BASE_URL) || "";

export const config: EditorConfig = {
  supabaseUrl: clean(import.meta.env.VITE_SUPABASE_URL),
  supabaseKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim(),
  backendUrl: clean(import.meta.env.VITE_ZENVI_BACKEND_URL) || "https://api.zenvi.pro",
  backendRestBase: `${base}/api/zenvi`,
  cloudUrl: clean(import.meta.env.VITE_ZENVI_CLOUD_URL),
  basename: base,
};

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
