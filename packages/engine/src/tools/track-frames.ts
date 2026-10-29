/**
 * Tracks of a media-bin file, read through `host.frames` (render-node, the
 * browser, Zenvi Cloud: anywhere frames render), so tracking runs on every
 * surface instead of only in the desktop's OpenCV Tracker effect.
 *
 * Frames are rendered small (TRACK_EDGE) through the same scratch project
 * inspect_media_tool uses, so a track is in source-frame coordinates (0-1)
 * whatever the clip's transform. Tracks are cached per file and request: a
 * look with track_point_tool followed by a pin or a reframe tracks once.
 */

import { decodePngBase64 } from "../io/png.js";
import type { ProjectFile } from "../model/types.js";
import type { RgbaImage } from "../render/types.js";
import { toGray, type GrayImage } from "../tracking/gray.js";
import { RegionTracker, type Quad, type Track, type TrackModel, type TrackSample } from "../tracking/track.js";
import type { ToolCall } from "./define.js";
import { fitSize, singleFileProject } from "./media-frames.js";

/** Longest edge of the frames the tracker reads, pixels. */
export const TRACK_EDGE = 480;
/** Most frames one track reads: a long shot is sampled more sparsely. */
const MAX_FRAMES = 900;
const CACHE_SIZE = 12;

export interface TrackRequest {
  /** The region on the source frame at `time`, 0-1. */
  quad: Quad;
  /** Source seconds the region was given at. */
  time: number;
  /** Source window to track, seconds. */
  start: number;
  end: number;
  /** Samples per second (at most the file's frame rate). */
  rate: number;
  model: TrackModel;
}

const cache = new Map<string, Track>();

function cacheKey(file: ProjectFile, r: TrackRequest): string {
  const q = r.quad.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(";");
  return [String(file.id), String(file.path), q, r.time.toFixed(3), r.start.toFixed(3), r.end.toFixed(3), r.rate.toFixed(3), r.model].join("|");
}

/** Frames per second of `file`, or undefined. */
export function fileFps(file: ProjectFile): number | undefined {
  const fps = file.fps as { num?: unknown; den?: unknown } | undefined;
  const v = Number(fps?.num) / Number(fps?.den);
  return Number.isFinite(v) && v > 2 ? v : undefined;
}

/** Sample times from `from` towards `to` (either direction), `step` apart, both ends included. */
function sampleTimes(from: number, to: number, step: number): number[] {
  const out = [from];
  const dir = to >= from ? 1 : -1;
  const n = Math.floor(Math.abs(to - from) / step + 1e-6);
  for (let i = 1; i <= n; i += 1) out.push(from + dir * i * step);
  if (Math.abs(out[out.length - 1]! - to) > step * 0.25) out.push(to);
  return out;
}

/** Grey frames of `file` at source seconds `times`, longest edge `edge`. Needs `host.frames`. */
export async function* grayFrames(call: ToolCall, file: ProjectFile, times: readonly number[], edge = TRACK_EDGE): AsyncGenerator<GrayImage> {
  const frames = call.host.frames!;
  const scratch = singleFileProject(call.doc.project, file);
  const [width] = fitSize(scratch.width, scratch.height, edge);
  if (frames.renderFrames) {
    for await (const image of frames.renderFrames(scratch, times, { width, ...(call.signal ? { signal: call.signal } : {}) })) yield toGray(image);
    return;
  }
  for (const t of times) {
    if (call.signal?.aborted) return;
    const png = await frames.renderFrame(scratch, t, { width, format: "png" });
    if (png.mimeType !== "image/png") throw new Error("this surface renders frames the tracker cannot read");
    yield toGray(decodePngBase64(png.data));
  }
}

/** Track from the reference time towards one end of the window. */
async function trackLeg(call: ToolCall, file: ProjectFile, r: TrackRequest, times: number[]): Promise<TrackSample[]> {
  const out: TrackSample[] = [];
  let tracker: RegionTracker | undefined;
  let size = { w: 1, h: 1 };
  let i = 0;
  for await (const gray of grayFrames(call, file, times)) {
    const time = times[i]!;
    i += 1;
    if (!tracker) {
      size = { w: gray.width, h: gray.height };
      tracker = new RegionTracker(gray, r.quad.map((p) => ({ x: p.x * size.w, y: p.y * size.h })) as Quad, r.model);
      out.push({ time, quad: r.quad, lost: false, score: 1 });
      continue;
    }
    const step = tracker.step(gray);
    out.push({ time, quad: step.quad.map((p) => ({ x: p.x / size.w, y: p.y / size.h })) as Quad, lost: step.lost, score: step.score });
  }
  return out;
}

/**
 * The track of `r` in `file`, or an "Error: …" string. Tracks from `time`
 * forwards to `end` and backwards to `start`.
 */
export async function trackFile(call: ToolCall, file: ProjectFile, r: TrackRequest): Promise<Track | string> {
  if (!call.host.frames) return "Error: this Zenvi surface cannot render frames to track.";
  const key = cacheKey(file, r);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const span = Math.max(0, r.end - r.start);
  const step = Math.max(1 / r.rate, span / MAX_FRAMES);
  const time = Math.min(Math.max(r.time, r.start), r.end);
  let samples: TrackSample[];
  try {
    const forward = time < r.end ? await trackLeg(call, file, r, sampleTimes(time, r.end, step)) : [];
    const backward = time > r.start ? await trackLeg(call, file, r, sampleTimes(time, r.start, step)) : [];
    samples = forward.length > 0 ? [...backward.slice(1).reverse(), ...forward] : [...backward].reverse();
    if (samples.length === 0) samples = [{ time, quad: r.quad, lost: false, score: 1 }];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    call.host.log?.(`track ${String(file.id)} failed: ${message}`);
    return `Error: could not read the frames of ${String(file.id)} to track: ${message}`;
  }
  if (call.signal?.aborted) return "Error: tracking was cancelled.";
  const width = Number(file.width) || 16;
  const height = Number(file.height) || 9;
  const track: Track = { model: r.model, aspect: width / height, samples };
  cache.set(key, track);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return track;
}

/** One colour frame of `file` at source second `time`, longest edge `edge`. Needs `host.frames`. */
export async function colourFrame(call: ToolCall, file: ProjectFile, time: number, edge = TRACK_EDGE): Promise<RgbaImage> {
  const frames = call.host.frames!;
  const scratch = singleFileProject(call.doc.project, file);
  const [width] = fitSize(scratch.width, scratch.height, edge);
  if (frames.renderFrames) {
    for await (const image of frames.renderFrames(scratch, [time], { width })) return image;
  }
  const png = await frames.renderFrame(scratch, time, { width, format: "png" });
  if (png.mimeType !== "image/png") throw new Error("this surface renders frames the tracker cannot read");
  return decodePngBase64(png.data);
}
