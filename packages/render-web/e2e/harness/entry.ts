/**
 * Browser side of the e2e suite, bundled with esbuild and loaded into
 * Chromium. Each scenario returns plain data for the Playwright test to check.
 *
 * Video fixtures encode their frame index as 8 black/white blocks (bit b is
 * block b, left to right; lossless VP9), so any decoded picture says which
 * source frame it is.
 */

import { ProjectDocument, addClip, addFile, createProject, type Profile, type ReaderInfo } from "@zenvi/engine";
import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from "mediabunny";
import {
  AudioRenderer,
  CanvasTextRasterizer,
  Compositor,
  KernelAudioSource,
  FrameProvider,
  MediaRegistry,
  PreviewPlayer,
  StillCache,
  defaultEngine,
  exportFrame,
  exportProject,
  exportProjectTo,
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

  /** Kernel resources on real canvases: corner radius, opacity before canvas effects, video masks, kernel audio, text. */
  async kernelResources() {
    const codes = await file("codes.webm");
    const media = new MediaRegistry({ resolvePath: (path) => (path === "@transitions/test/codes.webm" ? { kind: "blob", blob: codes, name: "codes.webm" } : undefined) });
    media.register("codes", { kind: "blob", blob: codes });
    media.register("tone", { kind: "blob", blob: await file("tone48.wav") });
    const frames = new FrameProvider({ media });
    const stills = new StillCache({ media });
    const audio = new KernelAudioSource(media);
    const compositor = new Compositor({ engine: testEngine });
    const resources = mediaResources({ media, frames, stills, audio });
    const canvas = new OffscreenCanvas(160, 90);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const render = async (clips: TestClip[], frame = 1) => {
      const errors = await compositor.render(testEngine.planFrame(makeProject(clips), frame, { width: 160, height: 90 }), ctx, resources, { mode: "sequential" });
      return errors.map((e) => `${e.clipId}:${e.stage}:${String(e.error)}`);
    };
    const white = (overrides: Partial<TestClip> = {}): TestClip => ({ id: "w", kind: "color", color: [255, 255, 255, 255], position: 0, start: 0, end: 10, layer: 2, ...overrides });
    const red: TestClip = { id: "r", kind: "color", color: [255, 0, 0, 255], position: 0, start: 0, end: 10, layer: 1 };

    const cornerErrors = await render([white({ cornerRadius: 30, layer: 1 })]);
    const corners = { corner: pixel(ctx, 2, 2), center: pixel(ctx, 80, 45), edgeMid: pixel(ctx, 80, 1) };

    // Half-transparent white, then a canvas-stage kernel that forces alpha 255: libopenshot applies
    // opacity first, so the result is opaque white (the other order would give pink).
    const orderErrors = await render([red, white({ opacity: 0.5, effects: [{ id: "o", type: "TestOpaque", frame: 1, params: {}, applyBeforeClip: false }] })]);
    const opacityFirst = pixel(ctx, 80, 45);

    // A video mask decoded at maskTime: white shows only where the mask frame's blocks are white.
    const maskErrors = await render([white({ layer: 1, masks: [{ transitionId: "T", maskPath: "@transitions/test/codes.webm", brightness: 0, contrast: 0, replaceImage: false, maskTime: 43 / 30, maskFrame: 44 }] })]);
    const videoMaskCode = readCode(ctx, 0, 0, 160, 90);

    // The frame's audio reaches the kernel: a 0.5 sine peaks at ~0.5 → gray ~128 (green set when 1600 samples arrived).
    const audioErrors = await render([{ ...white({ layer: 1 }), kernelAudio: { fileId: "tone", path: "tone48.wav" }, effects: [{ id: "a", type: "TestAudioLevel", frame: 1, params: {} }] }], 16);
    const audioPixel = pixel(ctx, 80, 45);

    const text = new CanvasTextRasterizer();
    const font = { family: "sans", pixelSize: 40 };
    const metrics = text.fontMetrics(font);
    const advance = text.advance("Zenvi", font);
    const ink = text.inkBounds("Zenvi", font);
    const target = { width: 200, height: 60, data: new Uint8ClampedArray(200 * 60 * 4) };
    text.drawText(target, "Zenvi", 10, 45, font, [255, 255, 0, 255], [0, 0, 255, 255], 2);
    let inked = 0;
    for (let i = 3; i < target.data.length; i += 4) if (target.data[i]! > 0) inked += 1;
    const clipped = { width: 200, height: 60, data: new Uint8ClampedArray(200 * 60 * 4) };
    text.drawText(clipped, "Zenvi", 10, 45, font, [255, 255, 0, 255], null, 0, { x: 0, y: 0, width: 50, height: 60 });
    let outside = 0;
    for (let y = 0; y < 60; y += 1) for (let x = 55; x < 200; x += 1) if (clipped.data[(y * 200 + x) * 4 + 3]! > 0) outside += 1;

    await audio.reset();
    await frames.dispose();
    stills.dispose();
    compositor.dispose();
    media.dispose();
    return {
      errors: [...cornerErrors, ...orderErrors, ...maskErrors, ...audioErrors],
      corners,
      opacityFirst,
      videoMaskCode,
      audioPixel,
      text: { ascent: metrics.ascent, descent: metrics.descent, advance, inkWidth: ink.width, inkHeight: ink.height, inked, outside },
    };
  },

  /** The real engine end to end: probe → addFile/addClip ops → planFrame → this compositor. */
  async realEngine() {
    const blob = await file("codes.webm");
    const info = await probeMedia({ kind: "blob", blob }, { path: "codes.webm" });
    const profile: Profile = {
      key: "test",
      description: "Test 160x90 30 fps",
      width: 160,
      height: 90,
      fps: { num: 30, den: 1 },
      progressive: true,
      pixel_ratio: { num: 1, den: 1 },
      display_ratio: { num: 16, den: 9 },
    };
    const doc = new ProjectDocument(createProject({ profile }));
    doc.transaction("Import", (tx) => {
      const added = addFile(tx, { path: "codes.webm", info, name: "codes.webm" }, { id: "codes" });
      addClip(tx, { fileId: added.id, position: 0, layer: 1000000, id: "CLIP1" });
    });
    const media = new MediaRegistry();
    media.register("codes", { kind: "blob", blob });
    // planAudio is not in the engine yet: silence for this video-only check.
    const engine = { ...defaultEngine, planAudio: (_p: unknown, range: { start: number; end: number }) => ({ sampleRate: 48000, channels: 2, start: range.start, end: range.end, segments: [] }) };
    const frames = new FrameProvider({ media });
    const stills = new StillCache({ media });
    const compositor = new Compositor({ engine });
    const resources = mediaResources({ media, frames, stills });
    const canvas = new OffscreenCanvas(160, 90);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const codes: number[] = [];
    for (let k = 1; k <= 60; k += 1) {
      const errors = await compositor.render(engine.planFrame(doc.project, k, { width: 160, height: 90 }), ctx, resources, { mode: "sequential" });
      if (errors.length) throw new Error(errors.map((e) => String(e.error)).join("; "));
      codes.push(readCode(ctx, 0, 0, 160, 90));
    }
    const plan10 = engine.planFrame(doc.project, 10, { width: 160, height: 90 });
    const preview = engine.planFrame(doc.project, 10, { width: 640, height: 640 }, { preview: true });
    const small = engine.planFrame(doc.project, 10, { width: 80, height: 80 }, { preview: true });

    // Scale the clip to half size (constant keyframes): it stays centered on black.
    const half = { Points: [{ co: { X: 1, Y: 0.5 }, interpolation: 2 }] };
    doc.transaction("Scale", (tx) => tx.update(["clips", { id: "CLIP1" }], { scale_x: half, scale_y: half }));
    await compositor.render(engine.planFrame(doc.project, 10, { width: 160, height: 90 }), ctx, resources, { mode: "seek" });
    const scaled = { corner: pixel(ctx, 5, 5), code: readCode(ctx, 40, 23, 80, 45) };

    const exported = await exportProject(doc.project, media, { format: "webm", width: 160, height: 90, fps: { num: 30, den: 1 } }, { engine });
    media.register("out", { kind: "blob", blob: exported, name: "out.webm" });
    // The export has the half-size clip too: read its codes from the centered 80×45 area.
    const exportedCodes: number[] = [];
    const probe = new OffscreenCanvas(160, 90).getContext("2d", { willReadFrequently: true })!;
    for (const k of [1, 2, 10, 45]) {
      const picture = await frames.frame({ ref: { fileId: "out" }, sourceTime: (k - 1) / 30, width: 160, height: 90, lane: "x", mode: "seek" });
      if (picture) probe.drawImage(picture.image, 0, 0, 160, 90);
      exportedCodes.push(picture ? readCode(probe, 40, 23, 80, 45) : -1);
      picture?.release();
    }
    await frames.dispose();
    stills.dispose();
    compositor.dispose();
    media.dispose();
    return {
      codes,
      plan10: { width: plan10.width, height: plan10.height, layers: plan10.layers.length, source: plan10.layers[0]?.source, transform: plan10.layers[0]?.transform, background: plan10.background },
      preview: [preview.width, preview.height],
      small: [small.width, small.height],
      scaled,
      exportedCodes,
      lastFrame: engine.lastFrame(doc.project),
    };
  },

  /** Per-frame cost of decoding a 720p clip at preview size, sequentially and by random access. */
  async playbackCost() {
    const media = new MediaRegistry();
    media.register("hd", { kind: "blob", blob: await file("hd.webm") });
    const frames = new FrameProvider({ media });
    const compositor = new Compositor({ engine: testEngine });
    const stills = new StillCache({ media });
    const resources = mediaResources({ media, frames, stills });
    const canvas = new OffscreenCanvas(640, 360);
    const ctx = canvas.getContext("2d")!;
    const project = makeProject([{ id: "H", kind: "video", fileId: "hd", path: "hd.webm", position: 0, start: 0, end: 3, layer: 1, width: 1280, height: 720 }], { width: 640, height: 360 });
    // Warm the decoder once (codec setup is a one-time cost).
    await compositor.render(testEngine.planFrame(project, 1, { width: 640, height: 360 }), ctx, resources, { mode: "seek" });
    const t0 = performance.now();
    for (let k = 2; k <= 90; k += 1) await compositor.render(testEngine.planFrame(project, k, { width: 640, height: 360 }), ctx, resources, { mode: "sequential" });
    const sequential = (performance.now() - t0) / 89;
    frames.cache.clear();
    const order = [77, 12, 55, 31, 88, 3, 64, 40, 20, 70];
    const t1 = performance.now();
    for (const k of order) await compositor.render(testEngine.planFrame(project, k, { width: 640, height: 360 }), ctx, resources, { mode: "seek" });
    const seek = (performance.now() - t1) / order.length;
    const t2 = performance.now();
    for (const k of order) await compositor.render(testEngine.planFrame(project, k, { width: 640, height: 360 }), ctx, resources, { mode: "seek" });
    const cached = (performance.now() - t2) / order.length;
    await frames.dispose();
    stills.dispose();
    compositor.dispose();
    media.dispose();
    return { sequentialMs: sequential, seekMs: seek, cachedMs: cached };
  },

  /**
   * QA repro: two clips with sound, exported with the default engine; the
   * file must carry an audio stream with each clip's tone where it belongs.
   */
  async exportWithAudio(format: "mp4" | "webm") {
    const media = new MediaRegistry();
    const doc = new ProjectDocument(createProject({ profile: "HD 720p 30 fps" }));
    for (const [id, name, position] of [["A", "tone440.webm", 0], ["B", "tone660.webm", 2]] as const) {
      const blob = await file(name);
      media.register(id, { kind: "blob", blob });
      const info = await media.probe({ fileId: id }, { path: name });
      doc.transaction("Import", (tx) => {
        addFile(tx, { path: name, info, name }, { id });
        addClip(tx, { fileId: id, position, layer: 1000000, id: `clip-${id}` });
      });
    }
    let notes: string[] = [];
    const blob = await exportProject(doc.project, media, { format, width: 320, height: 180, fps: { num: 30, den: 1 } }, { onNotes: (n) => (notes = n) });
    const info = await probeMedia({ kind: "blob", blob, name: `qa.${format}` }, { path: `qa.${format}` });
    // Decode the exported audio and measure each half.
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await input.getPrimaryAudioTrack();
    const left: number[] = [];
    let rate = 48000;
    if (track) {
      for await (const sample of new AudioSampleSink(track).samples(0, 4)) {
        rate = sample.sampleRate;
        const plane = new Float32Array(sample.numberOfFrames);
        sample.copyTo(plane, { planeIndex: 0, format: "f32-planar" });
        const at = Math.max(0, Math.round(sample.timestamp * rate));
        for (let i = 0; i < plane.length; i += 1) left[at + i] = plane[i]!;
        sample.close();
      }
    }
    input.dispose();
    media.dispose();
    const stats = (from: number, to: number) => {
      let sum = 0;
      let n = 0;
      let crossings = 0;
      for (let i = Math.round(from * rate); i < Math.round(to * rate); i += 1) {
        const v = left[i] ?? 0;
        sum += v * v;
        n += 1;
        if ((left[i - 1] ?? 0) < 0 && v >= 0) crossings += 1;
      }
      return { rms: Math.sqrt(sum / Math.max(1, n)), hz: crossings / (to - from) };
    };
    return { mime: blob.type, notes, hasAudio: info.has_audio, acodec: info.acodec, duration: info.duration, first: stats(0.2, 1.8), second: stats(2.2, 3.8) };
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

  /** Streaming export into an OPFS file (and reading it back through an `opfs` source). */
  async exportToOpfs(cancel: boolean) {
    const media = new MediaRegistry();
    media.register("codes", { kind: "blob", blob: await file("codes.webm") });
    media.register("tone", { kind: "blob", blob: await file("tone48.wav") });
    const project = makeProject([videoClip(), { id: "A", kind: "audio", fileId: "tone", path: "tone48.wav", position: 0, start: 0, end: 2, layer: 0, audio: {} }]);
    const root = await navigator.storage.getDirectory();
    const name = `export-${cancel ? "cancel" : "ok"}-${Date.now()}.webm`;
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    const controller = new AbortController();
    try {
      const result = await exportProjectTo(writable, project, media, { format: "webm", width: 160, height: 90, fps: { num: 30, den: 1 } }, {
        engine: testEngine,
        signal: controller.signal,
        onProgress: (p) => {
          if (cancel && p.frame >= 10) controller.abort(new Error("stop streaming"));
        },
      });
      const written = await handle.getFile();
      media.register("out", { kind: "opfs", handle });
      const info = await media.probe({ fileId: "out" }, { path: "out.webm" });
      const frames = new FrameProvider({ media });
      const picture = await frames.frame({ ref: { fileId: "out" }, sourceTime: 1, width: 160, height: 90, lane: "o", mode: "seek" });
      const code = picture ? codeOf(picture.image) : -1;
      picture?.release();
      await frames.dispose();
      return { ok: true, message: "", mime: result.mimeType, bytes: result.bytes, fileSize: written.size, videoLength: info.video_length, hasAudio: info.has_audio, code };
    } catch (error) {
      const left = await handle.getFile();
      return { ok: false, message: String(error), mime: "", bytes: 0, fileSize: left.size, videoLength: 0, hasAudio: false, code: -1 };
    } finally {
      media.dispose();
      await root.removeEntry(name).catch(() => undefined);
    }
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
      const buffer = await mixWindow(renderer, plan, bounds[i]!, bounds[i + 1]!, sampleRate, 2, { num: 30, den: 1 });
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
    const buffer = await mixWindow(renderer, testEngine.planAudio(project, { start: 0, end: 3 }), 0, 3, 48000, 1, { num: 30, den: 1 });
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

  /** Scrubbing long-GOP media: a keyframe stands in at once, then the exact frame. */
  async scrub() {
    const media = new MediaRegistry();
    media.register("codes", { kind: "blob", blob: await file("codesgop.webm") });
    const frames = new FrameProvider({ media });
    const preview = await frames.frame({ ref: { fileId: "codes" }, sourceTime: 1.5, width: 160, height: 90, lane: "s", mode: "preview" });
    const previewResult = { exact: preview?.exact ?? null, code: preview ? codeOf(preview.image) : -1 };
    preview?.release();
    const exact = await frames.frame({ ref: { fileId: "codes" }, sourceTime: 1.5, width: 160, height: 90, lane: "s", mode: "seek" });
    const exactResult = { exact: exact?.exact ?? true, code: exact ? codeOf(exact.image) : -1 };
    exact?.release();
    // Once decoded, a scrub to that frame is exact straight from the cache.
    const again = await frames.frame({ ref: { fileId: "codes" }, sourceTime: 1.5, width: 160, height: 90, lane: "s", mode: "preview" });
    const againExact = again?.exact ?? true;
    again?.release();
    await frames.dispose();

    const canvas = document.createElement("canvas");
    canvas.style.width = "160px";
    canvas.style.height = "90px";
    document.body.appendChild(canvas);
    const player = new PreviewPlayer(canvas, { media, engine: testEngine });
    player.setProject(makeProject([{ ...videoClip(), path: "codesgop.webm" }]));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const ctx = canvas.getContext("2d")!;
    const shown: number[] = [];
    const draw = ctx.drawImage.bind(ctx) as (...args: unknown[]) => void;
    (ctx as unknown as { drawImage: (...args: unknown[]) => void }).drawImage = (...args: unknown[]) => {
      draw(...args);
      queueMicrotask(() => shown.push(readCode(ctx, 0, 0, canvas.width, canvas.height)));
    };
    await player.seek(1.2, { scrub: true });
    await new Promise((r) => setTimeout(r, 50));
    const finalCode = readCode(ctx, 0, 0, canvas.width, canvas.height);
    player.dispose();
    canvas.remove();
    media.dispose();
    return { preview: previewResult, exact: exactResult, againExact, shown, finalCode };
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
