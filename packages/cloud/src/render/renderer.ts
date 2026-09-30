/**
 * What the render worker and the frame preview need from a Node renderer.
 * The implementation is `@zenvi/render-node` (W3): `renderProject(project,
 * { resolveMedia, output, options, onProgress, signal })` and
 * `renderFrame(project, seconds, { width, format })`. main.ts wires it in;
 * until it is available the service uses `unavailableRenderer`, which fails
 * every job with a clear message while the queue and job records keep working.
 */

import type { ExportOptions, Project, ProjectFile, ReaderInfo } from "@zenvi/engine";

/** ffprobe-backed media inspection (`@zenvi/render-node` `probe`). */
export interface MediaProber {
  readonly available: boolean;
  /** libopenshot-style reader info for a local file. */
  probe(filePath: string): Promise<ReaderInfo>;
}

export const unavailableProber: MediaProber = {
  available: false,
  async probe() {
    throw new Error("media probing not available: this Zenvi Cloud build has no ffprobe integration yet");
  },
};

export interface RenderInput {
  project: Project;
  /** Local path of a project file's bytes (downloaded from blob storage on demand). */
  resolveMedia: (file: ProjectFile) => Promise<string>;
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
  resolveMedia: (file: ProjectFile) => Promise<string>;
  signal: AbortSignal;
}

export interface Renderer {
  readonly available: boolean;
  render(input: RenderInput): Promise<void>;
  /** Encoded image bytes of one timeline frame. */
  frame(input: FrameInput): Promise<Uint8Array>;
}

export class RendererUnavailableError extends Error {
  constructor() {
    super("renderer not available: this Zenvi Cloud build has no video renderer yet");
    this.name = "RendererUnavailableError";
  }
}

export const unavailableRenderer: Renderer = {
  available: false,
  async render() {
    throw new RendererUnavailableError();
  },
  async frame() {
    throw new RendererUnavailableError();
  },
};
