/**
 * renderBlock: a motion block with its params → a video file.
 *
 * The page is laid out at a design size whose shorter side is 1080 px and
 * captured at a device scale factor that gives the requested size, so a
 * block looks the same at 720p and 4K. Each frame is `__zenvi.seek(t)` then
 * a PNG screenshot (transparent background when `alpha`); frames are spread
 * over a few tabs and piped in order into ffmpeg: ProRes 4444 `.mov` with
 * alpha (libopenshot drops VP9 WebM alpha, zenvi-core
 * classes/handoff/linked_media.py), H.264 `.mp4` without. Motion blur
 * renders `motionBlurSamples` sub-frames over a 180° shutter and averages
 * them (premultiplied, so edges do not fringe). Renders are cached by
 * fingerprint in `<cache>/motion/`, each with its picture events (what the
 * sound design hears, `__zenvi.events`) in a `.events.json` beside it.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, CDPSession, Page } from "puppeteer-core";
import { readPictureEvents, type PictureEvent } from "@zenvi/engine";
import { cacheDir, resolveBinary, spawnManaged } from "@zenvi/render-node";
import { getBlock } from "../catalog.js";
import { allParams, checkParams, type BlockManifest, type Params } from "../params.js";
import type { BlockConfig, MediaRef, ZenviPageApi } from "../config.js";
import { leaseChrome } from "./chrome.js";
import { prepareMedia } from "./media.js";
import { blockPage, motionDir, pageHtml } from "./page.js";
import { startPageServer } from "./server.js";

/** Bumped when the capture or encode changes renders; part of every fingerprint. */
export const RENDERER_VERSION = 1;

export type MotionCodec = "prores4444" | "h264";

export interface Fps {
  num: number;
  den: number;
}

export interface RenderBlockOptions {
  width: number;
  height: number;
  fps: number | Fps;
  /** Length, seconds (default the block's default; must be within its min/max). */
  seconds?: number;
  /** Transparent background, ProRes 4444 (default the block's `alpha`). */
  alpha?: boolean;
  /** Sub-frames averaged per frame for motion blur (0/1 = off, max 16). */
  motionBlurSamples?: number;
  /** Half size, faster encode: for previews. */
  draft?: boolean;
  /** Local file of each media param (by param name). */
  media?: Readonly<Record<string, string>>;
  /** Copy the result here (else the cached file is returned). */
  output?: string;
  /** Capture tabs in parallel (default 3). */
  workers?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  /** A Chrome to reuse (the caller closes it). */
  browser?: Browser;
}

export interface RenderedBlock {
  path: string;
  codec: MotionCodec;
  width: number;
  height: number;
  fps: Fps;
  frames: number;
  seconds: number;
  alpha: boolean;
  fingerprint: string;
  /** The params used, defaults filled in. */
  params: Params;
  cached: boolean;
  /** Wall-clock seconds the render took (0 when cached). */
  renderSeconds: number;
  /** What happens on screen that the ear expects to hear, from the block's timeline (seconds from its start). */
  events: PictureEvent[];
}

/** What blockEvents needs: a render request without the capture's own settings. */
export type BlockEventsOptions = Omit<RenderBlockOptions, "output" | "workers" | "onProgress">;

/** A bad block id, params or size: the caller's mistake, in words. */
export class MotionBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MotionBlockError";
  }
}

function toFps(fps: number | Fps): Fps {
  if (typeof fps === "number") {
    if (!(fps > 0 && fps <= 120)) throw new MotionBlockError(`fps must be between 1 and 120 (got ${fps})`);
    const whole = Math.round(fps);
    if (Math.abs(fps - whole) < 1e-6) return { num: whole, den: 1 };
    return { num: Math.round(fps * 1001), den: 1001 };
  }
  if (!(fps.num > 0 && fps.den > 0)) throw new MotionBlockError("fps must be positive");
  return { num: fps.num, den: fps.den };
}

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** The design size (shorter side 1080) and the scale that captures it at width × height. */
export function designSize(width: number, height: number): { width: number; height: number; scale: number } {
  const short = Math.min(width, height);
  const dw = Math.round((width * 1080) / short);
  const dh = Math.round((height * 1080) / short);
  return { width: dw, height: dh, scale: width / dw };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/** A media file's identity for the fingerprint: path, size and modification time. */
async function fileKey(file: string): Promise<string> {
  const s = await stat(file);
  return `${path.resolve(file)}:${s.size}:${Math.round(s.mtimeMs)}`;
}

export interface Fingerprinted {
  manifest: BlockManifest;
  params: Params;
  fps: Fps;
  seconds: number;
  alpha: boolean;
  samples: number;
  width: number;
  height: number;
  fingerprint: string;
}

/** Check a render request and fingerprint it (everything that changes its pixels). */
export async function fingerprintRender(id: string, raw: Readonly<Record<string, unknown>>, options: RenderBlockOptions): Promise<Fingerprinted> {
  const manifest = getBlock(id);
  if (!manifest) throw new MotionBlockError(`unknown motion block ${id}`);
  const checked = checkParams(manifest, raw);
  if (!checked.ok) throw new MotionBlockError(checked.error);
  const params = checked.params;
  const seconds = options.seconds ?? manifest.duration.default;
  if (!(seconds >= manifest.duration.min && seconds <= manifest.duration.max)) {
    throw new MotionBlockError(`${id} runs ${manifest.duration.min}-${manifest.duration.max} s (got ${seconds})`);
  }
  if (!(options.width >= 16 && options.height >= 16 && options.width <= 4096 && options.height <= 4096)) {
    throw new MotionBlockError(`size must be 16-4096 px a side (got ${options.width}×${options.height})`);
  }
  const fps = toFps(options.fps);
  const samples = Math.max(1, Math.min(16, Math.round(options.motionBlurSamples ?? 1)));
  const alpha = options.alpha ?? manifest.alpha;
  const draft = options.draft === true;
  const width = even(draft ? options.width / 2 : options.width);
  const height = even(draft ? options.height / 2 : options.height);
  const media: Record<string, string> = {};
  for (const [name, spec] of Object.entries(allParams(manifest))) {
    if (spec.type !== "media" || params[name] === undefined) continue;
    const file = options.media?.[name];
    if (!file) throw new MotionBlockError(`${name} needs its media file`);
    media[name] = await fileKey(file).catch(() => {
      throw new MotionBlockError(`${name}: ${file} is missing`);
    });
  }
  const page = await blockPage(id, options.env);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical({ renderer: RENDERER_VERSION, block: id, version: manifest.version, code: page.codeHash, params, media, width, height, fps, seconds, alpha, samples })))
    .digest("hex");
  return { manifest, params, fps, seconds, alpha, samples, width, height, fingerprint };
}

export function motionCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheDir(env), "motion");
}

/** The cached render of `fp` (whether or not it exists yet). */
function cachedPath(id: string, fp: Fingerprinted, env: NodeJS.ProcessEnv | undefined): string {
  return path.join(motionCacheDir(env), `${id}-${fp.fingerprint.slice(0, 16)}${fp.alpha ? ".mov" : ".mp4"}`);
}

const eventsPath = (cached: string): string => `${cached}.events.json`;

/** The events cached beside a render; null when there are none (a render cached before events were recorded). */
async function readCachedEvents(cached: string): Promise<PictureEvent[] | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(eventsPath(cached), "utf8"));
    return Array.isArray(raw) ? readPictureEvents(raw) : null;
  } catch {
    return null;
  }
}

/** Write the events beside the render, from the scratch folder `work` (in the cache) so a reader never sees half a file. */
async function writeCachedEvents(cached: string, events: readonly PictureEvent[], work: string): Promise<void> {
  const partial = path.join(work, "events.json");
  await writeFile(partial, JSON.stringify(events));
  await rename(partial, eventsPath(cached));
}

export async function renderBlock(id: string, raw: Readonly<Record<string, unknown>>, options: RenderBlockOptions): Promise<RenderedBlock> {
  const fp = await fingerprintRender(id, raw, options);
  const codec: MotionCodec = fp.alpha ? "prores4444" : "h264";
  const ext = fp.alpha ? ".mov" : ".mp4";
  const dir = motionCacheDir(options.env);
  await mkdir(dir, { recursive: true });
  const cached = cachedPath(id, fp, options.env);
  const frames = Math.max(1, Math.round((fp.seconds * fp.fps.num) / fp.fps.den));
  let events: PictureEvent[] = [];
  const result = (file: string, wasCached: boolean, renderSeconds: number): RenderedBlock => ({
    path: file,
    codec,
    width: fp.width,
    height: fp.height,
    fps: fp.fps,
    frames,
    seconds: fp.seconds,
    alpha: fp.alpha,
    fingerprint: fp.fingerprint,
    params: fp.params,
    cached: wasCached,
    renderSeconds,
    events,
  });
  const deliver = async (wasCached: boolean, renderSeconds: number): Promise<RenderedBlock> => {
    if (!options.output) return result(cached, wasCached, renderSeconds);
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await copyFile(cached, options.output);
    return result(path.resolve(options.output), wasCached, renderSeconds);
  };
  if (existsSync(cached)) {
    events = (await readCachedEvents(cached)) ?? (await cacheEvents(fp, cached, options));
    return deliver(true, 0);
  }

  const started = Date.now();
  // Scratch inside the cache folder so the finished file is renamed into place: a copy across
  // filesystems (tmpfs /tmp) cut short would leave a truncated file the cache then trusts.
  const work = await mkdtemp(path.join(dir, ".render-"));
  try {
    const partial = path.join(work, `render${ext}`);
    events = await capture(fp, frames, partial, work, options);
    // Events first: a render in the cache always has them beside it.
    await writeCachedEvents(cached, events, work);
    await rename(partial, cached);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return deliver(false, (Date.now() - started) / 1000);
}

/**
 * The picture events of a block as renderBlock would make it, without
 * capturing frames: read from the cache when that render (or an earlier
 * events-only read) is there, else the page is built once and asked.
 */
export async function blockEvents(id: string, raw: Readonly<Record<string, unknown>>, options: BlockEventsOptions): Promise<PictureEvent[]> {
  const fp = await fingerprintRender(id, raw, options);
  await mkdir(motionCacheDir(options.env), { recursive: true });
  const cached = cachedPath(id, fp, options.env);
  return (await readCachedEvents(cached)) ?? cacheEvents(fp, cached, options);
}

/** Open the block's page once (no capture), read its events and cache them beside `cached`. */
async function cacheEvents(fp: Fingerprinted, cached: string, options: BlockEventsOptions): Promise<PictureEvent[]> {
  const work = await mkdtemp(path.join(path.dirname(cached), ".events-"));
  try {
    const events = await withBrowser(options, async (browser) => {
      const served = await serveBlock(fp, work, options);
      try {
        const tab = await openTab(browser, served.url, served.design, false);
        try {
          return await readEvents(tab);
        } finally {
          await tab.page.close().catch(() => undefined);
        }
      } finally {
        await served.close();
      }
    });
    await writeCachedEvents(cached, events, work);
    return events;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Sample times (seconds) for each output frame: the frame time, or sub-frames over a 180° shutter. */
export function sampleTimes(frames: number, fps: number, samples: number): number[] {
  const out: number[] = [];
  for (let f = 0; f < frames; f += 1) {
    for (let k = 0; k < samples; k += 1) {
      const offset = samples > 1 ? (k / samples - 0.5) * 0.5 : 0;
      out.push(Math.max(0, (f + offset) / fps));
    }
  }
  return out;
}

/** The ffmpeg arguments that turn the PNG stream into the output file. */
export function encodeArgs(o: { alpha: boolean; fps: Fps; samples: number; width: number; height: number; captured: { width: number; height: number }; draft: boolean; output: string }): string[] {
  const rate = `${o.fps.num * o.samples}/${o.fps.den}`;
  const filters: string[] = [];
  if (o.samples > 1) {
    filters.push("format=rgba", "premultiply=inplace=1", `tmix=frames=${o.samples}`, `select='eq(mod(n\\,${o.samples})\\,${o.samples - 1})'`, "unpremultiply=inplace=1", `setpts=N/(${o.fps.num}/${o.fps.den})/TB`);
  }
  if (o.captured.width !== o.width || o.captured.height !== o.height) filters.push(`scale=${o.width}:${o.height}:flags=lanczos`);
  const args = ["-v", "error", "-y", "-f", "image2pipe", "-framerate", rate, "-c:v", "png", "-i", "-"];
  if (o.alpha) {
    if (filters.length > 0) args.push("-vf", filters.join(","));
    args.push("-r", `${o.fps.num}/${o.fps.den}`, "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0");
    if (o.draft) args.push("-qscale:v", "11");
  } else {
    filters.push("scale=out_color_matrix=bt709:out_range=tv", "format=yuv420p");
    args.push("-vf", filters.join(","), "-r", `${o.fps.num}/${o.fps.den}`, "-c:v", "libx264", "-preset", o.draft ? "veryfast" : "medium", "-crf", o.draft ? "23" : "16");
    args.push("-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart");
  }
  args.push(o.output);
  return args;
}

interface PageGlobals {
  __zenvi?: ZenviPageApi;
}

interface Tab {
  page: Page;
  cdp: CDPSession;
}

async function openTab(browser: Browser, url: string, design: { width: number; height: number; scale: number }, alpha: boolean): Promise<Tab> {
  const page = await browser.newPage();
  // Chrome rasterizes at the device scale factor; below 1 it does not shrink screenshots, so the capture clip scales the rest.
  await page.setViewport({ width: design.width, height: design.height, deviceScaleFactor: Math.max(1, design.scale) });
  const cdp = await page.createCDPSession();
  if (alpha) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e instanceof Error ? e.message : String(e)));
  // The page may load only the render's own server (and inline data): nothing from the network.
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const u = request.url();
    if (u.startsWith(url) || u.startsWith("data:") || u.startsWith("blob:")) void request.continue();
    else void request.abort("blockedbyclient");
  });
  await page.goto(url, { waitUntil: "load" });
  const failure = await page.evaluate(async () => {
    const z = (globalThis as unknown as PageGlobals).__zenvi;
    if (!z) return "the page did not start the block";
    try {
      await z.ready;
      return null;
    } catch {
      return z.error ?? "the block failed to build";
    }
  });
  if (failure || errors.length > 0) throw new Error(`block page failed: ${failure ?? errors.join("; ")}`);
  return { page, cdp };
}

/** The page's picture events, checked as the engine reads them (the page is code we run, but keep the contract). */
async function readEvents(tab: Tab): Promise<PictureEvent[]> {
  const raw = await tab.page.evaluate(() => (globalThis as unknown as PageGlobals).__zenvi?.events ?? []);
  return readPictureEvents(raw);
}

async function withBrowser<T>(options: { browser?: Browser; env?: NodeJS.ProcessEnv }, run: (browser: Browser) => Promise<T>): Promise<T> {
  if (options.browser) return run(options.browser);
  const lease = await leaseChrome(options.env);
  try {
    return await run(lease.browser);
  } finally {
    lease.release();
  }
}

function capture(fp: Fingerprinted, frames: number, output: string, work: string, options: RenderBlockOptions): Promise<PictureEvent[]> {
  return withBrowser(options, (browser) => captureWith(browser, fp, frames, output, work, options));
}

interface ServedBlock {
  url: string;
  design: { width: number; height: number; scale: number };
  close(): Promise<void>;
}

/** Prepare the media params and serve the block's page for `fp`. */
async function serveBlock(fp: Fingerprinted, work: string, options: BlockEventsOptions): Promise<ServedBlock> {
  const draft = options.draft === true;
  const design = designSize(fp.width, fp.height);
  const fpsValue = fp.fps.num / fp.fps.den;
  const media: Record<string, MediaRef> = {};
  const mediaDirs = new Map<string, string>();
  for (const [name, spec] of Object.entries(allParams(fp.manifest))) {
    if (spec.type !== "media" || fp.params[name] === undefined) continue;
    const prepared = await prepareMedia(name, options.media![name]!, spec.accept, { width: fp.width, height: fp.height, fps: fpsValue, seconds: fp.seconds, workDir: work, signal: options.signal });
    media[name] = prepared.ref;
    mediaDirs.set(name, prepared.dir);
  }
  const config: BlockConfig = { block: fp.manifest.id, params: fp.params, width: design.width, height: design.height, fps: fpsValue, seconds: fp.seconds, alpha: fp.alpha, media, draft };
  const page = await blockPage(fp.manifest.id, options.env);
  const server = await startPageServer({ html: pageHtml(page, config), script: page.script, fontsDir: path.join(motionDir(options.env), "fonts"), mediaDirs });
  return { url: server.url, design, close: () => server.close() };
}

async function captureWith(browser: Browser, fp: Fingerprinted, frames: number, output: string, work: string, options: RenderBlockOptions): Promise<PictureEvent[]> {
  const draft = options.draft === true;
  const fpsValue = fp.fps.num / fp.fps.den;
  const served = await serveBlock(fp, work, options);
  const design = served.design;
  const times = sampleTimes(frames, fpsValue, fp.samples);
  const clip = { x: 0, y: 0, width: design.width, height: design.height, scale: design.scale / Math.max(1, design.scale) };
  const captured = { width: Math.round(design.width * design.scale), height: Math.round(design.height * design.scale) };
  const ffmpeg = spawnManaged(resolveBinary("ffmpeg"), encodeArgs({ alpha: fp.alpha, fps: fp.fps, samples: fp.samples, width: fp.width, height: fp.height, captured, draft, output }), { stdin: "pipe", stdout: "ignore", signal: options.signal });
  const stdin = ffmpeg.child.stdin!;
  stdin.on("error", () => undefined);
  const tabs: Tab[] = [];
  try {
    const workers = Math.max(1, Math.min(options.workers ?? 3, 8, times.length));
    tabs.push(...(await Promise.all(Array.from({ length: workers }, () => openTab(browser, served.url, design, fp.alpha)))));
    const events = await readEvents(tabs[0]!);
    const ready = new Map<number, Buffer>();
    let next = 0;
    let written = 0;
    const waiters: (() => void)[] = [];
    const ahead = workers * 3;
    const writeReady = async (): Promise<void> => {
      while (ready.has(written)) {
        const buf = ready.get(written)!;
        ready.delete(written);
        written += 1;
        if (!stdin.write(buf)) await new Promise<void>((r) => stdin.once("drain", () => r()));
        options.onProgress?.(written, times.length);
      }
      for (const w of waiters.splice(0)) w();
    };
    let writing = Promise.resolve();
    await Promise.all(
      tabs.map(async (tab) => {
        for (;;) {
          if (options.signal?.aborted) throw new Error("render cancelled");
          const i = next;
          if (i >= times.length) return;
          next += 1;
          while (i - written >= ahead) await new Promise<void>((r) => waiters.push(r));
          await tab.page.evaluate((t: number) => (globalThis as unknown as PageGlobals).__zenvi!.seek(t), times[i]!);
          const shot = await tab.cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true, clip });
          ready.set(i, Buffer.from(shot.data, "base64"));
          writing = writing.then(writeReady);
        }
      }),
    );
    await writing;
    stdin.end();
    const code = await ffmpeg.exited;
    if (code !== 0) throw ffmpeg.failure("encoding the motion block");
    return events;
  } catch (error) {
    stdin.destroy();
    await ffmpeg.kill();
    throw error;
  } finally {
    await Promise.all(tabs.map((t) => t.page.close().catch(() => undefined)));
    await served.close();
  }
}
