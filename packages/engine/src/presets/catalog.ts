/**
 * Export presets: zenvi-core src/presets/*.xml, read the way the export
 * dialog's Simple tab reads them (src/windows/export.py
 * `cboSimpleProjectType_index_changed` L568, `cboSimpleTarget_index_changed`
 * L678, `cboSimpleQuality_index_changed` L873, `calculate_all_formats_bitrate`
 * L1878, `update_all_formats_bitrates` L1907, `_parse_bitrate_to_bps` L1937).
 *
 * The dialog hides targets whose video codec the local FFmpeg cannot
 * encode; that check belongs to the host (see `exportContainer`).
 */

import { PROFILES, type Profile } from "../model/profiles.js";
import { pyFixed } from "../tools/pyfmt.js";
import { EXPORT_PRESET_TABLE } from "./export-presets.data.js";

/** The dialog's "Export To" choices, in combo order. */
export const EXPORT_TYPES = ["Video & Audio", "Video Only", "Audio Only", "Image Sequence"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

/** The dialog's quality choices (keys of the preset rate attributes). */
export const PRESET_QUALITIES = ["Low", "Med", "High"] as const;
export type PresetQuality = (typeof PRESET_QUALITIES)[number];

/** Rate text per quality, exactly as the XML has it ("8 Mb/s", "23 crf", "" when not offered). */
export interface PresetRates {
  low: string;
  med: string;
  high: string;
}

export interface ExportPreset {
  /** File name without `.xml`, e.g. `"youtube_HD"`. */
  id: string;
  /** Simple-tab project type: "All Formats", "Web", "Device", "DVD", "Blu-Ray/AVCHD". */
  type: string;
  /** Target name, e.g. `"YouTube"`, `"MP4 (h.264)"`. */
  title: string;
  /** `<export-to>` when the preset forces one (GIF: "Video Only", MP3: "Audio Only"). */
  exportTo: string | null;
  /** FFmpeg muxer, e.g. "mp4", "webm", "gif", "mp3", "dvd". */
  videoFormat: string;
  /** FFmpeg encoder; "" when the preset has no video. */
  videoCodec: string;
  /** FFmpeg encoder; "" when the preset has no audio. */
  audioCodec: string;
  channels: number;
  /** FFmpeg channel layout (3 = stereo). */
  channelLayout: number;
  sampleRate: number;
  videoBitrate: PresetRates;
  audioBitrate: PresetRates;
  /** Profile descriptions the target allows (`model/profiles`); empty = any profile. */
  profiles: readonly string[];
}

/** Every desktop export preset, sorted by file name. */
export const EXPORT_PRESETS: readonly ExportPreset[] = EXPORT_PRESET_TABLE;

/** The project type listed first and selected by default. */
export const ALL_FORMATS = "All Formats";

/** The target the dialog selects by default. */
export const DEFAULT_EXPORT_PRESET: ExportPreset = EXPORT_PRESETS.find((p) => p.title === "MP4 (h.264)")!;

/** A preset by id (`"youtube_HD"`) or title (`"YouTube"`), case-insensitively. */
export function getExportPreset(ref: string): ExportPreset | undefined {
  const key = (ref ?? "").trim().toLowerCase();
  return EXPORT_PRESETS.find((p) => p.id.toLowerCase() === key) ?? EXPORT_PRESETS.find((p) => p.title.toLowerCase() === key);
}

const pyCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The project-type combo: "All Formats" first, then the other types sorted. */
export function exportPresetTypes(): string[] {
  const others = [...new Set(EXPORT_PRESETS.map((p) => p.type))].filter((t) => t !== ALL_FORMATS).sort(pyCompare);
  return [ALL_FORMATS, ...others];
}

/** The target combo for a project type, sorted by title. */
export function exportPresetsOfType(type: string): ExportPreset[] {
  return EXPORT_PRESETS.filter((p) => p.type === type).sort((a, b) => pyCompare(a.title, b.title));
}

/**
 * The dialog's profile list: every profile file in src/profiles (not
 * legacy/), in reverse file-name order, labelled "<description> (<w>x<h>)"
 * (export.py L267-292).
 */
const DIALOG_PROFILES: readonly { profile: Profile; label: string }[] = PROFILES.filter((p) => !p.legacy)
  .sort((a, b) => pyCompare(b.key, a.key))
  .map((profile) => ({ profile, label: `${profile.description} (${profile.width}x${profile.height})` }));

/**
 * The Simple tab's profile combo for a preset: its `<projectprofile>` names,
 * sorted, each resolved like `getProfilePath` (the first dialog profile whose
 * label contains the name, so "NTSC SD Anamorphic 480i 29.97 fps" finds the
 * "… | 4:3" profile); every profile when the preset lists none. Names no
 * profile matches are dropped (the desktop shows an empty entry for them).
 */
export function presetProfiles(preset: ExportPreset): Profile[] {
  if (preset.profiles.length === 0) return DIALOG_PROFILES.map((p) => p.profile);
  const out: Profile[] = [];
  for (const name of [...preset.profiles].sort(pyCompare)) {
    const match = DIALOG_PROFILES.find((p) => p.label.includes(name));
    if (match) out.push(match.profile);
  }
  return out;
}

/**
 * The profile the dialog selects for a preset: the project's own profile
 * when the preset allows it, otherwise the first allowed one.
 */
export function presetProfileFor(preset: ExportPreset, projectProfile: string): Profile | undefined {
  const allowed = presetProfiles(preset);
  return allowed.find((p) => p.description === projectProfile) ?? allowed[0];
}

/** The export type a preset selects (`<export-to>`, default "Video & Audio"). */
export function presetExportType(preset: ExportPreset): ExportType {
  return (EXPORT_TYPES as readonly string[]).includes(preset.exportTo ?? "") ? (preset.exportTo as ExportType) : "Video & Audio";
}

function rateFor(rates: PresetRates, quality: PresetQuality): string {
  return quality === "Low" ? rates.low : quality === "Med" ? rates.med : rates.high;
}

/** The quality combo: the levels with a video or audio rate. */
export function presetQualities(preset: ExportPreset): PresetQuality[] {
  return PRESET_QUALITIES.filter((q) => rateFor(preset.videoBitrate, q) !== "" || rateFor(preset.audioBitrate, q) !== "");
}

/** The dialog's default quality: the highest the preset offers. */
export function defaultPresetQuality(preset: ExportPreset): PresetQuality {
  const offered = presetQualities(preset);
  return offered[offered.length - 1] ?? "High";
}

export type ExportRate =
  /** Bits per second ("8 Mb/s", "192 kb/s"). */
  | { kind: "bitrate"; bitsPerSecond: number }
  /** Constant quality / quantizer ("23 crf", "22 cqp", "38 qp"). */
  | { kind: "crf" | "cqp" | "qp"; value: number };

/**
 * `_parse_bitrate_to_bps` without the fallback: `"3.32 Mb/s"` → 3 320 000 b/s,
 * `"500 kb/s"` → 500 000, `"23 crf"` → crf 23 (crf/cqp clamped 0-63, qp
 * 0-255), a number → that many b/s. Null for empty or unreadable values.
 */
export function parseExportRate(value: unknown): ExportRate | null {
  if (typeof value === "number") return Number.isFinite(value) ? { kind: "bitrate", bitsPerSecond: Math.trunc(value) } : null;
  if (typeof value !== "string") return null;
  const parts = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const raw = parts[0] === undefined ? Number.NaN : Number(parts[0]);
  if (!Number.isFinite(raw)) return null;
  const unit = parts[1];
  if (unit !== undefined) {
    if (unit.includes("kb")) return { kind: "bitrate", bitsPerSecond: Math.trunc(raw * 1000.0) };
    if (unit.includes("mb")) return { kind: "bitrate", bitsPerSecond: Math.trunc(raw * 1000.0 * 1000.0) };
    if (unit.includes("crf") || unit.includes("cqp")) {
      return { kind: unit.includes("crf") ? "crf" : "cqp", value: Math.trunc(Math.max(0, Math.min(63, raw))) };
    }
    if (unit.includes("qp")) return { kind: "qp", value: Math.trunc(Math.max(0, Math.min(255, raw))) };
  }
  return { kind: "bitrate", bitsPerSecond: Math.trunc(raw) };
}

/** `_is_quality_mode_rate`: the rate text is crf/cqp/qp rather than a bitrate. */
export function isQualityModeRate(text: string | null | undefined): boolean {
  const t = (text ?? "").trim().toLowerCase();
  return t.includes(" crf") || t.includes(" cqp") || t.includes(" qp");
}

/** Bits per pixel per quality for "All Formats" bitrate presets (export.py L1880). */
const ALL_FORMATS_BPP: Record<PresetQuality, number> = { Low: 0.055, Med: 0.08, High: 0.12 };

export interface FrameFormat {
  width: number;
  height: number;
  fps: { num: number; den: number };
}

/**
 * `calculate_all_formats_bitrate`: width × height × fps × bits-per-pixel,
 * as `"4.98 Mb/s"`. Null when a dimension or the rate is zero.
 */
export function allFormatsBitrate(quality: PresetQuality, frame: FrameFormat): string | null {
  const fps = frame.fps.num / (frame.fps.den || 1);
  if (!frame.width || !frame.height || !fps) return null;
  const bitsPerSecond = frame.width * frame.height * fps * ALL_FORMATS_BPP[quality];
  return `${pyFixed(bitsPerSecond / 1_000_000.0, 2)} Mb/s`;
}

/**
 * The video and audio rate text the dialog fills in for a preset at a
 * quality. "All Formats" presets that use bitrates (not crf/qp) get a
 * bitrate scaled to the frame size and rate (`update_all_formats_bitrates`).
 */
export function presetRates(preset: ExportPreset, quality: PresetQuality, frame: FrameFormat): { video: string; audio: string } {
  let video = rateFor(preset.videoBitrate, quality);
  const audio = rateFor(preset.audioBitrate, quality);
  const qualityMode = [preset.videoBitrate.low, preset.videoBitrate.med, preset.videoBitrate.high].some(isQualityModeRate);
  if (preset.type === ALL_FORMATS && !qualityMode && !isQualityModeRate(video)) {
    video = allFormatsBitrate(quality, frame) ?? video;
  }
  return { video, audio };
}
