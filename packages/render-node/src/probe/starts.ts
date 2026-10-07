/**
 * Stream start times, needed to turn libopenshot source times (anchored to
 * the first video packet, or the first audio packet for audio-only files)
 * into ffmpeg `-ss` positions (relative to the container start).
 */

import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";

export interface StreamStarts {
  videoStart?: number;
  audioStart?: number;
  formatStart: number;
}

const cache = new Map<string, Promise<StreamStarts>>();

function parse(v: string | undefined): number | undefined {
  if (v === undefined || v === "N/A") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function streamStarts(file: string, signal?: AbortSignal): Promise<StreamStarts> {
  let hit = cache.get(file);
  if (!hit) {
    hit = runBinary(
      resolveBinary("ffprobe"),
      ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_type,start_time:format=start_time", file],
      { signal, timeoutMs: 60_000 },
    )
      .then(({ stdout }) => {
        const parsed = JSON.parse(stdout.toString("utf8")) as {
          streams?: Array<{ codec_type?: string; start_time?: string }>;
          format?: { start_time?: string };
        };
        const video = parsed.streams?.find((s) => s.codec_type === "video");
        const audio = parsed.streams?.find((s) => s.codec_type === "audio");
        return {
          videoStart: video ? (parse(video.start_time) ?? 0) : undefined,
          audioStart: audio ? (parse(audio.start_time) ?? 0) : undefined,
          formatStart: parse(parsed.format?.start_time) ?? 0,
        };
      })
      .catch(() => {
        cache.delete(file);
        return { formatStart: 0 };
      });
    cache.set(file, hit);
  }
  return hit;
}
