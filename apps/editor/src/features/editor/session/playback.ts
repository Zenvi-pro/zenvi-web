/**
 * Playback state and the preview engine seam.
 *
 * The playhead lives in its own small store because it changes up to 60 times
 * a second: only the few components that show it subscribe (timecode, the
 * timeline playhead via direct DOM updates, Properties at a throttled rate).
 */
import type { Project } from "@zenvi/engine";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface PlaybackState {
  /** Playhead, timeline seconds. */
  time: number;
  playing: boolean;
  /** Playback rate; negative while shuttling backwards (J). */
  rate: number;
  loop: boolean;
}

export type PlaybackStore = StoreApi<PlaybackState>;

export function createPlaybackStore(time = 0): PlaybackStore {
  return createStore<PlaybackState>(() => ({ time, playing: false, rate: 1, loop: false }));
}

/**
 * What the editor needs from a preview renderer (render-web `PreviewPlayer`
 * implements it through an adapter). Engines draw into the canvas they were
 * created with and report time as they play.
 */
export interface PreviewEngine {
  setProject(project: Project): void;
  seek(seconds: number): void;
  play(): void;
  pause(): void;
  setRate(rate: number): void;
  setLoop(loop: boolean): void;
  /** Canvas size changed (CSS pixels × devicePixelRatio). */
  resize(width: number, height: number): void;
  onTime(listener: (seconds: number) => void): () => void;
  onState(listener: (state: { playing: boolean }) => void): () => void;
  /** A small JPEG data URL of the current frame, for project thumbnails. */
  captureThumbnail?(maxWidth: number): string | null;
  /** True when frames are actually rendered (false for the clock fallback). */
  readonly renders: boolean;
  dispose(): void;
}
