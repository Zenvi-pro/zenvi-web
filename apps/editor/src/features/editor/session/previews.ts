/**
 * Timeline filmstrips and waveforms, generated once per file and cached for
 * the session. Thumbnails become one sprite image per file so a clip's
 * filmstrip is a handful of CSS background tiles, not canvases.
 */
import { generateThumbnails, generateWaveform } from "../render";

export interface Sprite {
  url: string;
  /** Source time of each tile, ascending. */
  times: number[];
  tileWidth: number;
  tileHeight: number;
}

export const THUMB_HEIGHT = 54;
/** Peaks per second of source audio. */
export const WAVE_RESOLUTION = 60;

type Listener = () => void;

export class PreviewCache {
  private readonly sprites = new Map<string, Promise<Sprite | null>>();
  private readonly spriteValues = new Map<string, Sprite | null>();
  private readonly waves = new Map<string, Promise<Float32Array | null>>();
  private readonly waveValues = new Map<string, Float32Array | null>();
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sprite(fileId: string): Sprite | null | undefined {
    return this.spriteValues.get(fileId);
  }

  waveform(fileId: string): Float32Array | null | undefined {
    return this.waveValues.get(fileId);
  }

  requestSprite(fileId: string, duration: number, still: boolean): void {
    if (this.sprites.has(fileId)) return;
    const count = still ? 1 : Math.max(1, Math.min(120, Math.ceil(duration / 1.5)));
    const times = Array.from({ length: count }, (_, i) => (still ? 0 : ((i + 0.5) * duration) / count));
    const job = generateThumbnails(fileId, times, THUMB_HEIGHT)
      .then(async (thumbs) => {
        if (!thumbs || thumbs.length === 0) return null;
        const tileHeight = THUMB_HEIGHT;
        const first = thumbs[0]!.bitmap;
        const tileWidth = Math.max(8, Math.round((first.width / first.height) * tileHeight));
        const canvas = document.createElement("canvas");
        canvas.width = tileWidth * thumbs.length;
        canvas.height = tileHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        thumbs.forEach((t, i) => ctx.drawImage(t.bitmap, i * tileWidth, 0, tileWidth, tileHeight));
        for (const t of thumbs) t.bitmap.close();
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
        if (!blob) return null;
        return { url: URL.createObjectURL(blob), times: thumbs.map((t) => t.time), tileWidth, tileHeight };
      })
      .catch(() => null)
      .then((sprite) => {
        this.spriteValues.set(fileId, sprite);
        this.emit();
        return sprite;
      });
    this.sprites.set(fileId, job);
  }

  requestWaveform(fileId: string, duration: number): void {
    if (this.waves.has(fileId)) return;
    const buckets = Math.max(64, Math.min(200_000, Math.round(duration * WAVE_RESOLUTION)));
    const job = generateWaveform(fileId, buckets)
      .catch(() => null)
      .then((peaks) => {
        this.waveValues.set(fileId, peaks);
        this.emit();
        return peaks;
      });
    this.waves.set(fileId, job);
  }

  /** Drop cached previews of a file (its bytes changed). */
  invalidate(fileId: string): void {
    const sprite = this.spriteValues.get(fileId);
    if (sprite) URL.revokeObjectURL(sprite.url);
    this.sprites.delete(fileId);
    this.spriteValues.delete(fileId);
    this.waves.delete(fileId);
    this.waveValues.delete(fileId);
    this.emit();
  }

  dispose(): void {
    for (const sprite of this.spriteValues.values()) if (sprite) URL.revokeObjectURL(sprite.url);
    this.sprites.clear();
    this.spriteValues.clear();
    this.waves.clear();
    this.waveValues.clear();
    this.listeners.clear();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** Index of the tile whose time is nearest `t` (times ascending). */
export function nearestIndex(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1]! - t) <= Math.abs(times[lo]! - t)) return lo - 1;
  return lo;
}
