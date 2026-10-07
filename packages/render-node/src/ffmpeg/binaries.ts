/**
 * Locate the ffmpeg and ffprobe executables.
 *
 * Order: explicit env override (`ZENVI_FFMPEG` / `ZENVI_FFPROBE`, then the
 * common `FFMPEG_PATH` / `FFPROBE_PATH`), then `PATH`, then well-known install
 * folders. The last step matters for MCP servers started by GUI apps: Claude
 * Desktop on macOS launches `zenvi mcp` with a minimal PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`) that does not include Homebrew.
 */

import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type BinaryName = "ffmpeg" | "ffprobe";

const ENV_KEYS: Record<BinaryName, string[]> = {
  ffmpeg: ["ZENVI_FFMPEG", "FFMPEG_PATH"],
  ffprobe: ["ZENVI_FFPROBE", "FFPROBE_PATH"],
};

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (process.platform === "win32") return true;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Folders package managers install ffmpeg into, beyond whatever PATH holds. */
export function fallbackBinaryDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (process.platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const programData = env.ProgramData || "C:\\ProgramData";
    const programFiles = env.ProgramFiles || "C:\\Program Files";
    return [
      path.join(local, "Microsoft", "WinGet", "Links"),
      path.join(programData, "chocolatey", "bin"),
      path.join(home, "scoop", "shims"),
      path.join(programFiles, "ffmpeg", "bin"),
      "C:\\ffmpeg\\bin",
    ];
  }
  return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin", path.join(home, ".local", "bin"), "/opt/local/bin"];
}

/** Search `PATH` (and PATHEXT on Windows) for an executable. */
export function whichSync(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dirs = (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (isExecutable(candidate)) return candidate;
      if (ext && isExecutable(path.join(dir, name + ext))) return path.join(dir, name + ext);
    }
  }
  return undefined;
}

const cache = new Map<string, string>();

/**
 * Resolve a binary to an absolute path when possible. Falls back to the bare
 * name so `spawn` produces its own ENOENT, which callers turn into a clear
 * "ffmpeg not found" error.
 */
export function resolveBinary(name: BinaryName, env: NodeJS.ProcessEnv = process.env): string {
  for (const key of ENV_KEYS[name]) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  const cacheKey = `${name}\0${env.PATH ?? ""}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  let found = whichSync(name, env);
  if (!found) {
    const exe = process.platform === "win32" ? `${name}.exe` : name;
    found = fallbackBinaryDirs(env)
      .map((dir) => path.join(dir, exe))
      .find(isExecutable);
  }
  const resolved = found ?? name;
  cache.set(cacheKey, resolved);
  return resolved;
}
