/**
 * A fake ToolHost for tool tests (used only by `*.test.ts`). Every
 * capability is present by default and records what it was asked to do;
 * `fakeHost({ without: [...] })` drops capabilities and `omit` drops
 * optional methods, so tests can check each surface limitation.
 */

import { TranscriptionError, type Transcription } from "../../analysis/transcription.js";
import { fxStretch } from "../../fx/catalog.js";
import type { Project } from "../../model/types.js";
import { folderAndName, sequenceFramesPresent } from "../../ops/project-files.js";
import { isDirectMediaUrl, isYoutubeUrl, type WebVideoDownload, type WebVideoRequest } from "../../web-video/web-video.js";
import type {
  AudioEnvelope,
  ContainerFormat,
  EditorLayout,
  EditorSelection,
  ExportDelivery,
  ExportOptions,
  HostCapability,
  ImportedMedia,
  MediaMove,
  PathListing,
  PreferenceEntry,
  RecentProject,
  RecoveryCopy,
  TimelineView,
  ToolHost,
  ToolImage,
} from "../types.js";
import { readBundledFont } from "../../typography/test-fonts.js";
import { backendStock } from "../backend.js";
import { fakeMotionHost } from "./fake-motion.js";
import { SPOKEN_WORDS, TRANSCRIPT_CUES, infoForPath, videoInfo } from "./fixture.js";

/** A 1×1 PNG. */
export const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export type OptionalMethod =
  | "media.importPath"
  | "media.listPaths"
  | "media.importUrl"
  | "media.pickFiles"
  | "media.writeGenerated"
  | "media.missing"
  | "media.fetchWebVideo"
  | "media.inspectRender"
  | "storage.readText"
  | "storage.writeText"
  | "audio.transcribe"
  | "ui.openExportDialog"
  | "ui.selectedIds"
  | "ui.selection"
  | "ui.setSelection"
  | "ui.timelineView"
  | "ui.showTimelineRange"
  | "ui.setTimelineMode"
  | "ui.layout"
  | "ui.preferences"
  | "ui.clearPlaybackCache"
  | "storage.writeBytes"
  | "storage.exportMedia"
  | "storage.currentPath"
  | "storage.recentProjects"
  | "storage.recoveryCopies"
  | "storage.customProfiles"
  | "media.collect"
  | "exporter.supports";

export interface BackendCall {
  path: string;
  method: string;
  body: unknown;
}

export interface FakeHostOptions {
  /** Capabilities to leave out. */
  without?: HostCapability[];
  /** Optional methods to leave out. */
  omit?: OptionalMethod[];
  /** Extra backend routes (path prefix → handler); they win over the defaults. */
  routes?: Record<string, (body: unknown, path: string) => unknown>;
  /** Sound-library answers (URL prefix → handler, or an Error to throw); they win over `OPENVERSE_FIXTURES`. */
  library?: Record<string, (url: string) => unknown>;
  /** Files `storage.readText` can read. */
  texts?: Record<string, string>;
  /** Bundled assets `assets.readText` can read (default: a minimal Bar_1 title template). */
  assets?: Record<string, string>;
  /** Player position, seconds. */
  playhead?: number;
  /** The editor's timeline view (default `fakeView()`: 0-30 s visible, snapping on, no timing mode). */
  view?: Partial<TimelineView>;
  /**
   * What `audio.transcribe` answers per media path (a transcription, or an
   * error to throw); other paths get `SPOKEN_WORDS`. Each call is recorded
   * in `calls` as `transcribe <path> <language>`.
   */
  transcripts?: Record<string, Transcription | Error>;
  /**
   * Files on the host's disk (absolute paths). With it, listPaths, importPath,
   * probe and missing read this disk like the CLI host; without it, a path
   * containing "missing" is missing.
   */
  disk?: string[];
  /** Content of disk files, for their fingerprints (`fingerprint.sha256` = the content); others have none. */
  contents?: Record<string, string>;
  /**
   * What `media.fetchWebVideo` does (default: a finished download of
   * `/cache/web/<last path part>.mp4` titled "Web clip"). Each call is
   * recorded in `calls` as `fetchWebVideo <url> <intent> subs=<bool>`.
   */
  webVideo?: (request: WebVideoRequest) => Promise<WebVideoDownload>;
  /** Where the open project is saved (`storage.currentPath`; default /projects/current.zvn, null = never saved). */
  projectPath?: string | null;
  /** `storage.recentProjects`. */
  recent?: RecentProject[];
  /** `storage.recoveryCopies`, newest first, with the project each copy restores. */
  recovery?: (RecoveryCopy & { project: Project })[];
  /** Custom profile files by name (`storage.customProfiles`); the fake writes and deletes here. */
  profiles?: Record<string, string>;
  /** The editor's settings (`ui.preferences`); the fake stores values here. */
  preferences?: PreferenceEntry[];
  /** The editor's panels (`ui.layout`; default `fakeLayout()`). */
  layout?: EditorLayout;
  /** `exporter.supports` (default: every codec but `prores_ks` and `h264_nvenc`). */
  encodable?: (format: ContainerFormat, videoCodec: string, audioCodec: string) => boolean;
  /**
   * The exporter's surface (default `files`, like the CLI): `download` names
   * the file after `output` like the web editor, `job` answers with render
   * job `r_fakejob00000001` like Zenvi Cloud.
   */
  exportDelivery?: ExportDelivery;
  /** `exporter.defaultName` (default: none, so the project file's name is used). */
  exportName?: string;
  /** Paths `exporter.isFolder` reports as folders. */
  folders?: string[];
  /** Warnings the exporter reports with each export. */
  exportWarnings?: string[];
  /** `frames.fontFamilies`: the fonts the renderer draws titles with (default: none listed, like a browser). */
  fonts?: string[];
}

/** A small editor layout like the web editor's: one left and one right panel group, the preview and the timeline. */
export function fakeLayout(): EditorLayout {
  return {
    view: "simple",
    panels: [
      { name: "Project Files", open: true, closable: true, group: "left" },
      { name: "Effects", open: false, closable: true, group: "left" },
      { name: "Properties", open: true, closable: true, group: "right" },
      { name: "Assistant", open: false, closable: true, group: "right" },
      { name: "Video Preview", open: true, closable: false },
      { name: "Timeline", open: true, closable: false },
    ],
    toolbarVisible: true,
    fullscreen: false,
  };
}

/** The disk a fake host reads: listings in the CLI host's walk order, and what exists. */
function fakeDisk(initial: readonly string[]) {
  const paths = [...initial];
  const files = new Set(paths);
  const under = (folder: string) => paths.filter((p) => p.startsWith(`${folder}/`));
  const isDir = (entry: string) => under(entry).length > 0;
  /** The CLI host's walk: a folder's files (sorted), then each subfolder's, recursively. */
  const walk = (folder: string): string[] => {
    const inside = under(folder).map((p) => p.slice(folder.length + 1));
    const direct = inside.filter((r) => !r.includes("/")).sort();
    const subs = [...new Set(inside.filter((r) => r.includes("/")).map((r) => r.split("/")[0]!))].sort();
    return [...direct.map((n) => `${folder}/${n}`), ...subs.flatMap((d) => walk(`${folder}/${d}`))];
  };
  const names = (folder: string) => under(folder).map((p) => p.slice(folder.length + 1)).filter((r) => !r.includes("/"));
  return {
    has: (path: string) => files.has(path),
    add: (path: string) => {
      if (!files.has(path)) paths.push(path);
      files.add(path);
    },
    remove: (path: string) => {
      files.delete(path);
      const at = paths.indexOf(path);
      if (at >= 0) paths.splice(at, 1);
    },
    list: (entry: string): PathListing => {
      const path = entry.replace(/\/+$/, "");
      if (files.has(path)) return { kind: "file", files: [path], path };
      if (isDir(path)) return { kind: "directory", files: walk(path), path };
      return { kind: "missing", files: [], path };
    },
    present: (path: string): boolean => {
      if (!path.includes("%")) return files.has(path);
      const { folder } = folderAndName(path);
      return isDir(folder) && sequenceFramesPresent(path, names(folder));
    },
    /** Frames of a `%` pattern on disk (an image2 sequence from its first frame). */
    frames: (pattern: string): number => {
      const { folder, name } = folderAndName(pattern);
      const m = /%0?(\d*)d/.exec(name);
      if (!m) return 0;
      let count = 0;
      for (let i = 0; i < 100000; i += 1) {
        const frame = `${folder}/${name.replace(m[0], m[1] ? String(i).padStart(Number(m[1]), "0") : String(i))}`;
        if (files.has(frame)) count += 1;
        else if (count > 0 || i > 4) break;
      }
      return count;
    },
  };
}

/** The download the fake host's fetchWebVideo answers by default. */
export function fakeWebVideoDownload(request: WebVideoRequest, overrides: Partial<WebVideoDownload> = {}): WebVideoDownload {
  const last = request.url.split("?")[0]!.split("/").filter(Boolean).pop() || "video";
  return {
    path: `/cache/web/${last.replace(/\.[a-z0-9]+$/i, "")}.mp4`,
    title: "Web clip",
    extractor: isYoutubeUrl(request.url) ? "youtube" : "generic",
    durationSeconds: 8,
    width: 1280,
    height: 720,
    webpageUrl: request.url,
    id: "web1",
    isYoutube: isYoutubeUrl(request.url),
    subtitlePaths: [],
    direct: isDirectMediaUrl(request.url),
    fromCache: false,
    cachePurged: 0,
    ...overrides,
  };
}

export interface FakeHost extends ToolHost {
  readonly calls: string[];
  /** The fake disk's files (when `disk` was given). */
  readonly disk: { has(path: string): boolean } | null;
  /** Custom profile files by name. */
  readonly profiles: Record<string, string>;
  readonly backendCalls: BackendCall[];
  readonly written: Map<string, Uint8Array | string>;
  readonly exports: ExportOptions[];
  /** The project each export was given. */
  readonly exportedProjects: Project[];
  /** The fake editor's selection and timeline view (what the ui methods read and change). */
  readonly editor: { selection: EditorSelection; view: TimelineView };
}

/** A timeline view showing 0-30 s at 3 s per 100 px with snapping on, like the desktop tests' zoom slider. */
export function fakeView(view: Partial<TimelineView> = {}): TimelineView {
  return { secondsPer100px: 3, visibleSeconds: 30, visibleRange: [0, 30], snapping: true, razor: false, timing: null, ...view };
}

/** A tiny title template: one text line, like the desktop's Bar_1.svg. */
export const TITLE_TEMPLATE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect style="fill:#000000" width="1920" height="200"/>' +
  '<text x="100" y="100" style="font-size:72px"><tspan x="100" y="100">Title</tspan></text></svg>';

function defaultRoutes(): Record<string, (body: unknown, path: string) => unknown> {
  return {
    "/api/v1/indexing/status": () => ({ configured: true }),
    "/api/v1/search": () => ({
      results: [
        { video_id: "VID0001", start: 2.5, end: 4.5, rank: 2, score: 0.7, transcription: "today we talk about cameras" },
        { video_id: "VID0001", start: 12.0, end: 13.5, rank: 1, score: 0.9 },
      ],
    }),
    "/api/v1/indexing/watch-window": (body) => {
      const b = body as { window_start?: number; window_end?: number; fallback_cut?: number; fallback_in?: number; fallback_out?: number };
      const cut = Number(b.fallback_cut ?? b.window_start ?? 0);
      return {
        matched: true,
        used_fallback: false,
        cut_source: cut,
        in_source: Number(b.fallback_in ?? cut),
        out_source: Number(b.fallback_out ?? cut + 1),
        confidence: 0.9,
        reason: "The query is on screen.",
        visible_at: [cut],
      };
    },
    "/api/v1/indexing/catalog": () => ({
      items: [{ file_id: "FILEINTV01", filename: "interview.mp4", media_type: "video", duration_sec: 20, short_summary: "A speaker introduces a camera review." }],
    }),
    "/api/v1/indexing/summarize": () => ({ success: true, ai_metadata: { analyzed: true, short_summary: "Re-summarized." } }),
    "/api/v1/generation/video": () => ({ video_url: "https://cdn.example.com/generated.mp4" }),
    "/api/v1/generation/tts": () => ({ success: true, audio_base64: "SUQzAwAAAAAAAA==" }),
    "/api/v1/generation/image": () => ({ image_base64: PNG_1PX, mime_type: "image/png" }),
    "/api/v1/generation/morph": () => ({ video_url: "https://cdn.example.com/morph.mp4" }),
    "/api/v1/pexels/search": () => ({
      videos: [{ id: 101, url: "https://www.pexels.com/video/101/", video_files: [{ quality: "hd", link: "https://videos.pexels.com/101-hd.mp4" }] }],
    }),
    "/api/v1/freesound/search": () => ({
      sounds: [{ id: 202, name: "Rain", previews: { hq_mp3: "https://freesound.org/202-hq.mp3" } }],
    }),
  };
}

/** Openverse records the fake library serves: a CC0 whoosh, a CC BY hit, a non-commercial riser. */
export const OPENVERSE_FIXTURES = [
  openverseRecord("0e8a6e2a-0ac8-4615-9e0d-ebde30523783", "Deep Whoosh #1", "cc0", "1.0", 1200, ["whoosh", "air"]),
  openverseRecord("1b2c3d4e-0000-4000-8000-000000000002", "Glass impact hit", "by", "4.0", 800, ["impact", "glass"]),
  openverseRecord("2c3d4e5f-0000-4000-8000-000000000003", "Tension riser", "by-nc", "4.0", 4000, ["riser"]),
];

/** An Openverse audio record shaped like api.openverse.org's. */
export function openverseRecord(id: string, title: string, license: string, version: string, durationMs: number, tags: string[] = []): Record<string, unknown> {
  const path = license === "cc0" ? "publicdomain/zero" : `licenses/${license}`;
  return {
    id,
    title,
    creator: "maker",
    license,
    license_version: version,
    license_url: `https://creativecommons.org/${path}/${version}/`,
    url: `https://cdn.freesound.test/previews/${id.slice(0, 4)}-hq.mp3`,
    foreign_landing_url: `https://freesound.test/s/${id.slice(0, 4)}/`,
    duration: durationMs,
    filesize: 50_000,
    source: "freesound",
    tags: tags.map((name) => ({ name })),
  };
}

function defaultLibrary(): Record<string, (url: string) => unknown> {
  return {
    "https://api.openverse.org/v1/audio/?": () => ({ result_count: OPENVERSE_FIXTURES.length, results: OPENVERSE_FIXTURES }),
    "https://api.openverse.org/v1/audio/": (url) => {
      const record = OPENVERSE_FIXTURES.find((r) => url.endsWith(`/${String(r.id)}/`));
      if (!record) throw new Error("no such sound in the library (404).");
      return record;
    },
  };
}

export function fakeHost(options: FakeHostOptions = {}): FakeHost {
  const without = new Set(options.without ?? []);
  const omit = new Set(options.omit ?? []);
  const calls: string[] = [];
  const backendCalls: BackendCall[] = [];
  const written = new Map<string, Uint8Array | string>();
  const exports: ExportOptions[] = [];
  const exportedProjects: Project[] = [];
  const texts = { ...(options.texts ?? {}) };
  const assets = options.assets ?? { "titles/Bar_1.svg": TITLE_TEMPLATE_SVG };
  const routes = { ...defaultRoutes(), ...(options.routes ?? {}) };
  let playhead = options.playhead ?? 1;
  let playing = false;
  const editor = { selection: { clips: [], transitions: [], effects: [] } as EditorSelection, view: fakeView(options.view) };

  const disk = options.disk ? fakeDisk(options.disk) : null;
  const contents = { ...(options.contents ?? {}) };
  const profiles = { ...(options.profiles ?? {}) };
  const host: FakeHost = { calls, backendCalls, written, exports, exportedProjects, editor, disk, profiles, log: () => {} };
  const projectPath = options.projectPath === undefined ? "/projects/current.zvn" : options.projectPath;

  if (!without.has("media")) {
    const imported = (path: string, name?: string): ImportedMedia => (name === undefined ? { path, info: infoForPath(path) } : { path, info: infoForPath(path), name });
    host.media = {
      probe: async (path) => {
        calls.push(`probe ${path}`);
        if (disk && path.includes("%")) {
          const frames = disk.frames(path);
          if (frames === 0) throw new Error(`No media at ${path}`);
          // FFmpegReader on an image2 pattern: 25 fps, one frame per image.
          return { ...videoInfo(path, frames / 25, { has_audio: false, channels: 0, sample_rate: 0, acodec: "", vcodec: "png", width: 640, height: 360 }), fps: { num: 25, den: 1 }, video_length: frames };
        }
        if (disk ? !disk.has(path) : path.includes("missing")) throw new Error(`No media at ${path}`);
        return infoForPath(path);
      },
    };
    if (!omit.has("media.importPath")) {
      host.media.importPath = async (path) => {
        calls.push(`importPath ${path}`);
        if (disk ? !disk.has(path) : path.includes("missing")) throw new Error(`No such file: ${path}`);
        const content = options.contents?.[path];
        return content === undefined ? imported(path) : { ...imported(path), fingerprint: { sha256: content, size: content.length } };
      };
    }
    if (!omit.has("media.listPaths")) {
      host.media.listPaths = async (entry): Promise<PathListing> => {
        calls.push(`listPaths ${entry}`);
        if (disk) return disk.list(entry);
        if (entry.includes("missing")) return { kind: "missing", files: [] };
        if (entry.endsWith("/clips")) return { kind: "directory", files: [`${entry}/a.mp4`, `${entry}/notes.txt`, `${entry}/b.mov`] };
        return { kind: "file", files: [entry] };
      };
    }
    if (!omit.has("media.missing")) {
      host.media.missing = async (files) => {
        calls.push(`missing ${files.length}`);
        return files.map((f) => (disk ? !disk.present(String(f.path)) : String(f.path).includes("missing")));
      };
    }
    if (!omit.has("media.importUrl")) {
      host.media.importUrl = async (url, opts) => {
        calls.push(`importUrl ${url}`);
        const name = opts?.filename || url.split("/").pop() || "download.mp4";
        return imported(`/downloads/${name}`, name);
      };
    }
    if (!omit.has("media.pickFiles")) host.media.pickFiles = async () => [];
    if (!omit.has("media.collect")) {
      // media_collect on the fake disk: copies go to <project>_assets/media.
      const assets = `${(projectPath ?? "/projects/untitled.zvn").replace(/\.[^./]+$/, "")}_assets`;
      // Without a disk, sources exist unless "missing" and the assets folder holds what was copied.
      const copies = new Set<string>();
      const exists = (path: string) => (disk ? disk.has(path) : path.startsWith(`${assets}/`) ? copies.has(path) : !path.includes("missing"));
      host.media.collect = async (files) => {
        calls.push(`collect ${files.length}`);
        const out = { copied: [] as string[], skipped: [] as string[], errors: [] as string[], moves: [] as MediaMove[] };
        for (const f of files) {
          if (!f.path || f.path.includes("%") || !exists(f.path) || f.path.startsWith(`${assets}/`)) {
            out.skipped.push(f.path || "(empty)");
            continue;
          }
          const dest = `${assets}/media/${f.path.split("/").pop()}`;
          if (exists(dest)) out.skipped.push(f.path);
          else {
            disk?.add(dest);
            copies.add(dest);
            if (contents[f.path] !== undefined) contents[dest] = contents[f.path]!;
            out.copied.push(dest);
          }
          out.moves.push({ fileId: f.id, from: f.path, to: dest });
        }
        return out;
      };
      host.media.reclaimable = async (files) => {
        calls.push(`reclaimable ${files.length}`);
        const out = { moves: [] as MediaMove[], kept: [] as string[], errors: [] as string[] };
        for (const f of files) {
          if (!f.path.startsWith(`${assets}/media/`)) continue;
          if (!exists(f.path) || !exists(f.original)) out.kept.push(f.path);
          else if (contents[f.path] !== undefined && contents[f.path] === contents[f.original]) out.moves.push({ fileId: f.id, from: f.path, to: f.original });
          else out.kept.push(f.path);
        }
        return out;
      };
      host.media.removeCopies = async (paths) => {
        calls.push(`removeCopies ${paths.join(",")}`);
        for (const p of paths) {
          disk?.remove(p);
          copies.delete(p);
        }
        return { removed: [...paths], errors: [] };
      };
    }
    if (!omit.has("media.writeGenerated")) {
      host.media.writeGenerated = async (name, bytes) => {
        const path = `/generated/${name}`;
        calls.push(`writeGenerated ${name}`);
        written.set(path, bytes);
        return path;
      };
      host.media.discardGenerated = async (paths) => {
        calls.push(`discardGenerated ${paths.join(",")}`);
        for (const p of paths) written.delete(p);
      };
    }
    if (!omit.has("media.fetchWebVideo")) {
      const fetchWebVideo = options.webVideo ?? (async (request: WebVideoRequest) => fakeWebVideoDownload(request));
      host.media.fetchWebVideo = async (request) => {
        calls.push(`fetchWebVideo ${request.url} ${request.intent} subs=${request.writeSubs}`);
        return fetchWebVideo(request);
      };
    }
    if (!omit.has("media.inspectRender")) {
      // A clean 8 s render: two shots, a hold at the end, mastered audio.
      host.media.inspectRender = async (path) => {
        calls.push(`inspectRender ${path}`);
        return {
          path,
          duration: 8,
          width: 1280,
          height: 720,
          fps: 30,
          hasAudio: true,
          black: [],
          frozen: [{ start: 7, end: 8 }],
          cuts: [{ time: 4, score: 40 }],
          silences: [],
          loudness: { integratedLufs: -14, rangeLu: 3, truePeakDb: -1.5 },
        };
      };
    }
  }
  if (!without.has("player")) {
    host.player = {
      get playhead() {
        return playhead;
      },
      get playing() {
        return playing;
      },
      get rate() {
        return 1;
      },
      play: () => {
        calls.push("play");
        playing = true;
      },
      pause: () => {
        calls.push("pause");
        playing = false;
      },
      toggle: () => {
        calls.push("toggle");
        playing = !playing;
      },
      seek: (seconds) => {
        calls.push(`seek ${seconds}`);
        playhead = seconds;
      },
    };
  }
  if (!without.has("ui")) {
    host.ui = {
      zoomIn: () => calls.push("zoomIn"),
      zoomOut: () => calls.push("zoomOut"),
      centerOnPlayhead: () => calls.push("centerOnPlayhead"),
      notify: (message) => calls.push(`notify ${message}`),
    };
    if (!omit.has("ui.selectedIds")) host.ui.selectedIds = () => [...editor.selection.clips, ...editor.selection.transitions];
    if (!omit.has("ui.openExportDialog")) host.ui.openExportDialog = () => calls.push("openExportDialog");
    if (!omit.has("ui.selection")) host.ui.selection = () => structuredClone(editor.selection);
    if (!omit.has("ui.setSelection")) {
      host.ui.setSelection = (selection) => {
        calls.push(`select ${[...selection.clips, ...selection.transitions, ...selection.effects].join(",")}`);
        editor.selection = structuredClone(selection);
      };
    }
    host.ui.showProperties = () => calls.push("showProperties");
    if (!omit.has("ui.timelineView")) host.ui.timelineView = () => structuredClone(editor.view);
    if (!omit.has("ui.showTimelineRange")) {
      host.ui.showTimelineRange = (start, end) => {
        calls.push(`showRange ${start.toFixed(3)}-${end.toFixed(3)}`);
        editor.view = { ...editor.view, visibleRange: [start, end], visibleSeconds: end - start, secondsPer100px: (end - start) / 10 };
      };
    }
    if (!omit.has("ui.setTimelineMode")) {
      host.ui.setTimelineMode = (mode, on) => {
        calls.push(`mode ${mode} ${on}`);
        editor.view = { ...editor.view, [mode]: on };
      };
    }
    if (!omit.has("ui.layout")) {
      let layout = structuredClone(options.layout ?? fakeLayout());
      host.ui.layout = () => structuredClone(layout);
      host.ui.setLayout = (change) => {
        calls.push(`layout ${JSON.stringify(change)}`);
        if (change.view === "simple") layout = fakeLayout();
        for (const name of change.show ?? []) {
          const panel = layout.panels.find((p) => p.name === name)!;
          for (const p of layout.panels) if (panel.group && p.group === panel.group) p.open = false;
          panel.open = true;
        }
        for (const name of change.hide ?? []) layout.panels.find((p) => p.name === name)!.open = false;
        layout.view = change.view ?? "";
        return structuredClone(layout);
      };
    }
    if (!omit.has("ui.preferences")) {
      const prefs = structuredClone(options.preferences ?? []);
      host.ui.preferences = () => structuredClone(prefs);
      host.ui.setPreference = (key, value) => {
        calls.push(`setPreference ${key}=${String(value)}`);
        prefs.find((p) => p.key === key)!.value = value;
      };
    }
    if (!omit.has("ui.clearPlaybackCache")) host.ui.clearPlaybackCache = () => calls.push("clearPlaybackCache");
  }
  if (!without.has("exporter")) {
    const delivery = options.exportDelivery ?? "files";
    host.exporter = {
      export: async (project: Project, exportOptions, onProgress) => {
        calls.push(`export ${exportOptions.format}`);
        exports.push(exportOptions);
        exportedProjects.push(project);
        onProgress?.(1);
        const location = exportOptions.output ?? "/exports/export.mp4";
        const warnings = options.exportWarnings ? [...options.exportWarnings] : undefined;
        if (delivery === "job") {
          return { location, job: { id: "r_fakejob00000001", status: "queued", followUp: 'Call get_render_status with render_id "r_fakejob00000001" for the download link.' }, ...(warnings ? { warnings } : {}) };
        }
        const fps = exportOptions.fps.num / exportOptions.fps.den;
        const frames = exportOptions.range ? Math.round((exportOptions.range.end - exportOptions.range.start) * fps) : undefined;
        return { location, bytes: 1234, mimeType: "video/mp4", durationSeconds: 1, ...(frames !== undefined ? { frames } : {}), ...(warnings ? { warnings } : {}) };
      },
      delivery,
    };
    if (options.exportName !== undefined) host.exporter.defaultName = () => options.exportName!;
    if (options.folders) {
      const folders = new Set(options.folders);
      host.exporter.isFolder = async (path) => folders.has(path);
    }
    if (!omit.has("exporter.supports")) {
      const encodable = options.encodable ?? ((_f: ContainerFormat, v: string) => v !== "prores_ks" && v !== "h264_nvenc");
      host.exporter.supports = async (format, videoCodec, audioCodec) => encodable(format, videoCodec, audioCodec);
    }
  }
  if (!without.has("frames")) {
    host.frames = {
      renderFrame: async (_project, seconds, frameOptions): Promise<ToolImage> => {
        calls.push(`renderFrame ${Number(seconds).toFixed(2)}${frameOptions?.overlay?.grid ? " grid" : ""}`);
        return { mimeType: frameOptions?.format === "jpeg" ? "image/jpeg" : "image/png", data: PNG_1PX };
      },
    };
    const fonts = options.fonts;
    if (fonts) host.frames.fontFamilies = async () => [...fonts];
  }
  if (!without.has("backend")) {
    host.backend = {
      baseUrl: "https://api.zenvi.test",
      request: async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
        backendCalls.push({ path, method: init?.method ?? "GET", body: init?.body });
        const route = Object.keys(routes)
          .filter((prefix) => path.startsWith(prefix))
          .sort((a, b) => b.length - a.length)[0];
        if (!route) throw new Error(`no fake route for ${path}`);
        return routes[route]!(init?.body, path) as T;
      },
    };
  }
  if (!without.has("stock") && host.backend) host.stock = backendStock(host.backend);
  if (!without.has("storage")) {
    host.storage = {
      save: async (_project, path) => {
        calls.push(`save ${path ?? ""}`);
        return path ?? "/projects/current.zvn";
      },
      open: async (path) => {
        calls.push(`open ${path}`);
        throw new Error(`cannot open ${path} in tests`);
      },
    };
    if (!omit.has("storage.readText")) {
      host.storage.readText = async (path) => {
        calls.push(`readText ${path}`);
        const textValue = texts[path];
        if (textValue === undefined) throw new Error(`No such file: ${path}`);
        return textValue;
      };
    }
    if (!omit.has("storage.writeText")) {
      host.storage.writeText = async (path, textValue) => {
        calls.push(`writeText ${path}`);
        written.set(path, textValue);
        return path;
      };
    }
    // Relative paths start at the project's folder, like the CLI host's.
    const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
    const resolved = (path: string) => (path.startsWith("/") ? path : `${folderOf(projectPath ?? "/projects/untitled.zvn")}/${path}`);
    if (!omit.has("storage.writeBytes")) {
      host.storage.writeBytes = async (path, bytes, _type, opts) => {
        const target = resolved(path);
        calls.push(`writeBytes ${target}`);
        if (!opts?.overwrite && (written.has(target) || disk?.has(target))) throw Object.assign(new Error(`EEXIST: ${target}`), { code: "EEXIST", path: target });
        written.set(target, bytes);
        disk?.add(target);
        return target;
      };
    }
    if (!omit.has("storage.exportMedia")) {
      host.storage.exportMedia = async (file, name, folder, render) => {
        const dir = resolved(folder || ".").replace(/\/\.$/, "");
        const target = `${dir}/${name}`;
        calls.push(`exportMedia ${file.id} ${target}${render ? " render" : ""}`);
        if (written.has(target) || disk?.has(target)) return { location: target, folder: dir, existed: true };
        if (render) {
          if (!host.exporter) throw new Error("no exporter");
          await host.exporter.export(render.project, { ...render.options, output: target });
        }
        written.set(target, String(file.path));
        disk?.add(target);
        return { location: target, folder: dir, existed: false };
      };
    }
    if (!omit.has("storage.currentPath")) host.storage.currentPath = () => projectPath;
    if (!omit.has("storage.recentProjects")) host.storage.recentProjects = async () => structuredClone(options.recent ?? []);
    if (!omit.has("storage.recoveryCopies")) {
      host.storage.recoveryCopies = async () => (options.recovery ?? []).map(({ project: _project, ...copy }) => copy);
      host.storage.restoreRecoveryCopy = async (copy) => {
        calls.push(`restore ${copy}`);
        const found = (options.recovery ?? []).find((c) => c.path === copy);
        if (!found) throw new Error(`no copy ${copy}`);
        return { project: structuredClone(found.project), path: projectPath ?? "", backup: `${(projectPath ?? "").replace(/\.zvn$/, "")}-1-backup.zvn` };
      };
    }
    if (!omit.has("storage.customProfiles")) {
      host.storage.customProfiles = async () => Object.entries(profiles).map(([name, text]) => ({ name, text, path: `/profiles/${name}` }));
      host.storage.writeCustomProfile = async (name, text) => {
        calls.push(`writeProfile ${name}`);
        profiles[name] = text;
        return `/profiles/${name}`;
      };
      host.storage.removeCustomProfile = async (name) => {
        calls.push(`removeProfile ${name}`);
        delete profiles[name];
      };
    }
  }
  if (!without.has("library")) {
    const library = { ...defaultLibrary(), ...(options.library ?? {}) };
    host.library = {
      getJson: async (url) => {
        calls.push(`library ${url}`);
        // Longest matching prefix wins, so a search route never answers a lookup.
        const prefix = Object.keys(library)
          .filter((k) => url.startsWith(k))
          .sort((a, b) => b.length - a.length)[0];
        if (!prefix) throw new Error(`no fake library route for ${url}`);
        return structuredClone(library[prefix]!(url));
      },
    };
  }
  if (!without.has("audio")) {
    host.audio = {
      analyzeAudio: async (path): Promise<AudioEnvelope> => {
        calls.push(`analyzeAudio ${path}`);
        // 20 s at 16 kHz / 480: speech 0.5-2.0 s and 2.5-4.5 s, silence elsewhere.
        const frames = Math.round((20 * 16000) / 480);
        const rms = Array.from({ length: frames }, (_, i) => {
          const t = (i * 480) / 16000;
          return TRANSCRIPT_CUES.some((c) => t >= c.start && t < c.end) ? 0.3 : 0.001;
        });
        return { sampleRate: 16000, frameSize: 480, rms };
      },
    };
  }
  if (host.audio && !omit.has("audio.transcribe")) {
    const transcripts = options.transcripts ?? {};
    host.audio.transcribe = async (path, opts): Promise<Transcription> => {
      calls.push(`transcribe ${path} ${opts?.language || "auto"}`);
      const answer = transcripts[path];
      if (answer instanceof Error) throw answer;
      if (answer) return structuredClone(answer);
      if (path.includes("silent")) throw new TranscriptionError("no_audio", `${path} has no audio stream.`);
      return { language: opts?.language || "en", model: "whisper-1", words: structuredClone(SPOKEN_WORDS), segments: [], durationSeconds: 8 };
    };
  }
  if (!without.has("motion")) host.motion = fakeMotionHost();
  if (!without.has("fx")) {
    // Renders nothing: names the movie after the request so equal stacks share a path, like the render cache.
    host.fx = {
      render: async (r) => {
        const key = JSON.stringify([r.path, r.start, r.end, r.effects]);
        let hash = 0;
        for (const ch of key) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) >>> 0;
        const fingerprint = hash.toString(16).padStart(8, "0").repeat(8);
        calls.push(`fx ${r.path} ${r.start}-${r.end} ${r.effects.map((e) => e.effect).join("+")}`);
        if (r.path.includes("unrenderable")) throw new Error("ffmpeg failed (exit 1): Invalid data found when processing input");
        const duration = (r.end - r.start) * fxStretch(r.effects);
        return { path: `/cache/fx/${fingerprint.slice(0, 16)}.mov`, codec: "prores422", width: 1920, height: 1080, fps: { num: 30, den: 1 }, frames: Math.ceil(duration * 30), duration, fingerprint, cached: false, seconds: 1.5, renderedAt: "2026-10-26T00:00:00Z", ffmpeg: "9.0.2" };
      },
    };
  }
  if (!without.has("assets")) {
    host.assets = {
      readText: async (path) => {
        calls.push(`asset ${path}`);
        const textValue = assets[path];
        if (textValue === undefined) throw new Error(`No asset ${path}`);
        return textValue;
      },
      // The real bundled fonts: the typesetter's tests set real outlines.
      readBytes: async (path) => {
        calls.push(`asset ${path}`);
        if (!path.startsWith("fonts/")) throw new Error(`No asset ${path}`);
        return readBundledFont(path);
      },
    };
  }
  return host;
}
