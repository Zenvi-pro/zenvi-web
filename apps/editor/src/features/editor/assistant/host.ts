/**
 * The web editor as a tool host: what engine tools may use when the
 * Assistant (or the command palette) runs them here.
 */
import type { ExportOptions, ExportResult, ImportedMedia, ReaderInfo, ToolHost, ToolImage } from "@zenvi/engine";
import { backendRequest } from "@/lib/backend";
import { config } from "@/lib/env";
import { downloadBlob, safeFileName } from "@/lib/projectFactory";
import { mediaStore } from "@/lib/storage/media";
import { toast } from "@/ui/Toast";
import { exportAvailable, probe, renderFrame, startExport } from "../render";
import type { EditorSession } from "../session/EditorSession";
import { contentTypeFor, mediaPath, type MediaSourceSpec } from "../session/media";
import { hashFile, partialFingerprint } from "@/lib/storage/hash";

const MAX_URL_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

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

/** Store a File like an import, without adding it to the project (tools call addFile). */
async function prepare(session: EditorSession, file: File): Promise<ImportedMedia> {
  const [item] = await session.media.importFiles([file]);
  if (!item) throw new Error(`Could not import ${file.name}`);
  pendingSpecs.set(item.media.path, item.spec);
  return item.media;
}

/** Bytes for media a tool imported, attached once the tool added the file to the project. */
const pendingSpecs = new Map<string, MediaSourceSpec>();

/** Attach bytes of files tools added (they know paths, not our specs). */
export function attachPendingMedia(session: EditorSession): void {
  for (const file of session.project.files) {
    const spec = pendingSpecs.get(String(file.path));
    if (spec) {
      session.media.attach(file.id, spec);
      pendingSpecs.delete(String(file.path));
    }
  }
}

export function createToolHost(session: EditorSession, pickFiles: () => Promise<File[]>): ToolHost {
  const host: ToolHost = {
    player: {
      get playhead() {
        return session.playback.getState().time;
      },
      get playing() {
        return session.playback.getState().playing;
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
      openImportDialog: () => session.views.pickMedia?.(),
      openExportDialog: () => session.ui.setState({ dialog: "export" }),
      notify: (message, level = "info") => {
        if (level === "error") toast.error(message);
        else if (level === "warning") toast.warning(message);
        else toast.info(message);
      },
    },
    media: {
      async probe(path: string): Promise<ReaderInfo> {
        const file = session.project.files.find((f) => f.path === path || f.id === path);
        const spec = file ? session.media.spec(file.id) : pendingSpecs.get(path);
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
        const file = new File([bytes as BlobPart], name, { type: contentType });
        const sha256 = await hashFile(file);
        const store = await mediaStore();
        await store.put(sha256, file, name);
        const stored = await store.get(sha256);
        const path = mediaPath(sha256, name);
        pendingSpecs.set(path, stored?.handle ? { kind: "opfs", handle: stored.handle } : { kind: "blob", blob: file, name });
        // Keep the fingerprint consistent with regular imports for later relinks.
        void partialFingerprint(file);
        return path;
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
    },
    log: (message) => console.debug(`[zenvi tools] ${message}`),
  };
  if (exportAvailable) {
    host.exporter = {
      async export(project, options: ExportOptions, onProgress): Promise<ExportResult> {
        const job = startExport(project, options, (f) => onProgress?.(f), session.media);
        const blob = await job.promise;
        const name = safeFileName(session.meta.getState().name, options.format === "webm" ? "webm" : "mp4");
        downloadBlob(blob, name);
        return { location: name, bytes: blob.size, mimeType: blob.type };
      },
    };
  }
  host.frames = {
    async renderFrame(project, seconds, options): Promise<ToolImage> {
      return renderFrame(project, seconds, options ?? {}, session.media);
    },
  };
  return host;
}
