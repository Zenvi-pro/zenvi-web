/**
 * Project-level settings: profile (size + frame rate), fps / resolution /
 * sample rate, export overrides.
 *
 * Desktop: zenvi-core src/windows/main_window.py `actionProfile_trigger`
 * (one transaction: profile, width, height, ratios, fps, reset
 * export_settings), src/classes/project_data.py `changed` fps branch
 * (convert_framerate.change_profile snapping + remove_gaps, KeyframeScaler,
 * audio-only files resized), editor_tools/project_export_profiles.py
 * `set_project_setting` (audio), tool_handlers.py `set_export_setting`.
 *
 * Difference from the desktop: its fps side effects are written outside the
 * undo system, so undoing a profile change only restores the fps value.
 * Here they are part of the same transaction and undo restores everything.
 */

import type { ProjectDocument, Transaction } from "../history/document.js";
import { Gravity, ScaleMode, type Fraction, type Project } from "../model/types.js";
import { findProfile, type Profile } from "../model/profiles.js";
import { isAudioOnlyMedia } from "../model/media.js";
import { pyRound } from "../model/rounding.js";
import { scaleKeyframe } from "../keyframe/edit.js";
import { OpError, invalid } from "./errors.js";
import { changedFields, isRecord, sameJson } from "./internal.js";

type Timed = { position: number; start?: number; end?: number; [key: string]: unknown };

/** convert_framerate.py `change_profile` + `remove_gaps` on copies (clips and transitions together). */
export function snapToFrameRate<T extends Timed>(items: readonly T[], fps: Fraction): T[] {
  const frame = fps.den / fps.num;
  const snap = (t: number): number => pyRound(t / frame) * frame;
  const copies = items.map((item) => {
    const c = { ...item };
    c.position = snap(Number(c.position));
    if ("start" in c && c.start !== undefined) c.start = snap(Number(c.start));
    if ("end" in c && c.end !== undefined) c.end = snap(Number(c.end));
    return c;
  });
  // remove_gaps: sorted by position (stable), fix 1–3 frame gaps by extending the previous item's end.
  const order = copies.map((c, i) => ({ c, i })).sort((a, b) => a.c.position - b.c.position || a.i - b.i);
  const maxGap = 3 * frame;
  const minGap = 1 / 10000;
  for (let k = 1; k < order.length; k += 1) {
    const current = order[k]!.c;
    const previous = order[k - 1]!.c;
    if (current.start === undefined || previous.start === undefined) continue;
    if (current.end === undefined || previous.end === undefined) continue;
    const previousRight = snap(previous.position + (previous.end - previous.start));
    const gap = current.position - previousRight;
    if (minGap < Math.abs(gap) && Math.abs(gap) < maxGap) previous.end += gap;
    previous.end = snap(previous.end);
  }
  return copies;
}

/**
 * KeyframeScaler (keyframe_scaler.py): every keyframe X in `item` × factor
 * (Python rounding, X=1 kept); a `time` keyframe's Y too (it counts frames).
 */
export function rescaleItemKeyframes<T extends Record<string, unknown>>(item: T, factor: number): T {
  const scaleProp = (value: unknown, scaleY: boolean): unknown => {
    if (!isRecord(value)) return value;
    if (Array.isArray(value.Points)) {
      const scaled = scaleKeyframe(value as never, factor, "fps");
      if (!scaleY) return scaled;
      return {
        ...scaled,
        Points: scaled.Points.map((p) => {
          const y = p.co.Y;
          return { ...p, co: { ...p.co, Y: y === 1 ? y : pyRound(y * factor) } };
        }),
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isRecord(v) ? scaleProp(v, scaleY) : Array.isArray(v) ? v.map((x) => (isRecord(x) ? scaleProp(x, scaleY) : x)) : v;
    }
    return out;
  };
  const out: Record<string, unknown> = { ...item };
  for (const [key, value] of Object.entries(item)) {
    if (isRecord(value)) out[key] = scaleProp(value, key === "time");
  }
  return out as T;
}

/** Record the fps side effects of changing from `oldFps` to `profile`'s frame rate (project_data.py fps branch). */
function applyFrameRateChange(tx: Transaction, project: Project, oldFps: Fraction, newFps: Fraction, profile: Profile | null): void {
  const factor = newFps.num / newFps.den / (oldFps.num / oldFps.den);
  if (factor !== 1) {
    const snapped = snapToFrameRate([...project.clips, ...project.effects] as unknown as Timed[], newFps);
    const clipCount = project.clips.length;
    snapped.forEach((item, i) => {
      const original = (i < clipCount ? project.clips[i] : project.effects[i - clipCount]) as unknown as Record<string, unknown>;
      let next = { ...item } as Record<string, unknown>;
      if (i < clipCount) {
        next = rescaleItemKeyframes(next, factor);
        if (Array.isArray(next.effects)) {
          next.effects = (next.effects as Record<string, unknown>[]).map((e) => rescaleItemKeyframes(e, factor));
        }
      } else {
        next = rescaleItemKeyframes(next, factor);
      }
      if (sameJson(next, original)) return;
      tx.replace([i < clipCount ? "clips" : "effects", { id: String(original.id) }], next);
    });
  }
  if (!profile) return;
  // Audio-only files take the profile's size; clips reading them get the updated file as reader.
  for (const file of project.files) {
    if (!isAudioOnlyMedia(file)) continue;
    const patch = changedFields(file as Record<string, unknown>, {
      has_video: false,
      width: profile.width,
      height: profile.height,
      display_ratio: { ...(file.display_ratio ?? {}), num: profile.display_ratio.num, den: profile.display_ratio.den },
    });
    if (Object.keys(patch).length === 0) continue;
    tx.update(["files", { id: file.id }], patch);
    const updated = tx.project.files.find((f) => f.id === file.id)!;
    for (const clip of tx.project.clips) {
      if (clip.reader?.id === file.id) tx.update(["clips", { id: clip.id }], { reader: structuredClone(updated) });
    }
  }
}

/**
 * Switch the project to a profile (by key or description, see
 * `model/profiles`), like the desktop's Choose Profile: sets `profile`,
 * `width`, `height`, `display_ratio`, `pixel_ratio` and `fps`; when the
 * frame rate changes, clip/transition times snap to the new frame grid (tiny
 * gaps closed) and every keyframe is rescaled so animations keep their timing;
 * audio-only files take the new size; `export_settings` resets when anything
 * changed. Returns the profile applied (nothing recorded when already applied).
 */
export function setProfile(tx: Transaction, profileKey: string): Profile {
  if (typeof profileKey !== "string" || profileKey.trim() === "") throw invalid("profileKey is required.");
  const profile = findProfile(profileKey);
  if (!profile) throw new OpError("not_found", `No profile named ${profileKey}.`, { profile: profileKey });
  applyProfile(tx, profile);
  return profile;
}

/**
 * Whether switching to `profile` changes the project (`project_profile.profile_differs`):
 * its name, size, frame rate or ratios.
 */
export function profileDiffers(project: Project, profile: Profile): boolean {
  const fps = project.fps;
  const ratio = (value: unknown, expected: Fraction): boolean =>
    !isRecord(value) || value.num !== expected.num || value.den !== expected.den;
  return (
    project.profile !== profile.description ||
    project.width !== profile.width ||
    project.height !== profile.height ||
    !fps ||
    fps.num !== profile.fps.num ||
    fps.den !== profile.fps.den ||
    ratio(project.display_ratio, profile.display_ratio) ||
    ratio(project.pixel_ratio, profile.pixel_ratio)
  );
}

/**
 * Switch the project to a profile record (a built-in one, or a custom one
 * the host keeps), with the side effects of `setProfile`. Returns whether
 * anything changed; nothing is recorded when it already uses it.
 */
export function applyProfile(tx: Transaction, profile: Profile): boolean {
  const project = tx.project;
  const oldFps = project.fps;
  const changed = profileDiffers(project, profile);
  const fields = changedFields(project as Record<string, unknown>, {
    profile: profile.description,
    width: profile.width,
    height: profile.height,
    display_ratio: { num: profile.display_ratio.num, den: profile.display_ratio.den },
    pixel_ratio: { num: profile.pixel_ratio.num, den: profile.pixel_ratio.den },
    fps: { num: profile.fps.num, den: profile.fps.den },
  });
  for (const [key, value] of Object.entries(fields)) tx.replace([key], value);
  if (changed) {
    applyFrameRateChange(tx, project, oldFps, profile.fps, profile);
    if (project.export_settings !== null && "export_settings" in project) tx.replace(["export_settings"], null);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Reframe (zenvi-core develop editor_tools/project_export_profiles.py plan_reframe)
// ---------------------------------------------------------------------------

export type ReframeMode = "keep" | "fit" | "fill";

export interface ReframePlan {
  /** Clips to set to crop-to-fill (fill) or fit, centred. */
  changes: { id: string; scale: number; gravity: number }[];
  skipped: { timeline_clip_id: string; reason: string }[];
  /** Fitted clips of another shape that will show bars (mode keep). */
  letterboxed: string[];
  /** Clips with a picture on the timeline. */
  videoClips: number;
}

/** `_constant`: a keyframe curve that holds `value` everywhere (or has no points). */
function holds(curve: unknown, value: number): boolean {
  const points = isRecord(curve) && Array.isArray(curve.Points) ? (curve.Points as unknown[]) : null;
  if (!points || points.length === 0) return true;
  return points.every((p) => {
    const co = isRecord(p) && isRecord(p.co) ? p.co : {};
    const y = co.Y === undefined ? value : Number(co.Y);
    return Math.abs(y - value) < 1e-6;
  });
}

/** `_source_aspect`: the clip's media shape (display ratio, else pixels), or null. */
function sourceAspect(clip: Record<string, unknown>): number | null {
  const reader = isRecord(clip.reader) ? clip.reader : {};
  const dar = isRecord(reader.display_ratio) ? reader.display_ratio : {};
  const num = Number(dar.num);
  const den = Number(dar.den);
  if (num && den) return num / den;
  const w = Number(reader.width);
  const h = Number(reader.height);
  if (w && h) return w / h;
  return null;
}

/** Whether a clip has a picture (`reader.has_video` defaults to true; audio files have none). */
function showsPicture(clip: Record<string, unknown>): boolean {
  const reader = isRecord(clip.reader) ? clip.reader : {};
  const hasVideo = "has_video" in reader ? reader.has_video : true;
  return Boolean(hasVideo) && reader.media_type !== "audio";
}

/**
 * Which clips to reframe for a `width`×`height` frame: full-frame clips of
 * another shape are set to crop-to-fill (`fill`) or fit (`fit`), centred;
 * titles (SVG), picture-in-picture clips (scaled or moved) and clips on
 * locked tracks are never changed, and `keep` only lists the fitted clips
 * that will show bars. Changes nothing.
 */
export function planReframe(project: Project, mode: ReframeMode, width: number, height: number): ReframePlan {
  const target = width / height;
  const plan: ReframePlan = { changes: [], skipped: [], letterboxed: [], videoClips: 0 };
  const locked = new Set(project.layers.filter((l) => l.lock).map((l) => Number(l.number)));
  for (const raw of project.clips) {
    const clip = raw as Record<string, unknown>;
    if (!showsPicture(clip)) continue;
    plan.videoClips += 1;
    const id = String(clip.id);
    const reader = isRecord(clip.reader) ? clip.reader : {};
    const path = String(reader.path || clip.title || "").toLowerCase();
    const aspect = sourceAspect(clip);
    if (aspect === null || Math.abs(aspect - target) / target < 0.01) continue;
    const scale = Math.trunc(Number(clip.scale ?? ScaleMode.FIT));
    const svg = path.endsWith(".svg");
    if (mode === "keep") {
      if (scale === ScaleMode.FIT && !svg) plan.letterboxed.push(id);
      continue;
    }
    if (svg) {
      plan.skipped.push({ timeline_clip_id: id, reason: "title (SVG) kept as designed" });
      continue;
    }
    const fullFrame = holds(clip.scale_x, 1) && holds(clip.scale_y, 1) && holds(clip.location_x, 0) && holds(clip.location_y, 0);
    if (!fullFrame) {
      plan.skipped.push({ timeline_clip_id: id, reason: "resized or moved (picture-in-picture) clip kept" });
      continue;
    }
    const want = mode === "fill" ? ScaleMode.CROP : ScaleMode.FIT;
    if (scale === want && Math.trunc(Number(clip.gravity ?? Gravity.CENTER)) === Gravity.CENTER) continue;
    if (locked.has(Math.trunc(Number(clip.layer) || 0))) {
      plan.skipped.push({ timeline_clip_id: id, reason: "track is locked" });
      continue;
    }
    plan.changes.push({ id, scale: want, gravity: Gravity.CENTER });
  }
  return plan;
}

/** Record a reframe plan's clip changes (part of the caller's transaction). */
export function applyReframe(tx: Transaction, plan: ReframePlan): void {
  for (const change of plan.changes) tx.update(["clips", { id: change.id }], { scale: change.scale, gravity: change.gravity });
}

/** A project's audio mix format: what set_project_setting_tool changes besides the profile. */
export interface ProjectAudio {
  /** Hz, e.g. 44100 or 48000. */
  sampleRate?: number;
  /** Channel count with its FFmpeg layout (`ChannelLayout`), set together. */
  channels?: { count: number; layout: number };
}

/**
 * Set the project's sample rate and/or channels (count and layout), like
 * zenvi-core develop editor_tools/project_export_profiles.py
 * `set_project_setting` (`app.updates.update([key], value)` per key). Only
 * keys that differ are recorded. Returns the keys written.
 */
export function setProjectAudio(tx: Transaction, audio: ProjectAudio): string[] {
  if (typeof audio !== "object" || audio === null) throw invalid("audio must be an object.");
  const positiveInt = (value: unknown, what: string): number => {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw invalid(`${what} must be a positive integer (got ${String(value)}).`);
    return value;
  };
  const wanted: Record<string, number> = {};
  if (audio.sampleRate !== undefined) wanted.sample_rate = positiveInt(audio.sampleRate, "sampleRate");
  if (audio.channels !== undefined) {
    wanted.channels = positiveInt(audio.channels.count, "channels.count");
    wanted.channel_layout = positiveInt(audio.channels.layout, "channels.layout");
  }
  const fields = changedFields(tx.project as Record<string, unknown>, wanted);
  for (const [key, value] of Object.entries(fields)) tx.replace([key], value);
  return Object.keys(fields);
}

const INT_EXPORT_KEYS = new Set(["width", "height", "fps_num", "fps_den", "start_frame", "end_frame", "sample_rate", "channels"]);

/**
 * The `export_overrides` object after setting `key` to `value`, coerced like
 * zenvi-core tool_handlers.py `set_export_setting`: integer keys (`width`,
 * `height`, `fps_num`, `fps_den`, `start_frame`, `end_frame`, `sample_rate`,
 * `channels`), aliases (`vcodec` → `video_codec`, `acodec` → `audio_codec`,
 * `path` → `output_path`, `format` → `vformat`), everything else as a string.
 * Pure: does not change the project. Throws `OpError` for invalid values.
 */
export function withExportOverride(
  overrides: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
  value: string | number,
): Record<string, unknown> {
  if (typeof key !== "string" || key.trim() === "") throw invalid("key is required.");
  const out: Record<string, unknown> = { ...(overrides ?? {}) };
  const k = key.toLowerCase().trim();
  const text = String(value).trim();
  if (INT_EXPORT_KEYS.has(k)) {
    if (!/^[+-]?\d+$/.test(text)) throw invalid(`${k} must be an integer (got ${text}).`);
    out[k] = Number.parseInt(text, 10);
  } else if (k === "video_codec" || k === "vcodec") out.video_codec = text;
  else if (k === "audio_codec" || k === "acodec") out.audio_codec = text;
  else if (k === "output_path" || k === "path") out.output_path = text;
  else if (k === "vformat" || k === "format") out.vformat = text;
  else out[k] = text;
  return out;
}

/**
 * The `export_overrides` object without `names` (set_export_setting_tool
 * `clear`). Pure. The desktop writes None over them; a missing key reads the
 * same everywhere (None and absent both mean "not stored").
 */
export function withoutExportOverrides(overrides: Readonly<Record<string, unknown>> | null | undefined, names: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(overrides ?? {}) };
  for (const name of names) delete out[name];
  return out;
}

/**
 * Remove stored export overrides. Like `setExportSetting`, not an undo step:
 * `export_overrides` is written untracked. Returns the overrides left.
 */
export function clearExportSettings(doc: ProjectDocument, names: readonly string[]): Record<string, unknown> {
  if (!("export_overrides" in doc.project)) {
    throw new OpError("conflict", "The project has no export_overrides object (open it with parseProject).");
  }
  const next = withoutExportOverrides(doc.project.export_overrides, names);
  doc.setUntracked(["export_overrides"], next);
  return next;
}

/**
 * Set one export override. Like the desktop (`_ignore_history`), this is not
 * an undo step: it writes `export_overrides` untracked on the document.
 * Returns the new overrides.
 */
export function setExportSetting(doc: ProjectDocument, key: string, value: string | number): Record<string, unknown> {
  const next = withExportOverride(doc.project.export_overrides, key, value);
  if (!("export_overrides" in doc.project)) {
    throw new OpError("conflict", "The project has no export_overrides object (open it with parseProject).");
  }
  doc.setUntracked(["export_overrides"], next);
  return next;
}

