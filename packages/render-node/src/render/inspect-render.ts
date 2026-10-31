/**
 * `MediaHost.inspectRender`: ffmpeg's detectors over a rendered file in one
 * decode pass. `blackdetect`, `freezedetect` and `scdet` read the picture;
 * `silencedetect` and `ebur128` (true peak) read the mix; after them, a
 * small copy at PICTURE_FPS is measured by `signalstats` (mean luma, chroma
 * and change per frame) for the rhythm checks. The engine's
 * review_render_tool sets the thresholds and turns the stretches into
 * verdicts; this only runs ffmpeg and parses its log.
 */

import type { PictureSeries, RenderInspection, RenderInspectOptions, TimeRange } from "@zenvi/engine";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";
import { probe } from "../probe/probe.js";

/** Longest file inspected, seconds: a review is of a short edit, not a feature. */
const MAX_SECONDS = 900;
/** The detectors log a line per stretch and the picture series 8 lines a sample: this holds 900 s of them. */
const LOG_LIMIT = 16 * 1024 * 1024;
/** Samples a second of the picture series: enough to see a 0.6 s still and every shot's colour. */
export const PICTURE_FPS = 15;
const SERIES_KEYS = ["YAVG", "UAVG", "VAVG", "YDIF"] as const;

const round = (value: number): number => Math.round(value * 1000) / 1000;

function num(text: string | undefined): number | null {
  if (text === undefined || /^-?inf$/i.test(text.trim())) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Stretches from a detector's start/end lines; one still open at the end of the file closes there. */
function stretches(log: string, startKey: RegExp, endKey: RegExp, duration: number): TimeRange[] {
  const out: TimeRange[] = [];
  let open: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    const start = startKey.exec(line);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const end = endKey.exec(line);
    if (end && open !== null) {
      out.push({ start: round(open), end: round(Number(end[1])) });
      open = null;
    }
  }
  if (open !== null && duration > open) out.push({ start: round(open), end: round(duration) });
  return out;
}

/** The detectors' findings from ffmpeg's log (`duration` closes stretches still open at the end). */
export function parseInspectLog(
  log: string,
  duration: number,
  hasAudio: boolean,
): Omit<RenderInspection, "path" | "duration" | "width" | "height" | "fps" | "hasAudio"> {
  const black: TimeRange[] = [];
  for (const match of log.matchAll(/black_start:\s*(-?[\d.]+)\s+black_end:\s*(-?[\d.]+)/g)) {
    black.push({ start: round(Math.max(0, Number(match[1]))), end: round(Number(match[2])) });
  }
  // blackdetect closes a stretch still black at the end itself (black_end: the last frame's time); freezedetect leaves it open.
  const frozen = stretches(log, /freeze_start:\s*(-?[\d.]+)/, /freeze_end:\s*(-?[\d.]+)/, duration);
  const silences = hasAudio ? stretches(log, /silence_start:\s*(-?[\d.]+)/, /silence_end:\s*(-?[\d.]+)/, duration) : [];
  const cuts: { time: number; score: number }[] = [];
  for (const match of log.matchAll(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/g)) {
    cuts.push({ time: round(Number(match[2])), score: Math.round(Number(match[1]) * 10) / 10 });
  }
  const picture = parsePictureSeries(log);
  let loudness: RenderInspection["loudness"] = null;
  if (hasAudio) {
    const at = log.lastIndexOf("Summary:");
    const summary = at >= 0 ? log.slice(at) : "";
    const integrated = num(/\bI:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(summary)?.[1]);
    const range = num(/\bLRA:\s+(-?[\d.]+|-inf)\s+LU\b/.exec(summary)?.[1]);
    const peak = num(/\bPeak:\s+(-?[\d.]+|-inf)\s+dBFS/.exec(summary)?.[1]);
    // ebur128 reports its -70 LUFS floor for audio with nothing above the absolute gate.
    loudness = {
      integratedLufs: integrated === null || integrated <= -70 ? null : Math.round(integrated * 10) / 10,
      rangeLu: range === null || integrated === null || integrated <= -70 ? null : Math.round(range * 10) / 10,
      truePeakDb: peak === null || peak <= -120 ? null : Math.round(peak * 10) / 10,
    };
  }
  return { black, frozen, cuts, silences, loudness, ...(picture ? { picture } : {}) };
}

/** The `metadata=mode=print` lines of the signalstats branch as a series (8-bit studio range to 0-1 and -1..1). */
export function parsePictureSeries(log: string): PictureSeries | null {
  const rows = new Map<number, Partial<Record<(typeof SERIES_KEYS)[number], number>>>();
  let t: number | null = null;
  for (const line of log.split(/\r?\n/)) {
    if (!line.includes("Parsed_metadata")) continue;
    const time = /pts_time:\s*(-?[\d.]+)/.exec(line);
    if (time) {
      t = Math.round(Number(time[1]) * 1000) / 1000;
      continue;
    }
    const kv = /lavfi\.signalstats\.(YAVG|UAVG|VAVG|YDIF)=(-?[\d.]+)/.exec(line);
    if (kv && t !== null) rows.set(t, { ...rows.get(t), [kv[1]!]: Number(kv[2]) });
  }
  const times = [...rows.keys()].sort((a, b) => a - b).filter((k) => SERIES_KEYS.every((key) => rows.get(k)![key] !== undefined));
  if (times.length === 0) return null;
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  return {
    fps: PICTURE_FPS,
    t: times,
    luma: times.map((k) => r3(clampTo((rows.get(k)!.YAVG! - 16) / 219, 0, 1))),
    u: times.map((k) => r3(clampTo((rows.get(k)!.UAVG! - 128) / 112, -1, 1))),
    v: times.map((k) => r3(clampTo((rows.get(k)!.VAVG! - 128) / 112, -1, 1))),
    motion: times.map((k) => r3(rows.get(k)!.YDIF! / 219)),
  };
}

export async function inspectRender(file: string, options: RenderInspectOptions): Promise<RenderInspection> {
  const info = await probe(file);
  if (!info.has_video) throw new Error(`${file} has no picture to review`);
  const fps = info.fps.num / Math.max(1, info.fps.den);
  const duration = Math.min(Number(info.duration) || 0, MAX_SECONDS);
  const hasAudio = Boolean(info.has_audio);
  const video = [
    `blackdetect=d=${options.blackMinSeconds}:pix_th=${options.blackPixel}`,
    `freezedetect=n=${options.freezeNoiseDb}dB:d=${options.freezeMinSeconds}`,
    `scdet=threshold=${options.sceneThreshold}`,
    `fps=${PICTURE_FPS}`,
    "scale=96:-2",
    "signalstats",
    ...SERIES_KEYS.map((key) => `metadata=mode=print:key=lavfi.signalstats.${key}`),
  ].join(",");
  const args = ["-hide_banner", "-nostats", "-nostdin", "-t", String(MAX_SECONDS), "-i", file, "-map", "0:v:0", "-vf", video];
  if (hasAudio) {
    args.push("-map", "0:a:0", "-af", `silencedetect=noise=${options.silenceDb}dB:d=${options.silenceMinSeconds},ebur128=peak=true:framelog=verbose`);
  }
  args.push("-f", "null", "-");
  const { stderr } = await runBinary(resolveBinary("ffmpeg"), args, {
    signal: options.signal,
    timeoutMs: 300_000,
    stderrLimit: LOG_LIMIT,
    what: "Inspecting the render failed",
  });
  return {
    path: file,
    duration: round(duration),
    width: info.width,
    height: info.height,
    fps: round(fps),
    hasAudio,
    ...parseInspectLog(stderr, duration, hasAudio),
  };
}
