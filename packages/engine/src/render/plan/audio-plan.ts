/**
 * `planAudio`: the audio libopenshot mixes into each timeline frame, as
 * segments of clip source audio with a playback rate and a gain envelope.
 *
 * Per timeline frame and clip it follows `Timeline::GetFrame` and
 * `add_layer` (src/Timeline.cpp:1092-1100, 647-735): the JUCE gain ramp from
 * `volume(n-1)` to `volume(n)`, transition audio fades
 * (`ResolveTransitionAudioGains`, :1874-1990), AVERAGE / REDUCE mixing over
 * `max_volume_sum`; `Clip::GetOrCreateFrame`'s `has_audio` and end-of-media
 * muting (Clip.cpp:784-791); and `Clip::apply_timemapping` (Clip.cpp:585-720)
 * for `time` curves, replayed sequentially from the clip's first frame like
 * an export, so any sub-range plans the same audio. Audio effects run on the
 * clip audio before the gain (`Clip::apply_effects`).
 *
 * Source times count from the reader's frame 1 (for video files the first
 * video frame; libopenshot drops audio before it), in the FrameMapper's
 * layout at the timeline rate (FrameMapper.cpp:147-199).
 */

import { CompiledKeyframe } from "../../keyframe/evaluate.js";
import { roundHalfAway } from "../../model/rounding.js";
import type { Clip, Effect, Fraction, Project } from "../../model/types.js";
import { sortClips } from "../../timeline/queries.js";
import { frameSampleOffset, samplesPerFrame } from "../../timeline/time.js";
import { frameWindow, localFrame, windowContains, type FrameWindow } from "../../timeline/windows.js";
import type { AudioPlan, AudioSegment, EffectInstance, GainPoint } from "../types.js";
import { AUDIO_EFFECT_TYPES, effectInstance, resolveParentEffect, sortEffects } from "./effects.js";

const f32 = Math.fround;

/** libopenshot VolumeMixType (Enums.h). */
const VOLUME_MIX_AVERAGE = 1;
const VOLUME_MIX_REDUCE = 2;

/** Timeline.cpp:1876. */
const HALF_PI = 1.5707963267948966; // 1.57079632679489661923

export interface AudioRange {
  /** Timeline seconds. */
  start: number;
  end: number;
}

function int(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function fractionOf(v: unknown, fallback: Fraction): Fraction {
  if (typeof v === "object" && v !== null) {
    const { num, den } = v as { num?: unknown; den?: unknown };
    if (typeof num === "number" && typeof den === "number" && num > 0 && den > 0) return { num, den };
  }
  return fallback;
}

function keyframe(value: unknown): CompiledKeyframe | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return new CompiledKeyframe({ Points: [{ co: { X: 1, Y: value }, interpolation: 1 }] });
  return new CompiledKeyframe(value as never);
}

/** The timeline audio stream: frame `f` covers samples [offset(f), offset(f + 1)). */
class Grid {
  constructor(
    readonly fps: Fraction,
    readonly rate: number,
    readonly channels: number,
  ) {}

  offset(frame: number): number {
    return frameSampleOffset(frame, this.fps, this.rate, this.channels);
  }

  time(frame: number): number {
    return this.offset(frame) / this.rate;
  }

  samples(frame: number): number {
    return samplesPerFrame(frame, this.fps, this.rate, this.channels);
  }
}

interface ClipInfo {
  clip: Clip;
  order: number;
  layer: number;
  window: FrameWindow;
  /** libopenshot wraps every reader in a FrameMapper, which always reports audio. */
  hasReader: boolean;
  /** The source has an audio stream (FFmpegReader with `has_audio` not false). */
  audible: boolean;
  volume: CompiledKeyframe | null;
  hasAudio: CompiledKeyframe | null;
  channelFilter: CompiledKeyframe | null;
  channelMapping: CompiledKeyframe | null;
  mixing: number;
  /** The `time` curve when it remaps (GetLength() > 1). */
  time: CompiledKeyframe | null;
  /** FrameMapper `video_length`: clip frames past it are muted (0 = unknown). */
  mappedLength: number;
  /** `FrameMapper::AdjustFrameNumber` offset: mapped frame k has the samples of timeline frame k + offset. */
  offset: number;
  audioEffects: Effect[];
}

function clipInfo(clip: Clip, order: number, fps: Fraction, project: Project): ClipInfo {
  const fpsD = fps.num / fps.den;
  const reader = clip.reader;
  const hasReader = typeof reader === "object" && reader !== null;
  const audible = hasReader && reader.type === "FFmpegReader" && reader.has_audio !== false && typeof reader.path === "string" && reader.path !== "";
  const time = keyframe(clip.time);
  const duration = hasReader ? f32(Number(reader.duration) || 0) : 0;
  return {
    clip,
    order,
    layer: int(clip.layer),
    window: frameWindow(clip, fps),
    hasReader,
    audible,
    volume: keyframe(clip.volume),
    hasAudio: keyframe(clip.has_audio),
    channelFilter: keyframe(clip.channel_filter),
    channelMapping: keyframe(clip.channel_mapping),
    mixing: int(clip.mixing),
    time: time && time.length > 1 ? time : null,
    // FrameMapper: video_length = round(duration * fps) (FrameMapper.cpp:39).
    mappedLength: duration > 0 ? roundHalfAway(duration * fpsD) : 0,
    // clip_start_position - clip_start_frame (FrameMapper.cpp:1097-1117; start truncates).
    offset: roundHalfAway(f32(clip.position) * fpsD) - Math.trunc(f32(clip.start) * fpsD),
    audioEffects: sortEffects(clip.effects ?? [])
      .map((e) => resolveParentEffect(e, project))
      .filter((e) => AUDIO_EFFECT_TYPES.has(String(e.type ?? e.class_name))),
  };
}

function volumeAt(info: ClipInfo, n: number): number {
  return info.volume ? f32(info.volume.value(n)) : 1;
}

function hasAudioAt(info: ClipInfo, n: number): number {
  return info.hasAudio ? info.hasAudio.int(n) : -1;
}

function intAt(kf: CompiledKeyframe | null, n: number): number {
  return kf ? kf.int(n) : -1;
}

interface FadeMask {
  layer: number;
  window: FrameWindow;
}

/** `ResolveTransitionAudioGains`: equal-power fades for clips under a `fade_audio_hint` Mask. */
function transitionGains(info: ClipInfo, f: number, isTop: boolean, layerClips: readonly ClipInfo[], masks: readonly FadeMask[]): [number, number] {
  let active: FadeMask | null = null;
  for (const m of masks) {
    if (m.layer !== info.layer || !windowContains(m.window, f)) continue;
    if (active) return [1, 1];
    active = m;
  }
  if (!active) return [1, 1];
  const audible: ClipInfo[] = [];
  for (const other of layerClips) {
    if (!other.hasReader) continue;
    if (hasAudioAt(other, localFrame(other.window, f)) === 0) continue;
    audible.push(other);
    if (audible.length > 2) return [1, 1];
  }
  if (!audible.includes(info)) return [1, 1];
  if (audible.length === 2) {
    const [a, b] = audible as [ClipInfo, ClipInfo];
    // std::max_element by start_pos (ties: the later clip).
    const top = a.window.startFrame > b.window.startFrame ? a : b;
    if (isTop !== (top === info)) return [1, 1];
  }
  const { startFrame: ms, endFrame: me } = active.window;
  const fadesIn = Math.abs(ms - info.window.startFrame) <= Math.abs(me - info.window.endFrame);
  const gain = (frame: number): number => {
    if (me <= ms) return 1;
    let t = (frame - ms) / (me - ms);
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return f32(fadesIn ? Math.sin(t * HALF_PI) : Math.cos(t * HALF_PI));
  };
  return [gain(f - 1), gain(f)];
}

/** Where a frame's audio comes from in the clip's source. */
interface SourceSpan {
  /** Source seconds at the frame's first sample. */
  start: number;
  /** Source seconds per timeline second (negative = backwards). */
  rate: number;
  /** True when this span continues the previous frame's without a jump. */
  continues: boolean;
}

/** First sample of mapped frame `k` in the clip's source, timeline-rate samples. */
function mappedOffset(info: ClipInfo, grid: Grid, k: number): number {
  return grid.offset(k + info.offset) - grid.offset(1 + info.offset);
}

/**
 * `Clip::apply_timemapping` replayed from the clip's first frame through
 * `last`: the source span of every clip frame, or null where it is silent.
 */
function timeMappedSpans(info: ClipInfo, grid: Grid, last: number): Map<number, SourceSpan> {
  const time = info.time!;
  const spans = new Map<number, SourceSpan>();
  let prev: { frame: number; sample: number } = { frame: 0, sample: 0 };
  let prevEndedFrame = Number.NaN;
  for (let n = info.window.localStartFrame; n <= last; n += 1) {
    const newFrame = Math.max(1, time.long(n));
    const delta = time.delta(n + 1);
    const prevIncreasing = time.isIncreasing(n);
    const increasing = time.isIncreasing(n + 1);
    // target_sample_count uses the clip's own frame number: a Clip has no parent clip.
    const target = grid.samples(n);
    const source = roundHalfAway(target * Math.abs(delta));
    let loc: { frame: number; sample: number };
    let reset = false;
    if (prev.frame === 0 || Math.abs(newFrame - prev.frame) > 2 || prevIncreasing !== increasing) {
      loc = { frame: newFrame, sample: 0 };
      reset = true;
    } else loc = { ...prev };
    if (source <= 0 || target <= 0) continue;
    const frameSamples = (k: number): number => grid.samples(Math.max(1, k) + info.offset);
    const startOffset = increasing
      ? mappedOffset(info, grid, loc.frame) + loc.sample
      : mappedOffset(info, grid, loc.frame) + frameSamples(loc.frame) - loc.sample;
    let remaining = source;
    while (remaining > 0) {
      const count = frameSamples(loc.frame) - loc.sample;
      if (count <= 0) {
        loc = { frame: loc.frame + (increasing ? 1 : -1), sample: 0 };
        break;
      }
      if (remaining - count >= 0) {
        remaining -= count;
        loc = { frame: loc.frame + (increasing ? 1 : -1), sample: 0 };
      } else {
        loc = { frame: loc.frame, sample: loc.sample + remaining };
        remaining = 0;
      }
    }
    spans.set(n, {
      start: startOffset / grid.rate,
      rate: ((increasing ? 1 : -1) * source) / target,
      continues: !reset && prevEndedFrame === n - 1,
    });
    prevEndedFrame = n;
    prev = loc;
  }
  return spans;
}

interface FrameAudio {
  f: number;
  n: number;
  t0: number;
  t1: number;
  span: SourceSpan;
  pv: number;
  v: number;
  filter: number;
  mapping: number;
  effectsKey: string;
}

function isOne(v: number): boolean {
  return Math.abs(v - 1) < 0.000001;
}

/** Drop envelope points that lie on the line through their neighbours (steps are kept). */
function simplify(points: GainPoint[]): GainPoint[] {
  if (points.length <= 2) return points;
  const out: GainPoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = out[out.length - 1]!;
    const p = points[i]!;
    const b = points[i + 1]!;
    if (p.t > a.t && b.t > p.t) {
      const expected = a.gain + ((b.gain - a.gain) * (p.t - a.t)) / (b.t - a.t);
      if (Math.abs(expected - p.gain) <= 1e-7) continue;
    }
    out.push(p);
  }
  out.push(points[points.length - 1]!);
  return out;
}

function segmentOf(info: ClipInfo, frames: readonly FrameAudio[], fps: Fraction): AudioSegment {
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  const start = first.t0;
  const points: GainPoint[] = [];
  for (const fr of frames) {
    const prev = points[points.length - 1];
    if (!prev || prev.gain !== fr.pv) points.push({ t: fr.t0 - start, gain: fr.pv });
    points.push({ t: fr.t1 - start, gain: fr.v });
  }
  const reader = info.clip.reader;
  const segment: AudioSegment = {
    clipId: String(info.clip.id ?? ""),
    fileId: String(info.clip.file_id ?? ""),
    path: String(reader.path),
    timelineStart: start,
    sourceStart: first.span.start,
    duration: last.t1 - start,
    rate: first.span.rate,
    gain: simplify(points),
    effects: info.audioEffects.map((e): EffectInstance => effectInstance(e, first.n, fps, false)),
  };
  if (first.filter >= 0) segment.channelFilter = first.filter;
  if (first.mapping >= 0) segment.channelMapping = first.mapping;
  return segment;
}

/**
 * Plan the timeline audio for `range` (default: the whole timeline). Each
 * segment covers whole timeline frames, so segments may start before
 * `range.start` or end after `range.end`; renderers clip.
 */
export function planAudio(project: Project, range?: AudioRange): AudioPlan {
  const fps = fractionOf(project.fps, { num: 30, den: 1 });
  const fpsD = fps.num / fps.den;
  const sampleRate = int(project.sample_rate, 48000) || 48000;
  const channels = int(project.channels, 2) || 2;
  const grid = new Grid(fps, sampleRate, channels);

  const clips = sortClips(project.clips ?? []).map((c, i) => clipInfo(c, i, fps, project));
  let timelineEnd = 0;
  for (const c of clips) if (c.window.endFrame >= c.window.startFrame) timelineEnd = Math.max(timelineEnd, grid.time(c.window.endFrame + 1));
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.max(start, range?.end ?? timelineEnd);
  const plan: AudioPlan = { sampleRate, channels, start, end, segments: [] };
  if (!(end > start)) return plan;

  // Timeline frames overlapping [start, end).
  let fA = Math.max(1, Math.floor(start * fpsD) + 1);
  while (fA > 1 && grid.time(fA) > start) fA -= 1;
  while (grid.time(fA + 1) <= start) fA += 1;
  let fB = Math.max(fA, Math.ceil(end * fpsD));
  while (fB > fA && grid.time(fB) >= end) fB -= 1;
  while (grid.time(fB + 1) < end) fB += 1;

  const relevant = clips.filter((c) => c.window.endFrame >= Math.max(fA, c.window.startFrame) && c.window.startFrame <= fB);
  const masks: FadeMask[] = [];
  for (const e of project.effects ?? []) {
    const effect = e as unknown as Record<string, unknown>;
    if (effect.type !== "Mask" || !(effect.fade_audio_hint === true || effect.fade_audio_hint === 1)) continue;
    masks.push({
      layer: int(effect.layer),
      window: frameWindow({ position: Number(effect.position ?? 0), start: Number(effect.start ?? 0), end: Number(effect.end ?? 0) }, fps),
    });
  }

  const perClip = new Map<ClipInfo, FrameAudio[]>();
  const spans = new Map<ClipInfo, Map<number, SourceSpan>>();
  for (const c of relevant) {
    if (!c.audible) continue;
    perClip.set(c, []);
    if (c.time) spans.set(c, timeMappedSpans(c, grid, localFrame(c.window, Math.min(fB, c.window.endFrame))));
  }

  for (let f = fA; f <= fB; f += 1) {
    const here = relevant.filter((c) => windowContains(c.window, f));
    if (!here.some((c) => c.audible)) continue;
    // Top clip per layer: the largest start_pos, first in sort order on ties.
    const top = new Map<number, ClipInfo>();
    for (const c of here) {
      const best = top.get(c.layer);
      if (!best || c.window.startFrame > best.window.startFrame) top.set(c.layer, c);
    }
    let maxVolume: number | null = null;
    const volumeSum = (): number => {
      if (maxVolume === null) {
        let sum = 0;
        for (const c of here) {
          const n = localFrame(c.window, f);
          if (c.hasReader && hasAudioAt(c, n) !== 0) sum = f32(sum + volumeAt(c, n));
        }
        maxVolume = sum;
      }
      return maxVolume;
    };
    for (const c of here) {
      const list = perClip.get(c);
      if (!list) continue;
      const n = localFrame(c.window, f);
      if (hasAudioAt(c, n) === 0) continue;
      let span: SourceSpan | undefined;
      if (c.time) span = spans.get(c)?.get(n);
      else if (c.mappedLength === 0 || n <= c.mappedLength) span = { start: mappedOffset(c, grid, n) / sampleRate, rate: 1, continues: true };
      if (!span) continue;
      const layerClips = here.filter((o) => o.layer === c.layer);
      const [gPrev, gCur] = masks.length ? transitionGains(c, f, top.get(c.layer) === c, layerClips, masks) : [1, 1];
      let pv = f32(volumeAt(c, n - 1) * gPrev);
      let v = f32(volumeAt(c, n) * gCur);
      if (c.mixing === VOLUME_MIX_AVERAGE && volumeSum() > 1) {
        pv = f32(pv / volumeSum());
        v = f32(v / volumeSum());
      } else if (c.mixing === VOLUME_MIX_REDUCE && volumeSum() > 1) {
        pv = f32(pv * 0.77);
        v = f32(v * 0.77);
      }
      if (isOne(pv) && isOne(v)) pv = v = 1;
      const effectsKey = c.audioEffects.length ? JSON.stringify(c.audioEffects.map((e) => effectInstance(e, n, fps, false).params)) : "";
      list.push({
        f,
        n,
        t0: grid.time(f),
        t1: grid.time(f + 1),
        span,
        pv,
        v,
        filter: intAt(c.channelFilter, n),
        mapping: intAt(c.channelMapping, n),
        effectsKey,
      });
    }
  }

  const segments: { order: number; segment: AudioSegment }[] = [];
  const tolerance = 2.5 / sampleRate;
  for (const [c, frames] of perClip) {
    let run: FrameAudio[] = [];
    const flush = (): void => {
      if (run.length) segments.push({ order: c.order, segment: segmentOf(c, run, fps) });
      run = [];
    };
    for (const fr of frames) {
      const prev = run[run.length - 1];
      if (prev) {
        const expected = prev.span.start + prev.span.rate * (prev.t1 - prev.t0);
        const joins =
          fr.f === prev.f + 1 &&
          fr.span.rate === prev.span.rate &&
          (c.time ? fr.span.continues : true) &&
          Math.abs(fr.span.start - expected) <= tolerance * Math.max(1, Math.abs(fr.span.rate)) &&
          fr.filter === prev.filter &&
          fr.mapping === prev.mapping &&
          fr.effectsKey === prev.effectsKey;
        if (!joins) flush();
      }
      run.push(fr);
    }
    flush();
  }
  segments.sort((a, b) => a.segment.timelineStart - b.segment.timelineStart || a.order - b.order);
  plan.segments = segments.map((s) => s.segment);
  return plan;
}
