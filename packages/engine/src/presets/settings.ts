/**
 * The export defaults set_export_setting_tool stores in the project
 * (`export_overrides`), which export_video_tool uses for every argument a
 * call leaves out (`planExport`).
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export_render.py `_SETTING_KEYS`,
 * `_KEY_ALIASES`, `_parse_setting`: keys and values are checked, then kept
 * under the desktop's storage keys (start/end as frames, fps as a fraction,
 * channels with their layout, the preset by its title), so a project
 * exports the same on every surface and in Zenvi desktop. Whether the host
 * can encode a named codec is the caller's check.
 */

import { CHANNEL_LAYOUTS, channelLayoutNamed } from "../model/channel-layouts.js";
import { profileFpsFraction } from "../model/profiles.js";
import { pyRound } from "../model/rounding.js";
import type { Project } from "../model/types.js";
import { pyReprString } from "../tools/pyfmt.js";
import { EXPORT_TYPE_LABELS, ExportPlanError, planExportType, resolveExportPreset } from "./plan.js";

/** `_SETTING_KEYS`: the keys set_export_setting_tool accepts and each value's format, in the desktop's order. */
export const EXPORT_SETTING_KEYS: Readonly<Record<string, string>> = {
  preset: "export preset title or alias (e.g. 'YouTube', 'Instagram Reels', 'GIF', 'MP3')",
  quality: "low | med | high",
  export_type: "video_audio | video_only | audio_only | image_sequence",
  width: "even integer pixels",
  height: "even integer pixels",
  fps: "frame rate number (e.g. 24, 29.97)",
  fps_num: "integer",
  fps_den: "integer",
  start: "range start, timeline seconds",
  end: "range end, timeline seconds",
  start_frame: "range start frame (1-based, project fps)",
  end_frame: "range end frame",
  video_codec: "e.g. libx264",
  audio_codec: "e.g. aac",
  format: "container, e.g. mp4, mov, webm",
  video_bitrate: "'8 Mb/s' | '23 crf'",
  audio_bitrate: "'192 kb/s'",
  sample_rate: "22050 | 44100 | 48000 | 96000 | 192000",
  channels: "mono | stereo | surround | 5.1 | 7.1",
  output_path: "full output file path",
  folder: "output folder",
  file_name: "output file name",
  image_format: "png | jpg | bmp | tiff",
};

/** `_KEY_ALIASES`. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  vcodec: "video_codec",
  acodec: "audio_codec",
  vformat: "format",
  container: "format",
  path: "output_path",
  type: "export_type",
  target: "preset",
  bitrate: "video_bitrate",
  frame_rate: "fps",
  framerate: "fps",
};

/** Where the desktop stores a key that is not stored under its own name. */
export const EXPORT_SETTING_STORED_AS: Readonly<Record<string, readonly string[]>> = {
  start: ["start_frame"],
  end: ["end_frame"],
  fps: ["fps_num", "fps_den"],
  format: ["vformat"],
  channels: ["channels", "channel_layout"],
};

/** `_norm`. */
export function normSettingKey(text: unknown): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The setting a key names (aliases resolved): `_KEY_ALIASES.get(_norm(key), _norm(key))`. */
export function exportSettingKey(key: unknown): string {
  const k = normSettingKey(key);
  return KEY_ALIASES[k] ?? k;
}

export function isExportSettingKey(key: string): boolean {
  return Object.hasOwn(EXPORT_SETTING_KEYS, key);
}

/** "unknown export setting 'x'; valid keys: …". */
export function unknownSettingMessage(key: unknown): string {
  return `unknown export setting ${pyReprString(String(key ?? ""))}; valid keys: ${Object.keys(EXPORT_SETTING_KEYS).join(", ")}`;
}

const RATE_RE = /^\s*\d+(\.\d+)?\s*(kb\/s|mb\/s|crf|cqp|qp)\s*$/i;
const SAMPLE_RATES = [22050, 44100, 48000, 96000, 192000] as const;

/**
 * `_parse_setting`: `{storage key: value}` for one key (already resolved
 * with `exportSettingKey`), or `ExportPlanError` with the desktop's words.
 * Paths are kept as given (the host resolves relative ones).
 */
export function parseExportSetting(key: string, value: unknown, project: Project): Record<string, string | number> {
  const v = String(value ?? "").trim();
  if (!v) throw new ExportPlanError(`give a value for ${key}`);
  const asInt = (text: string, even = false, lo = 1): number => {
    const n = Number(text);
    if (text === "" || !Number.isFinite(n)) throw new ExportPlanError(`${key} must be a whole number, got ${pyReprString(text)}`);
    const whole = Math.trunc(n);
    if (whole < lo || (even && whole % 2 !== 0)) {
      throw new ExportPlanError(`${key} must be ${even ? "an even number" : "a number"} >= ${lo}, got ${pyReprString(text)}`);
    }
    return whole;
  };
  const fps = project.fps ?? { num: 30, den: 1 };
  const pfps = (Number(fps.num) || 30) / (Number(fps.den) || 1);
  switch (key) {
    case "preset":
      return { preset: resolveExportPreset(v).title };
    case "quality":
      if (!["low", "med", "high"].includes(v.toLowerCase())) throw new ExportPlanError("quality must be low, med or high");
      return { quality: v.toLowerCase() };
    case "export_type": {
      const type = planExportType(v);
      if (!type) throw new ExportPlanError("export_type must be video_audio, video_only, audio_only or image_sequence");
      return { export_type: EXPORT_TYPE_LABELS[type] };
    }
    case "width":
    case "height":
      return { [key]: asInt(v, true, 2) };
    case "fps": {
      const rate = Number(v);
      if (!(rate > 0) || !Number.isFinite(rate)) throw new ExportPlanError(`fps must be a positive number, got ${pyReprString(v)}`);
      const fraction = profileFpsFraction(rate);
      return { fps_num: fraction.num, fps_den: fraction.den };
    }
    case "fps_num":
    case "fps_den":
    case "start_frame":
    case "end_frame":
      return { [key]: asInt(v) };
    case "start":
    case "end": {
      const seconds = Number(v.replace(/s+$/, ""));
      if (!Number.isFinite(seconds) || v.replace(/s+$/, "").trim() === "") throw new ExportPlanError(`${key} must be seconds, got ${pyReprString(v)}`);
      if (seconds < 0) throw new ExportPlanError(`${key} must be >= 0`);
      const frame = pyRound(seconds * pfps) + (key === "start" ? 1 : 0);
      return { [key === "start" ? "start_frame" : "end_frame"]: Math.max(1, frame) };
    }
    case "video_codec":
    case "audio_codec":
      return { [key]: v };
    case "format":
      return { vformat: v.toLowerCase().replace(/^\.+/, "") };
    case "video_bitrate":
    case "audio_bitrate":
      if (!RATE_RE.test(v)) throw new ExportPlanError(`${key} must look like '8 Mb/s', '192 kb/s' or '23 crf'`);
      return { [key]: v };
    case "sample_rate": {
      const rate = asInt(v);
      if (!(SAMPLE_RATES as readonly number[]).includes(rate)) throw new ExportPlanError(`sample_rate must be ${SAMPLE_RATES.slice(0, -1).join(", ")} or ${SAMPLE_RATES[SAMPLE_RATES.length - 1]}`);
      return { sample_rate: rate };
    }
    case "channels": {
      const layout = channelLayoutNamed(v);
      if (!layout) throw new ExportPlanError("channels must be mono, stereo, surround, 5.1 or 7.1");
      const [code, count] = CHANNEL_LAYOUTS[layout];
      return { channels: count, channel_layout: code };
    }
    case "output_path":
    case "folder":
      return { [key]: v };
    case "file_name":
      if (/[\\/]/.test(v)) throw new ExportPlanError("file_name is only a name; use output_path or folder for folders");
      return { file_name: v };
    case "image_format":
      if (!["png", "jpg", "bmp", "tiff"].includes(v.toLowerCase())) throw new ExportPlanError("image_format must be png, jpg, bmp or tiff");
      return { image_format: v.toLowerCase() };
    default:
      throw new ExportPlanError(`unknown export setting ${pyReprString(key)}`);
  }
}
