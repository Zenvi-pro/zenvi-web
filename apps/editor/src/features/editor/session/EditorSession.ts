/**
 * One open project: the ProjectDocument plus everything the editor keeps
 * around it (UI state, playback, media, autosave, cloud sync).
 *
 * Every mutation goes through `edit(label, tx => op(tx, …))`: one user intent,
 * one transaction, one undo step. Ops validate first and throw `OpError`, so a
 * refused edit shows a message and leaves history untouched.
 */
import {
  autoFitDuration,
  frameDuration,
  isOpError,
  PROJECT_FORMAT_VERSION,
  ProjectDocument,
  snapToFrame,
  timelineEnd,
  type ChangeEvent,
  type ClipboardData,
  type Project,
  type Transaction,
} from "@zenvi/engine";
import { createStore, type StoreApi } from "zustand/vanilla";
import { CloudConflictError, type CloudClient } from "@/lib/cloud";
import { mediaStore } from "@/lib/storage/media";
import { describeProject, type LocalProjectMeta, type ProjectRepository } from "@/lib/storage/projects";
import { toast } from "@/ui/Toast";
import { Autosaver } from "./autosave";
import { uploadMissingMedia, type MediaUploadProgress } from "./cloudMedia";
import { MediaLibrary } from "./media";
import { createPlaybackStore, type PlaybackStore, type PreviewEngine } from "./playback";
import { PreviewCache } from "./previews";
import { createUiStore, pruneSelection, type UiStore } from "./uiStore";

export type CloudSyncState = "local" | "pending" | "syncing" | "synced" | "offline" | "conflict" | "error";

export interface CloudSyncStatus {
  state: CloudSyncState;
  error: string | null;
  lastSyncedAt: number | null;
}

/** The timeline view's imperative handle (zoom and scroll live in the view). */
export interface TimelineController {
  zoomIn(): void;
  zoomOut(): void;
  zoomToFit(): void;
  centerOnPlayhead(): void;
  /** Scroll so `seconds` is visible (no-op when it already is). */
  reveal(seconds: number): void;
}

/** Hooks React views register so commands can reach them. */
export interface SessionViews {
  timeline: TimelineController | null;
  /** Open the system file picker to import media. */
  pickMedia: (() => void) | null;
  /** Open the system file picker for a .zvn project. */
  pickProject: (() => void) | null;
  /** Put keyboard focus on the timeline. */
  focusTimeline: (() => void) | null;
}

export interface EditorSessionOptions {
  meta: LocalProjectMeta;
  project: Project;
  repository: ProjectRepository;
  media: MediaLibrary;
  cloud: () => CloudClient | null;
}

const THUMBNAIL_EVERY_MS = 20_000;

export class EditorSession {
  readonly doc: ProjectDocument;
  readonly ui: UiStore;
  readonly playback: PlaybackStore;
  readonly meta: StoreApi<LocalProjectMeta>;
  readonly media: MediaLibrary;
  readonly autosave: Autosaver;
  readonly cloudSync: StoreApi<CloudSyncStatus>;
  /** Timeline filmstrips and waveforms. */
  readonly previews = new PreviewCache();
  clipboard: ClipboardData | null = null;
  /** Resolves once every file of the opened project was looked up once. */
  readonly mediaReady: Promise<void>;
  readonly views: SessionViews = { timeline: null, pickMedia: null, pickProject: null, focusTimeline: null };

  private engine: PreviewEngine | null = null;
  private engineOff: (() => void)[] = [];
  private draft: Project | null = null;
  private readonly displayListeners = new Set<() => void>();
  private readonly disposers: (() => void)[] = [];
  private lastThumbnailAt = 0;
  private cloudTimer: ReturnType<typeof setTimeout> | null = null;
  private reverseRaf = 0;
  /** Media hashes known to be in Zenvi Cloud (skips repeated checks). */
  private readonly uploadedMedia = new Set<string>();
  private disposed = false;

  constructor(private readonly options: EditorSessionOptions) {
    this.doc = new ProjectDocument(options.project);
    this.meta = createStore<LocalProjectMeta>(() => options.meta);
    this.media = options.media;
    this.playback = createPlaybackStore(Math.max(0, Number(options.project.playhead_position) || 0));
    this.ui = createUiStore({ pxPerSecond: pixelsPerSecondOf(options.project) });
    this.cloudSync = createStore<CloudSyncStatus>(() => ({
      state: options.meta.cloud ? "synced" : "local",
      error: null,
      lastSyncedAt: options.meta.cloud?.syncedAt ?? null,
    }));
    this.autosave = new Autosaver({ save: () => this.saveLocal() });

    this.disposers.push(autoFitDuration(this.doc));
    this.disposers.push(this.doc.subscribe((event) => this.onChange(event)));
    const onHide = () => {
      if (document.visibilityState === "hidden") void this.autosave.flush();
    };
    document.addEventListener("visibilitychange", onHide);
    this.disposers.push(() => document.removeEventListener("visibilitychange", onHide));
    this.mediaReady = this.media.sync(this.doc.project).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Project access
  // -------------------------------------------------------------------------

  get project(): Project {
    return this.doc.project;
  }

  /** What the timeline and preview show: a live draft while a gesture previews, else the document. */
  displayProject = (): Project => this.draft ?? this.doc.project;

  subscribeDisplay = (listener: () => void): (() => void) => {
    this.displayListeners.add(listener);
    return () => this.displayListeners.delete(listener);
  };

  /**
   * Run one user intent as one undo step. Returns the op result, or undefined
   * when the op refused (a toast explains why) or threw.
   */
  edit<T>(label: string, body: (tx: Transaction) => T): T | undefined {
    this.setDraft(null);
    try {
      return this.doc.transaction(label, body);
    } catch (error) {
      reportEditError(label, error);
      return undefined;
    }
  }

  /**
   * Preview an edit without recording it (numeric scrubbing, live dragging):
   * the same ops run on a scratch copy, and the result is shown until
   * `endPreview()` or the next `edit()`. Refusals keep the last good preview.
   */
  preview(body: (tx: Transaction) => void): void {
    const scratch = new ProjectDocument(this.doc.project, { historyLimit: 0 });
    try {
      scratch.transaction("preview", body);
      this.setDraft(scratch.project);
    } catch {
      // Invalid intermediate value (e.g. dragged past a limit): keep the last draft.
    }
  }

  endPreview(): void {
    this.setDraft(null);
  }

  undo(): void {
    this.setDraft(null);
    if (!this.doc.canUndo) return;
    this.doc.undo(1);
  }

  redo(): void {
    this.setDraft(null);
    if (!this.doc.canRedo) return;
    this.doc.redo(1);
  }

  rename(name: string): void {
    const clean = name.trim() || "Untitled project";
    if (clean === this.meta.getState().name) return;
    this.meta.setState({ ...this.meta.getState(), name: clean });
    document.title = `${clean} · Zenvi`;
    void this.options.repository.updateMeta(this.meta.getState().id, { name: clean }).catch(() => undefined);
    const link = this.meta.getState().cloud;
    const cloud = this.options.cloud();
    if (link && cloud?.enabled) void cloud.renameProject(link.id, clean).catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  attachEngine(engine: PreviewEngine): void {
    this.detachEngine();
    this.engine = engine;
    engine.setProject(this.displayProject());
    engine.seek(this.playback.getState().time);
    this.engineOff = [
      engine.onTime((t) => this.playback.setState({ time: t })),
      engine.onState(({ playing }) => this.playback.setState({ playing, ...(playing ? {} : { rate: 1 }) })),
    ];
  }

  detachEngine(): void {
    for (const off of this.engineOff) off();
    this.engineOff = [];
    this.engine?.pause();
    this.engine = null;
  }

  resizePreview(width: number, height: number): void {
    this.engine?.resize(width, height);
  }

  get renders(): boolean {
    return this.engine?.renders ?? false;
  }

  /** Last frame of content, seconds (where playback stops). */
  endTime(): number {
    return timelineEnd(this.displayProject());
  }

  seek(seconds: number): void {
    const t = Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, Math.max(this.endTime(), 0)));
    this.playback.setState({ time: t });
    this.engine?.seek(t);
  }

  play(rate = 1): void {
    this.stopReverse();
    if (rate < 0) {
      this.engine?.pause();
      this.startReverse(rate);
      return;
    }
    const state = this.playback.getState();
    const end = this.endTime();
    if (end > 0 && state.time >= end - frameDuration(this.project.fps) / 2) this.seek(0);
    this.playback.setState({ rate });
    this.engine?.setRate(rate);
    this.engine?.play();
    if (!this.engine) this.playback.setState({ playing: true });
  }

  pause(): void {
    this.stopReverse();
    this.engine?.pause();
    this.playback.setState({ playing: false, rate: 1 });
  }

  /** Backwards shuttle: the preview renders by seeking (decoders only run forwards). */
  private startReverse(rate: number): void {
    this.playback.setState({ playing: true, rate });
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const t = this.playback.getState().time + dt * rate;
      if (t <= 0) {
        this.seek(0);
        this.stopReverse();
        this.playback.setState({ playing: false, rate: 1 });
        return;
      }
      this.seek(t);
      this.reverseRaf = requestAnimationFrame(tick);
    };
    this.reverseRaf = requestAnimationFrame(tick);
  }

  private stopReverse(): void {
    if (this.reverseRaf) cancelAnimationFrame(this.reverseRaf);
    this.reverseRaf = 0;
  }

  togglePlay(): void {
    if (this.playback.getState().playing) this.pause();
    else this.play(1);
  }

  /** Desktop J/L shuttle: each press doubles the speed in that direction. */
  shuttle(direction: 1 | -1): void {
    const { playing, rate } = this.playback.getState();
    const same = playing && Math.sign(rate) === direction;
    const next = same ? Math.max(-16, Math.min(16, rate * 2)) : direction;
    this.play(next);
  }

  stepFrames(count: number): void {
    this.pause();
    const fps = this.project.fps;
    const t = snapToFrame(this.playback.getState().time, fps) + count * frameDuration(fps);
    this.seek(snapToFrame(Math.max(0, t), fps));
  }

  setLoop(loop: boolean): void {
    this.playback.setState({ loop });
    this.engine?.setLoop(loop);
  }

  // -------------------------------------------------------------------------
  // Saving
  // -------------------------------------------------------------------------

  /** The project JSON to store: document + history slice + UI state (playhead, zoom). */
  snapshotForSave(): Project {
    const json = this.doc.toJSON();
    const pps = this.ui.getState().pxPerSecond;
    const tick = json.tick_pixels > 0 ? json.tick_pixels : 100;
    return {
      ...json,
      playhead_position: Math.round(this.playback.getState().time * 1000) / 1000,
      scale: Math.round((tick / pps) * 1e6) / 1e6,
      // Never the template's "0.0.0": the desktop would treat it as an
      // OpenShot beta project and flip every clip's alpha on load.
      version: { ...json.version, ...PROJECT_FORMAT_VERSION },
    };
  }

  private async saveLocal(): Promise<void> {
    const project = this.snapshotForSave();
    const now = Date.now();
    let thumbnail = this.meta.getState().thumbnail;
    if (this.engine?.captureThumbnail && now - this.lastThumbnailAt > THUMBNAIL_EVERY_MS) {
      const captured = this.engine.captureThumbnail(320);
      if (captured) {
        thumbnail = captured;
        this.lastThumbnailAt = now;
      }
    }
    const meta: LocalProjectMeta = { ...this.meta.getState(), ...describeProject(project), updatedAt: now, thumbnail };
    await this.options.repository.save(meta, project);
    this.meta.setState(meta);
    if (meta.cloud) this.scheduleCloudSave();
  }

  private scheduleCloudSave(): void {
    if (this.cloudTimer) clearTimeout(this.cloudTimer);
    this.cloudSync.setState({ state: "pending", error: null });
    this.cloudTimer = setTimeout(() => {
      this.cloudTimer = null;
      void this.saveCloud();
    }, 2500);
  }

  /** Push the current project to Zenvi Cloud (linked projects only). */
  async saveCloud(force = false): Promise<void> {
    const link = this.meta.getState().cloud;
    const cloud = this.options.cloud();
    if (!link || !cloud?.enabled) return;
    if (this.cloudSync.getState().state === "conflict" && !force) return;
    this.cloudSync.setState({ state: "syncing", error: null });
    try {
      // Media first, so the cloud project never points at bytes the cloud lacks.
      await this.uploadMedia();
      const { revision } = await cloud.saveProject(link.id, this.snapshotForSave(), link.revision);
      const syncedAt = Date.now();
      const cloudLink = { ...link, revision, syncedAt };
      this.meta.setState({ ...this.meta.getState(), cloud: cloudLink });
      await this.options.repository.updateMeta(this.meta.getState().id, { cloud: cloudLink });
      this.cloudSync.setState({ state: "synced", error: null, lastSyncedAt: syncedAt });
    } catch (error) {
      if (error instanceof CloudConflictError) {
        if (force && error.currentRevision) {
          this.meta.setState({ ...this.meta.getState(), cloud: { ...link, revision: error.currentRevision } });
          return this.saveCloud(false);
        }
        this.cloudSync.setState({ state: "conflict", error: error.message });
        this.ui.setState({ dialog: "cloudConflict" });
        return;
      }
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      this.cloudSync.setState({ state: offline ? "offline" : "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Upload media the cloud does not have yet (deduplicated by content hash). */
  async uploadMedia(onProgress?: (p: MediaUploadProgress) => void): Promise<{ uploaded: number; unavailable: number }> {
    const cloud = this.options.cloud();
    if (!cloud?.enabled) return { uploaded: 0, unavailable: 0 };
    return uploadMissingMedia(this.doc.project, cloud, await mediaStore(), this.uploadedMedia, onProgress);
  }

  /** Link this project to a cloud project (after Share / push). */
  async linkCloud(cloudId: string, revision: string | null): Promise<void> {
    const cloud = { id: cloudId, revision, syncedAt: Date.now() };
    this.meta.setState({ ...this.meta.getState(), cloud });
    await this.options.repository.updateMeta(this.meta.getState().id, { cloud });
    this.cloudSync.setState({ state: "synced", error: null, lastSyncedAt: cloud.syncedAt });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.detachEngine();
    if (this.cloudTimer) {
      clearTimeout(this.cloudTimer);
      this.cloudTimer = null;
      void this.saveCloud();
    }
    await this.autosave.flush().catch(() => undefined);
    this.autosave.dispose();
    for (const dispose of this.disposers.splice(0)) dispose();
    this.displayListeners.clear();
    this.previews.dispose();
  }

  // -------------------------------------------------------------------------

  private setDraft(project: Project | null): void {
    if (this.draft === project) return;
    this.draft = project;
    this.engine?.setProject(this.displayProject());
    for (const l of [...this.displayListeners]) l();
  }

  private onChange(event: ChangeEvent): void {
    // A committed change ends any preview; untracked UI state (duration fit) keeps it.
    if (event.source !== "untracked") this.draft = null;
    const project = this.doc.project;
    this.engine?.setProject(this.displayProject());
    for (const l of [...this.displayListeners]) l();
    const ui = this.ui.getState();
    const clipIds = new Set(project.clips.map((c) => c.id));
    const pruned = pruneSelection(ui.selection, {
      clip: (id) => clipIds.has(id),
      transition: (id) => project.effects.some((t) => t.id === id),
      marker: (id) => project.markers.some((m) => m.id === id),
      effect: (id) => project.clips.some((c) => c.effects?.some((e) => e.id === id)),
    });
    if (pruned !== ui.selection) this.ui.setState({ selection: pruned });
    if (event.source !== "load") void this.media.sync(project);
    this.autosave.notify();
  }
}

function pixelsPerSecondOf(project: Project): number {
  const scale = project.scale > 0 ? project.scale : 15;
  const tick = project.tick_pixels > 0 ? project.tick_pixels : 100;
  return Math.min(1200, Math.max(0.5, tick / scale));
}

export function reportEditError(label: string, error: unknown): void {
  if (isOpError(error)) {
    toast.warning(error.message.replace(/^not implemented: /, "Not available yet: "), { description: label });
    return;
  }
  console.error(`[zenvi] ${label} failed`, error);
  toast.error(`${label} failed`, { description: error instanceof Error ? error.message : String(error) });
}
