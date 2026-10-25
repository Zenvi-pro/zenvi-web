/**
 * Export tools: export_video_tool, get_export_settings_tool,
 * set_export_setting_tool.
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/tool_handlers.py
 * export_video / get_export_settings / set_export_setting and
 * src/windows/export.py export_video_headless: an agent export renders the
 * whole timeline (1..GetMaxFrame) with the project's settings plus
 * `export_overrides` (`getDefaultExportSettings`, src/presets).
 * set_export_setting_tool's `clear` follows develop 1f80cb3d0
 * editor_tools/project_export_render.py `set_export_setting`.
 */

import { clearExportSettings, setExportSetting } from "../../ops/project.js";
import { ExportSettingsError, exportOptionsFromSettings, getDefaultExportSettings } from "../../presets/export.js";
import { maxFrame } from "../../timeline/queries.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall, type ToolOutcome } from "../define.js";
import { projectFps } from "../frame-time.js";
import { pyRepr, pyReprString } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { ExportOptions } from "../types.js";
import { record, text } from "./common.js";
import { editorRun, nothingChanged, ok, ToolError } from "./timeline-edit-common.js";

/** project_export_render._SETTING_KEYS: what set_export_setting_tool stores, in the desktop's order. */
const SETTING_KEYS = [
  "preset",
  "quality",
  "export_type",
  "width",
  "height",
  "fps",
  "fps_num",
  "fps_den",
  "start",
  "end",
  "start_frame",
  "end_frame",
  "video_codec",
  "audio_codec",
  "format",
  "video_bitrate",
  "audio_bitrate",
  "sample_rate",
  "channels",
  "output_path",
  "folder",
  "file_name",
  "image_format",
] as const;
/** project_export_render._KEY_ALIASES. */
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
const STORED_AS: Readonly<Record<string, readonly string[]>> = {
  start: ["start_frame"],
  end: ["end_frame"],
  fps: ["fps_num", "fps_den"],
  format: ["vformat"],
  channels: ["channels", "channel_layout"],
};

/** project_export_render._norm. */
function normKey(text: unknown): string {
  return String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * set_export_setting(clear=True): remove the stored override for `key`
 * (every override when key is empty), outside the undo history like a
 * setting the Export dialog remembers. The names a key is stored under are
 * the desktop's plus the ones this surface's own set path used (it keeps
 * the key as given), so whatever was stored here can be cleared.
 */
function clearOverrides(call: ToolCall, key: unknown): ToolOutcome {
  const raw = normKey(key);
  const k = KEY_ALIASES[raw] ?? raw;
  const current = record(call.doc.project.export_overrides);
  const stored = (name: string): boolean => current[name] !== undefined && current[name] !== null;
  let targets: string[];
  if (!k) targets = Object.keys(current).filter(stored);
  else {
    const names = [...new Set([...(STORED_AS[k] ?? [k]), k, raw])];
    targets = names.filter(stored);
    if (targets.length === 0 && !(SETTING_KEYS as readonly string[]).includes(k)) {
      throw new ToolError(`unknown export setting ${pyReprString(String(key ?? ""))}; valid keys: ${SETTING_KEYS.join(", ")}`);
    }
  }
  if (targets.length === 0) return nothingChanged(call, "No stored override to clear.", { cleared: [], overrides: current });
  const left = clearExportSettings(call.doc, targets);
  return ok(call, `Cleared ${targets.join(", ")}.`, { cleared: targets, overrides: left });
}

export const exportTools: CatalogTool[] = [
  contractTool("export_video_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, input) => {
      const openUi = !["0", "false", "no"].includes(String(input.show_dialog ?? "true").toLowerCase().trim());
      const path = text(input.output_path);
      if (openUi && !path && call.host.ui?.openExportDialog) {
        call.host.ui.openExportDialog();
        return "Export video dialog opened.";
      }
      const exporter = call.host.exporter;
      if (!exporter) return unavailable("export_video_tool", "it needs video rendering, which this host does not provide.");
      const project = call.doc.toJSON();
      const settings = getDefaultExportSettings(project);
      const output = path || (settings.defaultPath !== "export.mp4" ? settings.defaultPath : undefined);
      if (output && (project.files ?? []).some((f) => f.path === output)) {
        return "Error: Export failed: Output path is an input file. Choose a different path.";
      }
      if (maxFrame(project, projectFps(project)) <= 1) {
        return "Error: Export failed: Invalid range of frames to export.";
      }
      let options: ExportOptions;
      try {
        options = exportOptionsFromSettings(settings);
      } catch (error) {
        if (error instanceof ExportSettingsError) return `Error: Export failed: ${error.message}`;
        throw error;
      }
      if (output) options.output = output;
      let result;
      try {
        result = await exporter.export(project, options);
      } catch (error) {
        return `Error: Export failed: ${error instanceof Error ? error.message : String(error)}`;
      }
      return applied("export_video_tool", `Exported to ${result.location}.`, { data: { ...result, options } }, 0);
    },
  }),

  contractTool("get_export_settings_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: (call) => {
      const project = call.doc.project;
      const { video, audio, exportType, defaultPath } = getDefaultExportSettings(project);
      const fps = record(video.fps);
      const lines = [
        `Export type: ${exportType}`,
        `Default path: ${defaultPath}`,
        `Video: ${String(video.width)}x${String(video.height)}, ${String(fps.num)}/${String(fps.den)} fps, codec ${video.vcodec}, format ${video.vformat}, bitrate ${String(video.video_bitrate)}`,
        `Audio: codec ${audio.acodec}, ${String(audio.sample_rate)} Hz, ${String(audio.channels)} channels, bitrate ${String(audio.audio_bitrate)}`,
        `Frame range: ${String(video.start_frame)} - ${String(video.end_frame)}`,
      ];
      const overrides = record(project.export_overrides);
      if (Object.keys(overrides).length > 0) lines.push(`Overrides: ${pyRepr(overrides)}`);
      return lines.join("\n");
    },
  }),

  contractTool("set_export_setting_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    run: (call, input) => {
      if (input.clear) return editorRun(() => clearOverrides(call, input.key));
      const key = String(input.key ?? "").trim().toLowerCase();
      if (!key) return "Error: key is required.";
      if (input.value === undefined || input.value === null) return "Error: value is required.";
      const value = typeof input.value === "boolean" ? String(input.value) : input.value;
      // Not an undo step on the desktop (`_ignore_history`): written untracked.
      setExportSetting(call.doc, key, value);
      return `Set ${key} = ${String(value)}.`;
    },
  }),
];
