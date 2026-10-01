/**
 * Export tools: export_video_tool, get_export_settings_tool,
 * set_export_setting_tool.
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/tool_handlers.py
 * export_video / get_export_settings / set_export_setting and
 * src/windows/export.py export_video_headless: an agent export renders the
 * whole timeline (1..GetMaxFrame) with the project's settings plus
 * `export_overrides` (`getDefaultExportSettings`, src/presets).
 */

import { setExportSetting } from "../../ops/project.js";
import { ExportSettingsError, exportOptionsFromSettings, getDefaultExportSettings } from "../../presets/export.js";
import { maxFrame } from "../../timeline/queries.js";
import { contractTool, unavailable, type CatalogTool } from "../define.js";
import { projectFps } from "../frame-time.js";
import { pyRepr } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { ExportOptions } from "../types.js";
import { record, text } from "./common.js";

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
