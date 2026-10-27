/** What the renderer hands a block page (`window.__ZENVI_BLOCK__`): shared by the page and the Node side. */

import type { PictureEvent } from "@zenvi/engine";
import type { Params } from "./params.js";

/** A video param as the page sees it: frames extracted at the render's frame rate. */
export interface VideoFrames {
  kind: "video";
  /** URL of frame n (0-based) is `pattern` with `{n}` replaced by the zero-padded number n + 1. */
  pattern: string;
  frames: number;
  fps: number;
  width: number;
  height: number;
}

export interface ImageRef {
  kind: "image";
  url: string;
  width: number;
  height: number;
}

export type MediaRef = ImageRef | VideoFrames;

export interface BlockConfig {
  block: string;
  params: Params;
  /** Design size, px: the shorter side is 1080 (TASTE.md's type scale); the renderer scales the capture. */
  width: number;
  height: number;
  fps: number;
  seconds: number;
  alpha: boolean;
  /** Media params by name. */
  media: Record<string, MediaRef>;
  draft: boolean;
}

/** The seek protocol a block page exposes as `window.__zenvi`. */
export interface ZenviPageApi {
  ready: Promise<void>;
  duration: number;
  /** Put the page in its state at t seconds; resolves when the frame is ready to capture. */
  seek(t: number): Promise<void>;
  /** The block's picture events (set once ready): where the sound design puts a click, a tick, a land. */
  events?: PictureEvent[];
  error?: string;
}
