/**
 * Where Zenvi Link lives on disk once installed (the CEP extensions folders)
 * and the steps that install or remove it. Shared by the dev install script
 * (`scripts/install-dev.mjs`, which builds from source and links) and by
 * `zenvi adobe install` / `zenvi adobe doctor` in the CLI (which copy the
 * prebuilt extension that ships with the CLI). Nothing runs at import.
 *
 *   macOS    ~/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link
 *            defaults write com.adobe.CSXS.<N> PlayerDebugMode 1
 *   Windows  %APPDATA%\Adobe\CEP\extensions\pro.zenvi.link  (a junction or a copy: no admin rights needed)
 *            reg add HKCU\Software\Adobe\CSXS.<N> /v PlayerDebugMode /t REG_SZ /d 1 /f
 */

import { spawnSync, type StdioOptions } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";

/** The extension bundle id, also its folder name in the CEP extensions folder. */
export const BUNDLE_ID = "pro.zenvi.link";

/** CSXS versions whose PlayerDebugMode lets unsigned extensions load (CEP 9-12: After Effects / Premiere 2019+). */
export const CSXS_VERSIONS: readonly number[] = [9, 10, 11, 12];

export type InstallAction =
  | { kind: "build"; outDir: string }
  | { kind: "remove"; path: string }
  | { kind: "link"; from: string; to: string; type: "dir" | "junction" }
  | { kind: "copy"; from: string; to: string }
  | { kind: "run"; command: string; args: string[] };

export interface InstallPlan {
  /** The installed extension folder. */
  target: string;
  actions: InstallAction[];
  notes: string[];
}

export interface InstallLocation {
  platform: string;
  home: string;
  /** Windows `%APPDATA%`. */
  appData?: string;
}

/** The per-user CEP extensions folder (where Zenvi installs Zenvi Link). */
export function extensionsDir({ platform, home, appData }: InstallLocation): string {
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Adobe", "CEP", "extensions");
  if (platform === "win32") return path.win32.join(appData ?? path.win32.join(home, "AppData", "Roaming"), "Adobe", "CEP", "extensions");
  throw new Error(`Adobe CEP extensions run on macOS and Windows, not ${platform}`);
}

/** Machine-wide CEP extensions folders (ZXP installers put extensions there); empty off macOS/Windows. */
export function systemExtensionsDirs(platform: string, env: Record<string, string | undefined> = {}): string[] {
  if (platform === "darwin") return ["/Library/Application Support/Adobe/CEP/extensions"];
  if (platform === "win32") {
    const roots = [env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", env.ProgramFiles ?? "C:\\Program Files"];
    return [...new Set(roots)].map((root) => path.win32.join(root, "Common Files", "Adobe", "CEP", "extensions"));
  }
  return [];
}

/** Commands that turn PlayerDebugMode on (or off) for every CSXS version. */
export function debugModeCommands(platform: string, enable: boolean): Extract<InstallAction, { kind: "run" }>[] {
  return CSXS_VERSIONS.map((n) =>
    platform === "darwin"
      ? enable
        ? { kind: "run" as const, command: "defaults", args: ["write", `com.adobe.CSXS.${n}`, "PlayerDebugMode", "1"] }
        : { kind: "run" as const, command: "defaults", args: ["delete", `com.adobe.CSXS.${n}`, "PlayerDebugMode"] }
      : enable
        ? { kind: "run" as const, command: "reg", args: ["add", `HKCU\\Software\\Adobe\\CSXS.${n}`, "/v", "PlayerDebugMode", "/t", "REG_SZ", "/d", "1", "/f"] }
        : { kind: "run" as const, command: "reg", args: ["delete", `HKCU\\Software\\Adobe\\CSXS.${n}`, "/v", "PlayerDebugMode", "/f"] },
  );
}

export interface ExtensionInstallOptions extends InstallLocation {
  /** The built `pro.zenvi.link` folder to install from. */
  source: string;
  uninstall?: boolean;
  /** Copy instead of linking (a link follows later builds of `source`). */
  copy?: boolean;
}

/** Install (replace, then link or copy, then debug mode) or uninstall: the steps, without a build. */
export function planExtensionInstall({ platform, home, appData, source, uninstall = false, copy = false }: ExtensionInstallOptions): InstallPlan {
  const target = (platform === "win32" ? path.win32 : path.posix).join(extensionsDir({ platform, home, appData }), BUNDLE_ID);
  if (uninstall) {
    return {
      target,
      actions: [{ kind: "remove", path: target }],
      notes: [
        "PlayerDebugMode stays on (other unsigned extensions may need it). To turn it off:",
        ...debugModeCommands(platform, false).map((action) => `  ${action.command} ${action.args.join(" ")}`),
      ],
    };
  }
  return {
    target,
    actions: [
      { kind: "remove", path: target },
      copy ? { kind: "copy", from: source, to: target } : { kind: "link", from: source, to: target, type: platform === "win32" ? "junction" : "dir" },
      ...debugModeCommands(platform, true),
    ],
    notes: ["Restart After Effects / Premiere Pro, then open Window > Extensions > Zenvi Link."],
  };
}

export function describeAction(action: InstallAction): string {
  switch (action.kind) {
    case "build":
      return `build ${path.join(action.outDir, BUNDLE_ID)}`;
    case "remove":
      return `remove ${action.path}`;
    case "link":
      return `link ${action.to} -> ${action.from} (${action.type})`;
    case "copy":
      return `copy ${action.from} -> ${action.to}`;
    default:
      return `run ${action.command} ${action.args.join(" ")}`;
  }
}

function exists(file: string): boolean {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run one step of a plan. `build` is the caller's job (the dev script builds
 * from source; the CLI ships a built extension). Throws when a step fails,
 * except deleting a debug-mode value that is already gone.
 */
export function runInstallAction(action: InstallAction, options: { stdio?: StdioOptions } = {}): void {
  switch (action.kind) {
    case "build":
      throw new Error("runInstallAction does not build; build the extension first");
    case "remove":
      // A link is removed, never what it points to (rmSync does not follow it).
      if (exists(action.path)) rmSync(action.path, { recursive: true, force: true });
      return;
    case "link":
      mkdirSync(path.dirname(action.to), { recursive: true });
      symlinkSync(action.from, action.to, action.type);
      return;
    case "copy":
      mkdirSync(path.dirname(action.to), { recursive: true });
      cpSync(action.from, action.to, { recursive: true });
      return;
    default: {
      const result = spawnSync(action.command, action.args, { stdio: options.stdio ?? "pipe", windowsHide: true });
      // `defaults delete` / `reg delete` fail when the value is already gone; that is fine.
      if (result.status !== 0 && !action.args.includes("delete")) {
        const why = result.error ? result.error.message : `exit ${result.status}`;
        throw new Error(`${describeAction(action)} failed (${why})`);
      }
    }
  }
}
