/**
 * Endpoints and folders the CLI uses, each overridable by environment.
 *
 * The Supabase URL and publishable key are the public client values the
 * desktop ships in zenvi-core `.env.production`; they identify the project,
 * they are not secrets.
 */

import { homedir } from "node:os";
import path from "node:path";

export const DEFAULTS = {
  website: "https://zenvi.pro",
  editor: "https://zenvi.pro/editor",
  cloud: "https://zenvi-cloud.whitesky-da3c8402.eastus.azurecontainerapps.io",
  backend: "https://api.zenvi.pro",
  supabaseUrl: "https://xktarhzbrdnxkaovtdxj.supabase.co",
  supabaseAnonKey: "sb_publishable_2-FCBkJ96Ss35jqL9krVEQ_otR5iGmA",
} as const;

export interface ZenviConfig {
  websiteUrl: string;
  editorUrl: string;
  cloudUrl: string;
  backendUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  /** `~/.config/zenvi` (auth.json, cloud links). */
  configDir: string;
  /** The desktop app's user folder, `~/.openshot_qt` (MCP discovery files, token). */
  desktopDir: string;
  home: string;
}

function env(e: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = e[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

const trim = (url: string) => url.replace(/\/+$/, "");

export function loadConfig(e: NodeJS.ProcessEnv = process.env): ZenviConfig {
  // os.homedir() honours HOME on POSIX and USERPROFILE on Windows.
  const home = e.HOME || e.USERPROFILE || homedir();
  const configDir =
    env(e, "ZENVI_CONFIG_DIR") ??
    (process.platform === "win32"
      ? path.join(e.APPDATA || path.join(home, "AppData", "Roaming"), "zenvi")
      : path.join(e.XDG_CONFIG_HOME || path.join(home, ".config"), "zenvi"));
  return {
    websiteUrl: trim(env(e, "ZENVI_WEBSITE", "ZENVI_WEBSITE_URL") ?? DEFAULTS.website),
    editorUrl: trim(env(e, "ZENVI_EDITOR_URL") ?? DEFAULTS.editor),
    cloudUrl: trim(env(e, "ZENVI_CLOUD_URL") ?? DEFAULTS.cloud),
    backendUrl: trim(env(e, "ZENVI_BACKEND_URL") ?? DEFAULTS.backend),
    supabaseUrl: trim(env(e, "ZENVI_SUPABASE_URL", "SUPABASE_URL") ?? DEFAULTS.supabaseUrl),
    supabaseAnonKey: env(e, "ZENVI_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY") ?? DEFAULTS.supabaseAnonKey,
    configDir,
    desktopDir: env(e, "ZENVI_DESKTOP_DIR") ?? path.join(home, ".openshot_qt"),
    home,
  };
}
