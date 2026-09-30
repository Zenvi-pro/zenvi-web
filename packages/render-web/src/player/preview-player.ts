/**
 * PreviewPlayer: a project on a canvas, with sound.
 *
 * - `seek` renders one frame; rapid seeks coalesce (only the latest renders,
 *   the ones in between are dropped), so scrubbing stays responsive.
 * - `play` uses the AudioContext as the master clock when the timeline has
 *   audio, `performance.now()` otherwise; each animation frame shows the
 *   frame the clock says. A late frame is dropped, never drawn behind time.
 * - Frames render at the canvas's device-pixel size, fitted like libopenshot's
 *   `SetMaxSize` (never above the project size), letterboxed and centered.
 */

import type { Project } from "@zenvi/engine";
import { AudioPlayback } from "../audio/playback.js";
import { AudioRenderer } from "../audio/renderer.js";
import type { ClockAnchor } from "../audio/schedule.js";
import { Compositor, type LayerError, type LayerResources } from "../compositor/compositor.js";
import { mediaResources } from "../compositor/resources.js";
import { defaultEngine, type RenderEngine } from "../engine.js";
import type { MediaRegistry } from "../media/registry.js";
import { StillCache } from "../media/stills.js";
import type { DecodeMode } from "../video/decode-cursor.js";
import { FrameCache } from "../video/frame-cache.js";
import { FrameProvider } from "../video/frame-provider.js";
import { bindCanvas, type CanvasSurface, type PreviewCanvas } from "./canvas-binding.js";
import { audibleContextTime, audioClock, performanceClock, type PlaybackClock } from "./clock.js";
import { fitViewport, previewPlanSize } from "./layout.js";

export interface PlayerState {
  playing: boolean;
  /** Playhead, seconds. */
  time: number;
  /** The 1-based frame on screen. */
  frame: number;
  rate: number;
  loop: boolean;
  /** Where the last clip ends, seconds (playback stops or loops there). */
  duration: number;
  /** A requested frame is still decoding. */
  waiting: boolean;
}

export type PlayerErrorEvent =
  | { kind: "layer"; clipId: string; stage: LayerError["stage"]; error: unknown }
  | { kind: "audio"; error: unknown }
  | { kind: "render"; error: unknown };

export interface PreviewPlayerOptions {
  media: MediaRegistry;
  /** Planner and kernels. Default: `@zenvi/engine`. */
  engine?: RenderEngine;
  /** Audio output. Default: one created on the first `play` (call `play` from a user gesture). */
  audioContext?: AudioContext;
  /** Fraction of device pixels to render at (lower is faster). Default 1. */
  resolution?: number;
  /** CSS color around the frame, or "transparent". Default black. */
  letterbox?: string;
  /** Budget for decoded preview frames. Default 192 MB. */
  frameCacheBytes?: number;
  /** A still/SVG cache to share with other consumers. */
  stills?: StillCache;
}

/** Audio scheduled this far in the future on play, so the first window is decoded before it is due. */
const AUDIO_START_DELAY = 0.12;
/**
 * How long to wait for the output device to start playing the first window
 * (a suspended context, a device that is waking up) before playing silently.
 */
const AUDIO_START_TIMEOUT_MS = 2000;
/** Playback faster than this seeks each frame instead of decoding every picture. */
const MAX_SEQUENTIAL_RATE = 4;

export class PreviewPlayer {
  private project: Project | null = null;
  private readonly engine: RenderEngine;
  private readonly media: MediaRegistry;
  private readonly surface: CanvasSurface;
  private readonly frames: FrameProvider;
  private readonly stills: StillCache;
  private readonly ownsStills: boolean;
  private readonly compositor: Compositor;
  private readonly resources: LayerResources;
  private readonly audioRenderer: AudioRenderer;
  private readonly resolution: number;
  private readonly letterbox: string;
  private audioContext: AudioContext | null;
  private readonly ownsAudioContext: boolean;
  private audio: AudioPlayback | null = null;
  private volumeValue = 1;
  private mutedValue = false;

  private playing = false;
  private clock: PlaybackClock | null = null;
  /** Set while the audio clock waits for the device to reach the anchor. */
  private audioWait: { since: number; anchor: ClockAnchor } | null = null;
  private timeValue = 0;
  private rateValue = 1;
  private loopValue = false;
  private raf: number | null = null;
  private lastSweep = 0;

  private pending: { frame: number; mode: DecodeMode } | null = null;
  private rendering = false;
  private shownFrame = 0;
  private generation = 0;
  private idle: (() => void)[] = [];

  private readonly timeListeners = new Set<(seconds: number) => void>();
  private readonly stateListeners = new Set<(state: PlayerState) => void>();
  private readonly errorListeners = new Set<(event: PlayerErrorEvent) => void>();
  private readonly reported = new Set<string>();
  private disposed = false;
  private readonly unbindResize: () => void;

  constructor(canvas: PreviewCanvas, options: PreviewPlayerOptions) {
    this.media = options.media;
    this.engine = options.engine ?? defaultEngine;
    this.resolution = Math.min(1, Math.max(0.1, options.resolution ?? 1));
    this.letterbox = options.letterbox ?? "#000";
    this.surface = bindCanvas(canvas, { transparent: this.letterbox === "transparent" });
    this.frames = new FrameProvider({ media: this.media, cache: new FrameCache(options.frameCacheBytes), quality: "medium" });
    this.ownsStills = !options.stills;
    this.stills = options.stills ?? new StillCache({ media: this.media, quality: "high" });
    this.compositor = new Compositor({ engine: this.engine });
    this.resources = mediaResources({ media: this.media, frames: this.frames, stills: this.stills });
    this.audioRenderer = new AudioRenderer({
      media: this.media,
      engine: this.engine,
      onUnsupported: (ref) => this.report(`audio:${ref.fileId ?? ref.path}`, { kind: "audio", error: new Error(`This browser cannot decode the audio of ${ref.fileId ?? ref.path}`) }),
    });
    this.audioContext = options.audioContext ?? null;
    this.ownsAudioContext = !options.audioContext;
    this.unbindResize = this.surface.onResize(() => this.redraw());
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Show `project` (after every edit). Keeps the playhead; restarts sound if playing. */
  setProject(project: Project): void {
    this.assertLive();
    this.project = project;
    this.generation += 1;
    if (this.playing) this.anchorAt(this.clampTime(this.currentClockTime()));
    this.redraw();
    this.emitState();
  }

  /** Move the playhead and render that frame. Resolves once it (or a later request) is on screen. */
  seek(seconds: number): Promise<void> {
    this.assertLive();
    const project = this.project;
    if (!project) return Promise.resolve();
    const t = this.clampTime(seconds);
    this.timeValue = t;
    if (this.playing) this.anchorAt(t);
    this.emitTime(t);
    return this.show(this.engine.frameAt(project, t), this.playing ? this.playbackMode() : "seek");
  }

  /** Step `count` frames (negative steps back) and pause there. */
  stepFrames(count: number): Promise<void> {
    const project = this.project;
    if (!project) return Promise.resolve();
    this.pause();
    const last = Math.max(1, this.engine.lastFrame(project));
    const frame = Math.min(last, Math.max(1, this.engine.frameAt(project, this.timeValue) + Math.trunc(count)));
    this.timeValue = this.engine.frameTime(project, frame);
    this.emitTime(this.timeValue);
    return this.show(frame, "seek");
  }

  play(): void {
    this.assertLive();
    const project = this.project;
    if (this.playing || !project) return;
    const end = this.duration;
    if (!(end > 0)) return;
    if (this.rateValue > 0 && this.timeValue >= end - 1e-9) this.timeValue = 0;
    if (this.rateValue < 0 && this.timeValue <= 1e-9) this.timeValue = end;
    this.playing = true;
    this.anchorAt(this.timeValue);
    this.startLoop();
    this.emitState();
  }

  pause(): void {
    if (!this.playing) return;
    const project = this.project;
    const t = this.clampTime(this.currentClockTime());
    this.playing = false;
    this.stopLoop();
    this.audio?.stop();
    this.clock = null;
    if (project) {
      // Rest on the start of the frame on screen, so an edit at the playhead cuts there.
      const frame = this.engine.frameAt(project, t);
      this.timeValue = Math.min(t, this.engine.frameTime(project, frame));
      this.emitTime(this.timeValue);
      this.request(frame, "seek");
    }
    this.emitState();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Playhead, seconds. */
  get time(): number {
    return this.playing ? this.clampTime(this.currentClockTime()) : this.timeValue;
  }

  /** The 1-based frame on screen. */
  get frame(): number {
    return this.shownFrame;
  }

  /** Where the last clip or transition ends, seconds. */
  get duration(): number {
    const project = this.project;
    if (!project) return 0;
    const last = this.engine.lastFrame(project);
    return last > 0 ? this.engine.frameTime(project, last + 1) : 0;
  }

  get rate(): number {
    return this.rateValue;
  }

  /** Playback speed; negative plays backwards (silently). */
  set rate(value: number) {
    const rate = Number.isFinite(value) && value !== 0 ? value : 1;
    if (rate === this.rateValue) return;
    const t = this.time;
    this.rateValue = rate;
    if (this.playing) this.anchorAt(t);
    this.emitState();
  }

  get loop(): boolean {
    return this.loopValue;
  }

  set loop(value: boolean) {
    this.loopValue = value;
    this.emitState();
  }

  get volume(): number {
    return this.volumeValue;
  }

  set volume(value: number) {
    this.volumeValue = Math.max(0, value);
    if (this.audio) this.audio.volume = this.volumeValue;
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(value: boolean) {
    this.mutedValue = value;
    if (this.audio) this.audio.muted = value;
  }

  get state(): PlayerState {
    return {
      playing: this.playing,
      time: this.time,
      frame: this.shownFrame,
      rate: this.rateValue,
      loop: this.loopValue,
      duration: this.duration,
      waiting: this.rendering,
    };
  }

  /** Decoded pictures dropped because playback outran decoding. */
  get droppedFrames(): number {
    return this.frames.droppedFrames;
  }

  onTime(listener: (seconds: number) => void): () => void {
    this.timeListeners.add(listener);
    return () => this.timeListeners.delete(listener);
  }

  onState(listener: (state: PlayerState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Decode, effect and audio failures (each distinct one reported once). */
  onError(listener: (event: PlayerErrorEvent) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.pause();
    this.disposed = true;
    this.stopLoop();
    this.unbindResize();
    this.surface.dispose();
    this.audio?.dispose();
    void this.audioRenderer.dispose();
    if (this.ownsAudioContext) void this.audioContext?.close().catch(() => undefined);
    void this.frames.dispose();
    this.frames.cache.clear();
    if (this.ownsStills) this.stills.dispose();
    this.compositor.dispose();
    this.timeListeners.clear();
    this.stateListeners.clear();
    this.errorListeners.clear();
    for (const resolve of this.idle.splice(0)) resolve();
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private redraw(): void {
    const project = this.project;
    if (!project || this.disposed) return;
    this.generation += 1;
    const frame = this.engine.frameAt(project, this.time);
    this.request(frame, this.playing ? this.playbackMode() : "seek");
  }

  /** Render `frame` next (replacing any frame still waiting to render). */
  private request(frame: number, mode: DecodeMode): void {
    this.pending = { frame, mode };
    if (!this.rendering) void this.renderLoop();
  }

  /** `request`, resolving once rendering goes idle. */
  private show(frame: number, mode: DecodeMode): Promise<void> {
    const done = new Promise<void>((resolve) => this.idle.push(resolve));
    this.request(frame, mode);
    return done;
  }

  private async renderLoop(): Promise<void> {
    this.rendering = true;
    if (!this.playing) this.emitState();
    try {
      while (this.pending && !this.disposed) {
        const { frame, mode } = this.pending;
        this.pending = null;
        await this.renderFrame(frame, mode);
      }
    } finally {
      this.rendering = false;
      for (const resolve of this.idle.splice(0)) resolve();
      if (!this.playing && !this.disposed) this.emitState();
    }
  }

  private async renderFrame(frame: number, mode: DecodeMode): Promise<void> {
    const project = this.project;
    if (!project) return;
    const generation = this.generation;
    const canvas = this.surface.size();
    const projectSize = { width: project.width, height: project.height };
    const planSize = previewPlanSize(projectSize, { width: canvas.width * this.resolution, height: canvas.height * this.resolution });
    let prepared: Awaited<ReturnType<Compositor["prepare"]>> | null = null;
    try {
      const plan = this.engine.planFrame(project, frame, planSize);
      prepared = await this.compositor.prepare(plan, this.resources, { mode });
      // A resize or a new project arrived meanwhile: its own render follows.
      if (generation !== this.generation || this.disposed) return;
      const ctx = this.surface.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      if (this.letterbox === "transparent") ctx.clearRect(0, 0, canvas.width, canvas.height);
      else {
        ctx.fillStyle = this.letterbox;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      this.compositor.draw(prepared, ctx, fitViewport(canvas, projectSize, plan));
      this.shownFrame = frame;
      for (const error of prepared.errors) {
        this.report(`${error.clipId}:${error.stage}:${String(error.error)}`, { kind: "layer", ...error });
      }
    } catch (error) {
      this.report(`render:${String(error)}`, { kind: "render", error });
    } finally {
      prepared?.release();
    }
  }

  private playbackMode(): DecodeMode {
    return this.rateValue > 0 && this.rateValue <= MAX_SEQUENTIAL_RATE ? "sequential" : "seek";
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  /** (Re)start the clock and sound at timeline `t`. */
  private anchorAt(t: number): void {
    const project = this.project;
    if (!project) return;
    this.audio?.stop();
    this.audioWait = null;
    const rate = this.rateValue;
    const plan = rate > 0 ? this.engine.planAudio(project, { start: t, end: this.duration }) : null;
    const context = plan && plan.segments.length > 0 ? this.ensureAudio() : null;
    if (plan && context && this.audio) {
      void context.resume().catch((error: unknown) => this.report("audio:resume", { kind: "audio", error }));
      const anchor: ClockAnchor = { timeline: t, context: context.currentTime + AUDIO_START_DELAY, rate };
      this.audio.start(plan, anchor);
      this.clock = audioClock(anchor, context, now);
      this.audioWait = { since: now(), anchor };
      return;
    }
    this.clock = performanceClock({ timeline: t, performanceMs: now(), rate }, now);
  }

  private ensureAudio(): AudioContext | null {
    if (!this.audioContext) {
      if (typeof AudioContext === "undefined") return null;
      this.audioContext = new AudioContext({ latencyHint: "interactive" });
    }
    if (!this.audio) {
      this.audio = new AudioPlayback({
        context: this.audioContext,
        renderer: this.audioRenderer,
        onError: (error) => this.report(`audio:${String(error)}`, { kind: "audio", error }),
      });
      this.audio.volume = this.volumeValue;
      this.audio.muted = this.mutedValue;
    }
    return this.audioContext;
  }

  private currentClockTime(): number {
    return this.clock ? this.clock.now() : this.timeValue;
  }

  private startLoop(): void {
    if (this.raf !== null) return;
    this.raf = requestFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.raf !== null) cancelFrame(this.raf);
    this.raf = null;
  }

  private readonly tick = (): void => {
    this.raf = null;
    const project = this.project;
    if (!this.playing || !project || this.disposed) return;

    // Video holds until the first sound is heard. A context that never starts
    // (no user gesture, a dead output device): play on, silently.
    const wait = this.audioWait;
    if (wait && this.audioContext) {
      if (this.audioContext.state === "running" && audibleContextTime(this.audioContext, now) >= wait.anchor.context) {
        this.audioWait = null;
      } else if (now() - wait.since > AUDIO_START_TIMEOUT_MS) {
        this.audio?.stop();
        this.audioWait = null;
        this.clock = performanceClock({ timeline: wait.anchor.timeline, performanceMs: now(), rate: this.rateValue }, now);
        this.report("audio:start", { kind: "audio", error: new Error("Audio output did not start; playing without sound") });
      }
    }

    const end = this.duration;
    let t = this.currentClockTime();
    if (this.rateValue > 0 && t >= end) {
      if (this.loopValue && end > 0) {
        t = 0;
        this.anchorAt(0);
      } else {
        this.finish(end);
        return;
      }
    } else if (this.rateValue < 0 && t <= 0) {
      if (this.loopValue && end > 0) {
        t = end;
        this.anchorAt(end);
      } else {
        this.finish(0);
        return;
      }
    }
    this.timeValue = t;
    this.emitTime(t);
    const frame = this.engine.frameAt(project, t);
    if (frame !== this.shownFrame && frame !== this.pending?.frame) this.request(frame, this.playbackMode());
    this.audio?.pump();
    if (now() - this.lastSweep > 1000) {
      this.lastSweep = now();
      this.frames.sweep();
    }
    this.raf = requestFrame(this.tick);
  };

  /** Playback reached an end: pause on the last (or first) frame. */
  private finish(at: number): void {
    const project = this.project;
    this.playing = false;
    this.stopLoop();
    this.audio?.stop();
    this.clock = null;
    if (project) {
      const last = Math.max(1, this.engine.lastFrame(project));
      const frame = at > 0 ? last : 1;
      this.timeValue = this.engine.frameTime(project, frame);
      this.emitTime(this.timeValue);
      this.request(frame, "seek");
    }
    this.emitState();
  }

  private clampTime(seconds: number): number {
    const project = this.project;
    const limit = Math.max(this.duration, typeof project?.duration === "number" ? project.duration : 0);
    return Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), limit);
  }

  private emitTime(seconds: number): void {
    for (const listener of [...this.timeListeners]) listener(seconds);
  }

  private emitState(): void {
    if (this.stateListeners.size === 0) return;
    const state = this.state;
    for (const listener of [...this.stateListeners]) listener(state);
  }

  private report(key: string, event: PlayerErrorEvent): void {
    if (this.reported.has(key)) return;
    this.reported.add(key);
    for (const listener of [...this.errorListeners]) listener(event);
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("PreviewPlayer is disposed");
  }
}

function now(): number {
  return performance.now();
}

function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else clearTimeout(handle);
}
