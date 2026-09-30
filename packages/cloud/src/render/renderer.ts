/**
 * What the render worker, frame previews and URL imports need from a Node
 * media runtime. The implementation is `@zenvi/render-node` (W3, see
 * render/node.ts): `probe(path)`, `renderProject(project, { resolveMedia,
 * output, options, onProgress, signal })` and `renderFrame(…)`. Until a piece
 * is available the service uses the `unavailable*` stand-ins, which fail with
 * a clear message while queues and job records keep working.
 */

import type { ExportOptions, Project, ReaderInfo } from "@zenvi/engine";

/**
 * Maps a path as stored in the project (a clip's `reader.path`, a file's
 * `path`, an `@transitions/…` asset) to a local file. Same contract as
 * render-node's `MediaResolver`.
 */
export type PathResolver = (projectPath: string) => Promise<string>;

export interface RenderInput {
  project: Project;
  resolveMedia: PathResolver;
  /** Where to write the finished file. */
  output: string;
  options: ExportOptions;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

export interface FrameInput {
  project: Project;
  seconds: number;
  width?: number;
  format: "png" | "jpeg";
  resolveMedia: PathResolver;
  signal: AbortSignal;
}

export interface Renderer {
  /** Whole-project renders work. */
  readonly available: boolean;
  /** Single-frame previews work. */
  readonly framesAvailable: boolean;
  render(input: RenderInput): Promise<void>;
  /** Encoded image bytes of one timeline frame. */
  frame(input: FrameInput): Promise<Uint8Array>;
}

/** ffprobe-backed media inspection (`@zenvi/render-node` `probe`). */
export interface MediaProber {
  readonly available: boolean;
  /** libopenshot-style reader info for a local file. */
  probe(filePath: string): Promise<ReaderInfo>;
}

export class RendererUnavailableError extends Error {
  constructor(what = "renderer") {
    super(`${what} not available: this Zenvi Cloud build has no video ${what} yet`);
    this.name = "RendererUnavailableError";
  }
}

export const unavailableRenderer: Renderer = {
  available: false,
  framesAvailable: false,
  async render() {
    throw new RendererUnavailableError();
  },
  async frame() {
    throw new RendererUnavailableError();
  },
};

export const unavailableProber: MediaProber = {
  available: false,
  async probe() {
    throw new Error("media probing not available: this Zenvi Cloud build has no ffprobe integration yet");
  },
};
