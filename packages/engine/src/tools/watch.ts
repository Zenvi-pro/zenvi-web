/**
 * Layer-3 "watch": confirm a candidate source window with vision before a
 * placement or cut.
 *
 * Port of zenvi-core src/classes/watch_window.py `confirm_watch_window` and
 * tool_handlers.py `_watch_confirm_cut` (ref b63c39be7, with develop #168:
 * frames at the asked start/end are always kept, and the result lists the
 * frames watched, the shot cuts and where the query was visible): sample
 * frames of [start-2 s, end+2 s], POST them to the backend's
 * /indexing/watch-window vision check, and fall back softly (the caller's
 * fallback times, `used_fallback: true`) whenever frames or the backend are
 * unavailable.
 *
 * Differences, all in what the host can measure: the desktop extracts up to
 * ~40 candidate JPEGs with ffmpeg, finds scene cuts (`select='gt(scene,…)'`)
 * and drops near-duplicate frames by fingerprint before sending 12. Here up
 * to 12 frames are sampled from the same plan (cue-forced and asked times
 * first); no scene cuts are detected, so `scene_times` is always empty and
 * no shot-boundary snapping happens.
 */

import type { ProjectFile } from "../model/types.js";
import { watchWindowRequest } from "./backend.js";
import type { ToolCall } from "./define.js";
import { renderMediaFrames } from "./media-frames.js";
import { pyFixed } from "./pyfmt.js";

export const WATCH_PAD_SEC = 2.0;
export const WATCH_MAX_FRAMES = 12;
export const DENSE_WINDOW_SEC = 16.0;
const DEFAULT_LONG_EDGE = 512;
const TEXT_LONG_EDGE = 1024;
const TEXT_QUERY = /\b(ui|slide|slides|on[- ]screen|onscreen|text|terminal|screenshot|caption|title card|lower[- ]third|ocr|menu|hud)\b/i;

export interface WatchResult {
  /**
   * False when this host cannot run the vision check at all (no frame
   * rendering or no backend). The desktop always can, so callers treat that
   * as "not watched" rather than as a failed watch.
   */
  ran: boolean;
  cut_source: number;
  in_source: number;
  out_source: number;
  matched: boolean;
  used_fallback: boolean;
  confidence: number;
  reason: string;
  warning: string;
  window_start: number;
  window_end: number;
  sparse: boolean;
  /** Source seconds of the frames sent to the vision check. */
  frame_times: number[];
  /** Shot cuts found in the watched window (none: hosts do not detect scene cuts). */
  scene_times: number[];
  /** Source seconds where the backend saw the query. */
  visible_at: number[];
}

/** [start - pad, end + pad] clamped to the media (watch_window.padded_window). */
export function paddedWindow(start: number, end: number, duration = 0, pad = WATCH_PAD_SEC): [number, number] {
  const s = Math.max(0, start - pad);
  let e = end + pad;
  if (duration > 0) e = Math.min(e, duration);
  if (e <= s) {
    e = s + 0.04;
    if (duration > 0) e = Math.min(e, duration);
  }
  return [s, e];
}

function cueTimes(cues: readonly unknown[] | undefined, winStart: number, winEnd: number): number[] {
  const out: number[] = [];
  for (const cue of cues ?? []) {
    let t: number | null = null;
    if (typeof cue === "object" && cue !== null) {
      const c = cue as Record<string, unknown>;
      const raw = c.start !== undefined && c.start !== null ? c.start : c.time;
      const n = Number(raw);
      t = raw === undefined || raw === null || !Number.isFinite(n) ? null : n;
    } else {
      const n = Number(cue);
      t = Number.isFinite(n) ? n : null;
    }
    if (t !== null && winStart - 1e-3 <= t && t <= winEnd + 1e-3) out.push(Math.max(winStart, Math.min(t, winEnd)));
  }
  return out;
}

/** The sample plan: 0.5 s steps in a dense window, evenly spread otherwise, plus cue and extra times (plan_sample_times). */
export function planSampleTimes(
  winStart: number,
  winEnd: number,
  cues: readonly unknown[] | undefined,
  maxFrames = WATCH_MAX_FRAMES,
  extraTimes: readonly number[] = [],
): { times: number[]; warning: string; sparse: boolean } {
  const span = Math.max(0, winEnd - winStart);
  const sparse = span > DENSE_WINDOW_SEC;
  let warning = "";
  let times: number[] = [];
  if (sparse) {
    warning = `Window is ${pyFixed(span, 1)}s; sparse-scanned (not a dense watch). Narrow the candidate window if the cut looks off.`;
    const n = Math.max(2, Math.trunc(maxFrames));
    const step = span / Math.max(n - 1, 1);
    times = Array.from({ length: n }, (_, i) => winStart + i * step);
  } else {
    for (let t = winStart; t <= winEnd + 1e-6; t += 0.5) times.push(t);
    times.push(winEnd);
  }
  times.push(...cueTimes(cues, winStart, winEnd));
  for (const t of extraTimes) if (Number.isFinite(t) && winStart - 1e-3 <= t && t <= winEnd + 1e-3) times.push(t);
  const seen = new Set<number>();
  const rounded: number[] = [];
  for (const t of times.sort((a, b) => a - b)) {
    const key = Math.round(t * 100);
    if (seen.has(key)) continue;
    seen.add(key);
    rounded.push(t);
  }
  return { times: rounded, warning, sparse };
}

/** Narrow a wide window to a dense 16 s sub-window around cue times (pick_dense_subwindow). */
export function pickDenseSubwindow(winStart: number, winEnd: number, extraTimes: readonly number[]): [number, number] {
  const span = Math.max(0, winEnd - winStart);
  if (span <= DENSE_WINDOW_SEC + 1e-6) return [winStart, winEnd];
  const pts = extraTimes.filter((t) => winStart - 1e-3 <= t && t <= winEnd + 1e-3).sort((a, b) => a - b);
  let center = (winStart + winEnd) / 2;
  if (pts.length > 0) {
    let best = pts[Math.floor(pts.length / 2)]!;
    let bestN = -1;
    for (const t of pts) {
      const n = pts.filter((u) => Math.abs(u - t) <= DENSE_WINDOW_SEC / 2).length;
      if (n > bestN) {
        bestN = n;
        best = t;
      }
    }
    center = best;
  }
  let start = Math.max(winStart, center - DENSE_WINDOW_SEC / 2);
  let end = Math.min(winEnd, start + DENSE_WINDOW_SEC);
  start = Math.max(winStart, end - DENSE_WINDOW_SEC);
  if (end <= start) end = Math.min(winEnd, start + 0.04);
  return [start, end];
}

/** Keep cue-forced frames, then spread the rest evenly, at most `max` (dedupe_frame_records budget rule). */
function pickFrames(times: readonly number[], mustKeep: ReadonlySet<number>, max: number): number[] {
  if (times.length <= max) return [...times];
  const musts = times.filter((t) => mustKeep.has(Math.round(t * 100)));
  const others = times.filter((t) => !mustKeep.has(Math.round(t * 100)));
  const budget = Math.max(0, max - musts.length);
  if (budget <= 0) return musts.slice(0, max);
  let picked: number[];
  if (others.length <= budget) picked = others;
  else if (budget === 1) picked = [others[Math.floor(others.length / 2)]!];
  else {
    const step = (others.length - 1) / Math.max(budget - 1, 1);
    const idx = [...new Set(Array.from({ length: budget }, (_, i) => Math.round(i * step)))].sort((a, b) => a - b);
    picked = idx.map((i) => others[i]!);
  }
  return [...musts, ...picked].sort((a, b) => a - b).slice(0, max);
}

export interface WatchInput {
  file: ProjectFile | undefined;
  start: number;
  end: number;
  query: string;
  duration?: number;
  cues?: readonly unknown[];
  fallbackCut?: number;
  fallbackIn?: number;
  fallbackOut?: number;
}

/** confirm_watch_window (+ the no-source fallback of tool_handlers._watch_confirm_cut). */
export async function confirmWatchWindow(call: ToolCall, input: WatchInput): Promise<WatchResult> {
  const fallback = input.fallbackCut ?? input.start;
  const fbIn = input.fallbackIn ?? input.start;
  const fbOut = input.fallbackOut ?? input.end;
  let frameTimes: number[] = [];
  const soft = (reason: string, windowStart: number, windowEnd: number, warning = "", sparse = false, ran = true): WatchResult => ({
    ran,
    cut_source: fallback,
    in_source: fbIn,
    out_source: fbOut,
    matched: false,
    used_fallback: true,
    confidence: 0,
    reason,
    warning,
    window_start: windowStart,
    window_end: windowEnd,
    sparse,
    frame_times: frameTimes,
    scene_times: [],
    visible_at: [],
  });

  const file = input.file;
  if (!file || !String(file.path ?? "")) return soft("No source path for watch window", input.start, input.end);

  let [winStart, winEnd] = paddedWindow(input.start, input.end, input.duration ?? (Number(file.duration) || 0));
  const cueT = cueTimes(input.cues, winStart, winEnd);
  if (winEnd - winStart > DENSE_WINDOW_SEC) [winStart, winEnd] = pickDenseSubwindow(winStart, winEnd, cueT);
  // Keep the edges of the window that was asked about: on a static shot the
  // padding frames would otherwise be all the caller hears about (#168).
  const asked = [input.start, input.end].filter((t) => winStart - 1e-3 <= t && t <= winEnd + 1e-3);
  const plan = planSampleTimes(winStart, winEnd, input.cues, Math.max(WATCH_MAX_FRAMES * 3, 24), asked);
  const mustKeep = new Set([...cueT, ...asked].map((t) => Math.round(t * 100)));
  const times = pickFrames(plan.times, mustKeep, WATCH_MAX_FRAMES);

  if (!call.host.frames || !call.host.backend) {
    const missing = !call.host.frames ? "frame rendering" : "the Zenvi backend";
    return soft(`Watch unavailable on this surface (needs ${missing})`, winStart, winEnd, plan.warning, plan.sparse, false);
  }
  let frames;
  try {
    frames = await renderMediaFrames(call, file, times, {
      longestEdge: TEXT_QUERY.test(input.query) ? TEXT_LONG_EDGE : DEFAULT_LONG_EDGE,
    });
  } catch (error) {
    return soft(`No watch frames extracted (${error instanceof Error ? error.message : String(error)})`, winStart, winEnd, plan.warning, plan.sparse);
  }
  if (frames.length === 0) return soft("No watch frames extracted", winStart, winEnd, plan.warning, plan.sparse);
  frameTimes = frames.map((f) => f.timestamp);

  const payload: Record<string, unknown> = {
    query: input.query || "",
    window_start: winStart,
    window_end: winEnd,
    frames: frames.map((f) => ({ timestamp: f.timestamp, image_base64: f.image.data })),
    sparse: plan.sparse,
    orientation_role: false,
    fallback_cut: fallback,
    fallback_in: fbIn,
    fallback_out: fbOut,
  };
  const data = await watchWindowRequest(call, payload);
  if (typeof data.error === "string" && data.error) return soft(data.error, winStart, winEnd, plan.warning, plan.sparse);

  const clamp = (v: number): number => Math.max(winStart, Math.min(v, winEnd));
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return v === null || v === undefined || !Number.isFinite(n) ? null : n;
  };
  let cut = clamp(num(data.cut_source) ?? fallback);
  const matched = Boolean(data.matched);
  const usedFallback = Boolean(data.used_fallback) || !matched;
  let inS = num(data.in_source) !== null ? clamp(num(data.in_source)!) : fbIn;
  let outS = num(data.out_source) !== null ? clamp(num(data.out_source)!) : fbOut;
  if (usedFallback && !matched) {
    cut = clamp(fallback);
    inS = fbIn;
    outS = fbOut;
  }
  if (outS <= inS) {
    inS = winStart;
    outS = winEnd;
  }
  let warning = plan.warning;
  const extra = String(data.warning ?? "");
  if (extra && !warning.includes(extra)) warning = `${warning} ${extra}`.trim();
  return {
    ran: true,
    cut_source: cut,
    in_source: inS,
    out_source: outS,
    matched,
    used_fallback: usedFallback,
    confidence: Number(data.confidence) || 0,
    reason: String(data.reason ?? ""),
    warning,
    window_start: winStart,
    window_end: winEnd,
    sparse: plan.sparse,
    frame_times: frameTimes,
    scene_times: [],
    visible_at: Array.isArray(data.visible_at) ? data.visible_at.map(Number).filter((t) => Number.isFinite(t)) : [],
  };
}
