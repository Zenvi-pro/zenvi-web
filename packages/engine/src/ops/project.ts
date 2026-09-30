/**
 * Project-level settings: profile (size + frame rate), fps / resolution /
 * sample rate, export overrides.
 *
 * Desktop: zenvi-core src/classes/project_data.py `apply_profile` and the
 * `["fps"]` branch of `changed` (keyframes are rescaled so animations keep
 * their timing), src/classes/agent_tools/project_settings.py
 * `set_project_setting`, tool_handlers.py `set_export_setting`.
 */

import type { ProjectDocument, Transaction } from "../history/document.js";
import type { Fraction } from "../model/types.js";
import type { Profile } from "../model/profiles.js";
import { OpError } from "./errors.js";

function notImplemented(op: string): never {
  throw new OpError("unsupported", `not implemented: ${op}`);
}

/**
 * Switch the project to a profile (by key or description, see
 * `model/profiles`): sets `profile`, `width`, `height`, `fps`,
 * `display_ratio`, `pixel_ratio`. When the frame rate changes, every clip and
 * transition keyframe is rescaled like the desktop, so animations keep their
 * timing in seconds. Returns the profile applied.
 */
export function setProfile(tx: Transaction, profileKey: string): Profile {
  void tx;
  void profileKey;
  return notImplemented("setProfile");
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

/**
 * Change fps / width / height / sample rate (zenvi-core
 * agent_tools/project_settings.py `set_project_setting`). Values that already
 * match are skipped; when nothing changes nothing is recorded. An fps change
 * rescales keyframes like `setProfile`.
 */
export function setProjectSettings(tx: Transaction, patch: ProjectSettingsPatch): ProjectSettingsResult {
  void tx;
  void patch;
  return notImplemented("setProjectSettings");
}

/** Single-key form of `setProjectSettings`. */
export function setProjectSetting<K extends keyof ProjectSettingsPatch>(
  tx: Transaction,
  key: K,
  value: NonNullable<ProjectSettingsPatch[K]>,
): ProjectSettingsResult {
  return setProjectSettings(tx, { [key]: value } as ProjectSettingsPatch);
}

/**
 * The `export_overrides` object after setting `key` to `value`, coerced like
 * zenvi-core tool_handlers.py `set_export_setting`: integer keys (`width`,
 * `height`, `fps_num`, `fps_den`, `start_frame`, `end_frame`, `sample_rate`,
 * `channels`), aliases (`vcodec` → `video_codec`, `acodec` → `audio_codec`,
 * `path` → `output_path`, `format` → `vformat`), everything else as a string.
 * Pure: does not change the project.
 */
export function withExportOverride(
  overrides: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
  value: string | number,
): Record<string, unknown> {
  void overrides;
  void key;
  void value;
  return notImplemented("withExportOverride");
}

/**
 * Set one export override. Like the desktop (`_ignore_history`), this is not
 * an undo step: it writes `export_overrides` untracked on the document.
 * Returns the new overrides.
 */
export function setExportSetting(doc: ProjectDocument, key: string, value: string | number): Record<string, unknown> {
  void doc;
  void key;
  void value;
  return notImplemented("setExportSetting");
}
