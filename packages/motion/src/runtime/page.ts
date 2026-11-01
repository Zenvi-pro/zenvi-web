/**
 * The page side of a block: reads the render config the renderer injected,
 * builds the block, and exposes the seek protocol.
 *
 * Protocol: `window.__zenvi = { ready, duration, seek(t) }` where `seek`
 * resolves once the frame at t is fully painted-ready (media decoded). The
 * same timeline is exposed as `window.__hf = { duration, seek }`, the
 * HyperFrames capture contract (@hyperframes/engine frameCapture: a page
 * exposing `window.__hf.seek` and `duration > 0`), so a block page renders
 * in HyperFrames too. Once ready, `__zenvi.events` lists the block's picture
 * events (what the sound design puts a sound on), from its `ctx.cue` calls.
 */

import type { PictureEvent, PictureEventKind } from "@zenvi/engine";
import type { BlockConfig, ZenviPageApi } from "../config.js";
import { FONT_FACES, FONT_STACKS, PALETTES, withAccent, type FontRole, type Palette, type PaletteName } from "../tokens.js";
import { videoTrack } from "./effects.js";
import { Timeline } from "./timeline.js";

export { safeArea, type Rect } from "./safe.js";
import { safeArea, type Rect } from "./safe.js";

/** Where a picture event happens: an element (its centre at the event's time) or a design-px point. */
export type CuePlace = Element | { x: number; y: number };

export interface CtxCueOptions {
  /** 0..1, how big it is on screen: hero reveals and slams 0.8-1, card lands 0.4-0.6, UI clicks 0.3-0.4, typing 0.2. */
  weight?: number;
  /** Default the centre of the frame. */
  at?: CuePlace;
  /** Runs (`type`, `tick`): seconds the run ends. */
  until?: number;
  /** Runs: keys or value changes per second. */
  rate?: number;
}

export interface BlockContext extends BlockConfig {
  doc: Document;
  /** The full-frame block root (position: absolute, inset 0). */
  root: HTMLElement;
  tl: Timeline;
  palette: Palette;
  display: FontRole;
  radius: number;
  seed: number;
  /** Title-safe insets, design px (TASTE.md §3; 9:16 keeps text out of the top 12 % and bottom 20 %). */
  safe: Rect;
  portrait: boolean;
  /** Set true when the block animates its own exit (else the root fades out over the last 0.4 s). */
  ownExit: boolean;
  /** Decodes the capture must wait for (media frames). */
  pending: Set<Promise<unknown>>;
  /** Create an element with classes and optional text, appended to `parent` (default root). */
  el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, parent?: HTMLElement | null, text?: string): HTMLElementTagNameMap[K];
  /** An <img> showing a media param (photo, or video frames following time); null when the param is unset. */
  mediaImg(name: string, className?: string, parent?: HTMLElement): HTMLImageElement | null;
  /** Report a picture event at `at` seconds (dropped at or past the end; the root's exit fade is not one). */
  cue(at: number, kind: PictureEventKind, options?: CtxCueOptions): void;
}

export type { BlockConfig };

export type BlockBuild = (ctx: BlockContext) => void | Promise<void>;

declare global {
  interface Window {
    __ZENVI_BLOCK__?: BlockConfig;
    __zenvi?: ZenviPageApi;
    __hf?: { duration: number; seek(t: number): void };
  }
}

const EXIT_SECONDS = 0.4;

interface PlacedCue {
  at: number;
  kind: PictureEventKind;
  el: Element;
  options: CtxCueOptions;
}

/** Cues on an element, placed once the block is built (`pictureEvents`): its position at the cue's time. */
const placedCues = new WeakMap<BlockContext, PlacedCue[]>();

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

function isElement(place: CuePlace): place is Element {
  return typeof (place as Element).getBoundingClientRect === "function";
}

/** Build the context for `config` inside `doc` (exported for tests, which run it in jsdom). */
export function createContext(doc: Document, config: BlockConfig): BlockContext {
  const p = config.params;
  const base = withAccent(PALETTES[(p.palette as PaletteName) ?? "light"] ?? PALETTES.light, typeof p.accent === "string" ? p.accent : undefined);
  const palette = { ...base, ...(typeof p.paper === "string" ? { paper: p.paper } : {}), ...(typeof p.ink === "string" ? { ink: p.ink } : {}) };
  const root = doc.createElement("div");
  root.id = "block";
  root.className = `block block-${config.block}${palette.dark ? " is-dark" : ""}${config.height > config.width * 1.2 ? " is-portrait" : ""}${config.alpha ? " is-alpha" : ""}`;
  const display = ((p.display_font as FontRole) ?? "sans") as FontRole;
  const radius = typeof p.radius === "number" ? p.radius : 28;
  const vars: Record<string, string> = {
    "--paper": palette.paper,
    "--ink": palette.ink,
    "--surface": palette.surface,
    "--muted": palette.muted,
    "--line": palette.line,
    "--accent": palette.accent,
    "--secondary": palette.secondary,
    "--glass": palette.glass,
    "--radius": `${radius}px`,
    "--font-sans": FONT_STACKS.sans,
    "--font-serif": FONT_STACKS.serif,
    "--font-mono": FONT_STACKS.mono,
    "--font-display": FONT_STACKS[display],
    "--w": `${config.width}px`,
    "--h": `${config.height}px`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  Object.assign(root.style, { position: "absolute", left: "0", top: "0", width: `${config.width}px`, height: `${config.height}px`, overflow: "hidden" });
  if (!config.alpha) root.style.background = palette.paper;
  doc.body.append(root);
  const tl = new Timeline().extend(config.seconds);
  const pending = new Set<Promise<unknown>>();
  const ctx: BlockContext = {
    ...config,
    doc,
    root,
    tl,
    palette,
    display,
    radius,
    seed: typeof p.seed === "number" ? p.seed : 1,
    safe: safeArea(config.width, config.height),
    portrait: config.height > config.width * 1.2,
    ownExit: false,
    pending,
    el(tag, className, parent, text) {
      const e = doc.createElement(tag);
      if (className) e.className = className;
      if (text !== undefined) e.textContent = text;
      (parent === undefined ? root : parent)?.append(e);
      return e;
    },
    mediaImg(name, className, parent) {
      const ref = config.media[name];
      if (!ref) return null;
      const img = ctx.el("img", className, parent ?? root);
      img.alt = "";
      if (ref.kind === "image") img.src = ref.url;
      else tl.track(videoTrack(img, ref, pending));
      return img;
    },
    cue(at, kind, options = {}) {
      if (!(at >= 0 && at < config.seconds)) return;
      const opts: CtxCueOptions = options.until === undefined ? options : { ...options, until: Math.min(options.until, config.seconds) };
      if (opts.at && isElement(opts.at)) {
        placedCues.get(ctx)?.push({ at, kind, el: opts.at, options: opts });
        return;
      }
      cueOn(tl, at, kind, opts, opts.at ? { x: opts.at.x / config.width, y: opts.at.y / config.height } : undefined);
    },
  };
  placedCues.set(ctx, []);
  return ctx;
}

function cueOn(tl: Timeline, at: number, kind: PictureEventKind, options: CtxCueOptions, place: { x: number; y: number } | undefined): void {
  tl.cue(round(at, 3), kind, {
    weight: round(clamp01(options.weight ?? 0.5), 2),
    x: place ? round(clamp01(place.x), 3) : 0.5,
    y: place ? round(clamp01(place.y), 3) : 0.5,
    ...(options.until !== undefined ? { until: round(options.until, 3) } : {}),
    // The contract's ceiling (sfx/events.ts readPictureEvents): past 30/s a run is a texture, not strikes.
    ...(options.rate !== undefined ? { rate: round(Math.min(30, options.rate), 2) } : {}),
  });
}

/**
 * The block's picture events, sorted. Cues on an element are placed first:
 * the timeline is seeked to each cue's time and the element's centre read
 * as a fraction of the frame (no layout, as in jsdom, leaves the centre).
 * Seeks the timeline: seek again before showing a frame.
 */
export function pictureEvents(ctx: BlockContext): PictureEvent[] {
  const placed = placedCues.get(ctx)?.splice(0) ?? [];
  placed.sort((a, b) => a.at - b.at);
  let seeked: number | undefined;
  for (const cue of placed) {
    if (seeked !== cue.at) ctx.tl.seek(cue.at);
    seeked = cue.at;
    const frame = ctx.root.getBoundingClientRect();
    const r = cue.el.getBoundingClientRect();
    const place = frame.width > 0 && frame.height > 0 ? { x: (r.left + r.width / 2 - frame.left) / frame.width, y: (r.top + r.height / 2 - frame.top) / frame.height } : undefined;
    cueOn(ctx.tl, cue.at, cue.kind, cue.options, place);
  }
  return ctx.tl.cues.filter((e) => e.t < ctx.seconds);
}

function waitImages(doc: Document): Promise<unknown> {
  return Promise.all(Array.from(doc.images).map((img) => img.decode().catch(() => undefined)));
}

/** Mount a block in this page (the bundle's entry calls this). */
export function defineBlock(build: BlockBuild): void {
  const config = window.__ZENVI_BLOCK__;
  if (!config) throw new Error("no __ZENVI_BLOCK__ config on the page");
  let resolveReady!: () => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });
  const api: NonNullable<Window["__zenvi"]> = {
    ready,
    duration: config.seconds,
    async seek() {
      await ready;
    },
  };
  window.__zenvi = api;
  void (async () => {
    // Faces load only when asked for: load them all before layout so no frame shows a fallback.
    await Promise.all(FONT_FACES.map((f) => document.fonts.load(`${f.style} ${f.weight.split(" ")[0]} 48px '${f.family}'`)));
    const ctx = createContext(document, config);
    await build(ctx);
    await document.fonts.ready;
    api.events = pictureEvents(ctx);
    if (config.params.exit !== false && !ctx.ownExit) {
      ctx.tl.to(ctx.root, { opacity: 0, y: -24, blur: 8 }, { at: Math.max(0, config.seconds - EXIT_SECONDS), duration: EXIT_SECONDS, ease: "exit" });
    }
    const seek = async (t: number): Promise<void> => {
      ctx.tl.seek(Math.min(t, config.seconds));
      await waitImages(document);
      while (ctx.pending.size > 0) await Promise.all([...ctx.pending]);
    };
    await seek(0);
    api.seek = seek;
    window.__hf = { duration: config.seconds, seek: (t) => void seek(t) };
    resolveReady();
  })().catch((error: unknown) => {
    api.error = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    rejectReady(error);
  });
}
