/**
 * Zenvi Link on this machine: the extension this CLI ships (and
 * `zenvi adobe install` copies), the copies installed in the CEP extensions
 * folders, and which Adobe apps are installed. Used by the MCP listing
 * policy (ZENVI_MCP_ADOBE=auto), `zenvi adobe install` and `zenvi adobe doctor`.
 */

import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { BUNDLE_ID, extensionsDir, systemExtensionsDirs, type HostId } from "@zenvi/adobe-link";
import { bundleDir } from "@zenvi/render-node";

/** File system access for detection (tests pass fakes). */
export interface DetectDeps {
  platform: string;
  home: string;
  env: NodeJS.ProcessEnv;
  exists(file: string): Promise<boolean>;
  listDir(dir: string): Promise<string[] | undefined>;
  readText(file: string): Promise<string | undefined>;
  isLink(file: string): Promise<boolean>;
}

export function defaultDetectDeps(home: string, env: NodeJS.ProcessEnv): DetectDeps {
  return {
    platform: process.platform,
    home,
    env,
    exists: async (file) => {
      try {
        await stat(file);
        return true;
      } catch {
        return false;
      }
    },
    listDir: async (dir) => readdir(dir).catch(() => undefined),
    readText: async (file) => readFile(file, "utf8").catch(() => undefined),
    isLink: async (file) => (await lstat(file).catch(() => undefined))?.isSymbolicLink() ?? false,
  };
}

/** `ExtensionBundleVersion` of a CEP manifest. */
export function manifestVersion(xml: string | undefined): string | undefined {
  return xml ? /\bExtensionBundleVersion\s*=\s*"([^"]+)"/.exec(xml)?.[1] : undefined;
}

export interface ExtensionCopy {
  dir: string;
  version?: string;
}

export interface InstalledExtension extends ExtensionCopy {
  scope: "user" | "system";
  /** A symlink or junction (a development install from `npm run install:dev`). */
  linked: boolean;
}

async function readCopy(deps: DetectDeps, dir: string): Promise<ExtensionCopy | undefined> {
  const xml = await deps.readText(path.join(dir, "CSXS", "manifest.xml"));
  if (xml === undefined) return undefined;
  return { dir, version: manifestVersion(xml) };
}

/** Zenvi Link copies in this user's and the machine-wide CEP extensions folders. */
export async function findInstalledExtensions(deps: DetectDeps): Promise<InstalledExtension[]> {
  if (deps.platform !== "darwin" && deps.platform !== "win32") return [];
  const folders: Array<[string, InstalledExtension["scope"]]> = [
    [extensionsDir({ platform: deps.platform, home: deps.home, appData: deps.env.APPDATA }), "user"],
    ...systemExtensionsDirs(deps.platform, deps.env).map((dir): [string, InstalledExtension["scope"]] => [dir, "system"]),
  ];
  const join = deps.platform === "win32" ? path.win32.join : path.posix.join;
  const found: InstalledExtension[] = [];
  for (const [folder, scope] of folders) {
    const dir = join(folder, BUNDLE_ID);
    const copy = await readCopy(deps, dir);
    if (copy) found.push({ ...copy, scope, linked: await deps.isLink(dir) });
  }
  return found;
}

/**
 * The extension `zenvi adobe install` installs: `ZENVI_ADOBE_EXTENSION`, the
 * copy next to the CLI bundle (`dist/adobe/pro.zenvi.link`, also in the
 * Claude Code plugin), or in a development checkout the adobe-link package's
 * own build (`npm run build -w @zenvi/adobe-link`).
 */
export async function bundledExtension(deps: DetectDeps): Promise<ExtensionCopy | undefined> {
  const candidates: string[] = [];
  const override = deps.env.ZENVI_ADOBE_EXTENSION?.trim();
  if (override) candidates.push(override);
  else {
    const bundle = bundleDir();
    if (bundle) candidates.push(path.join(bundle, "adobe", BUNDLE_ID));
    else {
      try {
        // packages/adobe-link/src/index.ts → packages/adobe-link/dist/pro.zenvi.link
        const entry = createRequire(import.meta.url).resolve("@zenvi/adobe-link");
        candidates.push(path.join(path.dirname(path.dirname(entry)), "dist", BUNDLE_ID));
      } catch {
        // Not a development checkout.
      }
    }
  }
  for (const dir of candidates) {
    const copy = await readCopy(deps, dir);
    if (copy) return copy;
  }
  return undefined;
}

/** Folder names that mark an installed app, per host. */
const APP_PREFIX: { readonly [H in HostId]: string } = {
  aftereffects: "Adobe After Effects",
  premiere: "Adobe Premiere Pro",
};

export interface AppsFound {
  /** Matching app folders per host (e.g. "Adobe After Effects 2026"). */
  apps: Record<HostId, string[]>;
  /** False when no app folder could be read at all (unknown platform, unusual install). */
  looked: boolean;
}

/** Which Adobe apps are installed in the standard places (/Applications, Program Files\Adobe). */
export async function findAdobeApps(deps: DetectDeps): Promise<AppsFound> {
  const dirs =
    deps.platform === "darwin"
      ? ["/Applications", path.posix.join(deps.home, "Applications")]
      : deps.platform === "win32"
        ? [...new Set([deps.env.ProgramFiles ?? "C:\\Program Files", deps.env.ProgramW6432 ?? deps.env.ProgramFiles ?? "C:\\Program Files"])].map((root) => path.win32.join(root, "Adobe"))
        : [];
  const apps: Record<HostId, string[]> = { aftereffects: [], premiere: [] };
  let looked = false;
  for (const dir of dirs) {
    const names = await deps.listDir(dir);
    if (!names) continue;
    looked = true;
    for (const host of Object.keys(apps) as HostId[]) {
      for (const name of names) if (name.startsWith(APP_PREFIX[host]) && !apps[host].includes(name)) apps[host].push(name);
    }
  }
  return { apps, looked };
}
