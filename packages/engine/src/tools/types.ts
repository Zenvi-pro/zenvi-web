/**
 * Tool catalog contract.
 *
 * A tool is one user intent: validated input in, one undo step (or none) out,
 * and a result the caller can show a person or feed back to a model. The same
 * definitions serve:
 *
 *   - the Zenvi Assistant bridge (backend `tool_call` → `tool_result.result`)
 *   - the local MCP server (`zenvi mcp`) and the remote MCP server (cloud)
 *   - the CLI (`zenvi call <tool>` and the friendlier subcommands)
 *   - the web editor's command palette and gestures
 *
 * Platform capabilities (playback, file import, rendering, backend access) are
 * injected through `ToolHost`. A tool that needs a capability its host lacks
 * returns an error result; it never throws for user-facing failures.
 */

import type { z } from "zod";
import type { Transcription } from "../analysis/transcription.js";
import type { ProjectDocument } from "../history/document.js";
import type { CloudMediaRef, FileFingerprint, Project, ProjectFile, ReaderInfo } from "../model/types.js";
import type { Scene3dId, Scene3dParams } from "../scenes3d/catalog.js";
import type { FreesoundSound, PexelsVideo } from "../stock/stock.js";
import type { Scene3dQuality, Scene3dRender } from "../scenes3d/link.js";
import type { WebVideoDownload, WebVideoRequest } from "../web-video/web-video.js";

export type ToolSurface = "assistant" | "mcp" | "cli" | "editor";

/** MCP tool annotations (spec 2025-06-18). */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolImage {
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  /** Base64 without a data: prefix. */
  data: string;
}

export interface ToolResult<D = unknown> {
  ok: boolean;
  /**
   * Text for a person or a model. Assistant bridge sends this as `result`.
   * Failures start with "Error:" (backend convention: tool_bridge treats a
   * result starting with "Error" as a failed call).
   */
  text: string;
  /** Structured payload / receipt (MCP `structuredContent`). */
  data?: D;
  /** Frames for the model to look at (MCP image content). */
  images?: ToolImage[];
}

/** What a mutating tool changed, so callers can chain without re-reading. */
export interface Receipt {
  created?: { kind: ObjectKind; id: string }[];
  updated?: { kind: ObjectKind; id: string }[];
  deleted?: { kind: ObjectKind; id: string }[];
  /** Undo label of the transaction this call recorded, if any. */
  undo?: string;
  [key: string]: unknown;
}

export type ObjectKind = "clip" | "file" | "transition" | "effect" | "track" | "marker" | "project";

export interface ToolContext {
  doc: ProjectDocument;
  host: ToolHost;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Host capabilities
// ---------------------------------------------------------------------------

export interface ImportedMedia {
  /** Where the host can read the bytes later (local path, OPFS path, URL…). */
  path: string;
  info: ReaderInfo;
  name?: string;
  fingerprint?: FileFingerprint;
  cloud?: CloudMediaRef;
}

/** What `MediaHost.listPaths` found for one import entry. */
export interface PathListing {
  /** `directory`: `files` is every file under it, recursively, sorted per folder. */
  kind: "file" | "directory" | "glob" | "missing";
  files: string[];
  /** The entry as the host resolved it (an absolute local path), when it can say. */
  path?: string;
}

export interface MediaHost {
  /** Probe media the host can reach and return libopenshot-style reader info. */
  probe(path: string): Promise<ReaderInfo>;
  /** Make a local file available to the project (CLI: path on disk). */
  importPath?(path: string): Promise<ImportedMedia>;
  /**
   * Expand one import entry (a file, a folder, a glob, a file:// URL) into
   * files, like the desktop's import_files_tool. The engine filters folder
   * contents by media extension.
   */
  listPaths?(entry: string): Promise<PathListing>;
  /**
   * Copy media stored outside the project's folder into its assets folder
   * (`<project>_assets/media`), keeping the originals (File > Collect Media).
   * Skips files already in the assets folder, bundled assets, image
   * sequences and missing files. Changes nothing in the project.
   */
  collect?(files: readonly { id: string; path: string }[]): Promise<CollectedMedia>;
  /** Asset copies whose recorded original (`original_path`) is still there, byte for byte. Reads only. */
  reclaimable?(files: readonly { id: string; path: string; original: string }[]): Promise<ReclaimableMedia>;
  /** Delete asset copies (once the project is saved pointing at their originals). */
  removeCopies?(paths: readonly string[]): Promise<{ removed: string[]; errors: string[] }>;
  /** Download a URL and make it available to the project. */
  importUrl?(url: string, options?: { filename?: string; signal?: AbortSignal }): Promise<ImportedMedia>;
  /** Ask the person to pick files (web). */
  pickFiles?(): Promise<ImportedMedia[]>;
  /** Write generated bytes (titles, TTS audio) and return a path the renderer can read. */
  writeGenerated?(name: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /**
   * Which project files have no media this host can read (moved, deleted,
   * never uploaded): the desktop's "media missing on disk"
   * (media_files.media_missing). One flag per file, in order.
   */
  missing?(files: readonly ProjectFile[]): Promise<boolean[]>;
  /**
   * Fetch the video of a web page (YouTube and other sites, with yt-dlp) or
   * a direct media link into this computer's cache, for
   * ingest_web_video_tool; the tool imports the file with `importPath`.
   * Only hosts on the person's own computer have it (the CLI): hosted
   * surfaces do not download third-party pages. Rejects with a
   * `WebVideoError` in words (no yt-dlp, a private address, a failed pull).
   */
  fetchWebVideo?(request: WebVideoRequest): Promise<WebVideoDownload>;
  /**
   * Run detectors over a rendered video file (`path` as an export was given
   * it): black and frozen picture, picture cuts, silence, and EBU R128
   * loudness with true peak, for review_render_tool. The engine sets the
   * thresholds and reads the verdicts. Hosts with ffmpeg have it (the CLI,
   * Zenvi Cloud's workers).
   */
  inspectRender?(path: string, options: RenderInspectOptions): Promise<RenderInspection>;
}

/** Detector thresholds for `MediaHost.inspectRender`. */
export interface RenderInspectOptions {
  /** Shortest black stretch reported, seconds. */
  blackMinSeconds: number;
  /** A pixel at or below this brightness (0-1) counts as black. */
  blackPixel: number;
  /** Shortest frozen stretch reported, seconds. */
  freezeMinSeconds: number;
  /** Frame-to-frame change below this (dB) counts as frozen. */
  freezeNoiseDb: number;
  /** Scene-change score (0-100) at or above which a frame starts a new shot. */
  sceneThreshold: number;
  /** Audio below this (dBFS) counts as silent. */
  silenceDb: number;
  /** Shortest silence reported, seconds. */
  silenceMinSeconds: number;
  signal?: AbortSignal;
}

export interface TimeRange {
  start: number;
  end: number;
}

/** What `MediaHost.inspectRender` found in a file. Times are seconds from its start. */
export interface RenderInspection {
  /** The file as the host resolved it: where `probe` and the frame renderer find it. */
  path: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  black: TimeRange[];
  frozen: TimeRange[];
  /** Frames that start a new shot, with their scene-change score (0-100). */
  cuts: { time: number; score: number }[];
  silences: TimeRange[];
  /** EBU R128 of the mix; null without an audio stream. A value is null when the audio is silent. */
  loudness: { integratedLufs: number | null; rangeLu: number | null; truePeakDb: number | null } | null;
}

export interface PlayerHost {
  readonly playhead: number;
  readonly playing: boolean;
  /** Playback speed while playing (1 = normal, negative = backwards); omitted = 1. */
  readonly rate?: number;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
}

/** What an editor has selected, by kind, in selection order. */
export interface EditorSelection {
  clips: string[];
  transitions: string[];
  /** Clip effects shown in the Properties panel. */
  effects: string[];
}

/** An editor's timeline view: zoom, scroll and the toolbar's modes. */
export interface TimelineView {
  /** The zoom: timeline seconds per 100 screen pixels. */
  secondsPer100px: number;
  /** Timeline seconds across the visible width. */
  visibleSeconds: number;
  /** First and last visible timeline second. */
  visibleRange: [number, number];
  /** Toolbar modes; null when this editor has no such mode. */
  snapping: boolean | null;
  razor: boolean | null;
  timing: boolean | null;
}

export type TimelineMode = "snapping" | "razor" | "timing";

export interface UiHost {
  zoomIn(): void;
  zoomOut(): void;
  centerOnPlayhead(): void;
  selectedIds?(): string[];
  /** The selection by kind (what the Properties panel shows and scope='selected' uses). */
  selection?(): EditorSelection;
  /** Replace the selection; a selected effect shows in the Properties panel with its clip. */
  setSelection?(selection: EditorSelection): void;
  /** Bring the Properties panel to the front. */
  showProperties?(): void;
  /** The timeline view, or null while no timeline is on screen. */
  timelineView?(): TimelineView | null;
  /** Zoom and scroll so timeline seconds [start, end] fill the timeline's width. */
  showTimelineRange?(start: number, end: number): void;
  /** Switch a toolbar mode on or off (only modes `timelineView` reports as non-null). */
  setTimelineMode?(mode: TimelineMode, on: boolean): void;
  openImportDialog?(): void;
  openExportDialog?(): void;
  notify?(message: string, level?: "info" | "warning" | "error"): void;
  /** The editor's panels and window state (View menu). */
  layout?(): EditorLayout;
  /** Open or close panels, or put them back where they start ("simple"). Returns the layout after. */
  setLayout?(change: LayoutChange): EditorLayout;
  /** The editor's own settings, as Preferences entries. */
  preferences?(): PreferenceEntry[];
  /** Store one setting the engine validated against its entry, and apply it. */
  setPreference?(key: string, value: PreferenceValue): void;
  /** Drop cached preview frames, filmstrips and waveforms; they are drawn again when shown. */
  clearPlaybackCache?(): void;
}

/** A panel of an editor window (the desktop's docks). */
export interface EditorPanel {
  /** What show_panels / hide_panels take, e.g. "Project Files", "Properties". */
  name: string;
  open: boolean;
  /** False for panels that always stay (the preview, the timeline). */
  closable: boolean;
  /** Panels that share one place on screen and show one at a time (e.g. "left"). */
  group?: string;
}

export interface EditorLayout {
  /** The built-in view the panels are in ("simple"), or "" after changes by hand. */
  view: string;
  panels: EditorPanel[];
  toolbarVisible: boolean;
  fullscreen: boolean;
}

export interface LayoutChange {
  /** Put every panel where it starts. */
  view?: "simple";
  /** Panel names as `layout()` reports them. */
  show?: string[];
  hide?: string[];
}

export type PreferenceValue = string | number | boolean;

/** One editor setting, shaped like a desktop Preferences entry (settings/_default.settings). */
export interface PreferenceEntry {
  key: string;
  title: string;
  /** The desktop Preferences tab it belongs on (General, Timeline, Autosave, Keyboard, AI…). */
  tab: string;
  type: "bool" | "spinner" | "spinner-int" | "dropdown" | "text" | "browse";
  value: PreferenceValue | null;
  default: PreferenceValue | null;
  min?: number;
  max?: number;
  choices?: { value: PreferenceValue; name: string }[];
  restartRequired?: boolean;
  /** Why it cannot be changed here; set_preference_tool refuses with it. */
  readOnly?: string;
}

/**
 * What an exporter writes: a video container, an audio-only file (`m4a` is
 * AAC in an MPEG-4 file), or a sequence of numbered images.
 */
export type ContainerFormat =
  | "mp4"
  | "webm"
  | "mov"
  | "mkv"
  | "gif"
  | "mp3"
  | "wav"
  | "flac"
  | "m4a"
  | "png-sequence"
  | "jpg-sequence"
  | "bmp-sequence"
  | "tiff-sequence";

export interface ExportOptions {
  format: ContainerFormat;
  width: number;
  height: number;
  fps: { num: number; den: number };
  videoCodec?: string;
  audioCodec?: string;
  /** Video bitrate in bits/s, or a quality preset. */
  videoBitrate?: number;
  quality?: "low" | "medium" | "high" | "lossless";
  /** Constant rate factor for CRF codecs (libx264/libx265/VP9), e.g. the desktop presets' Low/Med/High = 30/23/20 for libx264. Wins over `quality`. */
  crf?: number;
  audioBitrate?: number;
  sampleRate?: number;
  channels?: number;
  /** Timeline range in seconds; defaults to the whole project. */
  range?: { start: number; end: number };
  /** Output location (CLI path). Hosts choose one when omitted. */
  output?: string;
}

export interface ExportResult {
  /** Local path, OPFS path, blob URL or cloud URL of the finished file (an image sequence: its `%05d` pattern). */
  location: string;
  bytes?: number;
  durationSeconds?: number;
  mimeType?: string;
  /** Video frames written (an image sequence: its files). */
  frames?: number;
  /** How the file differs from what was asked (a codec the host swapped, a dropped track). */
  warnings?: string[];
  /** A host that renders in the background (Zenvi Cloud): the render, before the file exists. */
  job?: ExportJob;
}

/** A background render (`ExportResult.job`). */
export interface ExportJob {
  id: string;
  status: "queued" | "running" | "done" | "error";
  /** How the person gets the file, e.g. which tool returns the download link. */
  followUp: string;
}

/**
 * Where a finished export goes:
 * - `files`: written at `ExportOptions.output`, a path (relative to the
 *   project's folder); a call may choose it with folder / file_name / output_path;
 * - `download`: the browser downloads it, named after `output`'s file name;
 * - `job`: rendered in the background (Zenvi Cloud), named after `output`'s
 *   file name; `ExportResult.job` says how to get the download link.
 */
export type ExportDelivery = "files" | "download" | "job";

export interface ExportHost {
  export(project: Project, options: ExportOptions, onProgress?: (fraction: number) => void): Promise<ExportResult>;
  /**
   * Whether this host can encode a container with these FFmpeg encoder names
   * (an export preset's videocodec / audiocodec; "" = none), like the
   * desktop's FFmpegWriter.IsValidCodec, optionally at this frame size and
   * rate. Without it, every container the engine's exporters write counts
   * as encodable.
   */
  supports?(format: ContainerFormat, videoCodec: string, audioCodec: string, frame?: { width: number; height: number; fps: number }): Promise<boolean>;
  /** Where exports go (default `files`). */
  delivery?: ExportDelivery;
  /** The file name an export gets when the call names none (the desktop: the project file's name). */
  defaultName?(): string | Promise<string>;
  /** Whether `path`, as a call gave it, is an existing folder (`files` hosts). */
  isFolder?(path: string): Promise<boolean>;
}

/** Drawn over an inspect frame (zenvi-core agent_tools/inspect_overlay.py). Hosts may ignore it. */
export interface FrameOverlay {
  /** 0-1 coordinate grid, origin top-left: minor lines every 0.05, labels every 0.1. */
  grid?: boolean;
  /** Caption in the top-left corner, e.g. "f120  00:04.00". */
  caption?: string;
}

export interface FrameHost {
  /** Render one timeline frame for a model or a person to look at. */
  renderFrame(
    project: Project,
    seconds: number,
    options?: { width?: number; format?: "png" | "jpeg"; overlay?: FrameOverlay },
  ): Promise<ToolImage>;
  /**
   * The font families this host's renderer draws title text with (the SVG
   * rasterizer's fonts), as the fonts spell them: what a title may name, like
   * Zenvi desktop's Qt font database. Absent where they cannot be listed (a
   * browser draws titles with fonts it does not disclose).
   */
  fontFamilies?(): Promise<string[]>;
}

/** Per-frame loudness of a file's audio (the input of the desktop's energy VAD). */
export interface AudioEnvelope {
  /** Rate the audio was measured at. The desktop measures 16 kHz mono. */
  sampleRate: number;
  /** Samples per RMS frame (desktop: 480, 30 ms at 16 kHz). The last frame may be shorter. */
  frameSize: number;
  /** RMS of each frame of the mono mixdown, PCM normalized to -1..1, from source time 0. */
  rms: ArrayLike<number>;
}

export interface AudioHost {
  /**
   * Decode `path`'s audio to mono (default 16 kHz, 480-sample frames) and
   * return its RMS envelope. Rejects when the file has no audio stream.
   */
  analyzeAudio(
    path: string,
    options?: { sampleRate?: number; frameSize?: number; signal?: AbortSignal },
  ): Promise<AudioEnvelope>;
  /**
   * Decode `path`'s audio to mono float PCM (default 22050 Hz), optionally
   * from `startSeconds` for at most `maxSeconds`: what beat tracking reads.
   * Rejects when the file has no audio stream.
   */
  decodePcm?(
    path: string,
    options?: { sampleRate?: number; startSeconds?: number; maxSeconds?: number; signal?: AbortSignal },
  ): Promise<{ sampleRate: number; samples: Float32Array }>;
  /**
   * Transcribe the speech in `path`'s audio with word timings, through the
   * Zenvi backend (`POST /api/v1/transcription`, billed per started minute).
   * Hosts extract mono speech audio, split long media
   * (`planSpeechChunks`), read each answer with `parseTranscription` and
   * merge the pieces. Rejects with a `TranscriptionError` whose code says
   * what went wrong (no audio stream, not signed in, no credits, a server
   * without speech recognition…).
   */
  transcribe?(path: string, options?: TranscribeOptions): Promise<Transcription>;
}

export interface TranscribeOptions {
  /** ISO 639-1 code to transcribe in, or "" to detect the language (`asrLanguage`). */
  language?: string;
  /** Text that steers the recognizer, such as `FILLER_PROMPT` (`transcriptionPrompt`). */
  prompt?: string;
  signal?: AbortSignal;
}

export interface BackendHost {
  /** Zenvi backend base URL, e.g. https://api.zenvi.pro */
  readonly baseUrl: string;
  /** Authenticated JSON request to the Zenvi backend (`/api/v1/...`). */
  request<T = unknown>(path: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T>;
}

/**
 * Stock footage and music search, in the Zenvi backend's result shapes
 * (stock/stock.ts): the backend's proxies (`backendStock`), or a deployment's
 * own provider keys (Zenvi Cloud without the backend). Throws on failure,
 * like `BackendHost.request`.
 */
export interface StockHost {
  searchPexelsVideos(query: string, options: { perPage: number; signal?: AbortSignal }): Promise<{ videos: PexelsVideo[]; total: number }>;
  /** Sounds at least `minSeconds` long (0: any length). */
  searchFreesound(query: string, options: { pageSize: number; minSeconds: number; signal?: AbortSignal }): Promise<{ sounds: FreesoundSound[]; total: number }>;
}

export interface StorageHost {
  /** Save the current project. Returns where it went. */
  save(project: Project, path?: string): Promise<string>;
  /** Open a project from a path or id the host understands. */
  open(path: string): Promise<Project>;
  /** Read a small text file (subtitles to import). */
  readText?(path: string): Promise<string>;
  /** Write a small text file (exported subtitles). Returns where it went. */
  writeText?(path: string, text: string, contentType?: string): Promise<string>;
  /**
   * Write a binary file (a saved frame) where the person gets it: the CLI
   * writes the path (relative to the project's folder), Zenvi Cloud answers
   * with a download link, the web editor downloads it. Returns where it went.
   * Refuses to replace an existing file unless `overwrite`.
   */
  writeBytes?(path: string, bytes: Uint8Array, contentType: string, options?: { overwrite?: boolean }): Promise<string>;
  /**
   * Give the person a copy of a project file's media (Project Files > Export
   * Selected Clips) named `name`: the CLI copies it into `folder` (relative
   * to the project's folder; "" = the project's folder) and skips a file
   * that is already there, Zenvi Cloud answers with a download link, the web
   * editor downloads it. With `render`, the copy is that project rendered
   * with those options instead (hosts without an exporter refuse it).
   */
  exportMedia?(file: ProjectFile, name: string, folder: string, render?: MediaRender): Promise<ExportedMedia>;
  /** Where the open project is kept (a local path, a project id), or null when it never was. */
  currentPath?(): string | null;
  /** The projects this surface lists as recent (File > Recent Projects), most recent first. */
  recentProjects?(): Promise<RecentProject[]>;
  /** The open project's recovery copies (File > Recovery), newest first; none when it has no file. */
  recoveryCopies?(): Promise<RecoveryCopy[]>;
  /**
   * Put a recovery copy in place of the open project's file, keeping the
   * current file next to it as `<name>-<time>-backup.zvn`, and read the
   * restored project (the call then opens it).
   */
  restoreRecoveryCopy?(copy: string): Promise<RestoredProject>;
  /** The user's custom video profiles (the profile editor's files). */
  customProfiles?(): Promise<ProfileFile[]>;
  /** Create or replace a custom profile file (`name` = the profile key). Returns its path. */
  writeCustomProfile?(name: string, text: string): Promise<string>;
  /** Delete a custom profile file. */
  removeCustomProfile?(name: string): Promise<void>;
}

/** A project a surface lists as recent. */
export interface RecentProject {
  /** What opens it on this surface: a local path (CLI), a project id (Zenvi Cloud, the web editor). */
  path: string;
  name: string;
  /** False when the file is gone. */
  exists: boolean;
  /** Last change, Unix seconds, when known. */
  modifiedAt: number | null;
}

/** An automatic copy of the open project saved with it (File > Recovery). */
export interface RecoveryCopy {
  path: string;
  /** When it was saved, Unix seconds. */
  savedAt: number;
  sizeBytes: number | null;
}

export interface RestoredProject {
  project: Project;
  /** The project file the copy now fills. */
  path: string;
  /** Where the replaced file was kept, or null when there was none. */
  backup: string | null;
}

/** A custom profile file: libopenshot `key=value` text (description, frame rate, size, ratios). */
export interface ProfileFile {
  /** File name, the profile's key (e.g. `01000x1000p0030_01-01`). */
  name: string;
  text: string;
  /** Where the file is. */
  path: string;
}

/** A file's part rendered instead of copied (a sub-clip or an image sequence as MP4). */
export interface MediaRender {
  project: Project;
  options: ExportOptions;
}

/** Where a copy of a project file's media went. */
export interface ExportedMedia {
  /** A local path, a download link or a download name. */
  location: string;
  /** Where the copies go, for the summary: a local folder, the browser's downloads, Zenvi Cloud links. */
  folder: string;
  /** The destination already had a file of that name, which was kept (nothing written). */
  existed: boolean;
}

/** One media file moving between its original and the project's assets folder. */
export interface MediaMove {
  fileId: string;
  from: string;
  to: string;
}

/** What collecting media into the project's assets folder did (media_collect.copy_media_into_project). */
export interface CollectedMedia {
  copied: string[];
  skipped: string[];
  errors: string[];
  /** Every file to point at its copy (already there or just copied). */
  moves: MediaMove[];
}

/** Asset copies byte-identical to their recorded original (media_collect.find_reclaimable_media). */
export interface ReclaimableMedia {
  /** From the copy to the original. */
  moves: MediaMove[];
  kept: string[];
  errors: string[];
}

/** One project picture a 3D scene shows (a screen, a card, a cube face, a side of cube_cut). */
export interface Scene3dMediaInput {
  fileId: string;
  /** The file's `path` as the project stores it (the host resolves it). */
  path: string;
  kind: "image" | "video";
  width: number;
  height: number;
  /** Video frames per second and length in frames (images: 0). */
  fps: number;
  frames: number;
  /** Seconds into the video where the scene starts showing it. */
  start: number;
}

export interface Scene3dRenderRequest {
  scene: Scene3dId;
  /** Parsed params (parseScene3dParams), passed to the bpy scene as JSON. */
  params: Scene3dParams;
  width: number;
  height: number;
  fps: { num: number; den: number };
  frames: number;
  /** draft: half size, few samples (seconds); final: full size. */
  quality: Scene3dQuality;
  /** By slot: `screen`, `card0`…, `face0`…, `from` / `to`. */
  media: Record<string, Scene3dMediaInput>;
  signal?: AbortSignal;
  onProgress?: (fraction: number, message: string) => void;
}

/**
 * Zenvi 3D: renders Blender scenes (@zenvi/scenes3d) to movies. Only hosts
 * on a computer with Blender have it (the CLI and local MCP server).
 * `render` rejects with a message in words (no Blender, a failed render).
 */
export interface Scene3dHost {
  render(request: Scene3dRenderRequest): Promise<Scene3dRender>;
}

/** Files bundled with the engine (`packages/engine/assets/…`), such as the title templates. */
export interface AssetHost {
  /**
   * Text of a bundled asset by its path under the engine's `assets/`
   * folder, e.g. `titles/Bar_1.svg`. Rejects when there is no such asset.
   */
  readText(path: string): Promise<string>;
  /** Bytes of a bundled binary asset (`fonts/inter/Inter[opsz,wght].ttf`). Rejects when there is no such asset. */
  readBytes?(path: string): Promise<Uint8Array>;
}

/** What a subject matte separates from the rest of the frame. */
export type MatteSubject = "person";

export interface MatteRequest {
  subject: MatteSubject;
  /** Matte size relative to the source: 1 (same size) or 0.5 (half, faster; the Mask effect scales it up). */
  scale: 1 | 0.5;
  signal?: AbortSignal;
}

/** A matte video a host made: grayscale, white = subject, same frame rate and length as its source. */
export interface GeneratedMatte {
  /** The matte video, written into the project's assets, ready for the bin. */
  media: ImportedMedia;
  /** Model and release that made it, e.g. `rvm_mobilenetv3_fp32` / `1.0.0`. */
  model: string;
  version: string;
  /** SPDX licence of the model weights. */
  license: string;
  frames: number;
  /** Frames matted per second of wall time (what the person waits). */
  fps: number;
}

/**
 * Subject matting (`generate_subject_matte_tool` and the composites built
 * on it). Only hosts that run a matting model have it (the CLI with
 * onnxruntime-node); the model downloads on first use.
 */
export interface MatteHost {
  readonly subjects: readonly MatteSubject[];
  /** Matte every frame of the video at `path`. Rejects in words (no model, no video stream, cancelled). */
  generate(path: string, request: MatteRequest): Promise<GeneratedMatte>;
}

/** One parameter of a Zenvi Motion block (its block.json entry). */
export interface MotionBlockParam {
  name: string;
  /** string, number, integer, boolean, color, enum, strings, points or media (a bin file id). */
  type: string;
  description: string;
  default?: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  options?: string[];
  /** media: image and/or video. */
  accept?: string[];
  optional?: boolean;
}

/** A Zenvi Motion block: a parametric HTML motion graphic the host renders to video. */
export interface MotionBlockInfo {
  id: string;
  version: number;
  title: string;
  description: string;
  tags: string[];
  params: MotionBlockParam[];
  /** Seconds. */
  duration: { default: number; min: number; max: number };
  /** Aspect ratios the layout is designed for ("9:16", "16:9"…). */
  aspects: string[];
  /** Meant to sit over video (transparent) by default. */
  alpha: boolean;
}

export type MotionParamsCheck = { ok: true; params: Record<string, unknown> } | { ok: false; error: string };

export interface MotionRenderRequest {
  block: string;
  /** Checked params (`check`); media params hold bin file ids. */
  params: Record<string, unknown>;
  /** Project media path of each media param, by param name. */
  media: Record<string, string>;
  width: number;
  height: number;
  fps: { num: number; den: number };
  seconds: number;
  /** Transparent background (ProRes 4444 .mov) or opaque (H.264 .mp4). */
  alpha: boolean;
  /** Sub-frames averaged per frame (1 = no motion blur). */
  motionBlurSamples: number;
  /** Half-size preview render. */
  draft: boolean;
}

export interface MotionRender {
  /** The rendered file, ready for `addFile`. */
  media: ImportedMedia;
  codec: "prores4444" | "h264";
  width: number;
  height: number;
  fps: { num: number; den: number };
  frames: number;
  /** Hash of everything that shaped the pixels (block code, params, media, size, timing). */
  fingerprint: string;
  /** True when an identical render was reused. */
  cached: boolean;
  renderSeconds: number;
}

/** Rendering Zenvi Motion blocks (headless Chrome on the person's computer: the CLI and `zenvi mcp`). */
export interface MotionHost {
  blocks(): readonly MotionBlockInfo[];
  /** Params checked against the block and completed with defaults, or why they are wrong. */
  check(block: string, params: Readonly<Record<string, unknown>>): MotionParamsCheck;
  render(request: MotionRenderRequest, signal?: AbortSignal): Promise<MotionRender>;
}

export interface ToolHost {
  media?: MediaHost;
  player?: PlayerHost;
  ui?: UiHost;
  exporter?: ExportHost;
  frames?: FrameHost;
  backend?: BackendHost;
  stock?: StockHost;
  storage?: StorageHost;
  audio?: AudioHost;
  assets?: AssetHost;
  mattes?: MatteHost;
  motion?: MotionHost;
  scenes3d?: Scene3dHost;
  /** Diagnostic log line (never shown to the model). */
  log?: (message: string) => void;
}

export type HostCapability = keyof Omit<ToolHost, "log">;

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition<I extends z.ZodType = z.ZodType, D = unknown> {
  /** Stable name. Assistant-compatible tools keep the backend's `*_tool` names. */
  name: string;
  title: string;
  /** What the tool does and when to use it (shown to models). */
  description: string;
  input: I;
  annotations?: ToolAnnotations;
  surfaces: ToolSurface[];
  /** Capabilities the host must provide; checked before `run`. */
  requires?: HostCapability[];
  run(ctx: ToolContext, input: z.infer<I>): Promise<ToolResult<D>> | ToolResult<D>;
}

/** Erased form for registries. */
export type AnyTool = ToolDefinition<z.ZodType, unknown>;
