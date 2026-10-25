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
import { describeProject, type LocalProjectMeta, type ProjectRepository } from "@/lib/storage/projects";
import { toast } from "@/ui/Toast";
import { Autosaver } from "./autosave";
import { uploadMissingMedia, type MediaUploadProgress, type MediaUploadResult, type MissingCloudFile } from "./cloudMedia";
import { fileDisplayName, MediaLibrary } from "./media";
import { createPlaybackStore, type PlaybackStore, type PreviewEngine } from "./playback";
import { PreviewCache } from "./previews";
import { createUiStore, pruneSelection, type UiStore } from "./uiStore";

/** `partial`: the project synced, but some of its media is neither in Zenvi Cloud nor in this browser. */
export type CloudSyncState = "local" | "pending" | "syncing" | "synced" | "partial" | "offline" | "conflict" | "error";

export interface CloudSyncStatus {
  state: CloudSyncState;
  error: string | null;
  lastSyncedAt: number | null;
  /** Files the cloud copy refers to that Zenvi Cloud does not have (state `partial`). */
  missing: MissingCloudFile[];
  /** The cloud's revision when this copy conflicts with it (state `conflict`). */
  conflictRevision?: string | null;
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
  /** The cloud save in flight; saves never overlap (each needs the revision the previous one got). */
  private cloudSaving: Promise<void> | null = null;
  /** A save asked for while one was in flight (coalesced into one more run). */
  private cloudWanted: { force: boolean } | null = null;
  /** `cloudContentKey` of a revision just taken from the cloud (`adoptRemote`): a save of exactly that is not sent back. */
  private adoptedContentKey: string | null = null;
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
      missing: [],
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
    void this.mediaReady.then(() => this.noteMissingCloudMedia());
    // Media that becomes readable after a frame was drawn (tool imports, cloud URLs, relinks): draw again.
    let redrawQueued = false;
    this.disposers.push(
      this.media.status.subscribe((next, previous) => {
        const becameReady = Object.entries(next).some(([id, entry]) => entry.status === "ready" && previous[id]?.status !== "ready");
        if (!becameReady || redrawQueued) return;
        redrawQueued = true;
        queueMicrotask(() => {
          redrawQueued = false;
          this.engine?.setProject(this.displayProject());
        });
      }),
    );
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
    // In a conflict nothing syncs until the person chooses; edits keep saving locally.
    if (this.cloudSync.getState().state === "conflict") return;
    this.cloudSync.setState({ state: "pending", error: null });
    this.cloudTimer = setTimeout(() => {
      this.cloudTimer = null;
      void this.saveCloud();
    }, 2500);
  }

  /**
   * Push the current project to Zenvi Cloud (linked projects only). Saves run
   * one at a time: a save asked for while one is in flight runs once after
   * it, with the revision it got, so autosave and "Sync now" never send the
   * same If-Match twice. `force` overwrites a conflicting cloud copy.
   */
  saveCloud(force = false): Promise<void> {
    this.cloudWanted = { force: (this.cloudWanted?.force ?? false) || force };
    if (this.cloudSaving) return this.cloudSaving;
    const run = (async () => {
      try {
        while (this.cloudWanted) {
          const next = this.cloudWanted;
          this.cloudWanted = null;
          await this.saveCloudOnce(next.force);
        }
      } finally {
        this.cloudSaving = null;
      }
    })();
    this.cloudSaving = run;
    return run;
  }

  private async saveCloudOnce(force: boolean): Promise<void> {
    const link = this.meta.getState().cloud;
    const cloud = this.options.cloud();
    if (!link || !cloud?.enabled) return;
    const status = this.cloudSync.getState();
    if (status.state === "conflict" && !force) return;
    // Overwriting a conflict: the save must name the cloud's current revision.
    const revision = force && status.state === "conflict" && status.conflictRevision !== undefined ? status.conflictRevision : link.revision;
    // Exactly the revision just taken from the cloud (plus view state): nothing to send back.
    if (!force && status.state !== "conflict" && this.adoptedContentKey !== null && cloudContentKey(this.snapshotForSave()) === this.adoptedContentKey) {
      this.cloudSync.setState({ state: status.missing.length > 0 ? "partial" : "synced", error: null });
      return;
    }
    this.cloudSync.setState({ state: "syncing", error: null });
    try {
      // Media first, so the cloud project points at as few missing bytes as possible.
      const media = await this.uploadMedia();
      const snapshot = this.snapshotForSave();
      const saved = await cloud.saveProject(link.id, snapshot, revision);
      const syncedAt = Date.now();
      const cloudLink = { ...link, revision: saved.revision, syncedAt };
      this.adoptedContentKey = null;
      this.meta.setState({ ...this.meta.getState(), cloud: cloudLink });
      await this.options.repository.updateMeta(this.meta.getState().id, { cloud: cloudLink });
      this.cloudSync.setState(this.syncedStatus(syncedAt, media));
    } catch (error) {
      if (error instanceof CloudConflictError) {
        if (force) {
          // The cloud moved again while overwriting: overwrite that revision.
          this.cloudSync.setState({ state: "conflict", error: error.message, conflictRevision: error.currentRevision });
          if (error.currentRevision) return this.saveCloudOnce(true);
        }
        this.markConflict(error.currentRevision, error.message);
        return;
      }
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      this.cloudSync.setState({ state: offline ? "offline" : "error", error: error instanceof Error ? error.message : String(error) });
    }
  }

  private syncedStatus(syncedAt: number, media: MediaUploadResult): CloudSyncStatus {
    if (media.missing.length === 0) return { state: "synced", error: null, lastSyncedAt: syncedAt, missing: [], conflictRevision: undefined };
    const names = media.missing.map((m) => m.name);
    const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more` : names.join(", ");
    return {
      state: "partial",
      error: `Not fully synced: ${list} ${names.length === 1 ? "is" : "are"} not in Zenvi Cloud and not in this browser. Relink ${names.length === 1 ? "it" : "them"} to upload.`,
      lastSyncedAt: syncedAt,
      missing: media.missing,
      conflictRevision: undefined,
    };
  }

  /** A linked project whose media is neither here nor in the cloud is not fully synced, even before the next save. */
  private noteMissingCloudMedia(): void {
    if (this.disposed || !this.meta.getState().cloud) return;
    const status = this.cloudSync.getState();
    if (status.state !== "synced") return;
    const missing = this.media
      .missing(this.doc.project)
      .filter((f) => !this.media.inCloud(f.id))
      .map((f) => ({ fileId: f.id, name: fileDisplayName(f) }));
    if (missing.length > 0) this.cloudSync.setState(this.syncedStatus(status.lastSyncedAt ?? Date.now(), { uploaded: 0, unavailable: missing.length, missing }));
  }

  /** The cloud copy changed elsewhere: stop syncing until the person decides (nothing is discarded). */
  markConflict(cloudRevision: string | null, message = "This project was changed somewhere else."): void {
    this.cloudSync.setState({ state: "conflict", error: message, conflictRevision: cloudRevision });
    this.ui.setState({ dialog: "cloudConflict" });
  }

  /**
   * Take a newer cloud revision made elsewhere (the chat's tools, another
   * tab) as one undo step, without sending it back. Refused (false) while
   * this copy has edits the cloud does not have yet; the next save then
   * reports the conflict as usual. `project` must already be parsed
   * (`parseProject`), like every project the session holds.
   */
  adoptRemote(remote: { revision: string; project: Project }, label = "Changes from the chat"): boolean {
    const link = this.meta.getState().cloud;
    const state = this.cloudSync.getState().state;
    if (!link || link.revision === remote.revision) return false;
    if (this.cloudTimer || this.cloudSaving || (state !== "synced" && state !== "partial")) return false;
    if (this.autosave.current.state !== "saved") return false;
    const current = this.doc.project as unknown as Record<string, unknown>;
    const next = remote.project as unknown as Record<string, unknown>;
    const changed = Object.keys(next).filter((key) => !VOLATILE_KEYS.has(key) && JSON.stringify(current[key]) !== JSON.stringify(next[key]));
    this.setDraft(null);
    if (changed.length > 0) {
      try {
        this.doc.transaction(label, (tx) => {
          for (const key of changed) tx.replace([key], next[key]);
        });
      } catch (error) {
        reportEditError(label, error);
        return false;
      }
    }
    const cloudLink = { ...link, revision: remote.revision, syncedAt: Date.now() };
    this.adoptedContentKey = cloudContentKey(this.snapshotForSave());
    this.meta.setState({ ...this.meta.getState(), cloud: cloudLink });
    void this.options.repository.updateMeta(this.meta.getState().id, { cloud: cloudLink });
    return true;
  }

  /** Conflict → "Keep mine": overwrite the cloud copy (If-Match: its current revision). */
  keepMine(): Promise<void> {
    return this.saveCloud(true);
  }

  /** Upload media the cloud does not have yet (deduplicated by content hash). */
  async uploadMedia(onProgress?: (p: MediaUploadProgress) => void): Promise<MediaUploadResult> {
    const cloud = this.options.cloud();
    if (!cloud?.enabled) return { uploaded: 0, unavailable: 0, missing: [] };
    return uploadMissingMedia(this.doc.project, cloud, await this.media.storage(), this.uploadedMedia, {
      onProgress,
      inCloud: (fileId) => this.media.inCloud(fileId),
    });
  }

  /** Link this project to a cloud project (after Share / push). */
  async linkCloud(cloudId: string, revision: string | null): Promise<void> {
    const cloud = { id: cloudId, revision, syncedAt: Date.now() };
    this.meta.setState({ ...this.meta.getState(), cloud });
    await this.options.repository.updateMeta(this.meta.getState().id, { cloud });
    this.cloudSync.setState({ state: "synced", error: null, lastSyncedAt: cloud.syncedAt, missing: [] });
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

/** Project keys that change without changing the edit (view state, the undo slice, the format stamp). */
const VOLATILE_KEYS = new Set(["history", "playhead_position", "scale", "version"]);

/** What a cloud save would change: the project without its volatile keys. */
function cloudContentKey(project: Project): string {
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(project)) if (!VOLATILE_KEYS.has(key)) content[key] = value;
  return JSON.stringify(content);
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
