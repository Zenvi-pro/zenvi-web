/**
 * Open a URL (or file) with the system's default handler, like the desktop's
 * `start_auth_flow` (xdg-open on Linux, webbrowser elsewhere). Returns false
 * when nothing could be opened (headless machine, `ZENVI_NO_BROWSER=1`).
 */

import { spawn } from "node:child_process";

export async function openUrl(target: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env.ZENVI_NO_BROWSER === "1") return false;
  let command: string;
  let args: string[];
  if (env.BROWSER && /^https?:/i.test(target)) {
    command = env.BROWSER;
    args = [target];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [target];
  } else if (process.platform === "win32") {
    // rundll32 avoids cmd.exe quoting of & and % in URLs.
    command = /^https?:/i.test(target) ? "rundll32" : "explorer";
    args = /^https?:/i.test(target) ? ["url.dll,FileProtocolHandler", target] : [target];
  } else {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
    command = "xdg-open";
    args = [target];
  }
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
