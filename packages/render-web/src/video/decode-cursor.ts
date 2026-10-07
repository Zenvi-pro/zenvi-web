/**
 * A decode cursor: one open Mediabunny `samples()` iterator that serves
 * frame-accurate requests without re-seeking when it can.
 *
 * - Playback (`sequential`) walks forward through the iterator, which keeps
 *   decoding a few pictures ahead; pictures the clock has already passed are
 *   closed without being converted (dropped, not drawn late).
 * - Random access (`seek`) reuses the cursor when the target lies before the
 *   next keyframe (decoding forward is cheaper than restarting at a keyframe)
 *   and otherwise restarts the iterator at the keyframe before the target.
 *
 * Every decoded picture is closed exactly once: skipped, replaced, or on close.
 */

import { cursorAction, spanEnd, type FrameSpan } from "./frame-lookup.js";

export interface SampleLike {
  readonly timestamp: number;
  readonly duration: number;
  close(): void;
}

/** The part of Mediabunny's `VideoSampleSink` a cursor uses. */
export interface SampleSink<S extends SampleLike> {
  samples(startTimestamp?: number): AsyncGenerator<S, void, unknown>;
}

/** Keyframe positions (Mediabunny `EncodedPacketSink`, metadata only). */
export interface KeyframeIndex {
  /** Timestamp of the first keyframe after the one at or before `timestamp`, or null when none. */
  nextKeyframeAfter(timestamp: number): Promise<number | null>;
  /** Timestamp of the keyframe at or before `timestamp` (the first one when before it), or null when none. */
  keyframeAtOrBefore?(timestamp: number): Promise<number | null>;
}

/**
 * - `sequential`: playback and export; walk forward.
 * - `seek`: frame-accurate random access.
 * - `preview`: scrubbing; a nearby keyframe may stand in until the exact picture is decoded
 *   (handled by `FrameProvider`; a cursor treats it like `seek`).
 */
export type DecodeMode = "seek" | "sequential" | "preview";

/**
 * How far ahead playback keeps walking the iterator instead of re-seeking.
 * Beyond this the clock has outrun the decoder; jumping ahead is cheaper.
 */
export const SEQUENTIAL_WINDOW = 2;

export class DecodeCursor<S extends SampleLike> {
  private iterator: AsyncGenerator<S, void, unknown> | null = null;
  private current: S | null = null;
  /** Whether `current` has been handed to a caller (else replacing it drops it). */
  private currentDelivered = false;
  private currentSpan: FrameSpan | null = null;
  private peeked: S | null = null;
  private ended = false;
  private keyframeFor: { timestamp: number; next: number | null } | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  /** Pictures decoded but never used (dropped while catching up). */
  skipped = 0;
  lastUsed = 0;

  constructor(
    private readonly sink: SampleSink<S>,
    private readonly keyframes: KeyframeIndex,
    private readonly frameDuration: number | null,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /**
   * Run `use` with the picture showing at `timestamp` (last picture whose
   * timestamp is <= it), or with null when the stream has no pictures. The
   * picture belongs to the cursor: `use` must finish with it before resolving.
   */
  at<R>(timestamp: number, mode: DecodeMode, use: (sample: S | null, span: FrameSpan | null) => Promise<R> | R): Promise<R> {
    const run = this.tail.then(async () => {
      if (this.closed) throw new Error("DecodeCursor is closed");
      this.lastUsed = this.now();
      const sample = await this.moveTo(timestamp, mode);
      if (sample) this.currentDelivered = true;
      return use(sample, sample ? this.currentSpan : null);
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Stop decoding and close every picture the cursor holds. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.tail;
    await this.reset();
  }

  private async moveTo(timestamp: number, mode: DecodeMode): Promise<S | null> {
    const boundary = await this.boundary(mode);
    const action = cursorAction(this.currentSpan, boundary, timestamp);
    if (action === "reuse") return this.current;
    if (action === "reseek") {
      await this.reset();
      this.iterator = this.sink.samples(timestamp);
      const first = await this.pull();
      if (!first) return null;
      this.replaceCurrent(first);
    }
    // Walk forward: every picture up to the target replaces the previous one.
    for (;;) {
      const next = this.peeked ?? (await this.pull());
      this.peeked = null;
      if (!next) break;
      if (next.timestamp <= timestamp) {
        this.replaceCurrent(next);
        continue;
      }
      this.peeked = next;
      break;
    }
    if (!this.current) return null;
    const end =
      this.ended && !this.peeked
        ? Infinity // the last picture freezes (FrameMapper clamps past the end, spec §2.5)
        : spanEnd(this.current.timestamp, this.current.duration, this.peeked?.timestamp ?? null, this.frameDuration);
    this.currentSpan = { start: this.current.timestamp, end };
    return this.current;
  }

  private replaceCurrent(next: S): void {
    if (this.current) {
      if (!this.currentDelivered) this.skipped += 1;
      this.current.close();
    }
    this.current = next;
    this.currentDelivered = false;
  }

  /** The timestamp beyond which re-seeking beats walking forward. */
  private async boundary(mode: DecodeMode): Promise<number | null> {
    if (!this.currentSpan) return null;
    const at = this.currentSpan.start;
    if (mode === "sequential") return at + SEQUENTIAL_WINDOW;
    if (this.keyframeFor?.timestamp !== at) {
      this.keyframeFor = { timestamp: at, next: await this.keyframes.nextKeyframeAfter(at) };
    }
    return this.keyframeFor.next;
  }

  private async pull(): Promise<S | null> {
    if (!this.iterator || this.ended) return null;
    const result = await this.iterator.next();
    if (result.done) {
      this.ended = true;
      return null;
    }
    return result.value;
  }

  private async reset(): Promise<void> {
    if (this.current && !this.currentDelivered) this.skipped += 1;
    this.current?.close();
    this.peeked?.close();
    this.current = null;
    this.peeked = null;
    this.currentSpan = null;
    this.keyframeFor = null;
    this.ended = false;
    const iterator = this.iterator;
    this.iterator = null;
    // return() closes whatever the iterator had decoded ahead.
    await iterator?.return();
  }
}
