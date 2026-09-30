/** ffprobe JSON (`-show_format -show_streams`) and the runner that produces it. */

import { resolveBinary } from "../ffmpeg/binaries.js";
import { runBinary } from "../ffmpeg/process.js";

export interface FfprobeSideData {
  side_data_type?: string;
  rotation?: number;
  projection?: string;
  yaw?: number;
  pitch?: number;
  roll?: number;
  [key: string]: unknown;
}

export interface FfprobeStream {
  index: number;
  codec_name?: string;
  codec_type?: "video" | "audio" | "subtitle" | "data" | "attachment";
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  pix_fmt?: string;
  field_order?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  time_base?: string;
  duration_ts?: number;
  duration?: string;
  bit_rate?: string;
  nb_frames?: string;
  sample_fmt?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
  side_data_list?: FfprobeSideData[];
  [key: string]: unknown;
}

export interface FfprobeFormat {
  filename?: string;
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
  [key: string]: unknown;
}

export interface FfprobeResult {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

export async function ffprobe(file: string, signal?: AbortSignal): Promise<FfprobeResult> {
  const { stdout } = await runBinary(
    resolveBinary("ffprobe"),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
    { signal, timeoutMs: 60_000, maxStdout: 32 * 1024 * 1024, what: `ffprobe could not read ${file}` },
  );
  const parsed = JSON.parse(stdout.toString("utf8")) as Partial<FfprobeResult>;
  return { streams: parsed.streams ?? [], format: parsed.format ?? {} };
}
