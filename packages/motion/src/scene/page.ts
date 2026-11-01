/**
 * The page side of a scene: the trusted runtime that a scene page loads
 * before the scene's own script. It takes away what a scene must not
 * reach (the clock, randomness, timers, the network, the Function
 * constructor, the canvas's way back to the page), then waits for the
 * scene script to hand over its module, and exposes the seek protocol
 * (`window.__zenviScene`, contract.ts). The page's Content-Security-Policy
 * (no eval, no connections, no workers, no frames: node/scene-render.ts)
 * and the renderer's request blocking are the outer walls.
 */

import { FONT_FACES } from "../tokens.js";
import { createKit, type SceneApi } from "./kit.js";
import { PROBE_H, PROBE_W, type FrameProbe, type RawSceneExports, type SceneInfo, type ScenePageApi, type ScenePageConfig } from "./contract.js";

interface SceneModule {
  fps?: unknown;
  duration?: unknown;
  cues?: unknown;
  params?: unknown;
  alpha?: unknown;
  title?: unknown;
  draw?: (ctx: CanvasRenderingContext2D, t: number, api: SceneApi) => void;
}

declare global {
  interface Window {
    __zenviScene?: ScenePageApi;
    __zenviSceneStart?: (factory: (() => SceneModule) | null, error: unknown) => void;
  }
}

const doc = document;
const now = performance.now.bind(performance);
// Kept before the scene runs, so nothing it does to the built-ins changes what the runtime reports.
const fromCharCode = String.fromCharCode;
const toBase64 = btoa;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Take away what a scene may not use. Runs before the scene's script. */
function harden(): void {
  const refuse = (): never => {
    throw new Error("not available in a scene");
  };
  const lock = (target: object, name: string, value: unknown): void => {
    try {
      Object.defineProperty(target, name, { value, writable: false, configurable: false });
    } catch {
      // Already non-configurable: the CSP covers it.
    }
  };
  lock(Math, "random", refuse);
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "Worker", "SharedWorker", "BroadcastChannel", "setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback", "open", "Date", "performance", "localStorage", "sessionStorage", "indexedDB", "caches", "eval"]) {
    lock(window, name, undefined);
  }
  lock(navigator, "sendBeacon", undefined);
  // The Function constructors (also blocked by the CSP's missing 'unsafe-eval').
  const fnProtos = [Function.prototype, Object.getPrototypeOf(async function () {}), Object.getPrototypeOf(function* () {}), Object.getPrototypeOf(async function* () {})] as object[];
  for (const proto of fnProtos) lock(proto, "constructor", refuse);
  // The only page object a scene holds is its 2D context: no way back to the canvas, its document and window.
  Object.defineProperty(CanvasRenderingContext2D.prototype, "canvas", { get: () => undefined, configurable: false });
  // The shared built-ins frozen, so a scene cannot change what the runtime measures it with (a Math.round that
  // returns 0 would blind the flash check; the render is measured again from the file all the same).
  const typed = Object.getPrototypeOf(Uint8Array) as object;
  const arrays = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array];
  const builtIns: object[] = [Object, Array, Function, String, Number, Boolean, Symbol, Math, JSON, Map, Set, WeakMap, WeakSet, Promise, Error, TypeError, RangeError, RegExp, typed, ...arrays, ArrayBuffer, DataView];
  const dom: object[] = [CanvasRenderingContext2D, Path2D, DOMMatrix, DOMMatrixReadOnly, TextMetrics, CanvasGradient, CanvasPattern, ImageData, DOMException];
  for (const v of [...builtIns, ...dom]) {
    Object.freeze(v);
    const proto = (v as { prototype?: unknown }).prototype;
    if (proto && typeof proto === "object") Object.freeze(proto);
  }
}

function readConfig(): ScenePageConfig {
  const el = doc.getElementById("zenvi-scene-config");
  if (!el?.textContent) throw new Error("no scene config on the page");
  return JSON.parse(el.textContent) as ScenePageConfig;
}

/** FNV-1a over the pixels, 32 bits at a time. */
function pixelHash(data: Uint8ClampedArray): string {
  const words = new Uint32Array(data.buffer, data.byteOffset, data.byteLength >>> 2);
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i += 1) {
    h ^= words[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += fromCharCode(bytes[i]!);
  return toBase64(s);
}

function boot(): void {
  const config = readConfig();
  const canvas = doc.createElement("canvas");
  canvas.width = config.width;
  canvas.height = config.height;
  Object.assign(canvas.style, { position: "absolute", left: "0", top: "0", width: `${config.width}px`, height: `${config.height}px` });
  doc.body.append(canvas);
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true })!;
  // The scene gets this context: frozen, so it cannot shadow a method the runtime reads pixels with.
  const readPixels = CanvasRenderingContext2D.prototype.getImageData;
  Object.freeze(ctx);
  const thumb = Object.assign(doc.createElement("canvas"), { width: PROBE_W, height: PROBE_H });
  const tg = thumb.getContext("2d", { willReadFrequently: true })!;

  let resolveLoaded!: (raw: RawSceneExports) => void;
  let rejectLoaded!: (e: unknown) => void;
  const loaded = new Promise<RawSceneExports>((res, rej) => {
    resolveLoaded = res;
    rejectLoaded = rej;
  });
  loaded.catch(() => undefined);
  let module: SceneModule | null = null;
  // The scene's module, made again for every draw: nothing it keeps at its top level outlives one frame.
  let factory: (() => SceneModule) | null = null;
  let kit: ReturnType<typeof createKit> | undefined;
  let info: SceneInfo | undefined;

  // Decoded media by URL; a frame that needs one not decoded yet is drawn again once it is.
  const images = new Map<string, { img: HTMLImageElement; ready: boolean }>();
  const pending = new Set<Promise<unknown>>();
  const image = (url: string): HTMLImageElement | null => {
    const known = images.get(url);
    if (known) return known.ready ? known.img : null;
    const img = new Image();
    const entry = { img, ready: false };
    img.src = url;
    const decoding = img
      .decode()
      .then(() => {
        entry.ready = true;
      })
      .catch(() => {
        throw new Error(`media ${url.split("/").slice(-2).join("/")} could not be decoded`);
      })
      .finally(() => pending.delete(decoding));
    pending.add(decoding);
    images.set(url, entry);
    // Video frames are many: keep the last 160.
    if (images.size > 160) images.delete(images.keys().next().value!);
    return null;
  };

  const draw = async (frame: number): Promise<number> => {
    if (!kit || !info || !module?.draw || !factory) throw new Error("the scene has not started");
    const t = (frame * info.fps) / config.renderFps;
    let ms = 0;
    for (let pass = 0; ; pass += 1) {
      const started = now();
      kit.begin(t);
      try {
        const fresh = factory();
        fresh.draw!(ctx, t, kit.api);
      } catch (error) {
        throw new Error(`draw threw at frame ${Math.round(t * 100) / 100}: ${message(error)}`);
      }
      ms += now() - started;
      if (pending.size === 0) break;
      if (pass >= 3) throw new Error(`frame ${Math.round(t)} still waits for media after ${pass + 1} draws`);
      await Promise.all([...pending]);
    }
    return ms;
  };

  let boxes: FrameProbe["boxes"] = [];
  const seek = async (frame: number): Promise<number> => {
    const ms = await draw(frame);
    boxes = kit!.end();
    return ms;
  };

  const api: ScenePageApi = {
    loaded,
    async start(checked) {
      if (!module?.draw) throw new Error("the scene did not load");
      info = checked;
      const params = { ...checked.params, ...config.params };
      await Promise.all(FONT_FACES.map((f) => doc.fonts.load(`${f.style} ${f.weight.split(" ")[0]} 48px '${f.family}'`)));
      await doc.fonts.ready;
      kit = createKit({
        doc,
        ctx,
        canvas,
        scale: config.width / config.designWidth,
        designWidth: config.designWidth,
        designHeight: config.designHeight,
        fps: checked.fps,
        duration: checked.duration,
        cues: checked.cues,
        params,
        media: config.media,
        seed: config.seed,
        alpha: checked.alpha,
        image,
      });
      for (const ref of Object.values(config.media)) if (ref.kind === "image") image(ref.url);
      await Promise.all([...pending]);
    },
    async seek(frame) {
      await seek(frame);
    },
    async probe(frames, maxMs) {
      const out: FrameProbe[] = [];
      for (const frame of frames) {
        let ms: number;
        try {
          ms = await seek(frame);
        } catch (error) {
          out.push({ frame, hash: "", luma: "", coverage: 0, boxes: [], ms: 0, error: message(error) });
          break;
        }
        if (ms > maxMs) {
          out.push({ frame, hash: "", luma: "", coverage: 0, boxes: [], ms, error: `frame ${frame} took ${Math.round(ms)} ms to draw; a frame has ${maxMs} ms` });
          break;
        }
        const { width, height } = canvas;
        const hash = pixelHash(readPixels.call(ctx, 0, 0, width, height).data);
        tg.clearRect(0, 0, PROBE_W, PROBE_H);
        tg.drawImage(canvas, 0, 0, PROBE_W, PROBE_H);
        const px = tg.getImageData(0, 0, PROBE_W, PROBE_H).data;
        const luma = new Uint8Array(PROBE_W * PROBE_H);
        let alpha = 0;
        for (let i = 0; i < luma.length; i += 1) {
          const a = px[i * 4 + 3]! / 255;
          alpha += a;
          // Over black: what a transparent scene looks like at its brightest risk is measured as drawn.
          luma[i] = Math.round((0.2126 * px[i * 4]! + 0.7152 * px[i * 4 + 1]! + 0.0722 * px[i * 4 + 2]!) * a);
        }
        out.push({ frame, hash, luma: base64(luma), coverage: alpha / luma.length, boxes, ms: Math.round(ms * 10) / 10 });
      }
      return out;
    },
    async sheet(cells, columns, cellWidth) {
      const cellHeight = Math.round((cellWidth * canvas.height) / canvas.width);
      const label = 34;
      const rows = Math.ceil(cells.length / columns);
      const sheet = Object.assign(doc.createElement("canvas"), { width: columns * cellWidth, height: rows * (cellHeight + label) });
      const g = sheet.getContext("2d")!;
      g.fillStyle = "#16161A";
      g.fillRect(0, 0, sheet.width, sheet.height);
      for (const [i, cell] of cells.entries()) {
        await seek(cell.frame);
        const x = (i % columns) * cellWidth;
        const y = Math.floor(i / columns) * (cellHeight + label);
        if (info?.alpha) {
          for (let cy = 0; cy < cellHeight; cy += 16) for (let cx = 0; cx < cellWidth; cx += 16) {
            g.fillStyle = ((cx + cy) / 16) % 2 === 0 ? "#3A3A40" : "#2A2A30";
            g.fillRect(x + cx, y + cy, 16, 16);
          }
        }
        g.drawImage(canvas, x, y, cellWidth, cellHeight);
        g.fillStyle = "#E8E8EE";
        g.font = "600 18px Inter, sans-serif";
        g.textBaseline = "middle";
        g.fillText(cell.label, x + 10, y + cellHeight + label / 2, cellWidth - 20);
      }
      return sheet.toDataURL("image/jpeg", 0.86);
    },
  };
  Object.defineProperty(window, "__zenviScene", { value: Object.freeze(api), writable: false, configurable: false });

  let started = false;
  const handOver = (make: (() => SceneModule) | null, error: unknown): void => {
    if (started) return;
    started = true;
    let made: SceneModule;
    try {
      if (!make) throw error;
      made = make();
    } catch (e) {
      rejectLoaded(new Error(`the scene threw while loading: ${message(e)}`));
      return;
    }
    factory = make;
    module = made;
    try {
      // Plain data only: what the Node side checks (a getter or a function in cues would not survive the trip).
      const data = JSON.parse(JSON.stringify({ fps: made.fps, duration: made.duration, cues: made.cues, params: made.params, alpha: made.alpha, title: made.title })) as Omit<RawSceneExports, "draw">;
      resolveLoaded({ ...data, draw: typeof made.draw === "function" });
    } catch (e) {
      rejectLoaded(new Error(`the scene's exports are not plain data: ${message(e)}`));
    }
  };
  Object.defineProperty(window, "__zenviSceneStart", { value: handOver, writable: false, configurable: false });
}

try {
  boot();
} finally {
  harden();
}
