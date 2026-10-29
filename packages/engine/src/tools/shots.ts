/**
 * Shot embeddings for tools (catalog/shots.ts, review_edit_tool,
 * match_cut_montage_tool): which bin files can be embedded, at what
 * keyframe spacing, and the vector a shot (a window of a file) stands for.
 * The host computes and caches the keyframes (ShotHost); nothing is stored
 * in the project.
 */

import { isAudioOnlyMedia } from "../model/media.js";
import type { ProjectFile } from "../model/types.js";
import { meanDirection, type Vector } from "../shots/vectors.js";
import type { ToolCall } from "./define.js";
import { fileLabel, matteRecord } from "./mattes.js";
import type { ShotEmbeddings, ShotHost } from "./types.js";

/** Longer files are not embedded (an hour at one keyframe a second is 3,600 frames, about two minutes of CPU). */
export const MAX_EMBED_SECONDS = 3600;

/** Keyframes every 0.5 s up to two minutes of media, every second beyond: short stock clips are cut in half-seconds, long takes are not. */
export function shotInterval(file: ProjectFile): number {
  return !isStill(file) && (Number(file.duration) || 0) > 120 ? 1 : 0.5;
}

export function isStill(file: ProjectFile): boolean {
  return file.media_type === "image" || Boolean(file.has_single_image);
}

/** Why `file` has no shots to embed, or null. */
export function embeddableProblem(file: ProjectFile): string | null {
  if (isAudioOnlyMedia(file) || file.has_video === false) return `${fileLabel(file)} has no picture`;
  if (matteRecord(file)) return `${fileLabel(file)} is a subject matte`;
  if (!isStill(file) && (Number(file.duration) || 0) > MAX_EMBED_SECONDS) {
    return `${fileLabel(file)} is ${Math.round(Number(file.duration))} s long; files up to ${MAX_EMBED_SECONDS} s are embedded`;
  }
  return null;
}

/** Bin files with picture, in bin order (`ids` picks and orders them; unknown ids are refused by the caller). */
export function embeddableFiles(files: readonly ProjectFile[]): ProjectFile[] {
  return files.filter((f) => embeddableProblem(f) === null);
}

/** Keyframe embeddings of `file` from the host: computed when `compute`, else only what the cache has. */
export function embeddingsOf(host: ShotHost, file: ProjectFile, compute: boolean, signal?: AbortSignal): Promise<ShotEmbeddings | null> {
  return host.embedFile(file.path, { interval: shotInterval(file), cachedOnly: !compute, signal });
}

/** What a window of a file shows overall: the keyframes inside [start, end], else the one nearest its middle. */
export function windowVector(embeddings: ShotEmbeddings, start: number, end: number): Vector {
  const inside = embeddings.vectors.filter((_, i) => embeddings.times[i]! >= start - 1e-6 && embeddings.times[i]! <= end + 1e-6);
  if (inside.length > 0) return meanDirection(inside);
  const mid = (start + end) / 2;
  let best = 0;
  embeddings.times.forEach((t, i) => {
    if (Math.abs(t - mid) < Math.abs(embeddings.times[best]! - mid)) best = i;
  });
  return embeddings.vectors[best]!;
}

export interface ShotWindow {
  file: ProjectFile;
  /** Source seconds. */
  start: number;
  end: number;
}

/**
 * One vector per shot: from the file's keyframes when the cache has them
 * (or, with `compute`, after embedding the file), else from the frame in the
 * middle of the shot (one decode, not cached). Null for a shot whose file
 * has no picture or could not be read.
 */
export async function shotVectors(call: ToolCall, host: ShotHost, shots: readonly ShotWindow[], compute = false): Promise<(Vector | null)[]> {
  const cache = new Map<string, ShotEmbeddings | null>();
  const out: (Vector | null)[] = [];
  for (const shot of shots) {
    if (embeddableProblem(shot.file)) {
      out.push(null);
      continue;
    }
    if (!cache.has(shot.file.id)) cache.set(shot.file.id, await embeddingsOf(host, shot.file, compute, call.signal).catch(() => null));
    const cached = cache.get(shot.file.id);
    if (cached) {
      out.push(windowVector(cached, shot.start, shot.end));
      continue;
    }
    try {
      const [v] = await host.embedFrames(shot.file.path, [isStill(shot.file) ? 0 : (shot.start + shot.end) / 2], call.signal);
      out.push(v ?? null);
    } catch (error) {
      call.host.log?.(`embedding a frame of ${shot.file.id} failed: ${error instanceof Error ? error.message : String(error)}`);
      out.push(null);
    }
  }
  return out;
}
