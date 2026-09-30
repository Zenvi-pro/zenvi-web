/**
 * The decoded-picture cache shared by every clip of one player or export.
 *
 * Entries are pictures at one raster size, keyed by media, size and the
 * picture's presentation interval, so any request whose lookup timestamp falls
 * inside the interval hits (scrubbing back and forth, paused re-renders after
 * a property edit). One global byte budget instead of one per file keeps
 * memory bounded however many files the project uses.
 */

import { LruCache } from "../util/lru.js";
import { spanCovers, type FrameSpan } from "./frame-lookup.js";
import { SharedBitmap, type ClosableImage, type FrameImage } from "./shared-bitmap.js";

export interface FrameKey {
  /** Registry cache key of the media. */
  media: string;
  /** Media version (bumped when its bytes change). */
  version: number;
  width: number;
  height: number;
  /** Whether container rotation was applied. */
  rotated: boolean;
}

interface CachedFrame<T extends ClosableImage> {
  key: FrameKey;
  span: FrameSpan;
  bitmap: SharedBitmap<T>;
}

function group(key: FrameKey): string {
  return `${key.media}@${key.version}|${key.width}x${key.height}|${key.rotated ? "r" : "n"}`;
}

export class FrameCache<T extends ClosableImage = ImageBitmap> {
  private readonly lru: LruCache<string, CachedFrame<T>>;

  constructor(maxBytes = 192 * 1024 * 1024) {
    this.lru = new LruCache({
      maxCost: maxBytes,
      cost: (entry) => entry.bitmap.bytes,
      onEvict: (entry) => entry.bitmap.drop(),
    });
  }

  get bytes(): number {
    return this.lru.totalCost;
  }

  get size(): number {
    return this.lru.size;
  }

  /** A borrowed picture whose interval covers `timestamp`, if cached. */
  lookup(key: FrameKey, timestamp: number): FrameImage<T> | null {
    const g = group(key);
    const hit = this.lru.find((entry, k) => k.startsWith(g + "#") && spanCovers(entry.span, timestamp));
    return hit ? hit.value.bitmap.retain() : null;
  }

  /** Cache `image` for `span`; returns a borrowed reference for the caller. */
  insert(key: FrameKey, span: FrameSpan, image: T): FrameImage<T> {
    const bitmap = new SharedBitmap(image);
    const borrowed = bitmap.retain();
    this.lru.set(`${group(key)}#${span.start}`, { key, span, bitmap });
    return borrowed;
  }

  /** Drop every picture of `media` (its bytes changed or it went away). */
  evictMedia(media: string): void {
    this.lru.deleteWhere((_k, entry) => entry.key.media === media);
  }

  clear(): void {
    this.lru.clear();
  }
}
