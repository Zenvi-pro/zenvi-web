/**
 * Zenvi scenes: a film (or one shot of it) written as code. A scene is a
 * module an agent writes; it exports its frame grid and a pure draw
 * function, and nothing else runs:
 *
 *   export const fps = 60;            // the grid: cues and duration are frames of it
 *   export const duration = 240;      // frames
 *   export const cues = { land: 30, click: { at: 96, kind: "click", weight: 0.4, x: 0.62, y: 0.55 } };
 *   export const params = { headline: "Ship it" };   // defaults; the tools' params override them
 *   export function draw(ctx, t, api) { ... }        // t: frame (fractional between frames)
 *
 * One timeline drives picture, cues and sound (cinetic's src/timeline.ts,
 * MIT): the cues are the beats the picture lands on, and the same cues
 * become the scene's picture events, so the sound design puts each hit on
 * a visible event. DOM-free: the page and the Node side share it.
 */

import type { PictureEventKind, SceneModuleInfo } from "@zenvi/engine";

/** A cue as a scene writes it: a frame, or a frame with what happens there. */
export type SceneCueSpec =
  | number
  | {
      at: number;
      /** What the ear should hear (a picture event kind); a cue without one is a beat the picture uses but makes no sound. */
      kind?: PictureEventKind;
      /** 0..1: how big it is on screen. */
      weight?: number;
      /** Where, 0..1 of the frame. */
      x?: number;
      y?: number;
      /** Runs (`type`, `tick`): the frame the run ends. */
      until?: number;
      /** Runs: strikes per second. */
      rate?: number;
      /** A hit the kit's hit FX lands on (strength: 1 a cut, 1.3 the climax). */
      hit?: number;
      /** Shake of that hit, design px. */
      shake?: number;
      /** Scales that hit's flash (0: punch without a flash). */
      flash?: number;
      /** A picture cut: motion blur never smears across it. */
      cut?: boolean;
    };

/** A cue as the tools see it (named, every field filled) and what a module declares: the engine's host contract. */
export type { SceneCueInfo as SceneCue, SceneModuleInfo as SceneInfo } from "@zenvi/engine";

/** What the renderer hands a scene page (a JSON block on the page, read by the runtime). */
export interface ScenePageConfig {
  /** Canvas size, px (the render's size; the scene draws in design px, shorter side 1080). */
  width: number;
  height: number;
  /** Design size the scene draws in. */
  designWidth: number;
  designHeight: number;
  /** The tools' params (merged over the module's defaults on the page). */
  params: Record<string, unknown>;
  /** Media by name: a photo URL, or frames of a video. */
  media: Record<string, SceneMediaRef>;
  /** Output frames per second (the project's): output frame n draws scene frame n × fps / renderFps. */
  renderFps: number;
  alpha: boolean;
  /** Seed of `api.rng` (fixed: the scene is a pure function of time). */
  seed: number;
}

export type SceneMediaRef =
  | { kind: "image"; url: string; width: number; height: number }
  | { kind: "video"; pattern: string; frames: number; fps: number; width: number; height: number };

/** One text fragment drawn on a frame, in design px of the frame (camera and layers applied): what the layout audit reads. */
export interface TextBox {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Font size as drawn, design px. */
  px: number;
  /** Effective opacity. */
  opacity: number;
  /** A product string (a typed command, a URL, an app label): not counted against the reading budget. */
  ui: boolean;
}

/** What the page measures of one drawn frame (the probe pass draws every frame, no capture). */
export interface FrameProbe {
  /** Output frame. */
  frame: number;
  /** FNV-1a of the canvas pixels: the determinism check compares two draws. */
  hash: string;
  /** Base64 greyscale thumbnail (Rec. 709 luma, `PROBE_W` × `PROBE_H`): the flash measurement. */
  luma: string;
  /** Mean alpha 0..1 (a transparent scene that draws nothing is blank). */
  coverage: number;
  boxes: TextBox[];
  /** Milliseconds `draw` took. */
  ms: number;
  /** Set when draw threw. */
  error?: string;
}

/** The thumbnail the flash check measures: 3 x 3 regions of 16 x 9 pixels. */
export const PROBE_W = 48;
export const PROBE_H = 27;

/** What a scene module exported, as the page read it (checked on the Node side: node/scene-info.ts). */
export interface RawSceneExports {
  fps?: unknown;
  duration?: unknown;
  cues?: unknown;
  params?: unknown;
  alpha?: unknown;
  title?: unknown;
  /** Whether `draw` is a function. */
  draw: boolean;
}

/** Seek protocol of a scene page (`window.__zenviScene`). */
export interface ScenePageApi {
  /** The module has run: its exports, or why it failed. */
  loaded: Promise<RawSceneExports>;
  error?: string;
  /** Start drawing with the checked info (fonts and photos loaded when it resolves). */
  start(info: SceneModuleInfo): Promise<void>;
  /** Draw output frame n (fractional for motion-blur sub-frames); resolves once painted (media decoded). */
  seek(frame: number): Promise<void>;
  /** Draw each output frame and measure it; stops at the first frame that throws or takes longer than `maxMs`. */
  probe(frames: readonly number[], maxMs: number): Promise<FrameProbe[]>;
  /** Draw the frames into one labelled contact sheet; a JPEG data URL. */
  sheet(cells: readonly { frame: number; label: string }[], columns: number, cellWidth: number): Promise<string>;
}

/** Limits every scene runs under. */
export const SCENE_LIMITS = {
  /** Source, bytes. */
  codeBytes: 120_000,
  /** Longest scene, seconds. */
  seconds: 60,
  maxFps: 120,
  cues: 400,
  /** One frame's draw, ms, before the scene is stopped. */
  frameMs: 2_000,
  /** JavaScript heap of the scene's page, MB. */
  heapMb: 512,
  /** A draw slower than this is reported (the final render would crawl). */
  slowFrameMs: 120,
  /** Memory of the job's browser (every process), MB: the heap flag does not cover typed arrays and pixels. */
  processMb: 2_000,
  /** Wall-clock budget of a check, and of a render (check included), seconds. */
  checkSeconds: 600,
  renderSeconds: 3_600,
} as const;
