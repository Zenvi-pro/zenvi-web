/**
 * The web editor as a tool host: what engine tools may use when the
 * Assistant (or the command palette) runs them here.
 */
import type { CloudMediaRef, ExportOptions, ExportResult, ImportedMedia, ReaderInfo, ToolHost, ToolImage } from "@zenvi/engine";
import { canExportWith } from "@zenvi/render-web";
import { backendRequest } from "@/lib/backend";
import { config } from "@/lib/env";
import { downloadBlob, safeFileName } from "@/lib/projectFactory";
import { projectRepository } from "@/lib/storage/projects";
import { savePanels } from "../session/uiStore";
import { toast } from "@/ui/Toast";
import { exportAvailable, extensionForMime, probe, renderFrame, resolveBundledMedia, startExport } from "../render";
import { editorLayout, editorPreferences, withLayout, withPreference } from "./editorSettings";
import type { EditorSession } from "../session/EditorSession";
import { assetUrl } from "../catalog";
import { analyzeAudio, blobOf, decodePcm } from "./audioAnalysis";
import { transcribeSpeech } from "./transcribe";
import { contentTypeFor, fileHash, type MediaSourceSpec } from "../session/media";

const MAX_URL_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;
/** Text files tools read (title SVGs, subtitles); the largest bundled title template is under 5 MB. */
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

async function fileFromUrl(url: string, filename: string | undefined, signal?: AbortSignal): Promise<File> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http(s) URLs can be imported.");
  const response = await fetch(parsed, { signal });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_URL_IMPORT_BYTES) throw new Error("That file is too large to import in the browser.");
  const blob = await response.blob();
  const name = filename || decodeURIComponent(parsed.pathname.split("/").pop() || "download");
  return new File([blob], name, { type: blob.type || contentTypeFor(name) });
}

/**
 * Media tools brought into the session, by the path they gave the engine:
 * the bytes (attached once the tool added the file) and the content ref the
 * file must carry (`cloud`), which engine tools do not know for generated
 * media (titles, voiceovers) — without it the file would be missing after a
 * reload and never reach Zenvi Cloud.
 */
interface Intake {
  specs: Map<string, MediaSourceSpec>;
  refs: Map<string, CloudMediaRef>;
}

const intakes = new WeakMap<EditorSession, Intake>();

function intakeOf(session: EditorSession): Intake {
  let intake = intakes.get(session);
  if (!intake) {
    intake = { specs: new Map(), refs: new Map() };
    intakes.set(session, intake);
    // Redo re-inserts the file as the tool first wrote it: attach it again.
    session.doc.subscribe((event) => {
      if (event.source === "redo") queueMicrotask(() => attachPendingMedia(session));
    });
  }
  return intake;
}

/** Store a File like an import, without adding it to the project (tools call addFile). */
async function prepare(session: EditorSession, file: File): Promise<ImportedMedia> {
  const [item] = await session.media.importFiles([file]);
  if (!item) throw new Error(`Could not import ${file.name}`);
  const intake = intakeOf(session);
  intake.specs.set(item.media.path, item.spec);
  if (item.media.cloud) intake.refs.set(item.media.path, item.media.cloud);
  return item.media;
}

/** Attach bytes (and content refs) of files tools added; they know paths, not our specs. */
export function attachPendingMedia(session: EditorSession): void {
  const intake = intakes.get(session);
  if (!intake) return;
  for (const file of session.project.files) {
    const path = String(file.path);
    const spec = intake.specs.get(path);
    if (spec && !session.media.spec(file.id)) session.media.attach(file.id, spec);
    const ref = intake.refs.get(path);
    // Outside history on purpose: the ref describes bytes, not an edit.
    if (ref && !fileHash(file)) session.doc.setUntracked(["files", { id: file.id }], { ...file, cloud: { ...(file.cloud ?? {}), ...ref } });
  }
}

/** Text of a bundled engine asset (`titles/Bar_1.svg`), for tools such as add_title_tool. */
async function readAsset(path: string): Promise<string> {
  const url = assetUrl(path);
  if (!url) throw new Error(`No bundled asset ${path}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.text();
}

/** A download's file name for a path a tool gave (its base name, made safe), with a fallback name. */
function downloadName(path: string, fallback: string, extension: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  return safeFileName(base.replace(/\.[^.]+$/, "") || fallback, base.match(/\.([a-z0-9]+)$/i)?.[1] ?? extension);
}

function isFullscreen(): boolean {
  return typeof document !== "undefined" && document.fullscreenElement !== null && document.fullscreenElement !== undefined;
}

export function createToolHost(session: EditorSession, pickFiles: () => Promise<File[]>): ToolHost {
  // The loaded media of a project file (by path or id), for audio analysis.
  const specFor = (path: string) => {
    const file = session.project.files.find((f) => f.path === path || f.id === path);
    const spec = (file ? session.media.spec(file.id) : undefined) ?? intakeOf(session).specs.get(path);
    if (!spec) throw new Error(`the media for ${path} is not loaded (relink it first)`);
    return spec;
  };
  const host: ToolHost = {
    player: {
      get playhead() {
        return session.playback.getState().time;
      },
      get playing() {
        return session.playback.getState().playing;
      },
      get rate() {
        return session.playback.getState().rate;
      },
      play: () => session.play(),
      pause: () => session.pause(),
      toggle: () => session.togglePlay(),
      seek: (seconds) => session.seek(seconds),
    },
    ui: {
      zoomIn: () => session.views.timeline?.zoomIn(),
      zoomOut: () => session.views.timeline?.zoomOut(),
      centerOnPlayhead: () => session.views.timeline?.centerOnPlayhead(),
      selectedIds: () => [...session.ui.getState().selection.clips, ...session.ui.getState().selection.transitions],
      selection: () => {
        const s = session.ui.getState().selection;
        return { clips: [...s.clips], transitions: [...s.transitions], effects: s.effect ? [s.effect] : [] };
      },
      setSelection: (selection) => {
        // The Properties panel shows one effect, with its clip selected.
        const effect = selection.effects.at(-1) ?? null;
        const clips = [...selection.clips];
        const owner = effect ? session.project.clips.find((c) => c.effects?.some((e) => e.id === effect)) : undefined;
        if (owner && !clips.includes(owner.id)) clips.push(owner.id);
        session.ui.setState({ selection: { clips, transitions: [...selection.transitions], markers: [], effect } });
      },
      showProperties: () => session.ui.setState({ rightTab: "properties", panels: { ...session.ui.getState().panels, rightCollapsed: false } }),
      timelineView: () => {
        const timeline = session.views.timeline;
        if (!timeline) return null;
        const { start, end } = timeline.visibleRange();
        const ui = session.ui.getState();
        // The web timeline has no timing (retime-by-drag) mode.
        return { secondsPer100px: 100 / ui.pxPerSecond, visibleSeconds: end - start, visibleRange: [start, end], snapping: ui.snapping, razor: ui.tool === "razor", timing: null };
      },
      showTimelineRange: (start, end) => session.views.timeline?.showRange(start, end),
      setTimelineMode: (mode, on) => {
        if (mode === "snapping") session.ui.setState({ snapping: on });
        else if (mode === "razor") session.ui.setState({ tool: on ? "razor" : "select" });
      },
      openImportDialog: () => session.views.pickMedia?.(),
      openExportDialog: () => session.ui.setState({ dialog: "export" }),
      layout: () => editorLayout(session.ui.getState(), isFullscreen()),
      setLayout: (change) => {
        const next = withLayout(session.ui.getState(), change);
        session.ui.setState(next);
        savePanels(next.panels);
        return editorLayout(session.ui.getState(), isFullscreen());
      },
      preferences: () => editorPreferences(session.ui.getState(), config.backendUrl),
      setPreference: (key, value) => session.ui.setState(withPreference(key, value)),
      clearPlaybackCache: () => session.clearPreviewCaches(),
      notify: (message, level = "info") => {
        if (level === "error") toast.error(message);
        else if (level === "warning") toast.warning(message);
        else toast.info(message);
      },
    },
    media: {
      async probe(path: string): Promise<ReaderInfo> {
        const file = session.project.files.find((f) => f.path === path || f.id === path);
        const spec = (file ? session.media.spec(file.id) : undefined) ?? intakeOf(session).specs.get(path);
        if (!spec) throw new Error(`No media at ${path}`);
        return probe(spec, { path });
      },
      async importUrl(url, options) {
        const file = await fileFromUrl(url, options?.filename, options?.signal);
        return prepare(session, file);
      },
      async pickFiles() {
        const files = await pickFiles();
        const out: ImportedMedia[] = [];
        for (const f of files) out.push(await prepare(session, f));
        return out;
      },
      async writeGenerated(name, bytes, contentType) {
        // Stored like any import (content-addressed, probed), so it relinks, reloads and uploads the same way.
        const media = await prepare(session, new File([bytes as BlobPart], name, { type: contentType }));
        return media.path;
      },
      // Missing = what Project Files offers to relink: not in this browser and not loadable from Zenvi Cloud.
      async missing(files) {
        await session.media.sync(session.project);
        const gone = new Set(session.media.missing(session.project).map((f) => f.id));
        return files.map((f) => gone.has(f.id));
      },
    },
    backend: {
      baseUrl: config.backendUrl,
      request: (path, init) => backendRequest(path, { ...init, auth: true }),
    },
    storage: {
      async save(project) {
        await session.autosave.flush();
        return `browser:${session.meta.getState().id}:${project.id}`;
      },
      async open() {
        throw new Error("Open projects from the Zenvi projects page in the web editor.");
      },
      // A project file's text (title SVGs to edit, subtitles in the bin), by its path or id.
      async readText(path) {
        const file = session.project.files.find((f) => f.path === path || f.id === path);
        const spec = (file ? session.media.spec(file.id) : undefined) ?? intakeOf(session).specs.get(path) ?? resolveBundledMedia(path);
        if (!spec) throw new Error(`${path} is not loaded in this project`);
        const blob = await blobOf(spec);
        if (blob.size > MAX_TEXT_BYTES) throw new Error(`${path} is too large to read as text`);
        return blob.text();
      },
      // Exported captions and other text files arrive as downloads.
      async writeText(path, text, contentType) {
        const name = downloadName(path, session.meta.getState().name, "txt");
        downloadBlob(new Blob([text], { type: contentType ?? "text/plain;charset=utf-8" }), name);
        return name;
      },
      // Saved frames too (a download never replaces a file: the browser renames it).
      async writeBytes(path, bytes, contentType) {
        const name = downloadName(path, session.meta.getState().name, "png");
        downloadBlob(new Blob([bytes as BlobPart], { type: contentType }), name);
        return name;
      },
      // Copies of project media download from this browser's storage (or Zenvi Cloud); sub-clips render first.
      async exportMedia(file, name, _folder, render) {
        if (render) {
          if (!exportAvailable) throw new Error("this browser cannot export video");
          const blob = await startExport(render.project, render.options, () => {}, session.media).promise;
          downloadBlob(blob, name);
          return { location: name, folder: "your browser's downloads", existed: false };
        }
        const spec = session.media.spec(file.id);
        if (!spec) throw new Error(`the media of ${String(file.name ?? file.path)} is not loaded (relink it first)`);
        downloadBlob(await blobOf(spec), name);
        return { location: name, folder: "your browser's downloads", existed: false };
      },
      currentPath: () => session.meta.getState().id,
      // The projects in this browser, as the projects page lists them (most recently opened or edited first).
      async recentProjects() {
        const projects = await projectRepository().list();
        const at = (p: (typeof projects)[number]) => Math.max(p.openedAt ?? 0, p.updatedAt);
        return projects
          .sort((a, b) => at(b) - at(a))
          .slice(0, 10)
          .map((p) => ({ path: p.id, name: p.name, exists: true, modifiedAt: p.updatedAt / 1000 }));
      },
    },
    audio: {
      async analyzeAudio(path, options) {
        return analyzeAudio(specFor(path), options);
      },
      async decodePcm(path, options) {
        return decodePcm(specFor(path), options);
      },
      // Speech recognition through the Zenvi backend, as the signed-in person.
      async transcribe(path, options) {
        const file = session.project.files.find((f) => f.path === path || f.id === path);
        return transcribeSpeech(specFor(path), { ...options, name: String(file?.name ?? path.split(/[\\/]/).pop() ?? "") });
      },
    },
    log: (message) => console.debug(`[zenvi tools] ${message}`),
  };
  if (exportAvailable) {
    host.exporter = {
      async export(project, options: ExportOptions, onProgress): Promise<ExportResult> {
        const job = startExport(project, options, (f) => onProgress?.(f), session.media);
        const blob = await job.promise;
        const name = safeFileName(session.meta.getState().name, extensionForMime(blob.type));
        downloadBlob(blob, name);
        return { location: name, bytes: blob.size, mimeType: blob.type };
      },
      supports: (format, videoCodec, audioCodec) => canExportWith(format, videoCodec, audioCodec),
    };
  }
  host.assets = { readText: readAsset };
  host.frames = {
    async renderFrame(project, seconds, options): Promise<ToolImage> {
      return renderFrame(project, seconds, options ?? {}, session.media);
    },
  };
  return host;
}
