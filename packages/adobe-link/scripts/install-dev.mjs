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

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_OUT, buildExtension } from "./build-extension.mjs";
import { BUNDLE_ID, CSXS_VERSIONS, describeAction, extensionsDir, planExtensionInstall, runInstallAction } from "../src/install.ts";

// The planning lives in src/install.ts (shared with `zenvi adobe install`); this script adds the build.
export { CSXS_VERSIONS, describeAction, extensionsDir };

/** What installing (or uninstalling) does, as a list of actions: build from source, then install the build. */
export function planInstall({ platform, home, appData, outDir = DEFAULT_OUT, uninstall = false, copy = false }) {
  const plan = planExtensionInstall({ platform, home, appData, source: path.join(outDir, BUNDLE_ID), uninstall, copy });
  return uninstall ? plan : { ...plan, actions: [{ kind: "build", outDir }, ...plan.actions] };
}

function execute(action) {
  if (action.kind === "build") buildExtension({ outDir: action.outDir });
  else runInstallAction(action, { stdio: "inherit" });
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
