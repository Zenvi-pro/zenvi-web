/**
 * Export audio: the plan mixed offline, one window at a time, with the same
 * voices the preview schedules, so an export sounds like the preview.
 */

import type { AudioPlan } from "@zenvi/engine/render";
import type { AudioRenderer } from "./renderer.js";
import { scheduleVoice } from "./voice.js";

/**
 * Mix timeline `[from, to)` of `plan` into an `AudioBuffer` at `sampleRate`
 * with `channels` channels (up/down-mixed by Web Audio's speaker rules, as
 * FFmpeg's resampler does for the desktop's FrameMapper). Call for
 * consecutive windows with the same `renderer` to keep clips continuous.
 */
export async function mixWindow(renderer: AudioRenderer, plan: AudioPlan, from: number, to: number, sampleRate: number, channels: number): Promise<AudioBuffer> {
  const startFrame = Math.round(from * sampleRate);
  const length = Math.max(1, Math.round(to * sampleRate) - startFrame);
  const context = new OfflineAudioContext({ numberOfChannels: channels, length, sampleRate });
  // Timeline `from` is context time 0, at exactly the window's first frame.
  const anchor = { timeline: startFrame / sampleRate, context: 0, rate: 1 };
  const segments = plan.segments.filter((s) => s.timelineStart < to && s.timelineStart + s.duration > from);
  for (const segment of segments) {
    const piece = await renderer.render(segment, from, to);
    if (piece) scheduleVoice(context, context.destination, piece, anchor);
  }
  return context.startRendering();
}
