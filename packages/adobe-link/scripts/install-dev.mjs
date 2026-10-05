#!/usr/bin/env node
/**
 * Install Zenvi Link for development (unsigned) and let the Adobe apps load
 * it: builds dist/pro.zenvi.link, links (or copies) it into the per-user CEP
 * extensions folder, and sets PlayerDebugMode for CSXS 9-12.
 *
 *   macOS    ~/Library/Application Support/Adobe/CEP/extensions/pro.zenvi.link
 *            defaults write com.adobe.CSXS.<N> PlayerDebugMode 1
 *   Windows  %APPDATA%\Adobe\CEP\extensions\pro.zenvi.link  (a junction: no admin rights needed)
 *            reg add HKCU\Software\Adobe\CSXS.<N> /v PlayerDebugMode /t REG_SZ /d 1 /f
 *
 *   npm run install:dev -w @zenvi/adobe-link                  # build + link + debug mode
 *   npm run install:dev -w @zenvi/adobe-link -- --copy        # copy instead of link
 *   npm run install:dev -w @zenvi/adobe-link -- --uninstall   # remove the extension
 *   npm run install:dev -w @zenvi/adobe-link -- --dry-run [--platform darwin|win32]   # print the plan only
 *
 * Restart After Effects / Premiere Pro afterwards; the panel is under
 * Window > Extensions > Zenvi Link.
 */

import { spawnSync } from "node:child_process";
import { cpSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BUNDLE_ID, DEFAULT_OUT, buildExtension } from "./build-extension.mjs";

export const CSXS_VERSIONS = [9, 10, 11, 12];

/** The per-user CEP extensions folder. */
export function extensionsDir({ platform, home, appData }) {
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support", "Adobe", "CEP", "extensions");
  if (platform === "win32") return path.win32.join(appData, "Adobe", "CEP", "extensions");
  throw new Error(`Adobe CEP extensions run on macOS and Windows, not ${platform}`);
}

function debugModeCommands(platform, enable) {
  return CSXS_VERSIONS.map((n) =>
    platform === "darwin"
      ? enable
        ? { kind: "run", command: "defaults", args: ["write", `com.adobe.CSXS.${n}`, "PlayerDebugMode", "1"] }
        : { kind: "run", command: "defaults", args: ["delete", `com.adobe.CSXS.${n}`, "PlayerDebugMode"] }
      : enable
        ? { kind: "run", command: "reg", args: ["add", `HKCU\\Software\\Adobe\\CSXS.${n}`, "/v", "PlayerDebugMode", "/t", "REG_SZ", "/d", "1", "/f"] }
        : { kind: "run", command: "reg", args: ["delete", `HKCU\\Software\\Adobe\\CSXS.${n}`, "/v", "PlayerDebugMode", "/f"] },
  );
}

/** What installing (or uninstalling) does, as a list of actions. */
export function planInstall({ platform, home, appData, outDir = DEFAULT_OUT, uninstall = false, copy = false }) {
  const target = (platform === "win32" ? path.win32 : path.posix).join(extensionsDir({ platform, home, appData }), BUNDLE_ID);
  const source = path.join(outDir, BUNDLE_ID);
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
      { kind: "build", outDir },
      { kind: "remove", path: target },
      copy ? { kind: "copy", from: source, to: target } : { kind: "link", from: source, to: target, type: platform === "win32" ? "junction" : "dir" },
      ...debugModeCommands(platform, true),
    ],
    notes: ["Restart After Effects / Premiere Pro, then open Window > Extensions > Zenvi Link."],
  };
}

export function describeAction(action) {
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

function exists(file) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function execute(action) {
  switch (action.kind) {
    case "build":
      buildExtension({ outDir: action.outDir });
      return;
    case "remove":
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
      const result = spawnSync(action.command, action.args, { stdio: "inherit" });
      // `defaults delete` / `reg delete` fail when the value is already gone; that is fine.
      if (result.status !== 0 && !action.args.includes("delete")) throw new Error(`${describeAction(action)} failed (exit ${result.status})`);
    }
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv) {
  const dryRun = argv.includes("--dry-run");
  const platform = option(argv, "--platform") ?? process.platform;
  if (platform !== process.platform && !dryRun) throw new Error("--platform only works with --dry-run");
  const home = os.homedir();
  const appData = process.env.APPDATA ?? path.win32.join(home, "AppData", "Roaming");
  const plan = planInstall({ platform, home, appData, uninstall: argv.includes("--uninstall"), copy: argv.includes("--copy") });
  console.log(`${dryRun ? "Would" : "Will"} ${argv.includes("--uninstall") ? "uninstall" : "install"} Zenvi Link at ${plan.target}:`);
  for (const action of plan.actions) {
    console.log(`  ${describeAction(action)}`);
    if (!dryRun) execute(action);
  }
  for (const note of plan.notes) console.log(note);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
