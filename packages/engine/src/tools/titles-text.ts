/**
 * Helpers shared by the titles-and-text tools (titles, captions, timers,
 * emoji): a port of zenvi-core src/classes/editor_tools/titles_text_common.py
 * and the parts of editor_tools/_base.py they use (colours, keyframes, track
 * references, refusals). Everything here reads the project; the edits go
 * through ops (`placeOverlayClip`, `replaceClipEffects`, …).
 *
 * Fonts: the desktop checks names against Qt's font database. Here the list
 * is the host renderer's (`FrameHost.fontFamilies`: the fonts render-node
 * draws SVG titles with on the CLI and in Zenvi Cloud). The web editor's
 * browser does not disclose its fonts, so there a font is taken as given,
 * which is what the desktop does when Qt cannot tell
 * (`installed_font_families()` is None).
 */

import type { ColorKeyframe, Clip, Keyframe, Layer, Project, ProjectFile } from "../model/types.js";
import { Interpolation } from "../model/types.js";
import { makeKeyframePoint } from "../keyframe/edit.js";
import { pyRound } from "../model/rounding.js";
import { addFile, updateFile } from "../ops/files.js";
import { snapSeconds } from "../ops/internal.js";
import { isVisualClip } from "../timeline/export-end.js";
import type { Transaction } from "../history/document.js";
import type { ToolCall, ToolOutcome } from "./define.js";
import { getCloseMatches } from "./difflib.js";
import { projectFps } from "./frame-time.js";
import { pyFixed, pyReprString } from "./pyfmt.js";
import { refused } from "./receipt.js";
import { buildTrackStack, formatTrackLabelForLlm, normalizeTrackOrLayerArg, resolvePlacementTrack, type TrackResolution } from "./tracks.js";
import type { ImportedMedia } from "./types.js";

// ---------------------------------------------------------------------------
// Refusals (_base.ToolError / fail)
// ---------------------------------------------------------------------------

/** A caller problem or an impossible request (`ToolError`); the tool answers "Error: <message>". */
export class TextToolError extends Error {
  override readonly name = "TextToolError";
}

/** Refuse the call (`raise ToolError(message)`). */
export function toolError(message: string): never {
  throw new TextToolError(message);
}

/** `_base.fail`: whitespace collapsed, "Error: " in front unless the message has it. */
export function errorText(message: string): string {
  const collapsed = message.split(/\s+/).filter(Boolean).join(" ");
  return collapsed.startsWith("Error") ? collapsed : `Error: ${collapsed}`;
}

/** Run a tool body; a `TextToolError` becomes a refused receipt, history untouched. */
export async function guarded(tool: string, body: () => Promise<ToolOutcome> | ToolOutcome): Promise<ToolOutcome> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof TextToolError) return refused(tool, errorText(error.message));
    throw error;
  }
}

/** `_base.ok`'s summary line: whitespace collapsed. */
export function summaryLine(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

/** Python `round(x, digits)` (correctly rounded, ties to even on the binary value). */
export function pyRoundTo(x: number, digits: number): number {
  const value = Number(pyFixed(x, digits));
  return value === 0 ? 0 : value;
}

// ---------------------------------------------------------------------------
// Colours and keyframes (_base.parse_color, keyframe, titles_text_common)
// ---------------------------------------------------------------------------

export type Rgba = [number, number, number, number];

const COLOR_NAMES: Readonly<Record<string, string>> = {
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  orange: "#ffa500",
  purple: "#800080",
  pink: "#ffc0cb",
  gray: "#808080",
  grey: "#808080",
  transparent: "#00000000",
};

/** Python `float(text)` for the rgb() parts (finite values; null where Python raises). */
function pyFloat(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return null;
  return Number(t);
}

/**
 * `_base.parse_color`: '#RGB[A]', '#RRGGBB[AA]', 'rgb(r,g,b[,a])' / 'rgba(…)'
 * or a basic colour name → channels 0-255. An alpha of at most 1 in rgb() is
 * a fraction.
 */
export function parseEditorColor(value: unknown): Rgba {
  const raw = String(value ?? "").trim();
  const s = COLOR_NAMES[raw.toLowerCase()] ?? raw;
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join("");
    if ((h.length === 6 || h.length === 8) && /^[0-9a-fA-F]+$/.test(h)) {
      const byte = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16);
      return [byte(0), byte(2), byte(4), h.length === 8 ? byte(6) : 255];
    }
  }
  if (s.toLowerCase().startsWith("rgb") && s.includes("(") && s.includes(")")) {
    const parts = s.slice(s.indexOf("(") + 1, s.lastIndexOf(")")).split(",");
    const nums = parts.map(pyFloat);
    if (nums.length >= 3 && nums.every((n): n is number => n !== null)) {
      const clamp = (n: number): number => Math.max(0, Math.min(255, n));
      const [r, g, b] = nums.slice(0, 3).map((n) => Math.trunc(clamp(pyRound(n)))) as [number, number, number];
      let a = 255;
      if (nums.length > 3) a = nums[3]! <= 1 ? pyRound(nums[3]! * 255) : Math.trunc(nums[3]!);
      return [r, g, b, clamp(a)];
    }
  }
  return toolError(`unrecognised color ${pyReprString(String(value ?? ""))}; use #RRGGBB, #RRGGBBAA, rgb(r,g,b) or a basic color name`);
}

/** `color_hex_alpha`: ('#rrggbb', alpha 0..1 rounded to 4 places); the refusal names the argument. */
export function colorHexAlpha(value: unknown, what: string): [string, number] {
  let rgba: Rgba;
  try {
    rgba = parseEditorColor(value);
  } catch (error) {
    if (error instanceof TextToolError) return toolError(`${what}: ${error.message}`);
    throw error;
  }
  const hex = `#${rgba
    .slice(0, 3)
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
  return [hex, pyRoundTo(rgba[3] / 255, 4)];
}

/** `_base.keyframe`: points (frame, value[, interpolation]) sorted by frame, BEZIER unless given. */
export function keyframeOf(points: readonly (readonly [number, number] | readonly [number, number, Interpolation])[]): Keyframe {
  const pts = points.map((p) => makeKeyframePoint(p[0], p[1], p[2] ?? Interpolation.BEZIER));
  pts.sort((a, b) => a.co.X - b.co.X);
  return { Points: pts };
}

/** `titles_text_common.constant`: one BEZIER point at frame 1. */
export function constantKeyframe(value: number): Keyframe {
  return keyframeOf([[1, value]]);
}

/** `color_keyframes`: OpenShot colour JSON (red/green/blue/alpha keyframes, 0-255). */
export function colorKeyframes(hex: string, alpha = 1): ColorKeyframe {
  const h = hex.replace(/^#/, "");
  const byte = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16);
  return {
    red: keyframeOf([[1, byte(0)]]),
    green: keyframeOf([[1, byte(2)]]),
    blue: keyframeOf([[1, byte(4)]]),
    alpha: keyframeOf([[1, pyRound(255 * Math.max(0, Math.min(1, alpha)))]]),
  };
}

/**
 * `_base.keyframe_value_at`: a keyframe's value at `frame`, linear between
 * points (for reporting and starting values; renders use the real curve).
 */
export function keyframeValueAt(kf: unknown, frame: number, fallback = 0): number {
  if (typeof kf === "number" && Number.isFinite(kf)) return kf;
  const pts = (kf as { Points?: unknown } | null)?.Points;
  if (!Array.isArray(pts) || pts.length === 0) return fallback;
  const sorted = [...pts].sort((a, b) => Number(a?.co?.X) - Number(b?.co?.X));
  const x = (p: { co?: { X?: unknown } }): number => Number(p?.co?.X);
  const y = (p: { co?: { Y?: unknown } }): number => Number(p?.co?.Y);
  if (frame <= x(sorted[0])) return y(sorted[0]);
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (x(a) <= frame && frame <= x(b)) {
      if (Number(a.interpolation ?? Interpolation.BEZIER) === Interpolation.CONSTANT || x(b) === x(a)) return y(a);
      const t = (frame - x(a)) / (x(b) - x(a));
      return y(a) + t * (y(b) - y(a));
    }
  }
  return y(sorted[sorted.length - 1]);
}

// ---------------------------------------------------------------------------
// Fonts (titles_text_common.installed_font_families / resolve_font)
// ---------------------------------------------------------------------------

/**
 * `installed_font_families()`: the families the host draws title text with,
 * or null when it cannot tell (no list, an empty one, or a failure), in
 * which case any font is taken as given.
 */
export async function installedFontFamilies(call: ToolCall): Promise<string[] | null> {
  const frames = call.host.frames;
  if (!frames?.fontFamilies) return null;
  try {
    const families = await frames.fontFamilies();
    return families.length > 0 ? families : null;
  } catch (error) {
    call.host.log?.(`font list unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Python `sorted(names, key=len)[0]`: the shortest, the first of equals. */
function shortest(names: readonly string[]): string {
  return names.reduce((best, name) => (name.length < best.length ? name : best));
}

/**
 * `resolve_font`: the installed family `name` means (same name ignoring
 * case, else the shortest family starting with it, else the shortest
 * containing it), or a refusal naming installed fonts like it. Any name is
 * taken as given when the host cannot list its fonts (`families` null).
 */
export function resolveFont(name: unknown, families: readonly string[] | null): string {
  const wanted = String(name ?? "").trim().replace(/^['"]+|['"]+$/g, "");
  if (!wanted || families === null) return wanted;
  const low = wanted.toLowerCase();
  const exact = families.find((f) => f.toLowerCase() === low);
  if (exact !== undefined) return exact;
  const starts = families.filter((f) => f.toLowerCase().startsWith(low));
  if (starts.length > 0) return shortest(starts);
  const contains = families.filter((f) => f.toLowerCase().includes(low));
  if (contains.length > 0) return shortest(contains);
  const close = getCloseMatches(wanted, families, 8, 0.5);
  const hint = close.length > 0 ? close.join(", ") : [...families].sort(byCodePoint).slice(0, 8).join(", ");
  return toolError(`font ${pyReprString(wanted)} is not installed; installed fonts like it: ${hint}`);
}

// ---------------------------------------------------------------------------
// Project facts
// ---------------------------------------------------------------------------

/** `project_fps()`: the project frame rate as a float. */
export function fpsOfProject(project: Project): number {
  const fps = projectFps(project);
  return fps.num / fps.den;
}

/** `frame_seconds()`: one frame, seconds. */
export function frameSecondsOf(project: Project): number {
  return 1 / Math.max(1, fpsOfProject(project));
}

/** `snap_seconds`: seconds on the project's frame grid. */
export function snapToFrame(project: Project, seconds: number): number {
  return snapSeconds(seconds, project);
}

/** `project_size()`: width and height, 1920×1080 when unset. */
export function projectSize(project: Project): [number, number] {
  const w = Math.trunc(Number(project.width));
  const h = Math.trunc(Number(project.height));
  return [w > 0 ? w : 1920, h > 0 ? h : 1080];
}

export function isVertical(project: Project): boolean {
  const [w, h] = projectSize(project);
  return h > w;
}

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

/** libopenshot GravityType (openshot.GRAVITY_*). */
export const GRAVITY = {
  top_left: 0,
  top_center: 1,
  top_right: 2,
  center_left: 3,
  center: 4,
  center_right: 5,
  bottom_left: 6,
  bottom_center: 7,
  bottom_right: 8,
} as const;
export type ScreenPosition = keyof typeof GRAVITY;

/** actionAddTrack_trigger numbers new tracks max + 1000000. */
export const TRACK_STEP = 1_000_000;
/** Frames of overlap ignored when checking a track window. */
const ONE_FRAME_TOLERANCE = 0.5;

/** `ui_track_number`: 1-based track counted from the bottom, null when no track has `layer`. */
export function uiTrackNumber(project: Project, layer: number): number | null {
  return buildTrackStack(project.layers).find((e) => e.layer_number === Math.trunc(layer))?.ui_track ?? null;
}

export function isLocked(project: Project, layer: number): boolean {
  return Boolean(project.layers.find((l: Layer) => Math.trunc(Number(l.number)) === Math.trunc(layer))?.lock);
}

/** `ensure_unlocked`. */
export function ensureUnlocked(project: Project, layer: number): void {
  if (isLocked(project, layer)) toolError(`track ${uiTrackNumber(project, layer) ?? layer} is locked; unlock it first`);
}

/** `resolve_layer`: a UI track number, label, track id or layer number → layer number. */
export function resolveLayer(project: Project, track: unknown): number {
  return requireTrack(track, (raw) => normalizeTrackOrLayerArg(raw, project.layers)).layer;
}

/** `resolve_placement_layer`: resolveLayer, or up to three tracks past the top to add (resolvePlacementTrack). */
export function resolvePlacementLayer(project: Project, track: unknown): { layer: number; newTracks: number } {
  return requireTrack(track, (raw) => resolvePlacementTrack(raw, project.layers));
}

function requireTrack(track: unknown, resolve: (raw: string) => TrackResolution): { layer: number; newTracks: number } {
  const raw = String(track ?? "").trim();
  if (!raw) toolError("a track is required (UI track number, name, or layer number)");
  const res = resolve(raw);
  if (res.error) toolError(res.error);
  if (res.layer === undefined) toolError(`no track matches ${pyReprString(raw)}`);
  return { layer: res.layer, newTracks: res.newTracks ?? 0 };
}

/** `track_info`: the receipt fields naming a track. */
export function trackInfo(project: Project, layer: number): { track: number | null; layer: number; track_label: string } {
  return { track: uiTrackNumber(project, layer), layer: Math.trunc(layer), track_label: formatTrackLabelForLlm(layer, project.layers) };
}

/** `clip_extent`: (timeline start, timeline end, duration) in seconds. */
export function clipExtent(clip: Pick<Clip, "position" | "start" | "end">): [number, number, number] {
  const position = Number(clip.position) || 0;
  const duration = Math.max(0, (Number(clip.end) || 0) - (Number(clip.start) || 0));
  return [position, position + duration, duration];
}

/** `clips_in_window`: clips (on `layer`, or any) overlapping [start, end) by more than half a frame. */
export function clipsInWindow(project: Project, layer: number | null, start: number, end: number, exclude: ReadonlySet<string> = new Set()): Clip[] {
  const tol = ONE_FRAME_TOLERANCE * frameSecondsOf(project);
  return project.clips.filter((clip) => {
    if (exclude.has(clip.id)) return false;
    if (layer !== null && Math.trunc(Number(clip.layer) || 0) !== Math.trunc(layer)) return false;
    const [s, e] = clipExtent(clip);
    return s < end - tol && e > start + tol;
  });
}

/**
 * `plan_overlay_track`: where an overlay shown over [start, end) goes.
 * An explicit `track` must exist, be unlocked and be free in the window,
 * or be one to three tracks past the top (created, with the ones between);
 * otherwise the lowest free, unlocked track above every clip with a
 * picture in the window, or a new track on top when none is free.
 */
export function planOverlayTrack(
  project: Project,
  start: number,
  end: number,
  track: unknown,
  exclude: ReadonlySet<string> = new Set(),
): { layer: number; created: boolean } {
  if (String(track ?? "").trim()) {
    const { layer, newTracks } = resolvePlacementLayer(project, track);
    if (newTracks > 0) return { layer, created: true };
    ensureUnlocked(project, layer);
    const busy = clipsInWindow(project, layer, start, end, exclude);
    if (busy.length > 0) {
      const [s, e] = clipExtent(busy[0]!);
      const name = pyReprString(String(busy[0]!.title || busy[0]!.id));
      toolError(
        `track ${uiTrackNumber(project, layer) ?? layer} already has ${name} at ${pyFixed(s, 2)}-${pyFixed(e, 2)}s during ` +
          `${pyFixed(start, 2)}-${pyFixed(end, 2)}s; pick another track or leave track empty to use the first free track above the video`,
      );
    }
    return { layer, created: false };
  }
  const numbers = project.layers.map((l) => Math.trunc(Number(l.number) || 0)).sort((a, b) => a - b);
  const visual = clipsInWindow(project, null, start, end, exclude).filter(isVisualClip);
  const floor = visual.length > 0 ? Math.max(...visual.map((c) => Math.trunc(Number(c.layer) || 0))) : null;
  for (const num of numbers) {
    if (floor !== null && num <= floor) continue;
    if (isLocked(project, num)) continue;
    if (clipsInWindow(project, num, start, end, exclude).length === 0) return { layer: num, created: false };
  }
  const top = numbers.length > 0 ? numbers[numbers.length - 1]! : 0;
  return { layer: top + TRACK_STEP, created: true };
}

/** `fade_alpha`: alpha keyframes fading in over `fadeIn` s and out over `fadeOut` s (clip frames). */
export function fadeAlpha(project: Project, start: number, end: number, fadeIn: number, fadeOut: number, base = 1): Keyframe | null {
  let fin = Math.max(0, Number(fadeIn) || 0);
  let fout = Math.max(0, Number(fadeOut) || 0);
  if (fin <= 0 && fout <= 0) return null;
  const fps = fpsOfProject(project);
  const length = Math.max(frameSecondsOf(project), end - start);
  if (fin + fout > length) {
    const scale = length / (fin + fout);
    fin *= scale;
    fout *= scale;
  }
  const first = pyRound(start * fps) + 1;
  const last = pyRound(end * fps) + 1;
  const points = new Map<number, number>();
  if (fin > 0) {
    points.set(first, 0);
    points.set(first + Math.max(1, pyRound(fin * fps)), base);
  } else points.set(first, base);
  if (fout > 0) {
    points.set(last - Math.max(1, pyRound(fout * fps)), base);
    points.set(last, 0);
  }
  return keyframeOf([...points.entries()].sort((a, b) => a[0] - b[0]));
}

// ---------------------------------------------------------------------------
// The transparent overlay carrier (timers, captions not tied to a clip)
// ---------------------------------------------------------------------------

export const OVERLAY_ROLE = "text_overlay";
export const OVERLAY_FILE_NAME = "Text Overlay.svg";

/** The carrier SVG: a fully transparent frame of the project's size. */
export function overlaySvgText(width: number, height: number): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#000000" fill-opacity="0"/></svg>\n`
  );
}

/** `Text Overlay WxH.svg`, the carrier's file name for a project size. */
export function overlayFileName(width: number, height: number): string {
  return `Text Overlay ${width}x${height}.svg`;
}

/** The carrier already in the bin for this size, if any. */
function existingCarrier(project: Project, width: number, height: number): ProjectFile | undefined {
  const name = overlayFileName(width, height).toLowerCase();
  return project.files.find((f) => {
    if (f.zenvi_role !== OVERLAY_ROLE) return false;
    const base = String(f.path ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
    return base === name || (Number(f.width) === width && Number(f.height) === height);
  });
}

/** A carrier to place: the bin's (reused, like `overlay_file`) or media to add in the commit. */
export type OverlayCarrier = { file: ProjectFile } | { media: ImportedMedia };

/**
 * `overlay_file_path` + probe: reuse the bin's carrier for the project size,
 * else write a new one through the host. Host problems are refusals.
 */
export async function prepareOverlayCarrier(call: ToolCall): Promise<OverlayCarrier> {
  const [w, h] = projectSize(call.doc.project);
  const found = existingCarrier(call.doc.project, w, h);
  if (found) return { file: found };
  const media = call.host.media;
  if (!media?.writeGenerated) toolError("this Zenvi surface cannot store the transparent overlay image a timer or caption overlay needs");
  const name = overlayFileName(w, h);
  let path: string;
  try {
    path = await media.writeGenerated(name, new TextEncoder().encode(overlaySvgText(w, h)), "image/svg+xml");
  } catch (error) {
    return toolError(`could not write the overlay image: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return { media: { path, info: await media.probe(path), name } };
  } catch (error) {
    return toolError(`could not import ${name} into Project Files: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Inside the commit: the carrier's bin file (`overlay_file`: imported once, named and tagged). */
export function carrierFile(tx: Transaction, carrier: OverlayCarrier): ProjectFile {
  if ("file" in carrier) return carrier.file;
  const file = addFile(tx, carrier.media, { name: OVERLAY_FILE_NAME, mediaType: "image" });
  return updateFile(tx, file.id, { name: OVERLAY_FILE_NAME, zenvi_role: OVERLAY_ROLE });
}
