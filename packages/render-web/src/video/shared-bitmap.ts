/**
 * Reference-counted bitmaps.
 *
 * Decoded pictures live on the GPU and must be closed deterministically. A
 * cache holds one reference; every renderer that borrows the picture holds
 * another until it has drawn. The bitmap is closed when the last reference
 * goes, so evicting a cache entry can never close a picture a frame in flight
 * is about to draw.
 */

/** Anything with pixels that can be closed (an `ImageBitmap`, or a test double). */
export interface ClosableImage {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** A borrowed picture. Call `release` once when done drawing it. */
export interface FrameImage<T extends ClosableImage = ImageBitmap> {
  readonly image: T;
  readonly width: number;
  readonly height: number;
  /**
   * False when a nearby keyframe stands in for the requested picture
   * (scrubbing with `preview` decoding). Absent or true: the exact picture.
   */
  readonly exact?: boolean;
  release(): void;
}

export class SharedBitmap<T extends ClosableImage = ImageBitmap> {
  private refs = 1;

  constructor(readonly image: T) {}

  get closed(): boolean {
    return this.refs <= 0;
  }

  /** Bytes of GPU memory (RGBA). */
  get bytes(): number {
    return this.image.width * this.image.height * 4;
  }

  /** Borrow a reference. */
  retain(): FrameImage<T> {
    if (this.refs <= 0) throw new Error("SharedBitmap is already closed");
    this.refs += 1;
    let released = false;
    return {
      image: this.image,
      width: this.image.width,
      height: this.image.height,
      release: () => {
        if (released) return;
        released = true;
        this.drop();
      },
    };
  }

  /** Drop the owner's reference (or one borrowed via `retain`). */
  drop(): void {
    if (this.refs <= 0) return;
    this.refs -= 1;
    if (this.refs === 0) this.image.close();
  }
}
