/**
 * Preview audio: keeps a few seconds of the plan scheduled ahead of what is
 * audible, window by window, so the AudioContext clock can drive playback.
 *
 * Windows are contiguous, end on timeline audio frame boundaries, and every
 * clip decodes as one continuous stream, so nothing drifts however long
 * playback runs. Stopping (pause, seek) silences every voice at once; the
 * next start decodes from the new position.
 */

import type { Fraction } from "@zenvi/engine";
import type { AudioPlan } from "@zenvi/engine/render";
import { windowEnd } from "./channels.js";
import type { AudioRenderer, TimelineAudioFormat } from "./renderer.js";
import { timelineTimeOf, type ClockAnchor } from "./schedule.js";
import { scheduleVoice, type Voice } from "./voice.js";

export interface AudioPlaybackOptions {
  context: AudioContext;
  renderer: AudioRenderer;
  /** Where voices go. Default: `context.destination`. */
  output?: AudioNode;
  /** Timeline seconds kept scheduled ahead of the audible time. Default 2. */
  lookahead?: number;
  /** Window size in timeline seconds. Default 1; the first window is 0.25 s so sound starts fast. */
  window?: number;
  onError?: (error: unknown) => void;
}

export class AudioPlayback {
  private readonly context: AudioContext;
  private readonly renderer: AudioRenderer;
  private readonly master: GainNode;
  private readonly lookahead: number;
  private readonly windowSize: number;
  private readonly onError: ((error: unknown) => void) | undefined;
  private plan: AudioPlan | null = null;
  private anchor: ClockAnchor | null = null;
  private format: TimelineAudioFormat | null = null;
  private scheduledUntil = 0;
  private firstWindow = true;
  private inflight = 0;
  private generation = 0;
  private readonly voices = new Set<Voice>();
  private volumeValue = 1;
  private mutedValue = false;

  constructor(options: AudioPlaybackOptions) {
    this.context = options.context;
    this.renderer = options.renderer;
    this.lookahead = options.lookahead ?? 2;
    this.windowSize = options.window ?? 1;
    this.onError = options.onError;
    this.master = this.context.createGain();
    this.master.connect(options.output ?? this.context.destination);
  }

  get volume(): number {
    return this.volumeValue;
  }

  set volume(value: number) {
    this.volumeValue = Math.max(0, Number.isFinite(value) ? value : 1);
    this.applyVolume();
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  set muted(value: boolean) {
    this.mutedValue = value;
    this.applyVolume();
  }

  /** True while voices are scheduled or being prepared. */
  get active(): boolean {
    return this.anchor !== null;
  }

  /**
   * Schedule `plan` so timeline `anchor.timeline` sounds at context time
   * `anchor.context` and advances at `anchor.rate` (> 0). `fps` is the
   * timeline frame rate (audio effects run one frame at a time).
   */
  start(plan: AudioPlan, anchor: ClockAnchor, fps: Fraction): void {
    this.stop();
    if (!(anchor.rate > 0)) return;
    this.plan = plan;
    this.anchor = anchor;
    this.format = { sampleRate: plan.sampleRate, channels: plan.channels, fps };
    this.scheduledUntil = Math.max(anchor.timeline, plan.start);
    this.firstWindow = true;
    this.pump();
  }

  /** Top up the schedule. Call regularly (every animation frame) while playing. */
  pump(): void {
    const { plan, anchor, format } = this;
    if (!plan || !anchor || !format) return;
    const audible = timelineTimeOf(anchor, this.context.currentTime);
    const horizon = Math.min(plan.end, Math.max(audible, anchor.timeline) + this.lookahead * anchor.rate);
    const generation = this.generation;
    while (this.scheduledUntil < horizon - 1e-6 && this.inflight < 2) {
      const from = this.scheduledUntil;
      const size = (this.firstWindow ? Math.min(0.25, this.windowSize) : this.windowSize) * Math.max(1, anchor.rate);
      const to = windowEnd(from, size, plan.end, format.sampleRate, format.fps, format.channels);
      this.firstWindow = false;
      this.scheduledUntil = to;
      this.inflight += 1;
      void this.scheduleWindow(plan, anchor, format, from, to, generation).finally(() => {
        if (generation === this.generation) this.inflight -= 1;
      });
    }
  }

  /** Silence everything now and forget decode positions. */
  stop(): void {
    this.generation += 1;
    this.inflight = 0;
    this.plan = null;
    this.anchor = null;
    this.format = null;
    for (const voice of this.voices) voice.stop();
    this.voices.clear();
    void this.renderer.reset().catch((error: unknown) => this.onError?.(error));
  }

  dispose(): void {
    this.stop();
    this.master.disconnect();
  }

  private async scheduleWindow(plan: AudioPlan, anchor: ClockAnchor, format: TimelineAudioFormat, from: number, to: number, generation: number): Promise<void> {
    const segments = plan.segments.filter((s) => s.timelineStart < to && s.timelineStart + s.duration > from);
    const pieces = await Promise.all(
      segments.map((segment) =>
        this.renderer.render(segment, from, to, format).catch((error: unknown) => {
          this.onError?.(error);
          return null;
        }),
      ),
    );
    if (generation !== this.generation) return;
    for (const piece of pieces) {
      if (!piece) continue;
      const voice = scheduleVoice(this.context, this.master, piece, anchor);
      if (!voice) continue;
      this.voices.add(voice);
      voice.source.addEventListener("ended", () => this.voices.delete(voice), { once: true });
    }
    // Clips that ended before this window no longer need their decoders.
    await this.renderer.releaseEnded(plan, from);
  }

  private applyVolume(): void {
    const value = this.mutedValue ? 0 : this.volumeValue;
    this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
  }
}
