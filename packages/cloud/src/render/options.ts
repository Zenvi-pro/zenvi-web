/**
 * Render presets and option validation. A render request names a preset
 * and/or overrides; the result is a complete engine `ExportOptions` with the
 * project's size and frame rate filled in.
 */

import type { ContainerFormat, ExportOptions, Project } from "@zenvi/engine";
import { z } from "zod";

export const RENDER_FORMATS = ["mp4", "webm", "mov", "mkv", "gif", "mp3", "wav"] as const satisfies readonly ContainerFormat[];
export type RenderFormat = (typeof RENDER_FORMATS)[number];

export const PRESETS = {
  mp4: { format: "mp4", quality: "high" },
  "mp4-2160p": { format: "mp4", height: 2160, quality: "high" },
  "mp4-1080p": { format: "mp4", height: 1080, quality: "high" },
  "mp4-720p": { format: "mp4", height: 720, quality: "medium" },
  webm: { format: "webm", quality: "high" },
  gif: { format: "gif", height: 360, quality: "medium" },
  mp3: { format: "mp3" },
  wav: { format: "wav" },
} as const satisfies Record<string, { format: RenderFormat; height?: number; quality?: ExportOptions["quality"] }>;

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

export const CONTENT_TYPES: Record<RenderFormat, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  gif: "image/gif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

export const renderOptionsSchema = z
  .object({
    format: z.enum(RENDER_FORMATS).optional(),
    width: z.number().int().min(16).max(7680).optional(),
    height: z.number().int().min(16).max(4320).optional(),
    fps: z.object({ num: z.number().int().positive().max(240_000), den: z.number().int().positive().max(10_000) }).optional(),
    quality: z.enum(["low", "medium", "high", "lossless"]).optional(),
    videoBitrate: z.number().int().positive().max(200_000_000).optional(),
    audioBitrate: z.number().int().positive().max(1_536_000).optional(),
    sampleRate: z.number().int().min(8000).max(192_000).optional(),
    channels: z.number().int().min(1).max(8).optional(),
    range: z
      .object({ start: z.number().min(0), end: z.number().positive() })
      .refine((r) => r.end > r.start, "range.end must be after range.start")
      .optional(),
  })
  .strict();

export type RenderOverrides = z.infer<typeof renderOptionsSchema>;

/** Merge preset + overrides into full ExportOptions for `project`. */
export function resolveRenderOptions(project: Project, preset: PresetName | undefined, overrides: RenderOverrides = {}): ExportOptions {
  const base: { format: RenderFormat; height?: number; quality?: ExportOptions["quality"] } = PRESETS[preset ?? "mp4"];
  const format = overrides.format ?? base.format;
  const aspect = project.width / project.height;
  let width = overrides.width;
  let height = overrides.height ?? (overrides.width === undefined ? base.height : undefined);
  if (width === undefined && height === undefined) {
    width = project.width;
    height = project.height;
  } else if (width === undefined && height !== undefined) {
    width = even(height * aspect);
  } else if (height === undefined && width !== undefined) {
    height = even(width / aspect);
  }
  const options: ExportOptions = {
    format,
    width: even(width ?? project.width),
    height: even(height ?? project.height),
    fps: overrides.fps ?? { num: project.fps.num, den: project.fps.den },
  };
  const quality = overrides.quality ?? base.quality;
  if (quality) options.quality = quality;
  if (overrides.videoBitrate) options.videoBitrate = overrides.videoBitrate;
  if (overrides.audioBitrate) options.audioBitrate = overrides.audioBitrate;
  if (overrides.sampleRate) options.sampleRate = overrides.sampleRate;
  if (overrides.channels) options.channels = overrides.channels;
  if (overrides.range) options.range = overrides.range;
  return options;
}
