/**
 * `AudioPlan` → ffmpeg inputs + filter graph, mixed inside the encoder process.
 *
 * Per segment: input-level seek (`-ss`/`-t`, sample accurate when
 * transcoding), `areverse` for negative rates, an `atempo` chain for the
 * speed, conversion to the project rate/layout, the gain envelope as a
 * per-frame `volume` expression (frames forced to ~5 ms so ramps are smooth),
 * and `adelay` to its timeline position. Segments are summed with
 * `amix normalize=0` (libopenshot adds clip audio at gain 1:
 * Timeline::add_layer, Timeline.cpp), then padded/trimmed to the range.
 *
 * Source times follow libopenshot: audio is anchored to the video stream
 * start when the file has video (FFmpegReader::UpdatePTSOffset), to the audio
 * start otherwise. `-ss` is relative to the container start, so both are
 * converted.
 */

import path from "node:path";
import type { AudioKernel, AudioPlan, AudioSegment, GainPoint } from "@zenvi/engine";
import { renderSegmentEffects, splitEffects } from "./audio-effects.js";
import type { StreamStarts } from "../probe/starts.js";

export interface AudioInput {
  path: string;
  /** Input `-ss`, seconds from the container start. */
  seek: number;
  /** Input `-t`, seconds of source to read. */
  duration: number;
}

export interface AudioGraph {
  inputs: AudioInput[];
  /** Filter graph text; its output pad is `[aout]`. */
  filter: string;
  /** Segments left out (effects the node renderer cannot run yet, zero-rate freezes). */
  warnings: string[];
}

export interface BuildAudioGraphOptions {
  plan: AudioPlan;
  /** Timeline range being rendered, seconds. */
  range: { start: number; end: number };
  sampleRate: number;
  channels: number;
  /** Index of the first audio input (1 when the video arrives on input 0). */
  firstInput: number;
  resolve: (projectPath: string) => Promise<string>;
  startsOf: (file: string) => Promise<StreamStarts>;
  /** Run clip audio effects with the engine kernels (pre-rendered to temp WAVs). */
  effects?: {
    getKernel: (type: string) => AudioKernel | undefined;
    tempDir: string;
    /** Samples per processing block (one timeline frame). */
    blockSize: number;
    signal?: AbortSignal;
  };
}

/** Shortest decimal for ffmpeg (no exponent, trailing zeros trimmed). */
export function num(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(digits);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return trimmed === "-0" ? "0" : trimmed;
}

/** Drop points that lie on the line through their neighbours (the envelope is piecewise linear). */
export function simplifyGain(points: GainPoint[], tolerance = 1e-4): GainPoint[] {
  const sorted = [...points].filter((p) => Number.isFinite(p.t) && Number.isFinite(p.gain)).sort((a, b) => a.t - b.t);
  if (sorted.length <= 2) return sorted;
  const out: GainPoint[] = [sorted[0]!];
  for (let i = 1; i < sorted.length - 1; i += 1) {
    const prev = out[out.length - 1]!;
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    const span = next.t - prev.t;
    const expected = span > 0 ? prev.gain + ((next.gain - prev.gain) * (cur.t - prev.t)) / span : cur.gain;
    if (Math.abs(expected - cur.gain) > tolerance || cur.t === prev.t) out.push(cur);
  }
  out.push(sorted[sorted.length - 1]!);
  return out;
}

/**
 * ffmpeg expression for a piecewise-linear gain in `t` (seconds), held
 * constant before the first and after the last point. A balanced `if` tree
 * keeps evaluation logarithmic in the number of points.
 */
export function gainExpression(points: GainPoint[], shift = 0): string {
  const pts = simplifyGain(points).map((p) => ({ t: p.t - shift, gain: p.gain }));
  if (pts.length === 0) return "1";
  if (pts.length === 1 || pts.every((p) => Math.abs(p.gain - pts[0]!.gain) < 1e-6)) return num(pts[0]!.gain);
  const leaf = (i: number): string => {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dt = b.t - a.t;
    if (dt <= 0 || Math.abs(b.gain - a.gain) < 1e-9) return num(b.gain);
    return `${num(a.gain)}+${num(b.gain - a.gain)}*(t-${num(a.t)})/${num(dt)}`;
  };
  const tree = (lo: number, hi: number): string => {
    // segments lo..hi-1 (segment i spans points i..i+1)
    if (hi - lo === 1) return leaf(lo);
    const mid = Math.floor((lo + hi) / 2);
    return `if(lt(t,${num(pts[mid]!.t)}),${tree(lo, mid)},${tree(mid, hi)})`;
  };
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  return `if(lt(t,${num(first.t)}),${num(first.gain)},if(gte(t,${num(last.t)}),${num(last.gain)},${tree(0, pts.length - 1)}))`;
}

/** atempo only accepts 0.5..100 per instance; chain for anything outside. */
export function atempoChain(rate: number): string[] {
  let r = Math.abs(rate);
  if (Math.abs(r - 1) < 1e-9) return [];
  const out: string[] = [];
  while (r > 2) {
    out.push("atempo=2");
    r /= 2;
  }
  while (r < 0.5) {
    out.push("atempo=0.5");
    r /= 0.5;
  }
  if (Math.abs(r - 1) > 1e-9) out.push(`atempo=${num(r, 9)}`);
  return out;
}

/**
 * libopenshot `channel_filter` / `channel_mapping` (Timeline::add_layer,
 * Timeline.cpp:695-728): with a filter, only that source channel plays; each
 * playing channel is added to its mapped output channel (default: itself).
 */
export function channelPan(channels: number, layout: string, filter = -1, mapping = -1): string | undefined {
  if (filter < 0 && mapping < 0) return undefined;
  const outputs: string[][] = Array.from({ length: channels }, () => []);
  for (let c = 0; c < channels; c += 1) {
    if (filter >= 0 && c !== filter) continue;
    const target = mapping >= 0 ? mapping : c;
    if (target < channels) outputs[target]!.push(`c${c}`);
  }
  return `pan=${layout}|${outputs.map((sources, k) => `c${k}=${sources.length ? sources.join("+") : "0*c0"}`).join("|")}`;
}

export function layoutName(channels: number): string {
  return channels === 1 ? "mono" : channels === 2 ? "stereo" : channels === 6 ? "5.1" : channels === 8 ? "7.1" : `${channels}c`;
}

interface CutSegment {
  segment: AudioSegment;
  /** Timeline start of the part that is rendered. */
  cutStart: number;
  /** Seconds into the segment where the rendered part starts. */
  offset: number;
  length: number;
}

function cut(segment: AudioSegment, range: { start: number; end: number }): CutSegment | undefined {
  const segStart = segment.timelineStart;
  const segEnd = segment.timelineStart + segment.duration;
  const cutStart = Math.max(segStart, range.start);
  const cutEnd = Math.min(segEnd, range.end);
  if (!(cutEnd - cutStart > 1e-6)) return undefined;
  return { segment, cutStart, offset: cutStart - segStart, length: cutEnd - cutStart };
}

export async function buildAudioGraph(options: BuildAudioGraphOptions): Promise<AudioGraph> {
  const { plan, range, sampleRate, channels } = options;
  const total = Math.max(0, range.end - range.start);
  const layout = layoutName(channels);
  const warnings: string[] = [];
  const inputs: AudioInput[] = [];
  const chains: string[] = [];
  const labels: string[] = [];
  const frameSamples = Math.max(64, Math.round(sampleRate * 0.005));

  for (const segment of plan.segments) {
    const part = cut(segment, range);
    if (!part) continue;
    const rate = segment.rate;
    if (!Number.isFinite(rate) || Math.abs(rate) < 1e-3) {
      warnings.push(`Skipped a frozen audio segment of clip ${segment.clipId} (rate ${rate}).`);
      continue;
    }
    const file = await options.resolve(segment.path);
    const starts = await options.startsOf(file);
    const anchor = (starts.videoStart ?? starts.audioStart ?? starts.formatStart) - starts.formatStart;
    const sourceSpan = Math.abs(rate) * part.length;
    const a = segment.sourceStart + rate * part.offset;
    let lo = rate > 0 ? a : a - sourceSpan;
    let span = sourceSpan;
    if (lo < 0) {
      // Reversed past the source start: there is no audio before 0.
      span += lo;
      lo = 0;
    }
    if (span <= 1e-6) continue;
    const index = options.firstInput + inputs.length;
    const source: AudioInput = { path: file, seek: Math.max(0, anchor + lo), duration: span };
    const toTimeline = ["asetpts=PTS-STARTPTS", ...(rate < 0 ? ["areverse"] : []), ...atempoChain(rate), `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout}`];
    let filters: string[];
    const { runnable, missing } = options.effects ? splitEffects(segment.effects, options.effects.getKernel) : { runnable: [], missing: segment.effects.map((e) => e.type) };
    if (missing.length > 0) warnings.push(`Audio effects ${missing.join(", ")} on clip ${segment.clipId} are not available in this build; the clip plays without them.`);
    if (runnable.length > 0 && options.effects) {
      // libopenshot runs clip audio effects before the gain: process the
      // segment at timeline rate, then mix the result like any source.
      const wav = path.join(options.effects.tempDir, `segment-${inputs.length}.wav`);
      await renderSegmentEffects({
        input: source,
        filters: toTimeline,
        sampleRate,
        channels,
        seconds: part.length,
        effects: runnable,
        getKernel: options.effects.getKernel,
        blockSize: options.effects.blockSize,
        output: wav,
        signal: options.effects.signal,
      });
      inputs.push({ path: wav, seek: 0, duration: part.length });
      filters = ["asetpts=PTS-STARTPTS", `aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=${layout}`];
    } else {
      inputs.push(source);
      filters = toTimeline;
    }
    const pan = channelPan(channels, layout, segment.channelFilter, segment.channelMapping);
    if (pan) filters.push(pan);
    const gain = gainExpression(segment.gain, part.offset);
    if (gain !== "1") filters.push(`asetnsamples=n=${frameSamples}:p=0`, `volume=eval=frame:volume='${gain}'`);
    const delayMs = Math.round((part.cutStart - range.start) * 1000 * 1000) / 1000;
    if (delayMs > 0) filters.push(`adelay=delays=${num(delayMs, 3)}:all=1`);
    const label = `a${labels.length}`;
    labels.push(label);
    chains.push(`[${index}:a]${filters.join(",")}[${label}]`);
  }

  const tail = `apad=whole_dur=${num(total)},atrim=end=${num(total)},asetpts=N/SR/TB`;
  let filter: string;
  if (labels.length === 0) {
    filter = `anullsrc=r=${sampleRate}:cl=${layout},atrim=end=${num(total)}[aout]`;
  } else if (labels.length === 1) {
    filter = `${chains[0]};[${labels[0]}]${tail}[aout]`;
  } else {
    const mix = `${labels.map((l) => `[${l}]`).join("")}amix=inputs=${labels.length}:normalize=0:duration=longest:dropout_transition=0`;
    filter = `${chains.join(";")};${mix},${tail}[aout]`;
  }
  return { inputs, filter, warnings };
}
