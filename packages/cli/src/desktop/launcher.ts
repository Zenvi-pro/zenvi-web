/**
 * `zenvi open`: show a project in the installed Zenvi desktop app.
 *
 * - Already running (live GUI discovery file): load the project through the
 *   app's own MCP `open_project_tool`, then bring the window forward. One
 *   instance, no second window (zenvi-core #132).
 * - Not running: launch it with the project path as its first argument, the
 *   way the desktop opens projects (zenvi-core src/classes/app.py:484-492).
 *
 * Where the app is (zenvi-core installer/ + xdg/):
 * - macOS: Zenvi.app, bundle id org.zenvi.Zenvi (installer/Info.plist).
 * - Windows: Inno Setup AppId {4BB0DCDC-BC24-49EC-8937-72956C33A470},
 *   zenvi.exe under {autopf}\Zenvi (installer/windows-installer.iss).
 * - Linux: `zenvi-desktop` on PATH, a Zenvi AppImage, or the
 *   org.zenvi.Zenvi.desktop entry.
 * - Any OS: `ZENVI_DESKTOP_CMD` (e.g. a dev checkout's
 *   `.venv/bin/python src/launch.py`).
 */

import { execFile, spawn } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MAC_BUNDLE_ID = "org.zenvi.Zenvi";
export const WINDOWS_APP_ID = "{4BB0DCDC-BC24-49EC-8937-72956C33A470}";

export interface DesktopApp {
  kind: "override" | "macos-app" | "windows-exe" | "linux-bin" | "linux-appimage" | "linux-desktop-entry";
  /** What was found (app bundle, exe, AppImage, desktop file). */
  location: string;
  command: string;
  /** Arguments before the project path. */
  args: string[];
}

export interface LauncherDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exists(file: string): Promise<boolean>;
  readText(file: string): Promise<string | undefined>;
  listDir(dir: string): Promise<string[]>;
  run(command: string, args: string[]): Promise<{ code: number; stdout: string }>;
  spawnDetached(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<void>;
  /** Real paths of this CLI's own entry points (never launch ourselves). */
  selfPaths: string[];
}

export function defaultLauncherDeps(): LauncherDeps {
  const self = [process.argv[1]].filter((p): p is string => typeof p === "string");
  return {
    platform: process.platform,
    env: process.env,
    home: process.env.HOME || process.env.USERPROFILE || "",
    exists: async (file) => {
      try {
        await stat(file);
        return true;
      } catch {
        return false;
      }
    },
    readText: async (file) => readFile(file, "utf8").catch(() => undefined),
    listDir: async (dir) => readdir(dir).catch(() => []),
    run: async (command, args) => {
      try {
        const { stdout } = await execFileAsync(command, args, { timeout: 5000, windowsHide: true, maxBuffer: 1024 * 1024 });
        return { code: 0, stdout };
      } catch (error) {
        const e = error as { code?: number | string; stdout?: string };
        return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "" };
      }
    },
    spawnDetached: (command, args, env) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false, env: env ?? process.env });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      }),
    selfPaths: self,
  };
}

/** POSIX-shell-like split: whitespace, single/double quotes, backslash escapes. */
export function splitCommand(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < text.length && /["\\$`]/.test(text[i + 1]!)) cur += text[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else if (ch === "\\" && i + 1 < text.length && process.platform !== "win32") {
      cur += text[++i];
    } else cur += ch;
  }
  if (has || cur) out.push(cur);
  return out;
}

/** Desktop Entry `Exec=` → argv without field codes (%f %F %u %U …). */
export function parseDesktopExec(exec: string): string[] {
  return splitCommand(exec)
    .filter((arg) => !/^%[fFuUdDnNickvm]$/.test(arg))
    .map((arg) => arg.replace(/%%/g, "%"));
}

async function which(deps: LauncherDeps, name: string): Promise<string | undefined> {
  const dirs = (deps.env.PATH || deps.env.Path || "").split(deps.platform === "win32" ? ";" : ":").filter(Boolean);
  const exts = deps.platform === "win32" ? (deps.env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (await deps.exists(candidate)) return candidate;
    }
  }
  return undefined;
}

async function isSelf(deps: LauncherDeps, file: string): Promise<boolean> {
  const real = await realpath(file).catch(() => file);
  const selves = await Promise.all(deps.selfPaths.map((p) => realpath(p).catch(() => p)));
  if (selves.includes(real)) return true;
  // The npm-installed `zenvi` is a Node script; the desktop launcher never is.
  const head = (await deps.readText(real))?.slice(0, 200) ?? "";
  return /^#!.*\bnode\b/.test(head) || /\bzenvi\.mjs\b/.test(real);
}

async function findMac(deps: LauncherDeps): Promise<DesktopApp | undefined> {
  const candidates = ["/Applications/Zenvi.app", path.join(deps.home, "Applications", "Zenvi.app")];
  for (const app of candidates) {
    if (await deps.exists(app)) return { kind: "macos-app", location: app, command: "open", args: ["-a", app, "--args"] };
  }
  const found = await deps.run("mdfind", [`kMDItemCFBundleIdentifier == '${MAC_BUNDLE_ID}'`]);
  const app = found.stdout.split("\n").map((l) => l.trim()).find((l) => l.endsWith(".app"));
  if (app) return { kind: "macos-app", location: app, command: "open", args: ["-a", app, "--args"] };
  return undefined;
}

function regValue(stdout: string, name: string): string | undefined {
  const re = new RegExp(`^\\s*${name.replace(/[()]/g, "\\$&")}\\s+REG_(?:SZ|EXPAND_SZ)\\s+(.+?)\\s*$`, "im");
  return re.exec(stdout)?.[1];
}

async function findWindows(deps: LauncherDeps): Promise<DesktopApp | undefined> {
  const exe = (file: string): DesktopApp => ({ kind: "windows-exe", location: file, command: file, args: [] });
  const keys = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${WINDOWS_APP_ID}_is1`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${WINDOWS_APP_ID}_is1`,
    `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${WINDOWS_APP_ID}_is1`,
  ];
  for (const key of keys) {
    const { code, stdout } = await deps.run("reg", ["query", key]);
    if (code !== 0) continue;
    const location = regValue(stdout, "InstallLocation");
    if (location) {
      const file = path.win32.join(location.replace(/^"|"$/g, ""), "zenvi.exe");
      if (await deps.exists(file)) return exe(file);
    }
    const icon = regValue(stdout, "DisplayIcon")?.replace(/^"|"$/g, "").replace(/,\d+$/, "");
    if (icon && /zenvi\.exe$/i.test(icon) && (await deps.exists(icon))) return exe(icon);
  }
  // The .zvn association's open command, e.g. "C:\\Program Files\\Zenvi\\zenvi.exe" "%1".
  // The default value's label is localized, so take the first string value.
  const assoc = await deps.run("reg", ["query", "HKCR\\ZenviProject\\shell\\open\\command", "/ve"]);
  const command = /REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/m.exec(assoc.stdout)?.[1];
  const fromAssoc = command ? (/^"([^"]+)"/.exec(command)?.[1] ?? command.split(/\s+/)[0]) : undefined;
  if (fromAssoc && (await deps.exists(fromAssoc))) return exe(fromAssoc);
  const roots = [deps.env.ProgramFiles, deps.env["ProgramFiles(x86)"], deps.env.LOCALAPPDATA && path.win32.join(deps.env.LOCALAPPDATA, "Programs")];
  for (const root of roots) {
    if (!root) continue;
    const file = path.win32.join(root, "Zenvi", "zenvi.exe");
    if (await deps.exists(file)) return exe(file);
  }
  return undefined;
}

function xdgDataDirs(deps: LauncherDeps): string[] {
  const home = deps.env.XDG_DATA_HOME || path.join(deps.home, ".local", "share");
  const system = (deps.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [home, ...system, "/var/lib/flatpak/exports/share", path.join(deps.home, ".local", "share", "flatpak", "exports", "share")];
}

async function findLinux(deps: LauncherDeps): Promise<DesktopApp | undefined> {
  const bin = await which(deps, "zenvi-desktop");
  if (bin && !(await isSelf(deps, bin))) return { kind: "linux-bin", location: bin, command: bin, args: [] };

  const appImageDirs = [path.join(deps.home, "Applications"), path.join(deps.home, ".local", "bin"), path.join(deps.home, "bin"), "/opt", "/opt/zenvi", "/usr/local/bin"];
  for (const dir of appImageDirs) {
    const names = (await deps.listDir(dir)).filter((n) => /^zenvi.*\.appimage$/i.test(n)).sort().reverse();
    if (names[0]) {
      const file = path.join(dir, names[0]);
      return { kind: "linux-appimage", location: file, command: file, args: [] };
    }
  }

  for (const dataDir of xdgDataDirs(deps)) {
    for (const name of ["org.zenvi.Zenvi.desktop", "zenvi.desktop"]) {
      const file = path.join(dataDir, "applications", name);
      const text = await deps.readText(file);
      const exec = text && /^Exec\s*=\s*(.+)$/m.exec(text)?.[1];
      if (!exec) continue;
      const argv = parseDesktopExec(exec);
      const head = argv[0];
      if (!head) continue;
      const resolved = path.isAbsolute(head) ? head : await which(deps, head);
      if (!resolved || (await isSelf(deps, resolved))) continue;
      return { kind: "linux-desktop-entry", location: file, command: resolved, args: argv.slice(1) };
    }
  }
  return undefined;
}

/** Where the desktop app is, or undefined when it is not installed. */
export async function findDesktopApp(deps: LauncherDeps = defaultLauncherDeps()): Promise<DesktopApp | undefined> {
  const override = deps.env.ZENVI_DESKTOP_CMD?.trim();
  if (override) {
    const [command, ...args] = splitCommand(override);
    if (command) return { kind: "override", location: override, command, args };
  }
  if (deps.platform === "darwin") return findMac(deps);
  if (deps.platform === "win32") return findWindows(deps);
  return findLinux(deps);
}

/** argv that launches `app` on `project` (or empty). */
export function launchArgv(app: DesktopApp, project?: string): { command: string; args: string[] } {
  if (app.kind === "macos-app") {
    // `open -a App --args <project>`: the path arrives as argv[1].
    return { command: app.command, args: project ? [...app.args, project] : ["-a", app.location] };
  }
  return { command: app.command, args: project ? [...app.args, project] : [...app.args] };
}

/** Bring a running app's window forward (best effort, macOS only). */
export async function focusDesktopApp(app: DesktopApp | undefined, deps: LauncherDeps): Promise<boolean> {
  if (deps.platform !== "darwin") return false;
  const args = app?.kind === "macos-app" ? ["-a", app.location] : ["-b", MAC_BUNDLE_ID];
  return (await deps.run("open", args)).code === 0;
}

export async function launchDesktopApp(app: DesktopApp, project: string | undefined, deps: LauncherDeps): Promise<{ command: string; args: string[] }> {
  const argv = launchArgv(app, project);
  await deps.spawnDetached(argv.command, argv.args);
  return argv;
}
