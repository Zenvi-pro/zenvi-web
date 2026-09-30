/**
 * A test double for the engine: hand-built plans for simple projects, so the
 * browser suite exercises render-web on its own. Not a planner: it knows only
 * the few fields below and maps time 1:1 (same-fps sources, no keyframes).
 */

import type { Project } from "@zenvi/engine";
import type { AudioKernel, AudioPlan, EffectInstance, FramePlan, GainPoint, LayerPlan, MaskInstance, RGBA, RgbaImage, VideoKernel } from "@zenvi/engine/render";
import type { RenderEngine } from "../../src/engine.js";

export interface TestClip {
  id: string;
  kind: "video" | "image" | "svg" | "color" | "audio";
  fileId?: string;
  path?: string;
  position: number;
  start: number;
  end: number;
  layer: number;
  color?: RGBA;
  /** Natural size of the source. */
  width?: number;
  height?: number;
  /** Draw rect in canvas fractions [x, y, w, h]. Default: the whole frame. */
  rect?: [number, number, number, number];
  opacity?: number;
  composite?: number;
  effects?: EffectInstance[];
  masks?: MaskInstance[];
  /** Audio segment of this clip. */
  audio?: { gain?: GainPoint[]; rate?: number; effects?: EffectInstance[] };
}

export function makeProject(clips: TestClip[], options: { fps?: number; width?: number; height?: number; sampleRate?: number } = {}): Project {
  const fps = options.fps ?? 30;
  return {
    id: "TEST",
    fps: { num: fps, den: 1 },
    display_ratio: { num: 16, den: 9 },
    pixel_ratio: { num: 1, den: 1 },
    width: options.width ?? 160,
    height: options.height ?? 90,
    sample_rate: options.sampleRate ?? 48000,
    channels: 2,
    channel_layout: 3,
    settings: {},
    clips: [],
    effects: [],
    files: [],
    duration: 300,
    scale: 15,
    tick_pixels: 100,
    playhead_position: 0,
    profile: "test",
    export_settings: null,
    export_overrides: {},
    layers: [],
    markers: [],
    progress: [],
    history: { undo: [], redo: [] },
    version: {},
    testClips: clips,
  };
}

function clipsOf(project: Project): TestClip[] {
  return (project.testClips as TestClip[] | undefined) ?? [];
}

function fpsOf(project: Project): number {
  return project.fps.num / project.fps.den;
}

const invert: VideoKernel = (image) => {
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]!;
    d[i + 1] = 255 - d[i + 1]!;
    d[i + 2] = 255 - d[i + 2]!;
  }
};

/** Returns a half-size copy (a size-changing kernel, like Crop resize). */
const halve: VideoKernel = (image) => {
  const width = Math.max(1, Math.floor(image.width / 2));
  const height = Math.max(1, Math.floor(image.height / 2));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const s = (y * 2 * image.width + x * 2) * 4;
      data.set(image.data.subarray(s, s + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
};

const gainKernel: AudioKernel = (channels, _rate, params) => {
  const factor = typeof params.factor === "number" ? params.factor : 1;
  for (const channel of channels) for (let i = 0; i < channel.length; i += 1) channel[i]! *= factor;
};

export const testEngine: RenderEngine = {
  planFrame(project, frame, size): FramePlan {
    const fps = fpsOf(project);
    const t = (frame - 1) / fps;
    const visible = clipsOf(project)
      .filter((c) => c.kind !== "audio" && t >= c.position - 1e-9 && t < c.position + (c.end - c.start) - 1e-9)
      .sort((a, b) => a.layer - b.layer);
    const layers: LayerPlan[] = visible.map((c) => {
      const sourceTime = t - c.position + c.start;
      const [rx, ry, rw, rh] = c.rect ?? [0, 0, 1, 1];
      const source: LayerPlan["source"] =
        c.kind === "video"
          ? { kind: "video", fileId: c.fileId!, path: c.path ?? c.fileId!, time: sourceTime, frame: Math.round(sourceTime * fps) + 1 }
          : c.kind === "color"
            ? { kind: "color", color: c.color ?? [255, 255, 255, 255] }
            : { kind: c.kind as "image" | "svg", fileId: c.fileId!, path: c.path ?? c.fileId! };
      return {
        clipId: c.id,
        layer: c.layer,
        source,
        sourceWidth: c.width ?? size.width,
        sourceHeight: c.height ?? size.height,
        drawWidth: Math.round(rw * size.width),
        drawHeight: Math.round(rh * size.height),
        transform: [1, 0, 0, 1, rx * size.width, ry * size.height],
        opacity: c.opacity ?? 1,
        ...(c.composite !== undefined ? { composite: c.composite } : {}),
        effects: c.effects ?? [],
        masks: c.masks ?? [],
      };
    });
    return { frame, time: t, width: size.width, height: size.height, background: [0, 0, 0, 255], layers };
  },
  planAudio(project, range): AudioPlan {
    const segments = clipsOf(project)
      .filter((c) => c.audio && c.position < range.end && c.position + (c.end - c.start) > range.start)
      .map((c) => ({
        clipId: c.id,
        fileId: c.fileId!,
        path: c.path ?? c.fileId!,
        timelineStart: c.position,
        sourceStart: c.start,
        duration: c.end - c.start,
        rate: c.audio?.rate ?? 1,
        gain: c.audio?.gain ?? [],
        effects: c.audio?.effects ?? [],
      }));
    return { sampleRate: project.sample_rate, channels: project.channels, start: range.start, end: range.end, segments };
  },
  getVideoKernel: (type) => (type === "TestInvert" ? invert : type === "TestHalve" ? halve : undefined),
  getAudioKernel: (type) => (type === "TestGain" ? gainKernel : undefined),
  applyMask(image: RgbaImage, mask: RgbaImage) {
    // Test math only: the mask's red channel scales alpha.
    for (let i = 0; i < image.data.length; i += 4) image.data[i + 3] = Math.round((image.data[i + 3]! * mask.data[i]!) / 255);
  },
  frameAt: (project, seconds) => Math.floor(seconds * fpsOf(project) + 1e-9) + 1,
  frameTime: (project, frame) => (frame - 1) / fpsOf(project),
  lastFrame: (project) => {
    const end = Math.max(0, ...clipsOf(project).map((c) => c.position + (c.end - c.start)));
    return Math.ceil(end * fpsOf(project) - 1e-4);
  },
};
