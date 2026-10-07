/**
 * Export audio: the plan mixed offline, one window at a time, with the same
 * voices the preview schedules, so an export sounds like the preview.
 */

import type { Fraction } from "@zenvi/engine";
import type { AudioPlan } from "@zenvi/engine/render";
import type { AudioRenderer } from "./renderer.js";
import { scheduleVoice } from "./voice.js";

/**
 * Whether `plan` has sound to encode: some segment that plays (non-zero
 * length and rate) with a gain envelope that is not zero throughout. Clips
 * whose files have no audio stream are not planned at all.
 */
export function planHasSound(plan: AudioPlan): boolean {
  return plan.segments.some((s) => s.duration > 0 && s.rate !== 0 && (s.gain.length === 0 || s.gain.some((p) => p.gain !== 0)));
}

/**
 * Mix timeline `[from, to)` of `plan` into an `AudioBuffer` at `sampleRate`
 * with `channels` channels (up/down-mixed by Web Audio's speaker rules, as
 * FFmpeg's resampler does for the desktop's FrameMapper). `fps` is the
 * timeline frame rate. Call for consecutive windows with the same
 * `renderer` to keep clips continuous.
 */
export async function mixWindow(renderer: AudioRenderer, plan: AudioPlan, from: number, to: number, sampleRate: number, channels: number, fps: Fraction): Promise<AudioBuffer> {
  const startFrame = Math.round(from * sampleRate);
  const length = Math.max(1, Math.round(to * sampleRate) - startFrame);
  const context = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate });
  // Timeline `from` is context time 0, at exactly the window's first frame.
  const anchor = { timeline: startFrame / sampleRate, context: 0, rate: 1 };
  const segments = plan.segments.filter((s) => s.timelineStart < to && s.timelineStart + s.duration > from);
  for (const segment of segments) {
    const piece = await renderer.render(segment, from, to, { sampleRate, channels, fps });
    if (piece) scheduleVoice(context, context.destination, piece, anchor);
  }
  return context.startRendering();
}
