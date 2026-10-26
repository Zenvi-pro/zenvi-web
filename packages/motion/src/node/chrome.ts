/**
 * Finding, installing and launching the headless Chrome the renderer
 * captures with: chrome-headless-shell from Chrome for Testing, kept in
 * Zenvi's cache folder (`<cache>/chrome`), or any Chrome named by
 * `ZENVI_CHROME`.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { Browser, BrowserTag, detectBrowserPlatform, getInstalledBrowsers, install, resolveBuildId } from "@puppeteer/browsers";
import puppeteer, { type Browser as PuppeteerBrowser } from "puppeteer-core";
import { cacheDir } from "@zenvi/render-node";

export class ChromeMissingError extends Error {
  constructor() {
    super("Zenvi Motion needs headless Chrome to render blocks: run `zenvi motion setup` (downloads chrome-headless-shell, about 90 MB) or set ZENVI_CHROME to a Chrome executable.");
    this.name = "ChromeMissingError";
  }
}

export function chromeCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheDir(env), "chrome");
}

/** The Chrome to render with, or undefined when there is none. */
export async function findChrome(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const named = env.ZENVI_CHROME?.trim();
  if (named) return existsSync(named) ? named : undefined;
  const installed = await getInstalledBrowsers({ cacheDir: chromeCacheDir(env) }).catch(() => []);
  const shells = installed.filter((b) => b.browser === Browser.CHROMEHEADLESSSHELL).sort((a, b) => compareBuilds(b.buildId, a.buildId));
  const exe = shells[0]?.executablePath;
  return exe && existsSync(exe) ? exe : undefined;
}

function compareBuilds(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Download the stable chrome-headless-shell into Zenvi's cache (no-op when present). Returns its executable. */
export async function installChrome(env: NodeJS.ProcessEnv = process.env, onProgress?: (downloaded: number, total: number) => void): Promise<string> {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error(`chrome-headless-shell has no build for ${process.platform}/${process.arch}.`);
  const buildId = await resolveBuildId(Browser.CHROMEHEADLESSSHELL, platform, BrowserTag.STABLE);
  const done = await install({ browser: Browser.CHROMEHEADLESSSHELL, buildId, cacheDir: chromeCacheDir(env), platform, downloadProgressCallback: onProgress });
  return done.executablePath;
}

/**
 * Flags for repeatable frames: software raster with no GPU variance, sRGB
 * output, no LCD text, no background throttling of the capture tabs.
 */
export const CHROME_ARGS = [
  "--disable-gpu",
  "--force-color-profile=srgb",
  "--disable-lcd-text",
  "--font-render-hinting=none",
  "--hide-scrollbars",
  "--mute-audio",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-extensions",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-dev-shm-usage",
];

/**
 * The flags for this environment. `ZENVI_CHROME_NO_SANDBOX=1` drops Chrome's
 * own sandbox, which needs user namespaces that containers such as Azure
 * Container Apps (the Zenvi Cloud image) do not grant: there the container
 * is the boundary, and a block page reaches nothing but its own local page
 * server (render.ts aborts every other request).
 */
export function chromeArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  return env.ZENVI_CHROME_NO_SANDBOX?.trim() === "1" ? [...CHROME_ARGS, "--no-sandbox"] : CHROME_ARGS;
}

export async function launchChrome(env: NodeJS.ProcessEnv = process.env): Promise<PuppeteerBrowser> {
  const executablePath = await findChrome(env);
  if (!executablePath) throw new ChromeMissingError();
  return puppeteer.launch({ executablePath, headless: "shell", args: chromeArgs(env), protocolTimeout: 120_000 });
}
