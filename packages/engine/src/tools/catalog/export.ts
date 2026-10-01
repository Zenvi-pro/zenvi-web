/**
 * Export tools: export_video_tool, get_export_settings_tool,
 * set_export_setting_tool.
 *
 * Ports of zenvi-core (ref b63c39be7) src/classes/tool_handlers.py
 * export_video / get_export_settings / set_export_setting and
 * src/windows/export.py get_default_export_settings /
 * export_video_headless: an agent export renders the whole timeline
 * (1..GetMaxFrame) with the project's settings plus `export_overrides`.
 */

import type { Project } from "../../model/types.js";
import { setExportSetting } from "../../ops/project.js";
import { maxFrame } from "../../timeline/queries.js";
import { contractTool, unavailable, type CatalogTool } from "../define.js";
import { projectFps } from "../frame-time.js";
import { pyRepr } from "../pyfmt.js";
import { applied } from "../receipt.js";
import type { ContainerFormat, ExportOptions } from "../types.js";
import { record, text } from "./common.js";

export interface ExportSettings {
  video: {
    vformat: string;
    vcodec: string;
    fps: { num: unknown; den: unknown };
    width: unknown;
    height: unknown;
    video_bitrate: unknown;
    start_frame: unknown;
    end_frame: unknown;
    [key: string]: unknown;
  };
  audio: { acodec: string; sample_rate: unknown; channels: unknown; audio_bitrate: unknown; [key: string]: unknown };
  exportType: string;
  defaultPath: string;
}

const EXPORT_TYPES = ["Video & Audio", "Video Only", "Audio Only", "Image Sequence"];

/** windows/export.py get_default_export_settings. */
export function defaultExportSettings(project: Project): ExportSettings {
  const fps = record(project.fps);
  const video: ExportSettings["video"] = {
    vformat: "mp4",
    vcodec: "libx264",
    fps: { num: fps.num ?? 30, den: fps.den || 1 },
    width: project.width || 1920,
    height: project.height || 1080,
    pixel_ratio: { num: 1, den: 1 },
    video_bitrate: 2000000,
    start_frame: 1,
    end_frame: Math.max(1, Math.trunc(Number(project.duration) || 0) || 1),
    interlace: false,
    topfirst: false,
    spherical: false,
  };
  const audio: ExportSettings["audio"] = {
    acodec: "aac",
    sample_rate: project.sample_rate || 48000,
    channels: project.channels || 2,
    channel_layout: 2,
    audio_bitrate: 192000,
  };
  let exportType = EXPORT_TYPES[0]!;
  let defaultPath = "export.mp4";

  const saved = project.export_settings;
  if (Array.isArray(saved)) {
    const toVideo: Record<string, string | [string, string]> = {
      txtVideoFormat: "vformat",
      txtVideoCodec: "vcodec",
      txtWidth: "width",
      txtHeight: "height",
      txtFrameRateNum: ["fps", "num"],
      txtFrameRateDen: ["fps", "den"],
      txtPixelRatioNum: ["pixel_ratio", "num"],
      txtPixelRatioDen: ["pixel_ratio", "den"],
      txtVideoBitRate: "video_bitrate",
      txtStartFrame: "start_frame",
      txtEndFrame: "end_frame",
    };
    const toAudio: Record<string, string> = {
      txtAudioCodec: "acodec",
      txtSampleRate: "sample_rate",
      txtChannels: "channels",
      txtAudioBitrate: "audio_bitrate",
    };
    for (const raw of saved) {
      const s = record(raw);
      const name = String(s.name ?? "");
      const value = s.value;
      if (name in toVideo) {
        const key = toVideo[name]!;
        if (Array.isArray(key)) {
          const holder = record(video[key[0]]);
          video[key[0]] = { ...holder, [key[1]]: value };
        } else video[key] = value;
      } else if (name in toAudio) audio[toAudio[name]!] = value;
      else if (name === "cboChannelLayout") audio.channel_layout = value;
      else if (name === "cboExportTo" && typeof value === "number" && Number.isInteger(value) && value >= 0 && value < EXPORT_TYPES.length) {
        exportType = EXPORT_TYPES[value]!;
      }
    }
  }

  for (const [k, v] of Object.entries(record(project.export_overrides))) {
    if (["width", "height", "start_frame", "end_frame"].includes(k)) video[k] = v;
    else if (k === "fps_num") video.fps = { ...video.fps, num: v };
    else if (k === "fps_den") video.fps = { ...video.fps, den: v };
    else if (k === "video_codec" || k === "vcodec") video.vcodec = String(v);
    else if (k === "vformat" || k === "format") video.vformat = String(v);
    else if (k === "audio_codec" || k === "acodec") audio.acodec = String(v);
    else if (k === "sample_rate") audio.sample_rate = v;
    else if (k === "channels") audio.channels = v;
    else if (k === "output_path" || k === "path") defaultPath = String(v);
  }
  return { video, audio, exportType, defaultPath };
}

const FORMATS: readonly ContainerFormat[] = ["mp4", "webm", "mov", "mkv", "gif", "mp3", "wav", "png-sequence"];

/** What an agent export asks the host to render (export_video_headless with default settings). */
export function exportOptionsFor(project: Project, settings: ExportSettings, output: string | undefined): ExportOptions {
  const v = settings.video;
  const a = settings.audio;
  const fps = projectFps({ fps: { num: Number(record(v.fps).num), den: Number(record(v.fps).den) } });
  const format = (FORMATS as readonly string[]).includes(String(v.vformat)) ? (String(v.vformat) as ContainerFormat) : "mp4";
  const options: ExportOptions = {
    format,
    width: Math.trunc(Number(v.width)) || project.width,
    height: Math.trunc(Number(v.height)) || project.height,
    fps,
    videoCodec: String(v.vcodec),
    audioCodec: String(a.acodec),
    videoBitrate: Number(v.video_bitrate) || undefined,
    audioBitrate: Number(a.audio_bitrate) || undefined,
    sampleRate: Number(a.sample_rate) || undefined,
    channels: Number(a.channels) || undefined,
  };
  if (output) options.output = output;
  return options;
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
      const settings = defaultExportSettings(project);
      const output = path || (settings.defaultPath !== "export.mp4" ? settings.defaultPath : undefined);
      if (output && (project.files ?? []).some((f) => f.path === output)) {
        return "Error: Export failed: Output path is an input file. Choose a different path.";
      }
      if (maxFrame(project, projectFps(project)) <= 1) {
        return "Error: Export failed: Invalid range of frames to export.";
      }
      const options = exportOptionsFor(project, settings, output);
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
      const { video, audio, exportType, defaultPath } = defaultExportSettings(project);
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
