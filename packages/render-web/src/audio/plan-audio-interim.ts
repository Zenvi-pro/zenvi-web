/**
 * STUB (W5, remove when `@zenvi/engine/render` exports `planAudio`, W2):
 * an interim audio planner so previews and exports have sound meanwhile.
 *
 * It covers the common case using only the engine's own helpers (clip frame
 * windows, keyframe evaluation), and nothing more:
 * - every clip whose reader has audio and whose `has_audio` is not off;
 * - normal speed: a clip with a `time` curve plays at speed 1;
 * - the volume keyframe as libopenshot's per-frame gain ramps, volume(n−1) →
 *   volume(n) across clip frame n (`Timeline.cpp:647-749`).
 * Not covered: time remapping, volume mixing (AVERAGE/REDUCE), transition
 * audio fades (`fade_audio_hint`), audio effects.
 */

import { evaluate, frameWindow, getCount, getInt, localFrame, type Project } from "@zenvi/engine";
import type { AudioPlan, AudioSegment, GainPoint } from "@zenvi/engine/render";

export function planAudioInterim(project: Project, range: { start: number; end: number }): AudioPlan {
  const fps = project.fps;
  const rate = fps.num / fps.den;
  const segments: AudioSegment[] = [];
  for (const clip of project.clips) {
    if (clip.reader?.has_audio === false) continue;
    const window = frameWindow(clip, fps);
    if (window.endFrame < window.startFrame) continue;
    const timelineStart = (window.startFrame - 1) / rate;
    const frames = window.endFrame - window.startFrame + 1;
    const timelineEnd = timelineStart + frames / rate;
    if (timelineEnd <= range.start || timelineStart >= range.end) continue;
    const firstClipFrame = localFrame(window, window.startFrame);
    if (getInt(clip.has_audio, firstClipFrame, -1) === 0) continue;

    const gain: GainPoint[] = [];
    if (getCount(clip.volume) <= 1) {
      gain.push({ t: 0, gain: evaluate(clip.volume, firstClipFrame, 1) });
    } else {
      for (let i = 0; i <= frames; i += 1) gain.push({ t: i / rate, gain: evaluate(clip.volume, firstClipFrame + i - 1, 1) });
    }
    segments.push({
      clipId: clip.id,
      fileId: clip.file_id,
      path: String(clip.reader?.path ?? ""),
      timelineStart,
      sourceStart: (window.localStartFrame - 1) / rate,
      duration: frames / rate,
      rate: 1,
      gain,
      effects: [],
    });
  }
  return { sampleRate: project.sample_rate, channels: project.channels, start: range.start, end: range.end, segments };
}
