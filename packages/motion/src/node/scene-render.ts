/**
 * Scenes, checked and rendered in a sandbox. Scene code is the agent's, so
 * it runs only here: in a headless Chrome launched for the one job (a heap
 * limit, a dead proxy, no WebRTC UDP), on a page whose policy allows no
 * eval, no connections, no workers and no frames, whose requests are all
 * refused but the job's own loopback server (the runtime, the scene, the
 * fonts and the media passed in), and every call into it is timed out.
 * Before any of that the lint (scene-lint.ts) refuses what a scene may not
 * name.
 *
 * The check draws every frame at half size without capturing (pixel hash,
 * luma thumbnail, text boxes, draw time), draws a sample again in another
 * tab in reverse order (frame t twice must be identical), measures the
 * flashes against WCAG 2.3.1 (review/flashing.ts) and audits the layout
 * (scene/audit.ts). A draft adds the contact sheet; a render captures
 * every frame (motion blur sub-frames that stop at cuts) into ProRes 4444
 * or H.264, cached by fingerprint like motion blocks (render.ts).
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, CDPSession, Page } from "puppeteer-core";
import { flashingOf, readPictureEvents, type PictureEvent, type SceneProblem } from "@zenvi/engine";
import { resolveBinary, spawnManaged } from "@zenvi/render-node";
import { safeArea } from "../runtime/safe.js";
import { auditLayout } from "../scene/audit.js";
import { PROBE_H, PROBE_W, SCENE_LIMITS, type FrameProbe, type RawSceneExports, type SceneInfo, type SceneMediaRef, type ScenePageApi, type ScenePageConfig } from "../scene/contract.js";
import { FONT_FACES } from "../tokens.js";
import { launchChrome } from "./chrome.js";
import { prepareMedia } from "./media.js";
import { motionDir, scenePage, type ScenePage } from "./page.js";
import { designSize, encodeArgs, motionCacheDir, type Fps } from "./render.js";
import { lintScene, type SceneExport } from "./scene-lint.js";
import { sceneEvents, sceneInfo, sceneSampleFrames } from "./scene-info.js";
import { startPageServer } from "./server.js";

/** Bumped when the check or the capture changes renders; part of every fingerprint. */
export const SCENE_RENDERER_VERSION = 1;

/** The scene page's policy: its own scripts, fonts and media; no eval, no connections, no workers, no frames, no forms. */
export const SCENE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'none'",
  "media-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "manifest-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Flags of the scene's own Chrome: a heap limit, every non-loopback request through a proxy that does not exist, WebRTC kept off UDP. */
export function sandboxArgs(): string[] {
  return [`--js-flags=--max-old-space-size=${SCENE_LIMITS.heapMb}`, "--proxy-server=http://127.0.0.1:9", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-background-networking", "--disable-sync", "--disable-component-update", "--no-pings"];
}

/** A scene the caller got wrong (bad size, a missing media file): the agent's mistake in words, not a scene problem. */
export class SceneJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneJobError";
  }
}

export interface SceneJob {
  code: string;
  params?: Readonly<Record<string, unknown>>;
  /** Local file of each media name. */
  media?: Readonly<Record<string, string>>;
  width: number;
  height: number;
  /** The output's (the project's) rate. */
  fps: number | Fps;
  allowStrobe?: boolean;
  /** A frame's draw time limit, ms (default SCENE_LIMITS.frameMs; tests lower it). */
  frameMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface DraftOptions extends SceneJob {
  /** Write the contact sheet here (JPEG). */
  sheetPath?: string;
}

export interface DraftResult {
  info?: SceneInfo;
  problems: SceneProblem[];
  /** The contact sheet, JPEG. */
  sheet?: Buffer;
  cells: { frame: number; label: string }[];
  checkSeconds: number;
}

export interface RenderSceneOptions extends SceneJob {
  /** Default the scene's own `alpha`. */
  alpha?: boolean;
  motionBlurSamples?: number;
  /** Half size, quicker encode. */
  draft?: boolean;
  /** Capture tabs (default 2). */
  workers?: number;
  /** Copy the result here (else the cached file is returned). */
  output?: string;
  onProgress?: (done: number, total: number) => void;
}

export type RenderSceneResult =
  | { ok: true; path: string; codec: "prores4444" | "h264"; width: number; height: number; fps: Fps; frames: number; fingerprint: string; cached: boolean; renderSeconds: number; events: PictureEvent[]; info: SceneInfo; problems: SceneProblem[] }
  | { ok: false; problems: SceneProblem[]; info?: SceneInfo };

const even = (n: number): number => Math.max(16, Math.round(n / 2) * 2);
const round = (v: number, places = 2): number => Math.round(v * 10 ** places) / 10 ** places;
const isError = (p: SceneProblem): boolean => p.severity === "error";

function toFps(fps: number | Fps): Fps {
  if (typeof fps !== "number") return { num: fps.num, den: fps.den };
  const whole = Math.round(fps);
  return Math.abs(fps - whole) < 1e-6 ? { num: whole, den: 1 } : { num: Math.round(fps * 1001), den: 1001 };
}

function checkJob(job: SceneJob): { fps: Fps; rate: number } {
  if (!(job.width >= 16 && job.height >= 16 && job.width <= 4096 && job.height <= 4096)) throw new SceneJobError(`size must be 16-4096 px a side (got ${job.width}×${job.height})`);
  const fps = toFps(job.fps);
  const rate = fps.num / fps.den;
  if (!(rate > 0 && rate <= 120)) throw new SceneJobError(`fps must be between 1 and 120 (got ${rate})`);
  for (const name of Object.keys(job.media ?? {})) if (!/^[a-z][a-z0-9_]{0,31}$/.test(name)) throw new SceneJobError(`media name ${JSON.stringify(name)} must be lowercase letters, digits and _ (starting with a letter)`);
  return { fps, rate };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * The scene's script: its module body inside a strict function whose
 * parameters hide the page's globals, handing its exports to the runtime.
 */
export function wrapScene(body: string, exports: readonly SceneExport[]): string {
  const hidden = ["window", "self", "globalThis", "document", "top", "parent", "frames", "opener", "location", "navigator", "fetch", "XMLHttpRequest", "WebSocket", "Function", "setTimeout", "setInterval", "Date", "performance", "__zenviScene", "__zenviSceneStart"];
  return `(function (start) {
  "use strict";
  var made;
  try {
    made = (function (${hidden.join(", ")}) {
      "use strict";
${body}
      ;return { ${exports.map((e) => `${e.name}: ${e.local}`).join(", ")} };
    }).call(undefined);
  } catch (error) {
    start(null, error);
    return;
  }
  start(made, null);
})(window.__zenviSceneStart);
`;
}

function fontFaces(): string {
  return FONT_FACES.map((f) => `@font-face { font-family: '${f.family}'; src: url('/fonts/${f.file}') format('woff2'); font-weight: ${f.weight}; font-style: ${f.style}; font-display: block; }`).join("\n");
}

export function sceneHtml(config: ScenePageConfig): string {
  const json = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>${fontFaces()}
html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }</style>
</head><body>
<script type="application/json" id="zenvi-scene-config">${json}</script>
<script src="/runtime.js"></script>
<script src="/scene.js"></script>
</body></html>`;
}

class SceneStop extends Error {
  constructor(readonly problem: SceneProblem) {
    super(problem.message);
  }
}

function timed<T>(work: Promise<T>, ms: number, problem: () => SceneProblem): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SceneStop(problem())), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

interface Tab {
  page: Page;
  cdp: CDPSession;
  /** Set when the page's renderer died. */
  crashed: () => boolean;
}

interface PageGlobals {
  __zenviScene?: ScenePageApi;
}

/** A tab on the job's server: the scene loaded, its raw exports read. */
async function openTab(browser: Browser, url: string, size: { width: number; height: number }, alpha: boolean): Promise<{ tab: Tab; raw: RawSceneExports }> {
  const page = await browser.newPage();
  let crashed = false;
  const errors: string[] = [];
  page.on("error", () => {
    crashed = true;
  });
  page.on("pageerror", (e) => errors.push(e instanceof Error ? e.message : String(e)));
  await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
  const cdp = await page.createCDPSession();
  if (alpha) await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  // Only the job's own server, nothing else (not even data: or blob: URLs).
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.url().startsWith(url)) void request.continue();
    else void request.abort("blockedbyclient");
  });
  const tab: Tab = { page, cdp, crashed: () => crashed };
  const load = (async () => {
    await page.goto(url, { waitUntil: "load" });
    return page.evaluate(async () => {
      const z = (globalThis as unknown as PageGlobals).__zenviScene;
      if (!z) return { error: "the scene runtime did not start" };
      try {
        return { raw: await z.loaded };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
  })();
  const loaded = await timed(load, 30_000, () => ({ code: "timeout", severity: "error", message: "the scene did not finish loading in 30 s (top-level code that never ends?)" }));
  if ("error" in loaded) {
    const syntax = errors.length > 0 ? ` (${errors[0]})` : "";
    throw new SceneStop({ code: "load", severity: "error", message: `${loaded.error ?? "the scene did not load"}${syntax}` });
  }
  return { tab, raw: loaded.raw };
}

async function startTab(tab: Tab, info: SceneInfo): Promise<void> {
  const run = tab.page.evaluate(async (i: SceneInfo) => {
    try {
      await (globalThis as unknown as PageGlobals).__zenviScene!.start(i);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, info);
  const failure = await timed(run, 60_000, () => ({ code: "timeout", severity: "error", message: "the scene's fonts and media did not load in 60 s" }));
  if (failure) throw new SceneStop({ code: "load", severity: "error", message: failure });
}

/** Map a failure inside the page to a problem. */
function pageFailure(tab: Tab, error: unknown): SceneProblem {
  if (error instanceof SceneStop) return error.problem;
  if (tab.crashed()) return { code: "crash", severity: "error", message: `the scene's page crashed: it ran out of memory (a scene has ${SCENE_LIMITS.heapMb} MB) or drew something Chrome could not` };
  return { code: "draw-error", severity: "error", message: error instanceof Error ? error.message.split("\n")[0]! : String(error) };
}

const BATCH = 24;

async function probeFrames(tab: Tab, frames: readonly number[], frameMs: number): Promise<FrameProbe[]> {
  const out: FrameProbe[] = [];
  for (let i = 0; i < frames.length; i += BATCH) {
    const batch = frames.slice(i, i + BATCH);
    const run = tab.page.evaluate((fs: number[]) => (globalThis as unknown as PageGlobals).__zenviScene!.probe(fs), batch);
    const got = await timed(run, frameMs * batch.length + 2_000, () => ({ code: "timeout", severity: "error", message: `frames ${batch[0]}-${batch[batch.length - 1]} did not finish drawing (a loop that never ends, or far too much work: a frame has ${frameMs / 1000} s)` }));
    out.push(...got);
    if (got.some((p) => p.error)) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

interface Served {
  url: string;
  close(): Promise<void>;
}

interface Prepared {
  body: string;
  exports: SceneExport[];
  runtime: ScenePage;
  fps: Fps;
  rate: number;
  /** Fingerprint of everything that shapes the pixels except the capture's own settings. */
  sourceKey: string;
}

async function prepare(job: SceneJob): Promise<{ ok: true; prepared: Prepared } | { ok: false; problems: SceneProblem[] }> {
  const { fps, rate } = checkJob(job);
  const lint = await lintScene(job.code);
  if (!lint.ok) return { ok: false, problems: lint.problems.map((p) => ({ code: p.code === "banned" ? "lint" : p.code, severity: "error", message: p.message, ...(p.line !== undefined ? { line: p.line } : {}) })) };
  const runtime = await scenePage(job.env);
  const media: Record<string, string> = {};
  for (const [name, file] of Object.entries(job.media ?? {})) {
    const s = await stat(file).catch(() => null);
    if (!s?.isFile()) throw new SceneJobError(`media ${name}: ${file} is missing`);
    media[name] = `${path.resolve(file)}:${s.size}:${Math.round(s.mtimeMs)}`;
  }
  const sourceKey = createHash("sha256").update(JSON.stringify(canonical({ v: SCENE_RENDERER_VERSION, runtime: runtime.hash, body: lint.body, params: job.params ?? {}, media, fps }))).digest("hex");
  return { ok: true, prepared: { body: lint.body, exports: lint.exports, runtime, fps, rate, sourceKey } };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canonical(v)]));
  return value;
}

async function serve(prepared: Prepared, config: ScenePageConfig, mediaDirs: ReadonlyMap<string, string>, env: NodeJS.ProcessEnv | undefined): Promise<Served> {
  return startPageServer({
    html: sceneHtml(config),
    scripts: { "/runtime.js": prepared.runtime.script, "/scene.js": wrapScene(prepared.body, prepared.exports) },
    csp: SCENE_CSP,
    fontsDir: path.join(motionDir(env), "fonts"),
    mediaDirs,
  });
}

function pageConfig(width: number, height: number, rate: number, params: Readonly<Record<string, unknown>>, media: Record<string, SceneMediaRef>, alpha: boolean): ScenePageConfig {
  const design = designSize(width, height);
  return { width, height, designWidth: design.width, designHeight: design.height, params: { ...params }, media, renderFps: rate, alpha, seed: 1 };
}

/** Output frames of the scene at the output rate. */
const outputFrames = (info: SceneInfo, rate: number): number => Math.max(1, Math.round((info.duration / info.fps) * rate));

interface Checked {
  info: SceneInfo;
  problems: SceneProblem[];
  /** The tab that drew every frame (still open: the draft draws the sheet in it). */
  tab: Tab;
  media: Record<string, SceneMediaRef>;
  mediaDirs: Map<string, string>;
}

/** Spread over the scene, cue frames first: at most `count` scene frames. */
function sampleSceneFrames(info: SceneInfo, count: number): number[] {
  const picked = new Set<number>(info.cues.filter((c) => c.kind || c.hit || c.cut).map((c) => Math.min(info.duration - 1, Math.round(c.frame))));
  const spread = Math.max(2, count - picked.size);
  for (let i = 0; i < spread && picked.size < count * 2; i += 1) picked.add(Math.round(((info.duration - 1) * i) / (spread - 1)));
  const all = [...picked].sort((a, b) => a - b);
  if (all.length <= count) return all;
  return Array.from({ length: count }, (_, i) => all[Math.round((i * (all.length - 1)) / (count - 1))]!).filter((v, i, a) => a.indexOf(v) === i);
}

async function check(browser: Browser, job: SceneJob, prepared: Prepared, work: string, servers: Served[], tabs: Tab[], mediaSize: { width: number; height: number }): Promise<Checked> {
  const { rate } = prepared;
  const frameMs = job.frameMs ?? SCENE_LIMITS.frameMs;
  const probeSize = Math.min(job.width, job.height) > 720 ? { width: even(job.width / 2), height: even(job.height / 2) } : { width: even(job.width), height: even(job.height) };
  // Load once without media to read what the module declares.
  const bare = await serve(prepared, pageConfig(probeSize.width, probeSize.height, rate, job.params ?? {}, {}, false), new Map(), job.env);
  servers.push(bare);
  const first = await openTab(browser, bare.url, probeSize, false);
  tabs.push(first.tab);
  const read = sceneInfo(first.raw);
  if (!read.ok) throw new SceneStop(read.problems.find(isError)!);
  const info = read.info;
  const problems: SceneProblem[] = [...read.problems];
  await first.tab.page.close().catch(() => undefined);

  const seconds = info.duration / info.fps;
  const media: Record<string, SceneMediaRef> = {};
  const mediaDirs = new Map<string, string>();
  for (const [name, file] of Object.entries(job.media ?? {})) {
    const made = await prepareMedia(name, file, ["image", "video"], { width: mediaSize.width, height: mediaSize.height, fps: rate, seconds, workDir: work, signal: job.signal });
    media[name] = made.ref;
    mediaDirs.set(name, made.dir);
  }
  const server = await serve(prepared, pageConfig(probeSize.width, probeSize.height, rate, job.params ?? {}, media, info.alpha), mediaDirs, job.env);
  servers.push(server);
  const a = (await openTab(browser, server.url, probeSize, info.alpha)).tab;
  tabs.push(a);
  const b = (await openTab(browser, server.url, probeSize, info.alpha)).tab;
  tabs.push(b);
  for (const tab of [a, b]) {
    try {
      await startTab(tab, info);
    } catch (error) {
      throw new SceneStop(pageFailure(tab, error));
    }
  }

  const frames = outputFrames(info, rate);
  const sceneFrame = (out: number): number => Math.round((out * info.fps) / rate);
  let probes: FrameProbe[];
  try {
    probes = await probeFrames(a, Array.from({ length: frames }, (_, i) => i), frameMs);
  } catch (error) {
    throw new SceneStop(pageFailure(a, error));
  }
  const failed = probes.find((p) => p.error);
  if (failed) throw new SceneStop({ code: "draw-error", severity: "error", message: failed.error!, frames: { from: sceneFrame(failed.frame), to: sceneFrame(failed.frame) } });

  // Frame t drawn twice, in another tab and the other order, must be the same picture.
  const again = sampleSceneFrames(info, 12)
    .map((f) => Math.min(frames - 1, Math.round((f * rate) / info.fps)))
    .filter((v, i, all) => all.indexOf(v) === i)
    .reverse();
  let twice: FrameProbe[];
  try {
    twice = await probeFrames(b, again, frameMs);
  } catch (error) {
    throw new SceneStop(pageFailure(b, error));
  }
  const differs = twice.filter((p) => !p.error && p.hash !== probes[p.frame]?.hash).map((p) => sceneFrame(p.frame));
  if (differs.length > 0 || twice.some((p) => p.error)) {
    problems.push({
      code: "nondeterministic",
      severity: "error",
      message: `frame${differs.length === 1 ? "" : "s"} ${differs.sort((x, y) => x - y).join(", ")} drew differently the second time: draw must depend only on t, api and the params (no state kept between frames, no counters, no caches that change the picture)`,
      ...(differs.length > 0 ? { frames: { from: Math.min(...differs), to: Math.max(...differs) } } : {}),
    });
  }

  const flashes = flashingOf({ fps: rate, width: PROBE_W, height: PROBE_H, startSeconds: 0, frames: probes.map((p) => new Uint8Array(Buffer.from(p.luma, "base64"))) });
  for (const w of flashes) {
    problems.push({
      code: "flashing",
      severity: job.allowStrobe ? "warning" : "error",
      message: `${w.flashes} flashes in one second from ${round(w.start)} s to ${round(w.end)} s: more than 3 a second can trigger seizures (WCAG 2.3.1). Space the bright changes 1/3 s apart or soften them (a smaller luminance change, or a hit with flash: 0)${job.allowStrobe ? "; kept because allow_strobe is on" : ""}.`,
      frames: { from: Math.round(w.start * info.fps), to: Math.round(w.end * info.fps) },
    });
  }

  const design = designSize(probeSize.width, probeSize.height);
  problems.push(...auditLayout(probes.map((p) => ({ frame: sceneFrame(p.frame), boxes: p.boxes })), { width: design.width, height: design.height, safe: safeArea(design.width, design.height) }));

  if (probes.every((p) => p.hash === probes[0]!.hash)) problems.push({ code: "blank", severity: "warning", message: frames > 1 ? "every frame is the same picture: nothing moves" : "the scene is one frame" });
  if (info.alpha && probes.every((p) => p.coverage < 0.001)) problems.push({ code: "blank", severity: "warning", message: "the scene is transparent and draws nothing" });
  const slowest = probes.reduce((m, p) => (p.ms > m.ms ? p : m), probes[0]!);
  if (slowest.ms > frameMs) problems.push({ code: "timeout", severity: "error", message: `frame ${sceneFrame(slowest.frame)} took ${Math.round(slowest.ms)} ms to draw; a frame has ${frameMs} ms` });
  else if (slowest.ms > SCENE_LIMITS.slowFrameMs) problems.push({ code: "slow", severity: "warning", message: `frame ${sceneFrame(slowest.frame)} took ${Math.round(slowest.ms)} ms to draw at half size; the render will be slow (cache paths, draw fewer particles)` });
  if (info.cues.length === 0) problems.push({ code: "cues", severity: "warning", message: "the scene has no cues: name its beats (export const cues = { land: 30, … }) so the sound design can hit them" });
  else if (!info.cues.some((c) => c.kind)) problems.push({ code: "cues", severity: "warning", message: "no cue names a picture event kind (click, land, impact, whoosh…), so the scene makes no sound; give its hits a kind" });
  return { info, problems, tab: a, media, mediaDirs };
}

async function withSandbox<T>(env: NodeJS.ProcessEnv | undefined, signal: AbortSignal | undefined, run: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launchChrome(env, { args: sandboxArgs() });
  const onAbort = (): void => void browser.process()?.kill("SIGKILL");
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await run(browser);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // A renderer stuck in a scene's loop does not answer close: kill it after a moment.
    await timed(browser.close(), 5_000, () => ({ code: "timeout", severity: "error", message: "close" })).catch(() => browser.process()?.kill("SIGKILL"));
  }
}

async function cleanup(servers: Served[], tabs: Tab[]): Promise<void> {
  await Promise.all(tabs.map((t) => t.page.close().catch(() => undefined)));
  await Promise.all(servers.map((s) => s.close()));
}

/** Scene frames of a contact sheet: the cues that do something, then frames between, up to 12. */
function sheetCells(info: SceneInfo, rate: number): { frame: number; out: number; label: string }[] {
  const names = new Map<number, string[]>();
  for (const c of info.cues) {
    const f = Math.min(info.duration - 1, Math.round(c.frame));
    names.set(f, [...(names.get(f) ?? []), c.name]);
  }
  return sampleSceneFrames(info, 12).map((frame) => ({
    frame,
    out: (frame * rate) / info.fps,
    label: `${frame}f · ${(frame / info.fps).toFixed(2)}s${names.has(frame) ? ` · ${names.get(frame)!.join(", ")}` : ""}`,
  }));
}

/** Check a scene and draw its contact sheet. The scene's own faults come back as problems; only a bad job throws (SceneJobError). */
export async function draftScene(job: DraftOptions): Promise<DraftResult> {
  const started = Date.now();
  const done = (r: Omit<DraftResult, "checkSeconds">): DraftResult => ({ ...r, checkSeconds: round((Date.now() - started) / 1000, 1) });
  const ready = await prepare(job);
  if (!ready.ok) return done({ problems: ready.problems, cells: [] });
  const { prepared } = ready;
  const work = await mkdtemp(path.join(tmpdir(), "zenvi-scene-"));
  const servers: Served[] = [];
  const tabs: Tab[] = [];
  try {
    return await withSandbox(job.env, job.signal, async (browser) => {
      let checked: Checked;
      try {
        checked = await check(browser, job, prepared, work, servers, tabs, { width: even(job.width / 2), height: even(job.height / 2) });
      } catch (error) {
        if (error instanceof SceneStop) return done({ problems: [error.problem], cells: [] });
        throw error;
      }
      const cells = sheetCells(checked.info, prepared.rate);
      const portrait = job.height > job.width;
      const columns = portrait ? 6 : 4;
      let sheet: Buffer | undefined;
      try {
        const run = checked.tab.page.evaluate(
          (c: { frame: number; label: string }[], cols: number, cw: number) => (globalThis as unknown as PageGlobals).__zenviScene!.sheet(c, cols, cw),
          cells.map((c) => ({ frame: c.out, label: c.label })),
          columns,
          portrait ? 240 : 400,
        );
        const url = await timed(run, SCENE_LIMITS.frameMs * cells.length + 10_000, () => ({ code: "timeout", severity: "error", message: "the contact sheet did not finish drawing" }));
        sheet = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
        if (job.sheetPath) {
          await mkdir(path.dirname(job.sheetPath), { recursive: true });
          await writeFile(job.sheetPath, sheet);
        }
      } catch (error) {
        checked.problems.push(pageFailure(checked.tab, error));
      }
      return done({ info: checked.info, problems: checked.problems, ...(sheet ? { sheet } : {}), cells: cells.map(({ frame, label }) => ({ frame, label })) });
    });
  } finally {
    await cleanup(servers, tabs);
    await rm(work, { recursive: true, force: true });
  }
}

interface CachedCheck {
  info: SceneInfo;
  problems: SceneProblem[];
  events: PictureEvent[];
  frames: number;
}

/** Check, then render the whole scene; refused (ok: false) on any error problem. */
export async function renderScene(job: RenderSceneOptions): Promise<RenderSceneResult> {
  const ready = await prepare(job);
  if (!ready.ok) return { ok: false, problems: ready.problems };
  const { prepared } = ready;
  const samples = Math.max(1, Math.min(16, Math.round(job.motionBlurSamples ?? 1)));
  const width = even(job.draft ? job.width / 2 : job.width);
  const height = even(job.draft ? job.height / 2 : job.height);
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical({ source: prepared.sourceKey, width, height, samples, alpha: job.alpha ?? null, strobe: job.allowStrobe === true }))).digest("hex");
  const dir = path.join(motionCacheDir(job.env), "scenes");
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, `scene-${fingerprint.slice(0, 16)}`);
  const checkFile = `${base}.check.json`;
  const deliver = async (file: string, c: CachedCheck, alpha: boolean, cached: boolean, renderSeconds: number): Promise<RenderSceneResult> => {
    let out = file;
    if (job.output) {
      await mkdir(path.dirname(path.resolve(job.output)), { recursive: true });
      await copyFile(file, job.output);
      out = path.resolve(job.output);
    }
    return { ok: true, path: out, codec: alpha ? "prores4444" : "h264", width, height, fps: prepared.fps, frames: c.frames, fingerprint, cached, renderSeconds, events: c.events, info: c.info, problems: c.problems };
  };
  for (const ext of [".mov", ".mp4"]) {
    if (!existsSync(base + ext)) continue;
    try {
      const c = JSON.parse(await readFile(checkFile, "utf8")) as CachedCheck;
      return deliver(base + ext, { ...c, events: readPictureEvents(c.events) }, ext === ".mov", true, 0);
    } catch {
      // No check beside it: render again.
    }
  }

  const started = Date.now();
  const work = await mkdtemp(path.join(dir, ".render-"));
  const servers: Served[] = [];
  const tabs: Tab[] = [];
  try {
    return await withSandbox(job.env, job.signal, async (browser) => {
      let checked: Checked;
      try {
        checked = await check(browser, job, prepared, work, servers, tabs, { width, height });
      } catch (error) {
        if (error instanceof SceneStop) return { ok: false, problems: [error.problem] };
        throw error;
      }
      const { info } = checked;
      if (checked.problems.some(isError)) return { ok: false, problems: checked.problems, info };
      await cleanup([], tabs.splice(0));
      const alpha = job.alpha ?? info.alpha;
      const rate = prepared.rate;
      const frames = outputFrames(info, rate);
      const server = await serve(prepared, pageConfig(width, height, rate, job.params ?? {}, checked.media, alpha), checked.mediaDirs, job.env);
      servers.push(server);
      const cuts = info.cues.filter((c) => c.cut).map((c) => (c.frame * rate) / info.fps);
      const times = sceneSampleFrames(frames, samples, cuts);
      const partial = path.join(work, alpha ? "render.mov" : "render.mp4");
      const workers = Math.max(1, Math.min(job.workers ?? 2, 4, times.length));
      for (let i = 0; i < workers; i += 1) {
        const tab = (await openTab(browser, server.url, { width, height }, alpha)).tab;
        tabs.push(tab);
        try {
          await startTab(tab, { ...info, alpha });
        } catch (error) {
          return { ok: false, problems: [pageFailure(tab, error)], info };
        }
      }
      try {
        await capture(tabs, times, partial, { alpha, fps: prepared.fps, samples, width, height, draft: job.draft === true, signal: job.signal, onProgress: job.onProgress });
      } catch (error) {
        if (error instanceof CaptureError || job.signal?.aborted) throw error;
        return { ok: false, problems: [pageFailure(tabs.find((t) => t.crashed()) ?? tabs[0]!, error)], info };
      }
      const result: CachedCheck = { info, problems: checked.problems, events: sceneEvents(info), frames };
      await writeFile(path.join(work, "check.json"), JSON.stringify(result));
      await rename(path.join(work, "check.json"), checkFile);
      const cached = base + (alpha ? ".mov" : ".mp4");
      await rename(partial, cached);
      return deliver(cached, result, alpha, false, round((Date.now() - started) / 1000, 1));
    });
  } finally {
    await cleanup(servers, tabs);
    await rm(work, { recursive: true, force: true });
  }
}

/** ffmpeg failed (not the scene). */
class CaptureError extends Error {}

async function capture(tabs: Tab[], times: readonly number[], output: string, o: { alpha: boolean; fps: Fps; samples: number; width: number; height: number; draft: boolean; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<void> {
  const ffmpeg = spawnManaged(resolveBinary("ffmpeg"), encodeArgs({ alpha: o.alpha, fps: o.fps, samples: o.samples, width: o.width, height: o.height, captured: { width: o.width, height: o.height }, draft: o.draft, output }), { stdin: "pipe", stdout: "ignore", signal: o.signal });
  const stdin = ffmpeg.child.stdin!;
  stdin.on("error", () => undefined);
  try {
    const ready = new Map<number, Buffer>();
    let next = 0;
    let written = 0;
    const waiters: (() => void)[] = [];
    const ahead = tabs.length * 3;
    let writing = Promise.resolve();
    const writeReady = async (): Promise<void> => {
      while (ready.has(written)) {
        const buf = ready.get(written)!;
        ready.delete(written);
        written += 1;
        if (!stdin.write(buf)) await new Promise<void>((r) => stdin.once("drain", () => r()));
        o.onProgress?.(written, times.length);
      }
      for (const w of waiters.splice(0)) w();
    };
    await Promise.all(
      tabs.map(async (tab) => {
        for (;;) {
          if (o.signal?.aborted) throw new Error("render cancelled");
          const i = next;
          if (i >= times.length) return;
          next += 1;
          while (i - written >= ahead) await new Promise<void>((r) => waiters.push(r));
          const frame = times[i]!;
          const seek = tab.page.evaluate((f: number) => (globalThis as unknown as PageGlobals).__zenviScene!.seek(f), frame);
          await timed(seek, SCENE_LIMITS.frameMs * 4 + 5_000, () => ({ code: "timeout", severity: "error", message: `frame ${Math.round(frame)} did not finish drawing at full size` }));
          const shot = await tab.cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, captureBeyondViewport: false, fromSurface: true });
          ready.set(i, Buffer.from(shot.data, "base64"));
          writing = writing.then(writeReady);
        }
      }),
    );
    await writing;
    stdin.end();
    const code = await ffmpeg.exited;
    if (code !== 0) throw new CaptureError(ffmpeg.failure("encoding the scene").message);
  } catch (error) {
    stdin.destroy();
    await ffmpeg.kill();
    throw error;
  }
}
