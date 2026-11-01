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
    super("Zenvi Motion needs headless Chrome to render blocks: run `zenvi motion setup` or call setup_motion_runtime_tool (downloads chrome-headless-shell, about 90 MB, once) or set ZENVI_CHROME to a Chrome executable.");
    this.name = "ChromeMissingError";
  }
}

/** Size of the chrome-headless-shell download, for the messages that offer it. */
export const CHROME_DOWNLOAD_MB = 90;

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

/** How long one launch may take before it counts as failed (a loaded machine needs far more than puppeteer's 30 s). */
export const LAUNCH_TIMEOUT_MS = 90_000;
const LAUNCH_TRIES = 2;
/** A warm browser nobody has used for this long is closed. */
const IDLE_CLOSE_MS = 120_000;

export class ChromeLaunchError extends Error {
  constructor(tries: number, timeoutMs: number, cause: unknown) {
    const why = cause instanceof Error ? cause.message.split("\n")[0] : String(cause);
    const each = timeoutMs < 1000 ? `${timeoutMs} ms` : `${Math.round(timeoutMs / 1000)} s`;
    super(`Headless Chrome did not start after ${tries} tries of ${each} (${why}). The computer looks busy or the Chrome install is damaged: close heavy programs and try again, or run \`zenvi motion setup\` again, or set ZENVI_CHROME to a Chrome executable.`);
    this.name = "ChromeLaunchError";
  }
}

export interface LaunchDeps {
  launch?: typeof puppeteer.launch;
  /** Flags on top of chromeArgs (a scene's sandbox). */
  args?: readonly string[];
}

function launchTimeout(env: NodeJS.ProcessEnv): number {
  const asked = Number(env.ZENVI_CHROME_TIMEOUT_MS);
  return Number.isFinite(asked) && asked > 0 ? asked : LAUNCH_TIMEOUT_MS;
}

/** Start headless Chrome: a 90 s timeout per try and one retry (a busy machine, or macOS checking a fresh binary), then a clear error. */
export async function launchChrome(env: NodeJS.ProcessEnv = process.env, deps: LaunchDeps = {}): Promise<PuppeteerBrowser> {
  const executablePath = await findChrome(env);
  if (!executablePath) throw new ChromeMissingError();
  const launch = deps.launch ?? puppeteer.launch.bind(puppeteer);
  const timeout = launchTimeout(env);
  let last: unknown;
  for (let attempt = 1; attempt <= LAUNCH_TRIES; attempt += 1) {
    try {
      return await launch({ executablePath, headless: "shell", args: [...chromeArgs(env), ...(deps.args ?? [])], protocolTimeout: 120_000, timeout });
    } catch (error) {
      last = error;
    }
  }
  throw new ChromeLaunchError(LAUNCH_TRIES, timeout, last);
}

interface Warm {
  browser: Promise<PuppeteerBrowser>;
  /** The browser once launched: an exit handler cannot wait for the promise. */
  launched?: PuppeteerBrowser;
  leases: number;
  idle?: NodeJS.Timeout;
}

let warm: Warm | undefined;
let exitHook = false;

function dropWarm(entry: Warm): void {
  if (entry.idle) clearTimeout(entry.idle);
  if (warm === entry) warm = undefined;
}

export interface ChromeLease {
  browser: PuppeteerBrowser;
  release(): void;
}

/**
 * The process's one warm browser, started on first use and shared by every
 * render until it has been idle for two minutes (a launch costs 1-3 s, and
 * several renders in a row are the normal case). A browser that died is
 * replaced. Release the lease when the render is done.
 */
export async function leaseChrome(env: NodeJS.ProcessEnv = process.env, deps: LaunchDeps = {}): Promise<ChromeLease> {
  if (!exitHook) {
    exitHook = true;
    // Chrome must not outlive a process that never called closeChrome.
    process.once("exit", () => {
      warm?.launched?.process()?.kill();
    });
  }
  for (;;) {
    const entry = warm ?? startWarm(env, deps);
    entry.leases += 1;
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = undefined;
    let browser: PuppeteerBrowser;
    try {
      browser = await entry.browser;
    } catch (error) {
      entry.leases -= 1;
      throw error;
    }
    if (browser.connected) {
      let released = false;
      return {
        browser,
        release() {
          if (released) return;
          released = true;
          entry.leases -= 1;
          if (entry.leases === 0 && warm === entry) entry.idle = setTimeout(() => void closeChrome(), IDLE_CLOSE_MS).unref();
        },
      };
    }
    // It died since the last render: replace it.
    entry.leases -= 1;
    dropWarm(entry);
    void browser.close().catch(() => undefined);
  }
}

function startWarm(env: NodeJS.ProcessEnv, deps: LaunchDeps): Warm {
  const entry: Warm = { browser: launchChrome(env, deps), leases: 0 };
  // A failed launch is not kept: the next render tries again.
  entry.browser.then(
    (browser) => {
      entry.launched = browser;
    },
    () => dropWarm(entry),
  );
  warm = entry;
  return entry;
}

/** Close the warm browser now (a command that is about to exit, or a test). */
export async function closeChrome(): Promise<void> {
  const entry = warm;
  if (!entry) return;
  dropWarm(entry);
  const browser = await entry.browser.catch(() => undefined);
  await browser?.close().catch(() => undefined);
}
