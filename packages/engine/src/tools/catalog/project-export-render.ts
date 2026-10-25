/**
 * Export presets, frames and files: list_export_presets_tool,
 * save_frame_image_tool, export_files_to_folder_tool.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export_render.py and
 * src/windows/export_clips.py (names of exported files, sub-clip frames).
 *
 * Where the files go is the host's (StorageHost.writeBytes / exportMedia):
 * the CLI writes them on disk (relative paths start at the project's
 * folder, the desktop's default is its export folder), Zenvi Cloud answers
 * with a download link, the web editor downloads them. A preset is
 * available when the engine's exporters write its container and the host
 * can encode its codecs (ExportHost.supports, the desktop's
 * FFmpegWriter.IsValidCodec).
 */

import { ProjectDocument } from "../../history/document.js";
import { bytesFromBase64 } from "../../io/png.js";
import { createProject } from "../../model/defaults.js";
import { profileKey, reducedDisplayRatio, type Profile } from "../../model/profiles.js";
import { pyRound } from "../../model/rounding.js";
import type { Fraction, Project, ProjectFile } from "../../model/types.js";
import { addClip } from "../../ops/clips.js";
import { EXPORT_PRESETS, presetExportType, type ExportPreset } from "../../presets/catalog.js";
import { exportContainer } from "../../presets/export.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall } from "../define.js";
import { projectFps } from "../frame-time.js";
import { pyFixed, pyReprString } from "../pyfmt.js";
import type { ExportOptions, MediaRender } from "../types.js";
import { fileById, playheadSeconds, text } from "./common.js";
import { editorRun, ok, ToolError } from "./timeline-edit-common.js";

const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true } as const;

const pyCompare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** Whether this host can export a preset (`_codec_ok` for its video and audio codecs; AAC always counts). */
async function presetAvailable(call: ToolCall, preset: ExportPreset): Promise<boolean> {
  const exportTo = presetExportType(preset);
  const container = exportContainer(preset.videoFormat, exportTo);
  if (!container) return false;
  const supports = call.host.exporter?.supports;
  if (!supports) return true;
  const video = exportTo === "Audio Only" ? "" : preset.videoCodec;
  const audio = exportTo === "Video Only" || preset.audioCodec === "aac" ? "" : preset.audioCodec;
  return call.host.exporter!.supports!(container, video, audio);
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** `_timeline_bounds`: first clip start to last clip end, or null on an empty timeline. */
function timelineBounds(project: Project): [number, number] | null {
  if (project.clips.length === 0) return null;
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const c of project.clips) {
    const position = Number(c.position) || 0;
    start = Math.min(start, position);
    end = Math.max(end, position + Math.max(0, (Number(c.end) || 0) - (Number(c.start) || 0)));
  }
  return [start, end];
}

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

// ---------------------------------------------------------------------------
// Files (windows/export_clips.py)
// ---------------------------------------------------------------------------

const SEQUENCE_FORMAT_RE = /%(?:0\d+)?d/;

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** `os.path.splitext`: [root, ext]. */
function splitExt(path: string): [string, string] {
  const name = baseName(path);
  const leading = /^\.*/.exec(name)![0].length;
  const dot = name.lastIndexOf(".");
  if (dot < leading) return [path, ""];
  const cut = path.length - (name.length - dot);
  return [path.slice(0, cut), path.slice(cut)];
}

/** `makeLegalFileName`: lower case, only word characters, spaces and dashes. */
function legalFileName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "").trim();
}

/** A sub-clip (a Project Files entry with in/out points, `isClip`). */
function isSubclip(file: ProjectFile): boolean {
  return "start" in file && "end" in file;
}

function isSequence(file: ProjectFile): boolean {
  return SEQUENCE_FORMAT_RE.test(baseName(String(file.path ?? "")));
}

function fileFps(file: ProjectFile): Fraction {
  const fps = (file.fps ?? {}) as { num?: unknown; den?: unknown };
  const num = Math.trunc(Number(fps.num)) || 30;
  const den = Math.trunc(Number(fps.den)) || 1;
  return { num, den };
}

/** `fileDurationSeconds`: frames / rate. */
function fileDurationSeconds(file: ProjectFile): number {
  const fps = fileFps(file);
  return Math.trunc(Number(file.video_length) || 0) / (fps.num / fps.den);
}

/** `nameOfExport` / `nameOfImageSequenceExport`. */
export function exportedFileName(file: ProjectFile): string {
  const path = String(file.path ?? "");
  if (isSubclip(file)) {
    const fallback = splitExt(path || "openshot_clip")[0];
    const name = legalFileName("name" in file ? String(file.name ?? "") : fallback);
    return `${name} [${pyFixed(Number(file.start), 2)} - ${pyFixed(Number(file.end), 2)}].mp4`;
  }
  const seconds = pyFixed(fileDurationSeconds(file), 2);
  if (isSequence(file)) {
    let name = splitExt(baseName(path))[0];
    if ("name" in file) name = String(file.name ?? "");
    name = legalFileName(splitExt(name)[0].replace(new RegExp(SEQUENCE_FORMAT_RE.source, "g"), ""));
    return `${name} [0.00 - ${seconds}].mp4`;
  }
  const [root, ext] = splitExt(baseName(path));
  return `${legalFileName(root)} [0.00 - ${seconds}]${ext}`;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * The project and options that render a sub-clip or an image sequence as
 * H.264/AAC MP4 at the file's own size and rate (`startAndEndFrames`,
 * `setupWriter`: libx264 at quality 22, AAC 192 kb/s).
 */
export function partRender(file: ProjectFile): MediaRender {
  const fps = fileFps(file);
  const rate = fps.num / fps.den;
  const inPoint = isSubclip(file) ? Number(file.start) || 0 : 0;
  const outPoint = isSubclip(file) ? Number(file.end) || inPoint : fileDurationSeconds(file);
  const startFrame = Math.max(1, pyRound(inPoint * rate) + 1);
  const endFrame = Math.max(startFrame - 1, pyRound(outPoint * rate));
  if (endFrame < startFrame) throw new ToolError("it is shorter than one frame");
  const width = positiveInt(file.width, 1280);
  const height = positiveInt(file.height, 720);
  const pixel = (file.pixel_ratio ?? { num: 1, den: 1 }) as Fraction;
  const record = {
    description: "Export",
    width,
    height,
    fps,
    progressive: true,
    pixel_ratio: { num: positiveInt(pixel.num, 1), den: positiveInt(pixel.den, 1) },
    display_ratio: reducedDisplayRatio(width, height, positiveInt(pixel.num, 1), positiveInt(pixel.den, 1)),
  };
  const profile: Profile = { ...record, key: profileKey(record) };
  const doc = new ProjectDocument(createProject({ profile }));
  const layer = doc.project.layers[0]?.number ?? 1000000;
  doc.transaction("Export", (tx) => {
    tx.insert(["files"], structuredClone(file));
    addClip(tx, { fileId: file.id, position: 0, layer, start: (startFrame - 1) / rate, end: endFrame / rate });
  });
  const hasAudio = Boolean(file.has_audio);
  const options: ExportOptions = { format: "mp4", width, height, fps, videoCodec: "libx264", crf: 22, channels: 0 };
  if (hasAudio) {
    options.audioCodec = "aac";
    options.audioBitrate = positiveInt(file.audio_bit_rate, 192000);
    options.sampleRate = positiveInt(file.sample_rate, 48000);
    options.channels = positiveInt(file.channels, 2);
  }
  return { project: doc.project, options };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const projectRenderTools: CatalogTool[] = [
  contractTool("list_export_presets_tool", {
    annotations: READ,
    requires: ["exporter"],
    run: async (call, input) => {
      const category = input.category ?? "";
      const tokens = (input.query ?? "").toLowerCase().split(/[\s,()]+/).filter(Boolean);
      const rows: Record<string, unknown>[] = [];
      const seen = new Set<string>();
      for (const p of EXPORT_PRESETS) {
        if (seen.has(p.title)) continue;
        if (category && p.type !== category) continue;
        if (tokens.length > 0 && !tokens.every((t) => p.title.toLowerCase().includes(t))) continue;
        const available = await presetAvailable(call, p);
        if (!available && !input.include_unavailable) continue;
        seen.add(p.title);
        const qualities: Record<string, { video: string; audio: string }> = {};
        for (const [q, key] of [["low", "low"], ["med", "med"], ["high", "high"]] as const) {
          const video = p.videoBitrate[key];
          const audio = p.audioBitrate[key];
          if (video || audio) qualities[q] = { video, audio };
        }
        rows.push({
          title: p.title,
          category: p.type,
          export_to: presetExportType(p),
          format: p.videoFormat,
          video_codec: p.videoCodec,
          audio_codec: p.audioCodec,
          available,
          qualities,
          profiles: p.profiles.length > 0 ? [...p.profiles] : "any",
          user: false,
        });
      }
      rows.sort(
        (a, b) =>
          Number(a.category !== "Web") - Number(b.category !== "Web") ||
          pyCompare(String(a.category), String(b.category)) ||
          pyCompare(String(a.title), String(b.title)),
      );
      return ok(call, `${rows.length} export preset(s).`, { presets: rows });
    },
  }),

  contractTool("save_frame_image_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["frames"],
    run: (call, input) =>
      editorRun(async () => {
        const project = call.doc.project;
        const bounds = timelineBounds(project);
        if (!bounds) throw new ToolError("the timeline is empty");
        const time = input.time ?? -1;
        const seconds = time < 0 ? playheadSeconds(call) : time;
        if (seconds > bounds[1]) throw new ToolError(`${pyFixed(seconds, 3)}s is after the end of the last clip (${pyFixed(bounds[1], 3)}s)`);
        const fps = projectFps(project);
        const rate = fps.num / fps.den;
        const frame = pyRound(Math.max(0, seconds) * rate) + 1;
        const frameName = `Frame-${String(frame).padStart(5, "0")}.png`;
        let path = text(input.file_path);
        if (!path) path = frameName;
        else if (/[\\/]$/.test(path)) path += frameName;
        let ext = extensionOf(path);
        if (![".png", ".jpg", ".jpeg"].includes(ext)) {
          path += ".png";
          ext = ".png";
        }
        const format = ext === ".png" ? "png" : "jpeg";
        const at = (frame - 1) / rate;
        const image = await call.host.frames!.renderFrame(project, at, { width: project.width, format });
        const warnings: string[] = [];
        // A host that renders only PNG: the file says what it holds.
        if (image.mimeType === "image/png" && format === "jpeg") {
          path = `${path.slice(0, path.length - ext.length)}.png`;
          warnings.push("This Zenvi surface renders frames as PNG: saved as .png.");
        }
        const bytes = bytesFromBase64(image.data);
        const data = { path, frame, time: Number(pyFixed(at, 3)), width: project.width, height: project.height, size_bytes: bytes.length };
        const storage = call.host.storage;
        if (!storage?.writeBytes) {
          warnings.push(`This Zenvi surface writes no files: the frame is attached to this result instead of saved to ${path}.`);
          const receipt = ok(call, `Rendered frame ${frame} (${pyFixed(at, 3)}s); attached to this result.`, { ...data, frame_attached: true });
          receipt.warnings = warnings;
          return { receipt, images: [image] };
        }
        let location: string;
        try {
          location = await storage.writeBytes(path, bytes, image.mimeType, { overwrite: Boolean(input.overwrite) });
        } catch (error) {
          if (hasCode(error, "EEXIST")) throw new ToolError(`${(error as { path?: string }).path ?? path} already exists; pass overwrite=true`);
          throw new ToolError(`the frame could not be saved to ${path}: ${error instanceof Error ? error.message : String(error)}`);
        }
        const receipt = ok(call, `Saved frame ${frame} (${pyFixed(at, 3)}s) as ${location}.`, { ...data, path: location });
        receipt.warnings = warnings;
        return receipt;
      }),
  }),

  contractTool("export_files_to_folder_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call, input) =>
      editorRun(async () => {
        const project = call.doc.project;
        const files: ProjectFile[] = [];
        for (const raw of input.file_ids ?? []) {
          const file = fileById(project, String(raw).trim());
          if (!file) throw new ToolError(`no project file with id=${pyReprString(String(raw))}`);
          files.push(file);
        }
        if (files.length === 0) throw new ToolError("give at least one file id");
        const storage = call.host.storage;
        if (!storage?.exportMedia) {
          return unavailable(call.tool, "it needs a place to put copies of media (local files, downloads or download links), which this host does not provide.");
        }
        const folder = text(input.folder);
        let where = folder;
        const results: Record<string, unknown>[] = [];
        for (const file of files) {
          const entry: Record<string, unknown> = { file_id: file.id, source: file.path ?? null };
          try {
            const name = exportedFileName(file);
            const render = isSubclip(file) || isSequence(file) ? partRender(file) : undefined;
            if (render && !call.host.exporter) throw new Error("a sub-clip or image sequence is rendered to MP4, which needs video rendering (this host has none)");
            const done = await storage.exportMedia(file, name, folder, render);
            entry.path = done.location;
            entry.status = done.existed ? "skipped (exists)" : render ? "rendered" : "copied";
            where = done.folder;
          } catch (error) {
            entry.status = "error";
            entry.error = error instanceof Error ? error.message : String(error);
          }
          results.push(entry);
        }
        const errors = results.filter((r) => r.status === "error");
        const done = results.filter((r) => r.status === "copied" || r.status === "rendered");
        if (errors.length > 0 && done.length === 0) {
          throw new ToolError(`could not export: ${errors.map((r) => `${String(r.source)}: ${String(r.error)}`).join("; ")}`);
        }
        const already = results.length - done.length - errors.length;
        const summary =
          `Exported ${done.length} file(s) to ${where}` + (already ? `; ${already} already there` : "") + (errors.length ? `; ${errors.length} failed` : "") + ".";
        return ok(call, summary, { folder: where, files: results });
      }),
  }),
];
