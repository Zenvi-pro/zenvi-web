/**
 * Finding Blender: `ZENVI_BLENDER` (or `BLENDER`), then `blender` on PATH,
 * then the usual install folders. Synchronous (stat only) so a host can
 * decide at start-up whether to offer the 3D tools.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

/** Oldest Blender the scene scripts are written for (EEVEE Next, AgX, Principled v2). */
export const MIN_BLENDER = "4.2";

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function installCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "darwin") return ["/Applications/Blender.app/Contents/MacOS/Blender", path.join(env.HOME ?? "", "Applications/Blender.app/Contents/MacOS/Blender"), "/opt/homebrew/bin/blender", "/usr/local/bin/blender"];
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"]].filter((r): r is string => Boolean(r));
    const out: string[] = [];
    for (const root of roots) {
      const foundation = path.join(root, "Blender Foundation");
      if (!existsSync(foundation)) continue;
      out.push(path.join(foundation, "Blender", "blender.exe"));
      for (const v of ["5.2", "5.1", "5.0", "4.5", "4.4", "4.3", "4.2"]) out.push(path.join(foundation, `Blender ${v}`, "blender.exe"));
    }
    return out;
  }
  return ["/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender"];
}

/** The Blender executable to run, or undefined when this computer has none. */
export function findBlender(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  const explicit = (env.ZENVI_BLENDER ?? env.BLENDER)?.trim();
  if (explicit) return isFile(explicit) ? explicit : undefined;
  const exe = platform === "win32" ? "blender.exe" : "blender";
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir && isFile(path.join(dir, exe))) return path.join(dir, exe);
  }
  return installCandidates(platform, env).find(isFile);
}

/** True when `version` ("5.2.3 LTS") is at least `minimum` ("4.2"). */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (v: string) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);
  const a = parts(version);
  const b = parts(minimum);
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}
