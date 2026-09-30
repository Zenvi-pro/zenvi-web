/**
 * Browser side of the e2e suite, bundled with esbuild and loaded into
 * Chromium. Each scenario returns plain data for the Playwright test to check.
 *
 * Video fixtures encode their frame index as 8 black/white blocks (bit b is
 * block b, left to right; lossless VP9), so any decoded picture says which
 * source frame it is.
 */

import type { ReaderInfo } from "@zenvi/engine";
import {
  AudioRenderer,
  Compositor,
  FrameProvider,
  MediaRegistry,
  PreviewPlayer,
  StillCache,
  exportFrame,
  exportProject,
  generateThumbnails,
  generateWaveform,
  mediaResources,
  mixWindow,
  probeMedia,
  type ExportProgress,
} from "../../src/index.js";
import { makeProject, testEngine, type TestClip } from "./test-engine.js";

const MEDIA = "http://localhost:9/media/";

async function file(name: string): Promise<File> {
  const response = await fetch(MEDIA + name);
  if (!response.ok) throw new Error(`fixture ${name}: HTTP ${response.status}`);
  return new File([await response.blob()], name, { type: response.headers.get("content-type") ?? "" });
}

function readCode(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, x0: number, y0: number, width: number, height: number): number {
  const data = ctx.getImageData(x0, y0, width, height).data;
  const y = Math.floor(height / 2);
  let code = 0;
  for (let b = 0; b < 8; b += 1) {
    const x = Math.floor((width / 8) * (b + 0.5));
    if (data[(y * width + x) * 4]! > 128) code |= 1 << b;
  }
  return code;
}

function codeOf(image: CanvasImageSource, width = 160, height = 90): number {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  return readCode(ctx, 0, 0, width, height);
}

function pixel(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number): number[] {
  return [...ctx.getImageData(x, y, 1, 1).data];
}

const videoClip = (overrides: Partial<TestClip> = {}): TestClip => ({
  id: "V",
  kind: "video",
  fileId: "codes",
  path: "codes.webm",
  position: 0,
  start: 0,
  end: 2,
  layer: 1,
  width: 160,
  height: 90,
  ...overrides,
});

export interface CompositingResult {
  opacityErrors: string[];
  opacity: { left: number[]; right: number[] };
  screen: number[];
  invert: number[];
  maskErrors: string[];
  mask: { left: number[]; right: number[] };
  halvedErrors: string[];
  halvedCode: number;
  canvasStage: { inside: number[]; outside: number[] };
  stills: { png: number[]; svg: number[] };
  cacheStable: boolean;
  videoCode: number;
}

const api = {
  async probe(names: string[]): Promise<Record<string, ReaderInfo>> {
    const out: Record<string, ReaderInfo> = {};
    for (const name of names) out[name] = await probeMedia({ kind: "blob", blob: await file(name) }, { path: name });
    return out;
  },

  /** Frame-accurate decoding: sequential (playback) and shuffled (scrubbing) passes. */
  async frameAccuracy(name: string, fps: number, count: number) {
    const media = new MediaRegistry();
    media.register("F", { kind: "blob", blob: await file(name) });
    const frames = new FrameProvider({ media });
    const ask = async (k: number, mode: "seek" | "sequential", lane: string) => {
      const picture = await frames.frame({ ref: { fileId: "F" }, sourceTime: (k - 1) / fps, width: 160, height: 90, lane, mode });
      if (!picture) return -1;
      const code = codeOf(picture.image);
      picture.release();
      return code;
    };
    const sequential: number[] = [];
    for (let k = 1; k <= count; k += 1) sequential.push(await ask(k, "sequential", "play"));
    frames.cache.clear();
    const order = Array.from({ length: count }, (_, i) => i + 1).sort((a, b) => ((a * 7919) % 97) - ((b * 7919) % 97));
    const random: { k: number; code: number }[] = [];
    for (const k of order) random.push({ k, code: await ask(k, "seek", "scrub") });
    // Past the end: the last picture freezes (FrameMapper clamp).
    const pastEnd = await ask(count + 30, "seek", "scrub");
    await frames.dispose();
    media.dispose();
    return { sequential, random, pastEnd };
  },

  /** A signed URL that has expired: the registry refreshes it and keeps reading with range requests. */
  async signedUrl(name: string) {
    let refreshes = 0;
    const media = new MediaRegistry();
    media.register("U", {
      kind: "url",
      url: `${MEDIA}${name}?sig=old`,
      refresh: async () => {
        refreshes += 1;
        return `${MEDIA}${name}?sig=new`;
      },
    });
    const frames = new FrameProvider({ media });
    const picture = await frames.frame({ ref: { fileId: "U" }, sourceTime: 1, width: 160, height: 90, lane: "u", mode: "seek" });
    const code = picture ? codeOf(picture.image) : -1;
    picture?.release();
    const info = await media.probe({ fileId: "U" });
    await frames.dispose();
    media.dispose();
    return { code, refreshes, videoLength: info.video_length };
  },

  /** Real-canvas compositing: opacity, blend, source kernels, masks, resized kernels, canvas-stage kernels, stills, SVG. */
  async compositing(): Promise<CompositingResult> {
    // Transition masks are referenced by path (`@transitions/…`), resolved by the host.
    const maskBlob = await file("halfmask.png");
    const media = new MediaRegistry({ resolvePath: (path) => (path === "@transitions/test/half.png" ? { kind: "blob", blob: maskBlob, name: "half.png" } : undefined) });
    media.register("codes", { kind: "blob", blob: await file("codes.webm") });
    media.register("png", { kind: "blob", blob: await file("still.png") });
    media.register("svg", {
      kind: "blob",
      blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="45" viewBox="0 0 80 45"><rect width="80" height="45" fill="#00ff00"/></svg>'], { type: "image/svg+xml" }),
      name: "green.svg",
    });
    const frames = new FrameProvider({ media });
    const stills = new StillCache({ media });
    const compositor = new Compositor({ engine: testEngine });
    const resources = mediaResources({ media, frames, stills });
    const canvas = new OffscreenCanvas(160, 90);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const render = async (clips: TestClip[], frame = 1) => {
      const plan = testEngine.planFrame(makeProject(clips), frame, { width: 160, height: 90 });
      const errors = await compositor.render(plan, ctx, resources);
      return errors.map((e) => `${e.clipId}:${e.stage}:${String(e.error)}`);
    };
    const opacityErrors = await render([
      { id: "red", kind: "color", color: [255, 0, 0, 255], position: 0, start: 0, end: 10, layer: 1 },
      { id: "blue", kind: "color", color: [0, 0, 255, 255], position: 0, start: 0, end: 10, layer: 2, rect: [0.5, 0, 0.5, 1], opacity: 0.5 },
    ]);
    const opacity = { left: pixel(ctx, 20, 45), right: pixel(ctx, 140, 45) };

    await render([
      { id: "red", kind: "color", color: [255, 0, 0, 255], position: 0, start: 0, end: 10, layer: 1 },
      { id: "green", kind: "color", color: [0, 255, 0, 255], position: 0, start: 0, end: 10, layer: 2, composite: 14 },
    ]);
    const screen = pixel(ctx, 80, 45);

    await render([
      { id: "c", kind: "color", color: [200, 100, 50, 255], position: 0, start: 0, end: 10, layer: 1, effects: [{ id: "e", type: "TestInvert", frame: 1, params: {} }] },
    ]);
    const invert = pixel(ctx, 80, 45);

    const maskErrors = await render([
      { id: "w", kind: "color", color: [255, 255, 255, 255], position: 0, start: 0, end: 10, layer: 1, masks: [{ transitionId: "T", maskPath: "@transitions/test/half.png", brightness: 0, contrast: 0, replaceImage: false }] },
    ]);
    const mask = { left: pixel(ctx, 20, 45), right: pixel(ctx, 140, 45) };

    const halvedErrors = await render([videoClip({ effects: [{ id: "h", type: "TestHalve", frame: 1, params: {} }] })], 38);
    const halvedCode = readCode(ctx, 0, 0, 160, 90);

    await render([
      { id: "c2", kind: "color", color: [10, 20, 30, 255], position: 0, start: 0, end: 10, layer: 1, rect: [0, 0, 0.5, 1], effects: [{ id: "e", type: "TestInvert", frame: 1, params: {}, applyBeforeClip: false }] },
    ]);
    const canvasStage = { inside: pixel(ctx, 40, 45), outside: pixel(ctx, 120, 45) };

    await render([
      { id: "png", kind: "image", fileId: "png", path: "still.png", position: 0, start: 0, end: 10, layer: 1, width: 64, height: 36 },
      { id: "svg", kind: "svg", fileId: "svg", path: "green.svg", position: 0, start: 0, end: 10, layer: 2, width: 80, height: 45, rect: [0.5, 0.5, 0.5, 0.5] },
    ]);
    const stillPixels = { png: pixel(ctx, 20, 20), svg: pixel(ctx, 120, 70) };

    // The same frame drawn twice hits the picture cache (no second decode).
    await render([videoClip()], 12);
    const bytes = frames.cache.bytes;
    await render([videoClip()], 12);
    const cacheStable = frames.cache.bytes === bytes;
    const videoCode = readCode(ctx, 0, 0, 160, 90);

    await frames.dispose();
    stills.dispose();
    compositor.dispose();
    media.dispose();
    return { opacityErrors, opacity, screen, invert, maskErrors, mask, halvedErrors, halvedCode, canvasStage, stills: stillPixels, cacheStable, videoCode };
  },

  /** exportProject → re-probe and re-decode the result. */
  async exportRoundTrip(format: "webm" | "mp4") {
    const media = new MediaRegistry();
    media.register("codes", { kind: "blob", blob: await file("codes.webm") });
    media.register("tone", { kind: "blob", blob: await file("tone48.wav") });
    const project = makeProject([
      videoClip(),
      { id: "A", kind: "audio", fileId: "tone", path: "tone48.wav", position: 0, start: 0, end: 2, layer: 0, audio: {} },
    ]);
    const progress: ExportProgress[] = [];
    let notes: string[] = [];
    const started = performance.now();
    const blob = await exportProject(project, media, { format, width: 160, height: 90, fps: { num: 30, den: 1 }, quality: "high" }, {
      engine: testEngine,
      onProgress: (p) => progress.push(p),
      onNotes: (n) => (notes = n),
    });
    const elapsed = performance.now() - started;
    const info = await probeMedia({ kind: "blob", blob, name: `out.${format}` }, { path: `out.${format}` });
    media.register("out", { kind: "blob", blob, name: `out.${format}` });
    const frames = new FrameProvider({ media });
    const codes: number[] = [];
    for (let k = 1; k <= 60; k += 1) {
      const picture = await frames.frame({ ref: { fileId: "out" }, sourceTime: (k - 1) / 30, width: 160, height: 90, lane: "o", mode: "sequential" });
      codes.push(picture ? codeOf(picture.image) : -1);
      picture?.release();
    }
    const peaks = await generateWaveform(media, "out", { buckets: 20 });
    await frames.dispose();
    media.dispose();
    return {
      mime: blob.type,
      size: blob.size,
      info,
      codes,
      peaks: [...peaks],
      notes,
      elapsed,
      progress: { count: progress.length, last: progress.at(-1) ?? null, monotonic: progress.every((p, i) => i === 0 || p.fraction >= progress[i - 1]!.fraction) },
    };
  },

  /** Cancelling an export rejects with the abort reason and leaves nothing behind. */
  async exportCancel() {
    const media = new MediaRegistry();
    media.register("codes", { kind: "blob", blob: await file("codes.webm") });
    const controller = new AbortController();
    const project = makeProject([videoClip()]);
    try {
      await exportProject(project, media, { format: "webm", width: 160, height: 90, fps: { num: 30, den: 1 } }, {
        engine: testEngine,
        signal: controller.signal,
        onProgress: (p) => {
          if (p.frame >= 10) controller.abort(new Error("user cancelled"));
        },
      });
      return { rejected: false, message: "" };
    } catch (error) {
      return { rejected: true, message: String(error) };
    } finally {
      media.dispose();
    }
  },

  async exportStill(seconds: number) {
    const media = new MediaRegistry();
    media.register("codes", { kind: "blob", blob: await file("codes.webm") });
    const png = await exportFrame(makeProject([videoClip()]), media, seconds, { width: 160, height: 90 }, "image/png", { engine: testEngine });
    const bitmap = await createImageBitmap(png);
    const code = codeOf(bitmap);
    bitmap.close();
    media.dispose();
    return { type: png.type, code };
  },

  /** Offline mix in windows: continuity at window seams, gain automation and speed. */
  async audioMix(name: string, sampleRate: number) {
    const media = new MediaRegistry();
    media.register("tone", { kind: "blob", blob: await file(name) });
    const project = makeProject([{ id: "A", kind: "audio", fileId: "tone", path: name, position: 0.5, start: 0, end: 2.5, layer: 0, audio: {} }], { sampleRate });
    const plan = testEngine.planAudio(project, { start: 0, end: 3 });
    const renderer = new AudioRenderer({ media, engine: testEngine });
    const bounds = [0, 0.7, 1.33, 1.9, 3];
    const parts: Float32Array[] = [];
    for (let i = 0; i + 1 < bounds.length; i += 1) {
      const buffer = await mixWindow(renderer, plan, bounds[i]!, bounds[i + 1]!, sampleRate, 2);
      parts.push(buffer.getChannelData(0).slice());
    }
    await renderer.dispose();
    const total = parts.reduce((n, p) => n + p.length, 0);
    const mixed = new Float32Array(total);
    let at = 0;
    const seams: number[] = [];
    for (const part of parts) {
      mixed.set(part, at);
      at += part.length;
      seams.push(at);
    }
    seams.pop();
    // The source is a 440 Hz sine at amplitude 0.5 starting at timeline 0.5 s.
    let maxError = 0;
    for (let i = Math.round(0.6 * sampleRate); i < Math.round(2.9 * sampleRate); i += 1) {
      const expected = 0.5 * Math.sin((2 * Math.PI * 440 * (i - 0.5 * sampleRate)) / sampleRate);
      maxError = Math.max(maxError, Math.abs(mixed[i]! - expected));
    }
    const secondDiff = (i: number) => Math.abs(mixed[i]! - 2 * mixed[i - 1]! + mixed[i - 2]!);
    let body = 0;
    for (let i = Math.round(0.6 * sampleRate); i < Math.round(0.65 * sampleRate); i += 1) body = Math.max(body, secondDiff(i));
    const seamDiffs = seams.map((s) => Math.max(secondDiff(s), secondDiff(s + 1), secondDiff(s + 2)));
    const silenceBefore = Math.max(...mixed.subarray(0, Math.round(0.45 * sampleRate)).map(Math.abs));
    media.dispose();
    return { length: total, expectedLength: 3 * sampleRate, maxError, body, seamDiffs, silenceBefore };
  },

  /** Gain envelope, speed and an audio kernel, through the real Web Audio graph. */
  async audioShaping() {
    const media = new MediaRegistry();
    media.register("tone", { kind: "blob", blob: await file("tone48.wav") });
    const project = makeProject([
      { id: "fade", kind: "audio", fileId: "tone", path: "tone48.wav", position: 0, start: 0, end: 1, layer: 0, audio: { gain: [{ t: 0, gain: 0 }, { t: 1, gain: 1 }] } },
      // One timeline second at double speed plays two seconds of source.
      { id: "fast", kind: "audio", fileId: "tone", path: "tone48.wav", position: 1, start: 0, end: 1, layer: 0, audio: { rate: 2 } },
      { id: "fx", kind: "audio", fileId: "tone", path: "tone48.wav", position: 2, start: 0, end: 1, layer: 0, audio: { effects: [{ id: "g", type: "TestGain", frame: 1, params: { factor: 0.25 } }] } },
    ]);
    const renderer = new AudioRenderer({ media, engine: testEngine });
    const buffer = await mixWindow(renderer, testEngine.planAudio(project, { start: 0, end: 3 }), 0, 3, 48000, 1);
    await renderer.dispose();
    const data = buffer.getChannelData(0);
    const peak = (from: number, to: number) => Math.max(...data.subarray(Math.round(from * 48000), Math.round(to * 48000)).map(Math.abs));
    const crossings = (from: number, to: number) => {
      let n = 0;
      for (let i = Math.round(from * 48000) + 1; i < Math.round(to * 48000); i += 1) if (data[i - 1]! < 0 && data[i]! >= 0) n += 1;
      return n;
    };
    media.dispose();
    return {
      fadeEarly: peak(0.05, 0.15),
      fadeLate: peak(0.85, 0.95),
      fastCrossingsPerSecond: crossings(1.1, 1.9) / 0.8,
      normalCrossingsPerSecond: crossings(0.3, 0.9) / 0.6,
      effectPeak: peak(2.1, 2.9),
    };
  },

  /** PreviewPlayer on a real canvas: seek, play (audio clock), pause, loop. */
  async player() {
    const media = new MediaRegistry();
    media.register("codes", { kind: "blob", blob: await file("codes.webm") });
    media.register("tone", { kind: "blob", blob: await file("tone48.wav") });
    const canvas = document.createElement("canvas");
    canvas.style.width = "320px";
    canvas.style.height = "180px";
    document.body.appendChild(canvas);
    // Wake the output device first, as an app does on the first user gesture:
    // a headless device takes a few hundred ms before its clock moves.
    const audioContext = new AudioContext({ latencyHint: "interactive" });
    await audioContext.resume();
    const warm = audioContext.createConstantSource();
    warm.connect(audioContext.destination);
    warm.offset.value = 0;
    warm.start();
    const warmStart = performance.now();
    while (audioContext.getOutputTimestamp().performanceTime === 0 && performance.now() - warmStart < 5000) await new Promise((r) => setTimeout(r, 20));
    warm.stop();
    const player = new PreviewPlayer(canvas, { media, engine: testEngine, audioContext });
    const errors: string[] = [];
    player.onError((e) => errors.push(`${e.kind}:${String("error" in e ? e.error : "")}`));
    const project = makeProject([videoClip(), { id: "A", kind: "audio", fileId: "tone", path: "tone48.wav", position: 0, start: 0, end: 2, layer: 0, audio: {} }]);
    player.setProject(project);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const ctx = canvas.getContext("2d")!;
    const screenCode = () => readCode(ctx, 0, 0, canvas.width, canvas.height);

    await player.seek(1);
    const seekCode = screenCode();
    const size = [canvas.width, canvas.height];

    // Rapid seeks coalesce; the last one wins.
    const seeks = [0.1, 0.4, 0.8, 1.2, 1.5].map((t) => player.seek(t));
    await Promise.all(seeks);
    const coalescedCode = screenCode();

    await player.seek(0.2);
    const times: number[] = [];
    const off = player.onTime((t) => times.push(t));
    player.play();
    const trace: string[] = [];
    for (let i = 0; i < 9; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      const stamp = audioContext.getOutputTimestamp();
      trace.push(`t=${player.time.toFixed(3)} playing=${player.isPlaying} ct=${audioContext.currentTime.toFixed(3)} heard=${(stamp.contextTime ?? 0).toFixed(3)}@${Math.round(stamp.performanceTime ?? 0)} now=${Math.round(performance.now())}`);
    }
    // Playback times must never go back; pausing then rests on the shown frame's start.
    off();
    player.pause();
    await new Promise((r) => setTimeout(r, 200));
    const paused = { time: player.time, frame: player.frame, code: screenCode(), expected: testEngine.frameAt(project, player.time) - 1 };
    const monotonic = times.every((t, i) => i === 0 || t >= times[i - 1]! - 1e-9);

    player.loop = true;
    await player.seek(1.8);
    player.play();
    await new Promise((r) => setTimeout(r, 700));
    const looped = player.time < 1.5;
    player.pause();

    player.loop = false;
    await player.seek(1.85);
    player.play();
    await new Promise((r) => setTimeout(r, 600));
    const ended = { playing: player.isPlaying, time: player.time, frame: player.frame };

    const state = player.state;
    player.dispose();
    await audioContext.close();
    canvas.remove();
    media.dispose();
    return { seekCode, size, coalescedCode, advanced: paused.time - 0.2, paused, monotonic, timeEvents: times.length, looped, ended, duration: state.duration, errors, trace };
  },

  async timelineHelpers() {
    const media = new MediaRegistry();
    media.register("codes", { kind: "blob", blob: await file("codes.webm") });
    media.register("tone", { kind: "blob", blob: await file("tone48.wav") });
    media.register("png", { kind: "blob", blob: await file("still.png") });
    const thumbs = await generateThumbnails(media, "codes", { count: 4, height: 45 });
    const exact = await generateThumbnails(media, "codes", { times: [0.5, 1.5], height: 45, exact: true });
    const stillThumbs = await generateThumbnails(media, "png", { count: 3, height: 20 });
    const audioThumbs = await generateThumbnails(media, "tone", { count: 3, height: 20 });
    const summary = {
      count: thumbs.length,
      size: [thumbs[0]?.width, thumbs[0]?.height],
      codes: thumbs.map((b) => codeOf(b)),
      exactCodes: exact.map((b) => codeOf(b)),
      stillCount: stillThumbs.length,
      stillSize: [stillThumbs[0]?.width, stillThumbs[0]?.height],
      audioThumbs: audioThumbs.length,
    };
    for (const b of [...thumbs, ...exact, ...stillThumbs]) b.close();
    const peaks = await generateWaveform(media, "tone", { buckets: 30 });
    const silentVideo = await generateWaveform(media, "codes", { buckets: 5 });
    media.dispose();
    return { ...summary, peaks: [...peaks], silentVideo: [...silentVideo] };
  },
};

declare global {
  interface Window {
    harness: typeof api;
  }
}

window.harness = api;
