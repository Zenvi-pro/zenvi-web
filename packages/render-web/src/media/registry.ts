/**
 * MediaRegistry: project file id → where its bytes are, plus lazily opened
 * demuxers shared by the preview, export and timeline helpers.
 *
 * Inputs are reference counted (`acquire` → lease → `release`) and closed
 * after they sit unused for `idleMs`, so a long project does not keep a file
 * handle, HTTP cache and decoder state per clip alive.
 */

import { ALL_FORMATS, Input, type AudioCodec, type InputAudioTrack, type InputVideoTrack, type Rotation, type VideoCodec } from "mediabunny";
import type { ReaderInfo } from "@zenvi/engine";
import { mediaKind, probeMedia, type MediaKind, type ProbeOptions } from "./probe.js";
import { openSource, readBlob, sourceName, type MediaSourceSpec } from "./source.js";

/** How a plan or caller names media: a project file id, a path, or both (id wins). */
export interface MediaRef {
  fileId?: string;
  path?: string;
}

export interface VideoStreamInfo {
  track: InputVideoTrack;
  codec: VideoCodec | null;
  /** False when this browser cannot decode the codec (the file still probes). */
  canDecode: boolean;
  /** Stored picture size, before rotation. */
  codedWidth: number;
  codedHeight: number;
  /** Size after pixel aspect ratio and rotation. */
  displayWidth: number;
  displayHeight: number;
  rotation: Rotation;
  flip: boolean;
  /** Seconds per frame, or null when it could not be measured. */
  frameDuration: number | null;
  /** Container timestamp of the first picture. */
  firstTimestamp: number;
}

export interface AudioStreamInfo {
  track: InputAudioTrack;
  codec: AudioCodec | null;
  canDecode: boolean;
  sampleRate: number;
  channels: number;
  firstTimestamp: number;
}

export interface OpenMedia {
  readonly key: string;
  /** Bumped when the file's bytes change; caches keyed by it go stale. */
  readonly version: number;
  readonly input: Input;
  readonly video: VideoStreamInfo | null;
  readonly audio: AudioStreamInfo | null;
  /**
   * Container timestamp of source time 0. libopenshot measures source time from
   * the first video packet (audio included), or the first audio packet for
   * audio-only files (`FFmpegReader.cpp` `UpdatePTSOffset`, spec §5.2). Negative
   * timestamps (codec priming) are never presented.
   */
  readonly timeOffset: number;
  /** End of the media in seconds of source time. */
  readonly duration: number;
}

export interface MediaLease {
  readonly media: OpenMedia;
  release(): void;
}

export interface MediaRegistryOptions {
  /**
   * Media referenced by path only (transition masks `@transitions/…`, assets).
   * Return where the bytes are, or undefined when unknown.
   */
  resolvePath?: (path: string) => MediaSourceSpec | undefined;
  /** Close inputs that have been unused this long. Default 30 s. */
  idleMs?: number;
  /** Timer functions (tests). */
  timers?: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };
}

export class MediaUnavailableError extends Error {
  constructor(readonly ref: MediaRef) {
    super(`No media registered for ${ref.fileId ? `file ${ref.fileId}` : `path ${ref.path ?? "?"}`}`);
    this.name = "MediaUnavailableError";
  }
}

/** One opened input (one version of the bytes) and the leases on it. */
interface Handle {
  opening: Promise<OpenMedia>;
  media: OpenMedia | null;
  leases: number;
  /** Replaced by newer bytes or unregistered: dispose when the last lease ends. */
  retired: boolean;
  idleTimer: unknown;
}

interface Entry {
  key: string;
  spec: MediaSourceSpec;
  version: number;
  handle: Handle | null;
  blob: Promise<Blob> | null;
  info: Map<string, Promise<ReaderInfo>>;
}

const DEFAULT_IDLE_MS = 30_000;

export class MediaRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<(key: string) => void>();
  private readonly idleMs: number;
  private readonly timers: NonNullable<MediaRegistryOptions["timers"]>;
  private disposed = false;

  constructor(private readonly options: MediaRegistryOptions = {}) {
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  /** Register (or replace) the bytes of project file `fileId`. */
  register(fileId: string, spec: MediaSourceSpec): void {
    this.assertLive();
    const key = fileKey(fileId);
    const existing = this.entries.get(key);
    if (existing) {
      if (sameSpec(existing.spec, spec)) return;
      existing.spec = spec;
      this.bump(existing);
      return;
    }
    this.entries.set(key, newEntry(key, spec));
  }

  unregister(fileId: string): void {
    const key = fileKey(fileId);
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.retire(entry);
    this.emit(key);
  }

  /** The file's bytes changed in place (an edited title SVG): drop every cache of it. */
  invalidate(ref: MediaRef): void {
    const entry = this.entryFor(ref);
    if (entry) this.bump(entry);
  }

  /** Called with the cache key of media whose bytes changed or went away. */
  onInvalidate(listener: (key: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  has(ref: MediaRef): boolean {
    return this.entryFor(ref) !== undefined;
  }

  /** Stable cache key for `ref`, or undefined when nothing is registered for it. */
  keyOf(ref: MediaRef): string | undefined {
    return this.entryFor(ref)?.key;
  }

  /** Current version of `ref`'s bytes (0 when unknown). */
  versionOf(ref: MediaRef): number {
    return this.entryFor(ref)?.version ?? 0;
  }

  /** How the media is read (demuxed audio/video, raster still, SVG). */
  kindOf(ref: MediaRef): MediaKind | undefined {
    const entry = this.entryFor(ref);
    if (!entry) return undefined;
    const mime = entry.spec.kind === "blob" ? entry.spec.blob.type : "";
    return mediaKind(ref.path || sourceName(entry.spec), mime);
  }

  spec(ref: MediaRef): MediaSourceSpec | undefined {
    return this.entryFor(ref)?.spec;
  }

  /** Open (or share) the demuxer for `ref`. Release the lease when done. */
  async acquire(ref: MediaRef): Promise<MediaLease> {
    this.assertLive();
    const entry = this.entryFor(ref);
    if (!entry) throw new MediaUnavailableError(ref);
    const handle = entry.handle ?? (entry.handle = this.openHandle(entry));
    handle.leases += 1;
    this.cancelIdle(handle);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      handle.leases -= 1;
      if (handle.leases > 0) return;
      if (handle.retired) disposeHandle(handle);
      else this.scheduleIdle(entry, handle);
    };
    try {
      const media = await handle.opening;
      return { media, release };
    } catch (error) {
      release();
      throw error;
    }
  }

  /** The whole file as a Blob (stills, SVG). Cached until the file changes. */
  async blob(ref: MediaRef): Promise<Blob> {
    this.assertLive();
    const entry = this.entryFor(ref);
    if (!entry) throw new MediaUnavailableError(ref);
    if (!entry.blob) {
      const pending = readBlob(entry.spec);
      entry.blob = pending;
      pending.catch(() => {
        if (entry.blob === pending) entry.blob = null;
      });
    }
    return entry.blob;
  }

  /** The file as text (LUT `.cube` files). */
  async text(ref: MediaRef): Promise<string> {
    return (await this.blob(ref)).text();
  }

  /** `probeMedia` for registered media, cached per options until the file changes. */
  async probe(ref: MediaRef, options: ProbeOptions = {}): Promise<ReaderInfo> {
    this.assertLive();
    const entry = this.entryFor(ref);
    if (!entry) throw new MediaUnavailableError(ref);
    const cacheKey = JSON.stringify([options.path ?? ref.path ?? null, options.audioOnlySize ?? null]);
    let pending = entry.info.get(cacheKey);
    if (!pending) {
      pending = probeMedia(entry.spec, { ...options, path: options.path ?? ref.path ?? sourceName(entry.spec) });
      entry.info.set(cacheKey, pending);
      pending.catch(() => entry.info.delete(cacheKey));
    }
    return pending;
  }

  /** Close every input and forget all media. Outstanding leases become invalid. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      const handle = entry.handle;
      entry.handle = null;
      if (handle) {
        this.cancelIdle(handle);
        disposeHandle(handle);
      }
    }
    this.entries.clear();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------

  private entryFor(ref: MediaRef): Entry | undefined {
    if (ref.fileId) {
      const byId = this.entries.get(fileKey(ref.fileId));
      if (byId) return byId;
    }
    if (ref.path) {
      const key = pathKey(ref.path);
      const cached = this.entries.get(key);
      if (cached) return cached;
      const spec = this.options.resolvePath?.(ref.path);
      if (spec) {
        const entry = newEntry(key, spec);
        this.entries.set(key, entry);
        return entry;
      }
    }
    return undefined;
  }

  private openHandle(entry: Entry): Handle {
    const { key, version, spec } = entry;
    // The body reads `handle` only after its first await, when it is assigned.
    let handle!: Handle;
    const opening = (async () => {
      const input = new Input({ formats: ALL_FORMATS, source: await openSource(spec) });
      try {
        const media: OpenMedia = { key, version, input, ...(await describeInput(input)) };
        handle.media = media;
        if (handle.retired && handle.leases === 0) input.dispose();
        return media;
      } catch (error) {
        input.dispose();
        throw error;
      }
    })();
    handle = { opening, media: null, leases: 0, retired: false, idleTimer: null };
    opening.catch(() => {
      // A failed open (network, unsupported format) is retried by the next acquire.
      if (entry.handle === handle) entry.handle = null;
    });
    return handle;
  }

  private bump(entry: Entry): void {
    this.retire(entry);
    entry.version += 1;
    entry.blob = null;
    entry.info.clear();
    this.emit(entry.key);
  }

  /** Detach the entry's input; it is disposed now, or when its last lease ends. */
  private retire(entry: Entry): void {
    const handle = entry.handle;
    entry.handle = null;
    if (!handle) return;
    handle.retired = true;
    this.cancelIdle(handle);
    if (handle.leases === 0) disposeHandle(handle);
  }

  private scheduleIdle(entry: Entry, handle: Handle): void {
    this.cancelIdle(handle);
    handle.idleTimer = this.timers.setTimeout(() => {
      handle.idleTimer = null;
      if (handle.leases > 0 || entry.handle !== handle) return;
      entry.handle = null;
      disposeHandle(handle);
    }, this.idleMs);
  }

  private cancelIdle(handle: Handle): void {
    if (handle.idleTimer !== null && handle.idleTimer !== undefined) {
      this.timers.clearTimeout(handle.idleTimer);
      handle.idleTimer = null;
    }
  }

  private emit(key: string): void {
    for (const listener of [...this.listeners]) listener(key);
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("MediaRegistry is disposed");
  }
}

function disposeHandle(handle: Handle): void {
  handle.retired = true;
  if (handle.media) handle.media.input.dispose();
  else handle.opening.then((media) => media.input.dispose(), () => undefined);
}

function fileKey(fileId: string): string {
  return `file:${fileId}`;
}

function pathKey(path: string): string {
  return `path:${path}`;
}

function newEntry(key: string, spec: MediaSourceSpec): Entry {
  return { key, spec, version: 1, handle: null, blob: null, info: new Map() };
}

function sameSpec(a: MediaSourceSpec, b: MediaSourceSpec): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "blob" && b.kind === "blob") return a.blob === b.blob;
  if (a.kind === "opfs" && b.kind === "opfs") return a.handle === b.handle;
  if (a.kind === "url" && b.kind === "url") return a.url === b.url && a.refresh === b.refresh;
  return false;
}

/** Stream facts playback needs, from the first video and audio stream (libopenshot order). */
async function describeInput(input: Input): Promise<Omit<OpenMedia, "key" | "version" | "input">> {
  const tracks = await input.getTracks();
  const videoTrack = tracks.find((t): t is InputVideoTrack => t.isVideoTrack()) ?? null;
  const audioTrack = tracks.find((t): t is InputAudioTrack => t.isAudioTrack()) ?? null;

  const video = videoTrack ? await describeVideo(videoTrack) : null;
  const audio = audioTrack ? await describeAudio(audioTrack) : null;
  const timeOffset = Math.max(0, video ? video.firstTimestamp : (audio?.firstTimestamp ?? 0));
  const end = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
  return { video, audio, timeOffset, duration: Math.max(0, end - timeOffset) };
}

async function canDecode(track: InputVideoTrack | InputAudioTrack): Promise<boolean> {
  try {
    return await track.canDecode();
  } catch {
    // No WebCodecs in this environment (Node, old browsers).
    return false;
  }
}

async function describeVideo(track: InputVideoTrack): Promise<VideoStreamInfo> {
  const [codec, decodable, codedWidth, codedHeight, displayWidth, displayHeight, rotation, flip, firstTimestamp] = await Promise.all([
    track.getCodec(),
    canDecode(track),
    track.getCodedWidth(),
    track.getCodedHeight(),
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    track.getRotation(),
    track.getFlip(),
    track.getFirstTimestamp(),
  ]);
  let frameDuration: number | null = null;
  try {
    // A short prefix is enough for the half-frame lookup tolerance.
    const rates = await track.computeFrameRateMetrics({ targetPacketCount: 64 });
    const fps = rates.underlyingFrameRate ?? rates.bestGuessFrameRate;
    frameDuration = fps > 0 && Number.isFinite(fps) ? 1 / fps : null;
  } catch {
    frameDuration = null;
  }
  return { track, codec, canDecode: decodable, codedWidth, codedHeight, displayWidth, displayHeight, rotation, flip, frameDuration, firstTimestamp };
}

async function describeAudio(track: InputAudioTrack): Promise<AudioStreamInfo> {
  const [codec, decodable, sampleRate, channels, firstTimestamp] = await Promise.all([
    track.getCodec(),
    canDecode(track),
    track.getSampleRate(),
    track.getNumberOfChannels(),
    track.getFirstTimestamp(),
  ]);
  return { track, codec, canDecode: decodable, sampleRate, channels, firstTimestamp };
}
