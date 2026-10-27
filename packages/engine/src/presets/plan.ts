/**
 * The export plan: everything export_video_tool renders, resolved and
 * validated without side effects, the same way on every surface.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export_render.py (`build_export_plan`,
 * `resolve_preset`, `_pick_profile`, `_project_record`, `_channels_arg`,
 * `_timeline_bounds`, `_selection_bounds`, `_summary_of`): the target
 * resolves like the Export dialog's Simple tab (preset → container, codecs,
 * Low/Med/High rates and the profiles it allows; All Formats bitrates follow
 * the frame), then the call's Advanced overrides and the ones
 * set_export_setting_tool stored (`project.export_overrides`) apply, and the
 * range is the whole timeline (first clip to last), the selected clips or
 * start/end seconds, in frames of the export's rate.
 *
 * What only the host knows comes in `ExportPlanContext` (the profiles a
 * request can name, the selection, the default file name and folder, whether
 * output_path is a folder). Whether the host can encode the plan is the
 * caller's check (`ExportHost.supports`), as the desktop asks libopenshot.
 */

import { CHANNEL_LAYOUTS, channelLayoutNamed } from "../model/channel-layouts.js";
import { matchProfile, profileCatalog, ProfileRequestError, resolveProfileRequest, sizeFor, socialPreset } from "../model/profile-requests.js";
import { aspectText, profileFpsFraction, type CatalogProfile } from "../model/profiles.js";
import { pyRound } from "../model/rounding.js";
import { audioCutNote, defaultExportEnd } from "../timeline/export-end.js";
import type { Fraction, Project } from "../model/types.js";
import { pyFixed, pyReprString } from "../tools/pyfmt.js";
import type { ContainerFormat } from "../tools/types.js";
import {
  EXPORT_PRESETS,
  allFormatsBitrate,
  isQualityModeRate,
  parseExportRate,
  presetExportType,
  presetQualities,
  type ExportPreset,
  type ExportType,
  type PresetQuality,
  type PresetRates,
} from "./catalog.js";
import { crfZeroIsLossless, exportContainer, isSequenceFormat, type PresetExportOptions } from "./export.js";

/** A plan's export type, by the tool's names. */
export type PlanExportType = "video_audio" | "video_only" | "audio_only" | "image_sequence";
export type PlanRange = "whole" | "selection" | "custom";

/** `_TYPE_LABELS`: the tool's export types and the dialog's "Export To" labels. */
export const EXPORT_TYPE_LABELS: Readonly<Record<PlanExportType, ExportType>> = {
  video_audio: "Video & Audio",
  video_only: "Video Only",
  audio_only: "Audio Only",
  image_sequence: "Image Sequence",
};

const TYPE_OF_LABEL: Readonly<Record<string, PlanExportType>> = Object.fromEntries(
  Object.entries(EXPORT_TYPE_LABELS).map(([type, label]) => [label, type as PlanExportType]),
);

/** The export type a key ("video_only") or the dialog's label ("Video Only") names, or undefined. */
export function planExportType(text: unknown): PlanExportType | undefined {
  const value = String(text ?? "").trim();
  if (Object.hasOwn(TYPE_OF_LABEL, value)) return TYPE_OF_LABEL[value];
  const key = norm(value);
  return Object.hasOwn(EXPORT_TYPE_LABELS, key) ? (key as PlanExportType) : undefined;
}

/** A request no plan answers; the message is the desktop's ToolError text. */
export class ExportPlanError extends Error {
  override readonly name = "ExportPlanError";
}

/** What a call asks for (export_video_tool's arguments; unset = the stored override, else the preset's). */
export interface ExportRequest {
  preset?: string;
  quality?: string;
  /** "auto" (the preset's), video_audio, video_only, audio_only, image_sequence. */
  exportType?: string;
  /** "" (custom when start/end are given or stored, else whole), whole, selection, custom. */
  range?: string;
  start?: number;
  end?: number;
  outputPath?: string;
  folder?: string;
  fileName?: string;
  profile?: string;
  width?: number;
  height?: number;
  fps?: number;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  videoBitrate?: string;
  audioBitrate?: string;
  sampleRate?: number;
  channels?: string;
  interlaced?: boolean;
  imageFormat?: string;
}

/** What only the host knows. */
export interface ExportPlanContext {
  /** Profiles a request can name, custom ones first (`profileCatalog`). Default: the built-in ones. */
  catalog?: readonly CatalogProfile[];
  /** Clips selected in the editor (range = selection). */
  selectedClipIds?: readonly string[];
  /** The name an export gets when the call names none (the desktop: the project file's name). Default "Untitled Project". */
  defaultName?: string;
  /** The folder an export goes to when the call names none (the desktop: its Export folder preference). Default "": the host's. */
  defaultFolder?: string;
  /** output_path names an existing folder (the host looked). */
  outputIsFolder?: boolean;
}

/** `build_export_plan`'s result, with the desktop's keys. */
export interface ExportPlan {
  preset: string;
  preset_category: string;
  quality: PresetQuality;
  export_type: PlanExportType;
  /** Output path as the call gave it (relative paths start at the host's folder); an image sequence has a `%05d` pattern. */
  path: string;
  /** Container (FFmpeg muxer / extension), or the image type of a sequence. */
  vformat: string;
  vcodec: string;
  acodec: string;
  width: number;
  height: number;
  fps_num: number;
  fps_den: number;
  fps: number;
  pixel_ratio: Fraction;
  video_bitrate: string;
  audio_bitrate: string;
  sample_rate: number;
  channels: number;
  channel_layout: number;
  interlaced: boolean;
  start_seconds: number;
  end_seconds: number;
  /** 1-based, at the export's frame rate (inclusive). */
  start_frame: number;
  end_frame: number;
  range: PlanRange;
  profile: string;
  notes: string[];
}

/** `_summary_of`: the plan keys a receipt carries. */
export const PLAN_SUMMARY_KEYS = [
  "preset",
  "quality",
  "export_type",
  "path",
  "vformat",
  "vcodec",
  "acodec",
  "width",
  "height",
  "fps",
  "video_bitrate",
  "audio_bitrate",
  "sample_rate",
  "channels",
  "start_seconds",
  "end_seconds",
  "start_frame",
  "end_frame",
  "range",
  "profile",
] as const satisfies readonly (keyof ExportPlan)[];

export function planSummary(plan: ExportPlan): Record<(typeof PLAN_SUMMARY_KEYS)[number], unknown> {
  return Object.fromEntries(PLAN_SUMMARY_KEYS.map((key) => [key, plan[key]])) as Record<(typeof PLAN_SUMMARY_KEYS)[number], unknown>;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** `_PRESET_ALIASES`: everyday names for export targets → preset titles. */
const PRESET_ALIASES: Readonly<Record<string, string>> = {
  mp4: "MP4 (h.264)",
  h264: "MP4 (h.264)",
  "h.264": "MP4 (h.264)",
  x264: "MP4 (h.264)",
  video: "MP4 (h.264)",
  default: "MP4 (h.264)",
  hevc: "MP4 (h.265)",
  h265: "MP4 (h.265)",
  "h.265": "MP4 (h.265)",
  gif: "GIF (animated)",
  animated_gif: "GIF (animated)",
  mp3: "MP3 (audio only)",
  audio: "MP3 (audio only)",
  audio_only: "MP3 (audio only)",
  webm: "WEBM (vp9)",
  vp9: "WEBM (vp9)",
  prores: "MOV (ProRes 422)",
  mov: "MOV (h.264)",
  quicktime: "MOV (h.264)",
  mkv: "MKV (h.264)",
  avi: "AVI (h.264)",
  ogg: "OGG (theora/vorbis)",
  ogv: "OGG (theora/vorbis)",
  av1: "MP4 (AV1 svt)",
  lossless: "MP4 (h.264) lossless",
  dvd: "DVD-NTSC",
  youtube_4k: "YouTube (4K)",
  youtube_2k: "YouTube (2K)",
  youtube_8k: "YouTube (8K)",
  twitter: "Twitter / X",
  x: "Twitter / X",
  instagram_reels: "Instagram Reels",
  reels: "Instagram Reels",
};

/** `_norm`: lower case, runs of space / - / slash become one underscore. */
function norm(text: unknown): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const pyCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `resolve_preset`: a preset by title, everyday name ("webm", "prores"), social name ("tiktok", "reels") or title words. */
export function resolveExportPreset(name: string): ExportPreset {
  const text = String(name ?? "").trim();
  const byTitle = new Map<string, ExportPreset>();
  for (const p of EXPORT_PRESETS) if (!byTitle.has(p.title.toLowerCase())) byTitle.set(p.title.toLowerCase(), p);
  const direct = byTitle.get(text.toLowerCase());
  if (direct) return direct;
  const alias = PRESET_ALIASES[norm(text)] ?? socialPreset(text)?.exportPreset;
  const aliased = alias ? byTitle.get(alias.toLowerCase()) : undefined;
  if (aliased) return aliased;
  const tokens = text.toLowerCase().split(/[\s,()]+/).filter(Boolean);
  const hits = tokens.length > 0 ? EXPORT_PRESETS.filter((p) => tokens.every((t) => p.title.toLowerCase().includes(t))) : [];
  const titles = [...new Set(hits.map((h) => h.title))];
  if (titles.length === 1) return hits[0]!;
  if (hits.length > 0) throw new ExportPlanError(`'${text}' matches several presets: ${titles.sort(pyCompare).join(", ")}`);
  throw new ExportPlanError(
    `no export preset matches '${text}'. Try 'MP4 (h.264)', 'YouTube', 'Instagram Reels', 'TikTok', 'YouTube Shorts', 'GIF', 'MP3', 'WEBM', 'ProRes' (list_export_presets_tool lists all)`,
  );
}

function rateFor(rates: PresetRates, quality: PresetQuality): string {
  return quality === "Low" ? rates.low : quality === "Med" ? rates.med : rates.high;
}

// ---------------------------------------------------------------------------
// Stored overrides
// ---------------------------------------------------------------------------

/** The overrides set_export_setting_tool keeps, by the desktop's storage keys. */
export interface StoredExportOverrides {
  preset?: string;
  quality?: string;
  /** The dialog's label ("Video Only"). */
  export_type?: string;
  width?: number;
  height?: number;
  fps_num?: number;
  fps_den?: number;
  start_frame?: number;
  end_frame?: number;
  video_codec?: string;
  audio_codec?: string;
  vformat?: string;
  video_bitrate?: string;
  audio_bitrate?: string;
  sample_rate?: number;
  channels?: number;
  channel_layout?: number;
  output_path?: string;
  folder?: string;
  file_name?: string;
  image_format?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Python `int(value)` for a stored number or numeric text; undefined when it is neither. */
function toInt(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/** A frame rate as `{num, den}`, or undefined. */
function rateFraction(value: unknown): Fraction | undefined {
  const rate = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!(rate > 0) || !Number.isFinite(rate)) return undefined;
  return profileFpsFraction(rate);
}

/**
 * The stored overrides (`{k: v for k, v in overrides if v not in (None, "")}`),
 * also read where an earlier web version of set_export_setting_tool stored a
 * key under its own name (fps, start, end, container, an export_type key, a
 * channel count without its layout), so those projects keep exporting as set.
 */
export function storedExportOverrides(project: Project): StoredExportOverrides {
  const raw = isRecord(project.export_overrides) ? project.export_overrides : {};
  const ov: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (value !== null && value !== undefined && value !== "") ov[key] = value;
  const out: StoredExportOverrides = {};
  for (const key of ["preset", "quality", "video_codec", "audio_codec", "vformat", "video_bitrate", "audio_bitrate", "output_path", "folder", "file_name", "image_format"] as const) {
    const text = toText(ov[key]);
    if (text !== undefined) out[key] = text;
  }
  for (const key of ["width", "height", "fps_num", "fps_den", "start_frame", "end_frame", "sample_rate", "channels", "channel_layout"] as const) {
    const n = toInt(ov[key]);
    if (n !== undefined) out[key] = n;
  }
  const type = planExportType(ov.export_type);
  if (type) out.export_type = EXPORT_TYPE_LABELS[type];
  // Older web keys.
  if (out.vformat === undefined && toText(ov.container) !== undefined) out.vformat = toText(ov.container);
  if (out.fps_num === undefined && out.fps_den === undefined) {
    const fps = rateFraction(ov.fps);
    if (fps) [out.fps_num, out.fps_den] = [fps.num, fps.den];
  }
  const pfps = projectRate(project);
  for (const [key, frameKey, first] of [["start", "start_frame", 1], ["end", "end_frame", 0]] as const) {
    if (out[frameKey] !== undefined) continue;
    const seconds = Number.parseFloat(String(ov[key] ?? "").replace(/s$/i, ""));
    if (Number.isFinite(seconds) && seconds >= 0) out[frameKey] = Math.max(1, pyRound(seconds * pfps) + first);
  }
  if (out.channels !== undefined && out.channel_layout === undefined) {
    const layout = channelLayoutNamed(String(out.channels));
    if (layout) out.channel_layout = CHANNEL_LAYOUTS[layout][0];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Profiles, range, paths
// ---------------------------------------------------------------------------

function projectFraction(project: Project): Fraction {
  const fps: Record<string, unknown> = isRecord(project.fps) ? project.fps : {};
  return { num: Math.trunc(Number(fps.num) || 30), den: Math.trunc(Number(fps.den) || 1) };
}

function projectRate(project: Project): number {
  const fps = projectFraction(project);
  return fps.num / fps.den;
}

/** `_project_record`: the catalog profile the project uses, else one of its size and rate, else its own values. */
function projectRecord(project: Project, catalog: readonly CatalogProfile[]): CatalogProfile {
  const width = Math.trunc(Number(project.width) || 0);
  const height = Math.trunc(Number(project.height) || 0);
  const description = String(project.profile ?? "");
  const fps = projectFraction(project);
  const same = catalog.find((p) => p.description === description && p.width === width && p.height === height);
  if (same) return same;
  const found = matchProfile(catalog, width, height, fps.num / fps.den);
  if (found) return found;
  const ratio = (value: unknown, fallback: Fraction): Fraction =>
    isRecord(value) ? { num: Math.trunc(Number(value.num) || fallback.num), den: Math.trunc(Number(value.den) || fallback.den) } : fallback;
  return {
    key: "",
    description,
    width,
    height,
    fps,
    progressive: true,
    pixel_ratio: ratio(project.pixel_ratio, { num: 1, den: 1 }),
    display_ratio: ratio(project.display_ratio, { num: 16, den: 9 }),
    user: false,
  };
}

const rateOf = (p: { fps: Fraction }): number => p.fps.num / p.fps.den;

/** Resolution classes ("1080p", "4k") by their short side; they say nothing about orientation. */
const RESOLUTION_CLASSES: Readonly<Record<string, number>> = {
  "720p": 720, hd_720p: 720, "1080p": 1080, fhd: 1080, full_hd: 1080, "1440p": 1440, qhd: 1440, "2k": 1440, "2160p": 2160, "4k": 2160, uhd: 2160,
};

/**
 * The short side a resolution class means ("1080p", "mp4-1080p", "4K"), or
 * null. On a landscape project only the "mp4-" form (Zenvi Cloud's preset
 * names) counts: a bare "1080p" there stays the desktop's YouTube alias.
 */
function resolutionClass(text: string, landscape: boolean): number | null {
  const key = norm(text);
  if (landscape && !key.startsWith("mp4_")) return null;
  return RESOLUTION_CLASSES[key.replace(/^mp4_/, "")] ?? null;
}

/** The longest side Zenvi's renderers take (render-node's limit is 16384; browsers' encoders stop near 8192). */
const MAX_EXPORT_SIDE = 8192;

/**
 * A profile with the project's shape and a `side`-pixel short side
 * ("1080p" on a 9:16 project is 1080x1920, never 608x1080), at the project's
 * rate; refuses in words when that frame is too large.
 */
function shortSideProfile(project: Project, record: CatalogProfile, catalog: readonly CatalogProfile[], side: number, asked: string): CatalogProfile {
  const [pw, ph] = [record.width, record.height];
  const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
  const [w, h] = pw >= ph ? [even((side * pw) / ph), side] : [side, even((side * ph) / pw)];
  if (Math.max(w, h) > MAX_EXPORT_SIDE) {
    throw new ExportPlanError(
      `'${asked}' means a ${side}-pixel short side, which on this ${pw}x${ph} project is ${w}x${h}, larger than Zenvi renders ` +
        `(${MAX_EXPORT_SIDE} pixels on the long side); pick a smaller size or pass width/height`,
    );
  }
  const found = sizeFor({ catalog, projectFps: projectRate(project) }, w, h, projectRate(project));
  return found ? found.profile : { ...record, width: w, height: h };
}

/** `_pick_profile`: the profile the Simple tab would pick for a preset (the closest it allows), plus a note when it re-frames. */
function pickProfile(preset: ExportPreset, record: CatalogProfile, catalog: readonly CatalogProfile[]): [CatalogProfile, string | null] {
  const allowed = preset.profiles;
  if (allowed.length === 0) return [record, null];
  const byDescription = new Map<string, CatalogProfile>();
  for (const p of catalog) if (!byDescription.has(p.description)) byDescription.set(p.description, p);
  const options = allowed.filter((name) => byDescription.has(name)).map((name) => byDescription.get(name)!);
  if (options.length === 0) return [record, null];
  if (allowed.includes(record.description)) return [byDescription.get(record.description) ?? record, null];
  const [pw, ph] = [record.width, record.height];
  const pfps = rateOf(record);
  const paspect = pw / ph;
  const fpsGap = (p: CatalogProfile): number => Math.abs(rateOf(p) - pfps);
  const buckets = [
    options.filter((p) => p.width === pw && p.height === ph),
    options.filter((p) => Math.abs(p.width / p.height - paspect) < 0.01),
    options.filter((p) => p.width > p.height === pw > ph && (p.width === p.height) === (pw === ph)),
    options,
  ];
  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    // Python's sort is stable: ties keep the preset's order.
    const best = bucket
      .map((p, i) => ({ p, i }))
      .sort((a, b) => fpsGap(a.p) - fpsGap(b.p) || b.p.width * b.p.height - a.p.width * a.p.height || a.i - b.i)[0]!.p;
    let note: string | null = null;
    if (Math.abs(best.width / best.height - paspect) > 0.01) {
      const sizes = [...new Set(options.map((o) => `${o.width}x${o.height}`))].sort(pyCompare).join(", ");
      note =
        `'${preset.title}' only renders ${sizes}; exporting ${best.width}x${best.height} from a ${pw}x${ph} project re-frames every clip ` +
        "(bars on 'fit' clips, crops on 'fill' clips). For a proper vertical/square edit switch the project with set_project_profile_tool " +
        "(reframe='fill') first, or pass profile= to keep the project size";
    }
    return [best, note];
  }
  return [record, null];
}

/** `_timeline_bounds`: first clip start to last clip end, or null on an empty timeline. */
export function clipBounds(project: Project, ids?: ReadonlySet<string>): [number, number] | null {
  const clips = (project.clips ?? []).filter((c) => !ids || ids.has(c.id));
  if (clips.length === 0) return null;
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const c of clips) {
    const position = Number(c.position) || 0;
    start = Math.min(start, position);
    end = Math.max(end, position + Math.max(0, (Number(c.end) || 0) - (Number(c.start) || 0)));
  }
  return [start, end];
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** `os.path.splitext`: [root, ext] of the last path component (leading dots are not an extension). */
function splitExt(path: string): [string, string] {
  const name = baseName(path);
  const leading = /^\.*/.exec(name)![0].length;
  const dot = name.lastIndexOf(".");
  if (dot < leading) return [path, ""];
  const cut = path.length - (name.length - dot);
  return [path.slice(0, cut), path.slice(cut)];
}

/** `os.path.join(folder, name)`: an absolute name wins; "" = no folder. */
function joinPath(folder: string, name: string): string {
  if (!folder || /^([\\/]|[A-Za-z]:[\\/]|~)/.test(name)) return name;
  if (/[\\/]$/.test(folder)) return folder + name;
  return `${folder}${folder.includes("\\") && !folder.includes("/") ? "\\" : "/"}${name}`;
}

/** `_RATE_RE`. */
const RATE_RE = /^\s*\d+(\.\d+)?\s*(kb\/s|mb\/s|crf|cqp|qp)\s*$/i;

/** `_AUDIO_CONTAINERS`: the audio codec an audio-only container gets when none is named. */
const AUDIO_CONTAINERS: Readonly<Record<string, string>> = {
  wav: "pcm_s16le",
  flac: "flac",
  mp3: "libmp3lame",
  m4a: "aac",
  ogg: "libvorbis",
  aac: "aac",
};

const IMAGE_FORMATS = ["png", "jpg", "jpeg", "bmp", "tiff", "ppm"] as const;

/** `str.capitalize`. */
function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1).toLowerCase() : text;
}

/** `round(x, 3)`. */
function r3(x: number): number {
  return Number(pyFixed(x, 3));
}

/** Python truthiness for the request's optional values (NaN, an unreadable number, counts as unset). */
function given<T>(value: T | undefined | null): value is T {
  if (value === undefined || value === null || (value as unknown) === "" || (value as unknown) === false) return false;
  return typeof value !== "number" || (value !== 0 && !Number.isNaN(value));
}

function firstGiven<T>(...values: (T | undefined | null)[]): T | undefined {
  return values.find((v): v is T => given(v));
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * `build_export_plan`: the export a request asks for, or `ExportPlanError`
 * with the desktop's words. Pure.
 */
export function planExport(project: Project, request: ExportRequest = {}, context: ExportPlanContext = {}): ExportPlan {
  const catalog = context.catalog ?? profileCatalog();
  const ov = storedExportOverrides(project);
  const notes: string[] = [];

  const presetText = firstGiven(request.preset?.trim(), ov.preset) ?? "MP4 (h.264)";
  // "1080p" names the short side: on a vertical or square project it is not the landscape YouTube preset.
  const landscape = Number(project.width) > Number(project.height);
  const presetSide = resolutionClass(presetText, landscape);
  const p = resolveExportPreset(presetSide ? "MP4 (h.264)" : presetText);
  const qualities = presetQualities(p);
  const offered: PresetQuality[] = qualities.length > 0 ? qualities : ["High"];
  let q = capitalize((firstGiven(request.quality, ov.quality) ?? "high").trim()) as PresetQuality;
  if (!offered.includes(q)) {
    notes.push(`'${p.title}' has no ${q} quality; using ${offered[offered.length - 1]}`);
    q = offered[offered.length - 1]!;
  }

  const asked = request.exportType && request.exportType !== "auto" ? planExportType(request.exportType) : undefined;
  if (request.exportType && request.exportType !== "auto" && !asked) {
    throw new ExportPlanError("export_type must be auto, video_audio, video_only, audio_only or image_sequence");
  }
  let etype: PlanExportType = asked ?? planExportType(ov.export_type) ?? TYPE_OF_LABEL[presetExportType(p)] ?? "video_audio";

  // Video profile: explicit > stored size/rate > the preset's allowed list (Simple tab).
  const record = projectRecord(project, catalog);
  let prof: CatalogProfile;
  // An explicit profile wins over the preset's resolution class.
  const side = request.profile?.trim() ? resolutionClass(request.profile, landscape) : presetSide;
  if (side) {
    prof = shortSideProfile(project, record, catalog, side, request.profile?.trim() || presetText);
  } else if (request.profile?.trim()) {
    try {
      prof = resolveProfileRequest({ catalog, projectFps: projectRate(project) }, request.profile, null).profile;
    } catch (error) {
      if (error instanceof ProfileRequestError) throw new ExportPlanError(error.message);
      throw error;
    }
  } else {
    const [picked, note] = pickProfile(p, record, catalog);
    prof = picked;
    if (note) notes.push(note);
  }
  const w = Math.trunc(firstGiven(request.width, ov.width) ?? prof.width);
  const h = Math.trunc(firstGiven(request.height, ov.height) ?? prof.height);
  let fps: Fraction;
  if (given(request.fps)) fps = profileFpsFraction(request.fps);
  else if (given(ov.fps_num) && given(ov.fps_den)) fps = { num: ov.fps_num, den: ov.fps_den };
  else fps = { num: prof.fps.num, den: prof.fps.den };
  if (w <= 0 || h <= 0 || w % 2 !== 0 || h % 2 !== 0) {
    throw new ExportPlanError(`export size ${w}x${h} is invalid; width and height must be positive even numbers`);
  }
  const fpsValue = fps.num / fps.den;

  // Container and codecs.
  let vformat = (firstGiven(request.container, ov.vformat, p.videoFormat) ?? "mp4").toLowerCase().replace(/^\.+/, "");
  let vcodec = firstGiven(request.videoCodec, ov.video_codec, p.videoCodec) ?? "";
  let acodec = firstGiven(request.audioCodec, ov.audio_codec, p.audioCodec) ?? "";
  const namedAudio = given(request.audioCodec) || given(ov.audio_codec);
  if (etype === "audio_only" && Object.hasOwn(AUDIO_CONTAINERS, vformat) && !namedAudio && vformat !== p.videoFormat.toLowerCase()) {
    acodec = AUDIO_CONTAINERS[vformat]!;
  }
  if (etype === "image_sequence") {
    const image = (firstGiven(request.imageFormat, ov.image_format) ?? "png").toLowerCase().replace(/^\.+/, "");
    if (!(IMAGE_FORMATS as readonly string[]).includes(image)) throw new ExportPlanError("image_format must be png, jpg, bmp, tiff or ppm");
    vformat = image;
    vcodec = image === "jpg" || image === "jpeg" ? "mjpeg" : image;
  }
  if ((etype === "video_audio" || etype === "video_only" || etype === "image_sequence") && !vcodec) {
    throw new ExportPlanError(`'${p.title}' has no video codec; use export_type='audio_only' or another preset`);
  }
  if ((etype === "video_audio" || etype === "audio_only") && !acodec) {
    if (etype === "audio_only") throw new ExportPlanError(`'${p.title}' has no audio codec; pick an audio preset such as 'MP3'`);
    notes.push(`'${p.title}' has no audio; exporting video only`);
    etype = "video_only";
  }

  // Rates.
  let vrate = (firstGiven(request.videoBitrate, ov.video_bitrate, rateFor(p.videoBitrate, q)) ?? "").trim();
  if (!given(request.videoBitrate) && !given(ov.video_bitrate) && p.type === "All Formats" && vrate && !isQualityModeRate(vrate)) {
    vrate = allFormatsBitrate(q, { width: w, height: h, fps }) ?? vrate;
  }
  const arate = (firstGiven(request.audioBitrate, ov.audio_bitrate, rateFor(p.audioBitrate, q)) ?? "192 kb/s").trim();
  for (const [rate, label] of [[vrate, "video_bitrate"], [arate, "audio_bitrate"]] as const) {
    if (rate && !RATE_RE.test(rate)) throw new ExportPlanError(`${label} must look like '8 Mb/s', '192 kb/s' or '23 crf', got ${pyReprString(rate)}`);
  }
  let sr = Math.trunc(firstGiven(request.sampleRate, ov.sample_rate, p.sampleRate, Number(project.sample_rate)) ?? 48000);
  let ch: number;
  let layout: number;
  if (request.channels?.trim()) {
    const named = channelLayoutNamed(request.channels);
    if (!named) throw new ExportPlanError("channels must be mono, stereo, surround, 5.1 or 7.1");
    [layout, ch] = CHANNEL_LAYOUTS[named];
  } else if (given(ov.channels) && given(ov.channel_layout)) {
    [ch, layout] = [ov.channels, ov.channel_layout];
  } else {
    ch = Math.trunc(firstGiven(p.channels, Number(project.channels)) ?? 2);
    layout = Math.trunc(firstGiven(p.channelLayout) ?? 3);
  }
  if (etype === "audio_only" && (!sr || !ch)) [sr, ch, layout] = [sr || 48000, ch || 2, layout || 3];

  // Frame range, in export frames.
  const bounds = clipBounds(project);
  if (!bounds) throw new ExportPlanError("the timeline is empty; add clips before exporting");
  let rmode = (request.range ?? "").trim().toLowerCase() as PlanRange | "";
  if (rmode && !["whole", "selection", "custom"].includes(rmode)) throw new ExportPlanError("range must be whole, selection or custom");
  if (!rmode) rmode = given(request.start) || given(request.end) || given(ov.start_frame) || given(ov.end_frame) ? "custom" : "whole";
  // Video ends with the last picture unless an end is given (timeline/export-end.ts).
  const cut = defaultExportEnd(project, etype !== "audio_only");
  const lastEnd = cut.audioCut > 0 ? cut.end : bounds[1];
  let t0: number;
  let t1: number;
  if (rmode === "whole") [t0, t1] = [bounds[0], lastEnd];
  else if (rmode === "selection") {
    const selected = clipBounds(project, new Set(context.selectedClipIds ?? []));
    if (!selected) throw new ExportPlanError("no clips are selected in the timeline; select some or give start/end seconds");
    [t0, t1] = selected;
  } else {
    const pfps = rateOf(record);
    t0 = given(request.start) ? Number(request.start) : given(ov.start_frame) ? (ov.start_frame - 1) / pfps : 0;
    // A range starting after the last picture is sound only: it runs to the last item.
    t1 = given(request.end) ? Number(request.end) : given(ov.end_frame) ? ov.end_frame / pfps : t0 < lastEnd ? lastEnd : bounds[1];
  }
  const endDefaulted = rmode === "whole" || (rmode === "custom" && !given(request.end) && !given(ov.end_frame));
  if (endDefaulted && t1 === lastEnd) {
    const note = audioCutNote(cut, "end");
    if (note) notes.push(note);
  }
  if (t1 <= t0) throw new ExportPlanError(`the range ends (${pyFixed(t1, 3)}s) before it starts (${pyFixed(t0, 3)}s)`);
  if (t0 >= bounds[1]) throw new ExportPlanError(`the range starts at ${pyFixed(t0, 3)}s, after the last clip ends (${pyFixed(bounds[1], 3)}s)`);
  const startFrame = pyRound(t0 * fpsValue) + 1;
  const endFrame = Math.max(startFrame + 1, pyRound(t1 * fpsValue));

  // Output path (Export dialog rules: folder + file name + extension).
  let ext = vformat;
  let folder = request.folder ?? "";
  let out = firstGiven(request.outputPath?.trim(), ov.output_path?.trim()) ?? "";
  if (out && context.outputIsFolder) [folder, out] = [out, ""];
  if (!out) {
    const baseFolder = firstGiven(folder.trim(), ov.folder?.trim()) ?? context.defaultFolder ?? "";
    const name = firstGiven(request.fileName?.trim(), ov.file_name?.trim()) ?? (context.defaultName?.trim() || "Untitled Project");
    out = joinPath(baseFolder, name);
  }
  if (etype === "image_sequence") {
    const [stem, dotted] = splitExt(out);
    let root = [ext, "png", "jpg"].includes(dotted.toLowerCase().replace(/^\./, "")) ? stem : out;
    if (!baseName(root).includes("%")) root += "-%05d";
    out = `${root}.${ext}`;
  } else {
    const current = splitExt(out)[1].toLowerCase().replace(/^\./, "");
    if (!current || /^\d+$/.test(current)) out = `${out}.${ext}`;
    else if (current !== ext) {
      if (given(request.container?.trim())) out = `${splitExt(out)[0]}.${ext}`;
      else {
        if (current === "gif" && etype !== "audio_only" && vcodec !== "gif") {
          throw new ExportPlanError(`a .gif file needs the GIF preset ('${p.title}' encodes ${vcodec}): pass preset='GIF', or another file extension`);
        }
        vformat = ext = current;
      }
    }
  }

  const projectAspect = record.width / record.height;
  if (Math.abs(w / h - projectAspect) > 0.01 && !notes.some((n) => n.includes("re-frames every clip"))) {
    notes.push(
      `export is ${aspectText(w, h)} but the project is ${aspectText(record.width, record.height)}: each clip is re-framed by its scale mode ` +
        "(bars on 'fit' clips, crops on 'fill' clips)",
    );
  }
  if (Math.abs(fpsValue - rateOf(record)) > 0.01) {
    notes.push(`export frame rate ${pyFixed(fpsValue, 3)} differs from the project's; keyframes are rescaled for the render`);
  }

  const audioOnly = etype === "audio_only";
  return {
    preset: p.title,
    preset_category: p.type,
    quality: q,
    export_type: etype,
    path: out,
    vformat,
    vcodec: audioOnly ? "" : vcodec,
    acodec: etype === "video_audio" || audioOnly ? acodec : "",
    width: w,
    height: h,
    fps_num: fps.num,
    fps_den: fps.den,
    fps: r3(fpsValue),
    pixel_ratio: { num: prof.pixel_ratio.num, den: prof.pixel_ratio.den },
    video_bitrate: audioOnly ? "" : vrate,
    audio_bitrate: arate,
    sample_rate: sr,
    channels: ch,
    channel_layout: layout,
    interlaced: audioOnly ? false : Boolean(request.interlaced),
    start_seconds: r3(t0),
    end_seconds: r3(t1),
    start_frame: startFrame,
    end_frame: endFrame,
    range: rmode,
    profile: prof.description,
    notes: audioOnly ? notes.filter((n) => !n.includes("re-frame") && !n.includes("differs from the project")) : notes,
  };
}

// ---------------------------------------------------------------------------
// From a plan to the engine's exporters
// ---------------------------------------------------------------------------

/** What the engine's exporters write for a plan, or undefined (AVI, MPEG, OGG, DVD, PPM… only Zenvi desktop writes). */
export function planContainer(plan: Pick<ExportPlan, "vformat" | "export_type">): ContainerFormat | undefined {
  return exportContainer(plan.vformat, EXPORT_TYPE_LABELS[plan.export_type]);
}

const QUALITY_OF: Readonly<Record<PresetQuality, NonNullable<PresetExportOptions["quality"]>>> = { Low: "low", Med: "medium", High: "high" };

/**
 * The exporter options for a plan (`_settings_for`): its container, size,
 * rate, codecs, rates and frames start_frame..end_frame as seconds. Video
 * Only and image sequences carry no audio (`channels: 0`), Audio Only no
 * video codec. Undefined when the engine's exporters cannot write the
 * container (`planContainer`).
 */
export function exportOptionsForPlan(plan: ExportPlan): PresetExportOptions | undefined {
  const format = planContainer(plan);
  if (!format) return undefined;
  const fps = { num: plan.fps_num, den: plan.fps_den };
  const rate = fps.num / fps.den;
  const options: PresetExportOptions = {
    format,
    width: plan.width,
    height: plan.height,
    fps,
    quality: QUALITY_OF[plan.quality],
    range: { start: (plan.start_frame - 1) / rate, end: plan.end_frame / rate },
    output: plan.path,
  };
  const sequence = isSequenceFormat(format);
  if (plan.export_type !== "audio_only" && !sequence && format !== "gif") {
    options.videoCodec = plan.vcodec;
    const video = parseExportRate(plan.video_bitrate);
    if (video?.kind === "bitrate") {
      if (video.bitsPerSecond > 0) options.videoBitrate = video.bitsPerSecond;
    } else if (video) {
      options.crf = video.value;
      if (video.value === 0 && crfZeroIsLossless(format, plan.vcodec)) options.quality = "lossless";
    }
  }
  if (plan.export_type === "video_audio" || plan.export_type === "audio_only") {
    options.audioCodec = plan.acodec;
    const audio = parseExportRate(plan.audio_bitrate);
    if (audio?.kind === "bitrate" && audio.bitsPerSecond > 0) options.audioBitrate = audio.bitsPerSecond;
    options.sampleRate = plan.sample_rate;
    options.channels = plan.channels;
  } else if (!sequence && format !== "gif") {
    // "Video Only": no audio stream (libopenshot reads a zero channel count that way).
    options.channels = 0;
  }
  return options;
}
