/**
 * `@zenvi/render-node` (W3) as the cloud's media runtime.
 *
 * `probe` is used directly. `renderProject` / `renderFrame` are picked up
 * when this build of render-node exports them (they are landing in W3's
 * `src/render/`); until then the service reports rendering as unavailable.
 * Owner W7: replace the runtime lookup with static imports once both exports
 * are released.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExportOptions, Project } from "@zenvi/engine";
import * as renderNode from "@zenvi/render-node";
import type { AssetSource, AudioAnalyzer, MediaProber, PathResolver, Renderer } from "./renderer.js";
import { RendererUnavailableError, unavailableRenderer } from "./renderer.js";

type RenderProjectFn = (
  project: Project,
  options: {
    resolveMedia: PathResolver;
    output: string;
    options: ExportOptions;
    onProgress?: (progress: number | { fraction: number }) => void;
    signal?: AbortSignal;
  },
) => Promise<unknown>;

type RenderFrameFn = (
  project: Project,
  seconds: number,
  options: { width?: number; format?: "png" | "jpeg"; resolveMedia: PathResolver; signal?: AbortSignal },
) => Promise<Uint8Array>;

export const nodeProber: MediaProber = {
  available: true,
  probe: (filePath) => renderNode.probe(filePath),
};

/**
 * The render-node renderer, or `unavailableRenderer` (with the reason) when
 * this build lacks `renderProject` or the engine's planner/compositor that
 * render-node drives (`defaultRenderEngine`).
 */
export async function nodeRenderer(): Promise<{ renderer: Renderer; reason?: string }> {
  const mod = renderNode as unknown as Record<string, unknown>;
  const renderProject = typeof mod.renderProject === "function" ? (mod.renderProject as RenderProjectFn) : null;
  const renderFrame = typeof mod.renderFrame === "function" ? (mod.renderFrame as RenderFrameFn) : null;
  if (!renderProject) return { renderer: unavailableRenderer, reason: "@zenvi/render-node has no renderProject" };
  if (typeof mod.defaultRenderEngine === "function") {
    try {
      await (mod.defaultRenderEngine as () => Promise<unknown>)();
    } catch (error) {
      return { renderer: unavailableRenderer, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  const renderer: Renderer = {
    available: true,
    framesAvailable: renderFrame !== null,
    async render(input) {
      await renderProject(input.project, {
        resolveMedia: input.resolveMedia,
        output: input.output,
        options: input.options,
        signal: input.signal,
        onProgress: (progress) => input.onProgress(typeof progress === "number" ? progress : progress.fraction),
      });
    },
    async frame(input) {
      if (!renderFrame) throw new RendererUnavailableError("frame renderer");
      return renderFrame(input.project, input.seconds, {
        width: input.width,
        format: input.format,
        resolveMedia: input.resolveMedia,
        signal: input.signal,
      });
    },
  };
  return { renderer };
}

const PORTABLE = ["transitions", "emojis", "colors"] as const;

/**
 * Built-in assets from render-node's asset folder, never escaping it:
 * the portable prefixes `@transitions/…`, `@emojis/…`, `@colors/…` (as
 * render-node's `createMediaResolver` maps them), and absolute paths into a
 * desktop install's `…/transitions/…` or `…/emojis/…` folders, which projects
 * pushed straight from the desktop still carry.
 */
export function nodeAssetResolver(): ((projectPath: string) => string | undefined) | undefined {
  const dir = renderNode.engineAssetsDir();
  if (!dir) return undefined;
  const root = path.resolve(dir);
  const inside = (relative: string): string | undefined => {
    const full = path.resolve(root, relative);
    return full.startsWith(`${root}${path.sep}`) && existsSync(full) ? full : undefined;
  };
  return (projectPath) => {
    const normalized = projectPath.replace(/\\/g, "/");
    for (const kind of PORTABLE) {
      if (normalized.startsWith(`@${kind}/`)) return inside(`${kind}/${normalized.slice(kind.length + 2)}`);
    }
    for (const kind of PORTABLE) {
      const at = normalized.lastIndexOf(`/${kind}/`);
      if (at >= 0) return inside(`${kind}/${normalized.slice(at + kind.length + 2)}`);
    }
    return undefined;
  };
}

/**
 * The engine's bundled assets (title templates, transition masks) from
 * render-node's asset folder — `dist/assets` in the image. Paths are relative
 * to that folder and cannot leave it.
 */
export function nodeAssetSource(): AssetSource | undefined {
  const dir = renderNode.engineAssetsDir();
  if (!dir || !existsSync(dir)) return undefined;
  const root = path.resolve(dir);
  return {
    async readText(assetPath) {
      const full = path.resolve(root, assetPath.replace(/^\/+/, ""));
      if (!full.startsWith(`${root}${path.sep}`)) throw new Error(`not a bundled asset: ${assetPath}`);
      return readFile(full, "utf8");
    },
  };
}

export const nodeAnalyzeAudio: AudioAnalyzer = (filePath, options) => renderNode.analyzeAudio(filePath, options);
