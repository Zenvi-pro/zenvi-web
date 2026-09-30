/**
 * Project-level settings: profile (size + frame rate), fps / resolution /
 * sample rate, export overrides.
 *
 * Desktop: zenvi-core src/windows/main_window.py `actionProfile_trigger`
 * (one transaction: profile, width, height, ratios, fps, reset
 * export_settings), src/classes/project_data.py `changed` fps branch
 * (convert_framerate.change_profile snapping + remove_gaps, KeyframeScaler,
 * audio-only files resized), src/classes/agent_tools/project_settings.py
 * `set_project_setting`, tool_handlers.py `set_export_setting`.
 *
 * Difference from the desktop: its fps side effects are written outside the
 * undo system, so undoing a profile change only restores the fps value.
 * Here they are part of the same transaction and undo restores everything.
 */

import type { ProjectDocument, Transaction } from "../history/document.js";
import type { Fraction, Project } from "../model/types.js";
import { findProfile, type Profile } from "../model/profiles.js";
import { isAudioOnlyMedia } from "../model/media.js";
import { pyRound } from "../model/rounding.js";
import { scaleKeyframe } from "../keyframe/edit.js";
import { fpsFromRate, sameFps } from "../timeline/time.js";
import { OpError, invalid } from "./errors.js";
import { changedFields, isRecord } from "./internal.js";

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
      if (JSON.stringify(next) === JSON.stringify(original)) return;
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
  const project = tx.project;
  const oldFps = project.fps;
  const changed =
    project.profile !== profile.description ||
    project.width !== profile.width ||
    project.height !== profile.height ||
    !oldFps ||
    oldFps.num !== profile.fps.num ||
    oldFps.den !== profile.fps.den;
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
  return profile;
}

/** Arguments of `set_project_setting_tool` (all optional; at least one). */
export interface ProjectSettingsPatch {
  /**
   * Frame rate as a number (23.976 / 29.97 / 59.94 snap to the NTSC
   * fractions, other non-integers are approximated with denominator <= 1001)
   * or an exact fraction.
   */
  fps?: number | Fraction;
  /** 16..8192. */
  width?: number;
  /** 16..8192. */
  height?: number;
  /** 8000..192000. */
  sampleRate?: number;
}

export interface ProjectSettingsResult {
  changed: boolean;
  /** The project keys written and their new values. */
  updates: { fps?: Fraction; width?: number; height?: number; sample_rate?: number };
  /** Human-readable notes, e.g. `"fps=30000/1001"`. */
  notes: string[];
}

function requireInt(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw invalid(`${what} must be an integer (got ${String(value)}).`);
  }
  if (value < min || value > max) throw invalid(`${what} out of range (${min}..${max}).`);
  return value;
}

/**
 * Change fps / width / height / sample rate (zenvi-core
 * agent_tools/project_settings.py `set_project_setting`). Values that already
 * match are skipped; when nothing changes nothing is recorded. An fps change
 * has the same side effects as `setProfile` (times snapped to the new grid,
 * keyframes rescaled). The profile description is left as it is, like the
 * desktop.
 */
export function setProjectSettings(tx: Transaction, patch: ProjectSettingsPatch): ProjectSettingsResult {
  if (typeof patch !== "object" || patch === null) throw invalid("patch must be an object.");
  const project = tx.project;
  const updates: ProjectSettingsResult["updates"] = {};
  const notes: string[] = [];

  let fps: Fraction | undefined;
  if (patch.fps !== undefined) {
    if (typeof patch.fps === "number") {
      if (!Number.isFinite(patch.fps) || patch.fps <= 0) throw invalid("fps must be positive.");
      fps = fpsFromRate(patch.fps);
    } else if (typeof patch.fps === "object" && patch.fps !== null) {
      const { num, den } = patch.fps;
      if (!Number.isInteger(num) || !Number.isInteger(den) || num <= 0 || den <= 0) {
        throw invalid("fps num/den must be positive integers.");
      }
      fps = { num, den };
    } else {
      throw invalid("fps must be a number or {num, den}.");
    }
  }
  const width = patch.width === undefined ? undefined : requireInt(patch.width, "width", 16, 8192);
  const height = patch.height === undefined ? undefined : requireInt(patch.height, "height", 16, 8192);
  const sampleRate = patch.sampleRate === undefined ? undefined : requireInt(patch.sampleRate, "sample_rate", 8000, 192000);

  if (fps && (project.fps?.num !== fps.num || project.fps?.den !== fps.den)) {
    updates.fps = fps;
    notes.push(`fps=${fps.num}/${fps.den}`);
  }
  if (width !== undefined && project.width !== width) {
    updates.width = width;
    notes.push(`width=${width}`);
  }
  if (height !== undefined && project.height !== height) {
    updates.height = height;
    notes.push(`height=${height}`);
  }
  if (sampleRate !== undefined && project.sample_rate !== sampleRate) {
    updates.sample_rate = sampleRate;
    notes.push(`sample_rate=${sampleRate}`);
  }
  if (Object.keys(updates).length === 0) return { changed: false, updates, notes: ["Settings already matched."] };

  const oldFps = project.fps;
  for (const [key, value] of Object.entries(updates)) tx.replace([key], value);
  if (updates.fps && !sameFps(oldFps, updates.fps)) {
    applyFrameRateChange(tx, project, oldFps, updates.fps, findProfile(project.profile) ?? null);
  }
  return { changed: true, updates, notes };
}

/** Single-key form of `setProjectSettings`. */
export function setProjectSetting<K extends keyof ProjectSettingsPatch>(
  tx: Transaction,
  key: K,
  value: NonNullable<ProjectSettingsPatch[K]>,
): ProjectSettingsResult {
  return setProjectSettings(tx, { [key]: value } as ProjectSettingsPatch);
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

