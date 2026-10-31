/**
 * Export tools: export_video_tool, get_export_settings_tool,
 * set_export_setting_tool.
 *
 * Port of zenvi-core develop 1f80cb3d0
 * src/classes/editor_tools/project_export_render.py (`export_video`,
 * `get_export_settings`, `set_export_setting`). What an export renders is
 * planned once, in the engine (presets/plan.ts, `build_export_plan`), from
 * the call's arguments and the defaults set_export_setting_tool stores
 * (presets/settings.ts); the host renders the plan (`ExportHost`):
 *
 * - the CLI writes files (`files`): ffmpeg renders to the planned path;
 *   relative paths and the default folder start at the project's folder
 *   (the desktop's default is its Export folder preference);
 * - the web editor renders in the browser (WebCodecs), which downloads the
 *   file under the planned name (`download`): there are no folders;
 * - Zenvi Cloud starts a render job (`job`) and answers with its render_id;
 *   get_render_status gives the download link.
 *
 * Before rendering, the host says whether it writes the container and
 * encodes the codecs (`ExportHost.supports`, the desktop's
 * FFmpegWriter.IsValidCodec); a refusal says what it can do instead. An
 * audio codec that comes from the preset (not one the call or a stored
 * setting named) is swapped for one the host has in the same container,
 * with a warning, as AAC always counts on the desktop. No web encoder
 * interlaces, so `interlaced` is refused.
 */

import { isSequenceFormat } from "../../presets/export.js";
import {
  ExportPlanError,
  exportOptionsForPlan,
  planContainer,
  planExport,
  planSummary,
  resolveExportPreset,
  storedExportOverrides,
  type ExportPlan,
  type ExportRequest,
} from "../../presets/plan.js";
import {
  EXPORT_SETTING_KEYS,
  EXPORT_SETTING_STORED_AS,
  exportSettingKey,
  isExportSettingKey,
  normSettingKey,
  parseExportSetting,
  unknownSettingMessage,
} from "../../presets/settings.js";
import { clearExportSettings, storeExportOverrides } from "../../ops/project.js";
import { contractTool, unavailable, type CatalogTool, type ToolCall, type ToolOutcome } from "../define.js";
import { pyFixed, pyFloat } from "../pyfmt.js";
import type { ToolReceipt } from "../receipt.js";
import { contractMeta } from "../schemas.gen.js";
import { readBrief } from "../../brief/brief.js";
import { houseStyle } from "../../brief/house.js";
import type { ContainerFormat, ExportHost, ExportResult } from "../types.js";
import { record, text } from "./common.js";
import { profileContext } from "./project-export-profiles.js";
import { editorRun, nothingChanged, ok, selectedClipIds, ToolError } from "./timeline-edit-common.js";
import { finishGaps, finishLines } from "../../review/finish.js";

/** The arguments that choose what to render (the desktop's), as opposed to show_dialog / overwrite. */
const EXPORT_ARGUMENTS = [
  "preset",
  "quality",
  "export_type",
  "range",
  "start",
  "end",
  "output_path",
  "folder",
  "file_name",
  "profile",
  "width",
  "height",
  "fps",
  "container",
  "video_codec",
  "audio_codec",
  "video_bitrate",
  "audio_bitrate",
  "sample_rate",
  "channels",
  "interlaced",
  "image_format",
] as const;

/** The export arguments a call sets to something other than their default. */
function exportArgumentsSet(input: Record<string, unknown>): string[] {
  const schema = contractMeta.export_video_tool.inputSchema.properties;
  return EXPORT_ARGUMENTS.filter((name) => {
    const value = input[name];
    if (value === undefined || value === null || value === "") return false;
    return JSON.stringify(value) !== JSON.stringify(schema[name]?.default);
  });
}

function requestOf(input: Record<string, unknown>): ExportRequest {
  const str = (name: string): string | undefined => (typeof input[name] === "string" ? (input[name] as string) : undefined);
  const num = (name: string): number | undefined => (typeof input[name] === "number" ? (input[name] as number) : undefined);
  return {
    preset: str("preset"),
    quality: str("quality"),
    exportType: str("export_type"),
    range: str("range"),
    start: num("start"),
    end: num("end"),
    outputPath: str("output_path"),
    folder: str("folder"),
    fileName: str("file_name"),
    profile: str("profile"),
    width: num("width"),
    height: num("height"),
    fps: num("fps"),
    container: str("container"),
    videoCodec: str("video_codec"),
    audioCodec: str("audio_codec"),
    videoBitrate: str("video_bitrate"),
    audioBitrate: str("audio_bitrate"),
    sampleRate: num("sample_rate"),
    channels: str("channels"),
    interlaced: input.interlaced === true,
    imageFormat: str("image_format"),
  };
}

/** Run a plan; its refusals are the desktop's ToolError text. */
function planning<T>(body: () => T): T {
  try {
    return body();
  } catch (error) {
    if (error instanceof ExportPlanError) throw new ToolError(error.message);
    throw error;
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The name an export gets when the call names none: the host's, else the project file's, else the desktop's. */
async function defaultExportName(call: ToolCall): Promise<string> {
  const fromHost = await call.host.exporter?.defaultName?.();
  if (fromHost?.trim()) return fromHost.trim();
  const saved = call.host.storage?.currentPath?.() ?? "";
  const name = baseName(saved);
  return /\.(zvn|osp)$/i.test(name) ? name.replace(/\.(zvn|osp)$/i, "") : "Untitled Project";
}

/** The plan a call asks for, with what the host knows (profiles, selection, default name, folders). */
async function planFor(call: ToolCall, input: Record<string, unknown>): Promise<ExportPlan> {
  const request = requestOf(input);
  const exporter = call.host.exporter;
  const files = (exporter?.delivery ?? "files") === "files";
  if (request.range?.trim().toLowerCase() === "selection" && !call.host.ui?.selectedIds) {
    throw new ToolError("range='selection' exports the clips selected in an editor's timeline, and this Zenvi surface has no timeline selection; give start/end seconds instead");
  }
  // An output path (given, else stored) that is an existing folder takes the default name, as on the desktop.
  const outputPath = request.outputPath?.trim() || storedExportOverrides(call.doc.project).output_path?.trim() || "";
  const outputIsFolder = files && outputPath !== "" && exporter?.isFolder ? await exporter.isFolder(outputPath) : false;
  const { catalog } = await profileContext(call);
  const defaultName = await defaultExportName(call);
  return planning(() => planExport(call.doc.project, request, { catalog, selectedClipIds: selectedClipIds(call), defaultName, outputIsFolder }));
}

// ---------------------------------------------------------------------------
// What the host can encode
// ---------------------------------------------------------------------------

const FORMAT_NAMES: Readonly<Record<ContainerFormat, string>> = {
  mp4: "MP4",
  mov: "MOV",
  mkv: "MKV",
  webm: "WebM",
  gif: "GIF",
  mp3: "MP3",
  wav: "WAV",
  flac: "FLAC",
  m4a: "M4A",
  "png-sequence": "PNG",
  "jpg-sequence": "JPG",
  "bmp-sequence": "BMP",
  "tiff-sequence": "TIFF",
};

/** Each container with the codecs it is tried with when listing what a host writes. */
const FORMAT_PROBES: readonly [ContainerFormat, string, string][] = [
  ["mp4", "libx264", ""],
  ["mov", "libx264", ""],
  ["mkv", "libx264", ""],
  ["webm", "libvpx-vp9", "libopus"],
  ["gif", "gif", ""],
  ["mp3", "", "libmp3lame"],
  ["wav", "", "pcm_s16le"],
  ["flac", "", "flac"],
  ["m4a", "", ""],
  ["png-sequence", "png", ""],
  ["jpg-sequence", "mjpeg", ""],
  ["bmp-sequence", "bmp", ""],
  ["tiff-sequence", "tiff", ""],
];
const VIDEO_CODECS = ["libx264", "libx265", "libvpx-vp9", "libvpx", "libsvtav1", "libaom-av1", "prores_ks", "mpeg4", "gif"] as const;
const AUDIO_CODECS = ["aac", "libopus", "libvorbis", "libmp3lame", "flac", "pcm_s16le"] as const;
/** AAC always counts as encodable (the desktop's rule: FFmpeg falls back to its own encoder). */
const AAC = new Set(["aac", "libfaac", "libvo_aacenc", "libfdk_aac"]);
/** What a container's sound becomes when the preset's audio codec is not available here, in order. */
const AUDIO_FALLBACKS: Readonly<Partial<Record<ContainerFormat, readonly string[]>>> = {
  mp4: ["aac"],
  mov: ["aac"],
  mkv: ["aac"],
  m4a: ["aac"],
  webm: ["libopus", "libvorbis"],
  mp3: ["libmp3lame"],
  wav: ["pcm_s16le"],
  flac: ["flac"],
};

function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "MP4, MOV, … and PNG, JPG image sequences": what this host writes. */
async function writableFormats(exporter: ExportHost): Promise<string> {
  const files: string[] = [];
  const frames: string[] = [];
  for (const [format, video, audio] of FORMAT_PROBES) {
    if (exporter.supports && !(await exporter.supports(format, video, audio))) continue;
    (isSequenceFormat(format) ? frames : files).push(FORMAT_NAMES[format]);
  }
  const parts = [listWords(files), frames.length > 0 ? `${listWords(frames)} image sequences` : ""].filter(Boolean);
  return parts.length > 0 ? `it can export ${parts.join(", and ")}` : "it cannot export anything";
}

/** The codecs of `candidates` this host encodes in `format`. */
async function encodable(exporter: ExportHost, format: ContainerFormat, kind: "video" | "audio", candidates: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const codec of candidates) {
    const ok = await exporter.supports!(format, kind === "video" ? codec : "", kind === "audio" ? codec : "");
    if (ok) out.push(codec);
  }
  return out;
}

/** What the plan writes, in words: "MP4", "PNG image sequences". */
function formatWords(format: ContainerFormat): string {
  return isSequenceFormat(format) ? `${FORMAT_NAMES[format]} image sequences` : `${FORMAT_NAMES[format]} files`;
}

/**
 * Check the plan against the host's encoders before anything renders.
 * Returns the audio codec to use instead of the preset's (when the host
 * lacks it) and the warnings to report.
 */
async function checkEncoders(exporter: ExportHost, plan: ExportPlan, format: ContainerFormat, presetAudio: boolean): Promise<{ audioCodec?: string; warnings: string[] }> {
  const warnings: string[] = [];
  const supports = exporter.supports;
  if (!supports) return { warnings };
  const frame = { width: plan.width, height: plan.height, fps: plan.fps };
  if (!(await supports(format, "", "", frame))) {
    throw new ToolError(`this Zenvi surface cannot write ${formatWords(format)}; ${await writableFormats(exporter)}. Pick one with container= or preset=`);
  }
  const video = plan.export_type === "audio_only" ? "" : plan.vcodec;
  if (video && !(await supports(format, video, "", frame))) {
    const options = await encodable(exporter, format, "video", VIDEO_CODECS.filter((c) => c !== video));
    const there = options.length > 0 ? `it encodes ${listWords(options)} there` : `it encodes no video in ${FORMAT_NAMES[format]}`;
    throw new ToolError(`this Zenvi surface cannot encode video codec '${video}' in ${FORMAT_NAMES[format]}; ${there}. Pass video_codec=, or another preset or container`);
  }
  const audio = plan.export_type === "video_audio" || plan.export_type === "audio_only" ? plan.acodec : "";
  if (!audio || AAC.has(audio.toLowerCase()) || (await supports(format, "", audio, frame))) return { warnings };
  if (presetAudio) {
    for (const alternative of AUDIO_FALLBACKS[format] ?? []) {
      if (AAC.has(alternative) || (await supports(format, "", alternative, frame))) {
        warnings.push(`This Zenvi surface cannot encode '${audio}' audio; the sound is ${alternative} instead (the same ${FORMAT_NAMES[format]} file otherwise).`);
        return { audioCodec: alternative, warnings };
      }
    }
  }
  const options = await encodable(exporter, format, "audio", AUDIO_CODECS.filter((c) => c !== audio));
  const there = options.length > 0 ? `it encodes ${listWords(options)} there` : `it encodes no audio in ${FORMAT_NAMES[format]}`;
  throw new ToolError(`this Zenvi surface cannot encode audio codec '${audio}' in ${FORMAT_NAMES[format]}; ${there}. Pass audio_codec=, or another preset or container`);
}

/** The first file of a `%05d` pattern ("clip-00001.png"). */
function firstFrameOf(pattern: string): string {
  return pattern.replace(/%0?(\d*)d/, (_match, width: string) => "1".padStart(Number(width) || 1, "0"));
}

const WHAT: Readonly<Record<ExportPlan["export_type"], string>> = {
  video_audio: "video",
  video_only: "video (no audio)",
  audio_only: "audio",
  image_sequence: "image sequence",
};

/** The export_video_tool receipt (`export_video`'s `ok(summary, …)`). */
function exportReceipt(call: ToolCall, plan: ExportPlan, result: ExportResult, warnings: string[]): ToolReceipt {
  const seconds = plan.end_seconds - plan.start_seconds;
  const what = WHAT[plan.export_type];
  const frame = plan.export_type === "audio_only" ? "" : `, ${plan.width}x${plan.height} at ${pyFloat(plan.fps)} fps`;
  const notes = plan.notes.length > 0 ? ` Note: ${plan.notes.join("; ")}.` : "";
  const summaryOf = planSummary(plan);
  let receipt: ToolReceipt;
  if (result.job) {
    const name = baseName(result.location);
    const summary =
      `Started rendering ${pyFixed(seconds, 2)}s of ${what} with '${plan.preset}' (${plan.quality})${frame} as ${name}: ` +
      `render ${result.job.id} is ${result.job.status}. ${result.job.followUp}${notes}`;
    receipt = ok(call, summary, {
      render_id: result.job.id,
      status: result.job.status,
      duration_seconds: Number(pyFixed(seconds, 3)),
      notes: plan.notes,
      ...summaryOf,
      path: name,
    });
  } else {
    const size = result.bytes ?? 0;
    const summary = `Exported ${pyFixed(seconds, 2)}s of ${what} with '${plan.preset}' (${plan.quality}) to ${result.location} (${pyFixed(size / 1048576.0, 1)} MB)${frame}.${notes}`;
    const extra: Record<string, unknown> =
      plan.export_type === "image_sequence" ? { frame_files: result.frames ?? plan.end_frame - plan.start_frame + 1, first_frame: firstFrameOf(result.location) } : {};
    receipt = ok(call, summary, { size_bytes: size, duration_seconds: Number(pyFixed(seconds, 3)), notes: plan.notes, ...summaryOf, path: result.location, ...extra });
  }
  receipt.warnings = warnings;
  // The finish the director owes every edit (review/finish.ts): what is missing, with the calls that close it.
  // In notes and data only: the summary is the desktop's export_video text.
  const gaps = plan.export_type === "audio_only" ? [] : finishGaps(call.doc.project);
  if (gaps.length > 0) {
    receipt.notes = [...receipt.notes, ...finishLines(gaps)];
    if (receipt.data && typeof receipt.data === "object") (receipt.data as Record<string, unknown>).finish = gaps;
  }
  return receipt;
}

/** export_video_tool when it renders. */
async function exportVideo(call: ToolCall, input: Record<string, unknown>): Promise<ToolOutcome> {
  const exporter = call.host.exporter;
  if (!exporter) return unavailable("export_video_tool", "it needs video rendering, which this host does not provide.");
  if (input.interlaced === true) {
    throw new ToolError("this Zenvi surface cannot export interlaced video: its encoders write progressive frames only (Zenvi desktop can). Call it again without interlaced");
  }
  const delivery = exporter.delivery ?? "files";
  if (delivery !== "files" && text(input.folder)) {
    const where = delivery === "download" ? "the browser downloads the file" : "Zenvi Cloud answers with a download link";
    throw new ToolError(`this Zenvi surface has no folders (${where}); call it again without folder (file_name names the file)`);
  }
  const plan = await planFor(call, input);
  const format = planContainer(plan);
  if (!format) {
    const kind = plan.export_type === "image_sequence" ? `${plan.vformat.toUpperCase()} image sequences` : `${plan.vformat.toUpperCase()} files`;
    throw new ToolError(`this Zenvi surface cannot write ${kind} (Zenvi desktop can); ${await writableFormats(exporter)}. Pick one with container= or preset=`);
  }
  const ov = storedExportOverrides(call.doc.project);
  const presetAudio = !text(input.audio_codec) && !ov.audio_codec && plan.acodec === resolveExportPreset(plan.preset).audioCodec;
  const { audioCodec, warnings } = await checkEncoders(exporter, plan, format, presetAudio);
  const project = call.doc.toJSON();
  if ((project.files ?? []).some((f) => f.path === plan.path)) throw new ToolError(`${plan.path} is one of the project's input files; choose a different name`);
  const options = exportOptionsForPlan(plan)!;
  if (audioCodec) options.audioCodec = audioCodec;
  // A cinetic house style ships its gradients dithered (its finishing pass): the brief says which style this is.
  const brief = readBrief(call.doc.project);
  if (brief && houseStyle(brief.style)?.profile === "cinetic") options.deband = true;
  if (delivery !== "files" && /[\\/]/.test(plan.path)) {
    const name = baseName(plan.path);
    options.output = name;
    warnings.push(`This Zenvi surface has no folders: the file is named ${name}.`);
  }
  let result: ExportResult;
  try {
    result = await exporter.export(project, options);
  } catch (error) {
    throw new ToolError(`export failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // The receipt names the audio codec the file has.
  return exportReceipt(call, audioCodec ? { ...plan, acodec: audioCodec } : plan, result, [...warnings, ...(result.warnings ?? [])]);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function storedOverrides(call: ToolCall): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record(call.doc.project.export_overrides)).filter(([, v]) => v !== null && v !== undefined));
}

/**
 * set_export_setting(clear=True): remove the stored override for `key`
 * (every override when key is empty), outside the undo history like a
 * setting the Export dialog remembers. Besides the desktop's storage keys,
 * a key an earlier web version stored under its own name is cleared too.
 */
function clearOverrides(call: ToolCall, key: unknown): ToolOutcome {
  const raw = normSettingKey(key);
  const k = exportSettingKey(key);
  const current = record(call.doc.project.export_overrides);
  const stored = (name: string): boolean => current[name] !== undefined && current[name] !== null;
  let targets: string[];
  if (!k) targets = Object.keys(current).filter(stored);
  else {
    const names = [...new Set([...(EXPORT_SETTING_STORED_AS[k] ?? [k]), k, raw])];
    targets = names.filter(stored);
    if (targets.length === 0 && !isExportSettingKey(k)) throw new ToolError(unknownSettingMessage(key));
  }
  if (targets.length === 0) return nothingChanged(call, "No stored override to clear.", { cleared: [], overrides: storedOverrides(call) });
  clearExportSettings(call.doc, targets);
  return ok(call, `Cleared ${targets.join(", ")}.`, { cleared: targets, overrides: storedOverrides(call) });
}

/** set_export_setting: check and store one export default (not an undo step). */
async function storeOverride(call: ToolCall, key: unknown, value: unknown): Promise<ToolOutcome> {
  const k = exportSettingKey(key);
  if (!k) throw new ToolError(`give key and value; valid keys: ${Object.keys(EXPORT_SETTING_KEYS).join(", ")}`);
  if (!isExportSettingKey(k)) throw new ToolError(unknownSettingMessage(key));
  const values = planning(() => parseExportSetting(k, value, call.doc.project));
  const codec = k === "video_codec" || k === "audio_codec" ? String(values[k]) : "";
  const supports = call.host.exporter?.supports;
  // MKV holds every codec the exporters know, so it asks only whether the codec can be encoded here.
  if (codec && supports && !(k === "audio_codec" && AAC.has(codec.toLowerCase()))) {
    const ok = k === "video_codec" ? await supports("mkv", codec, "") : await supports("mkv", "", codec);
    if (!ok) throw new ToolError(`this Zenvi surface cannot encode '${codec}'`);
  }
  const current = record(call.doc.project.export_overrides);
  const shown = String(value ?? "").trim();
  if (Object.entries(values).every(([name, v]) => current[name] === v)) {
    return nothingChanged(call, `${k} is already ${shown}.`, { overrides: storedOverrides(call) });
  }
  // Not an undo step on the desktop (`_ignore_history`): written untracked.
  storeExportOverrides(call.doc, values);
  return ok(call, `Stored export ${k} = ${shown}.`, { changed: true, stored: values, overrides: storedOverrides(call) });
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const exportTools: CatalogTool[] = [
  contractTool("export_video_tool", {
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (call, input) =>
      editorRun(async () => {
        const args = input as Record<string, unknown>;
        // The Assistant's default opens the editor's Export dialog; arguments that say what to render render it.
        const openUi = !["0", "false", "no"].includes(String(args.show_dialog ?? "true").toLowerCase().trim());
        if (openUi && exportArgumentsSet(args).length === 0 && call.host.ui?.openExportDialog) {
          call.host.ui.openExportDialog();
          return ok(call, "Opened the Export Video dialog for the user; nothing was rendered.", { dialog_opened: true });
        }
        return exportVideo(call, args);
      }),
  }),

  contractTool("get_export_settings_tool", {
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    run: (call) =>
      editorRun(async () => {
        const overrides = storedOverrides(call);
        let effective: Record<string, unknown> | null = null;
        let notes: string[];
        try {
          const plan = await planFor(call, {});
          effective = planSummary(plan);
          notes = plan.notes;
        } catch (error) {
          if (!(error instanceof ToolError)) throw error;
          notes = [error.message];
        }
        const summary = effective
          ? `Next export: '${String(effective.preset)}' ${String(effective.quality)} ${String(effective.export_type)} ` +
            `${String(effective.width)}x${String(effective.height)} ${pyFloat(Number(effective.fps))} fps, ` +
            `${pyFloat(Number(effective.start_seconds))}-${pyFloat(Number(effective.end_seconds))}s -> ${String(effective.path)}.`
          : `Nothing to export yet: ${notes.join("; ")}`;
        return ok(call, summary, { effective, overrides, notes, valid_keys: EXPORT_SETTING_KEYS });
      }),
  }),

  contractTool("set_export_setting_tool", {
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
    run: (call, input) => editorRun(() => (input.clear ? clearOverrides(call, input.key) : storeOverride(call, input.key, input.value))),
  }),
];

