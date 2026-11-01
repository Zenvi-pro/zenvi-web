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
import { createMotionHost, findChrome } from "@zenvi/motion/node";
import * as renderNode from "@zenvi/render-node";
import type {
  AssetSource,
  AudioAnalyzer,
  FontLister,
  MatteHostFactory,
  MediaProber,
  MixRenderer,
  MotionHostFactory,
  PathResolver,
  PcmDecoder,
  Renderer,
  SpeechTranscriber,
  WatchProxyMaker,
} from "./renderer.js";
import { RendererUnavailableError, unavailableRenderer } from "./renderer.js";

type RenderProjectFn = (
  project: Project,
  options: {
    resolveMedia: PathResolver;
    output: string;
    options: ExportOptions;
    onProgress?: (progress: number | { fraction: number }) => void;
    signal?: AbortSignal;
    log?: (message: string) => void;
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
        log: input.log,
        onProgress: (progress) => input.onProgress(typeof progress === "number" ? progress : progress.fraction),
      });
    },
    // The same image (and ffmpeg) runs in-process renders and the render workers.
    encoders: () => renderNode.encoderNames(),
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
  const inside = (assetPath: string): string => {
    const full = path.resolve(root, assetPath.replace(/^\/+/, ""));
    if (!full.startsWith(`${root}${path.sep}`)) throw new Error(`not a bundled asset: ${assetPath}`);
    return full;
  };
  return {
    async readText(assetPath) {
      return readFile(inside(assetPath), "utf8");
    },
    async readBytes(assetPath) {
      return new Uint8Array(await readFile(inside(assetPath)));
    },
  };
}

export const nodeAnalyzeAudio: AudioAnalyzer = (filePath, options) => renderNode.analyzeAudio(filePath, options);
export const nodeDecodePcm: PcmDecoder = (filePath, options) => renderNode.decodePcm(filePath, options);
export const nodeMixPcm: MixRenderer = (project, options) => renderNode.renderMixPcm(project, options);
export const nodeTranscribeMedia: SpeechTranscriber = (filePath, options) => renderNode.transcribeMediaFile(filePath, options);

export const nodeWatchProxy: WatchProxyMaker = (filePath, signal) => renderNode.makeWatchProxy(filePath, signal);
export const nodeFontFamilies: FontLister = () => renderNode.installedFontFamilies();

/** Capture tabs per motion block render: the service container has 2 vCPUs, and requests still need answering. */
const MOTION_WORKERS = 2;

/**
 * Zenvi Motion with the image's chrome-headless-shell (`ZENVI_CHROME`, or the
 * one `zenvi motion setup` installs), or why there is none. A call's renders
 * and render cache live in its scratch folder: the result is kept as
 * content-addressed media (mcp/host.ts), so nothing needs to outlive the call.
 */
export async function nodeMotionHosts(env: NodeJS.ProcessEnv = process.env): Promise<{ factory?: MotionHostFactory; reason?: string }> {
  if (env.ZENVI_MOTION?.trim() === "0") return { reason: "turned off (ZENVI_MOTION=0)" };
  const chrome = await findChrome(env);
  if (!chrome) return { reason: "no headless Chrome (ZENVI_CHROME)" };
  // Scenes run agent-written code in Chrome, which the container runs unsandboxed: off on a shared
  // worker until that has had a security review (ZENVI_CLOUD_SCENES=1 turns them on).
  const scenes = env.ZENVI_CLOUD_SCENES?.trim() === "1";
  return {
    factory: ({ workDir, resolveMedia }) => {
      const { scenes: sceneHost, ...blocks } = createMotionHost({
        projectFile: () => path.join(workDir, "cloud.zvn"),
        resolveMedia,
        env: { ...env, ZENVI_CHROME: chrome, ZENVI_CACHE_DIR: workDir },
        workers: MOTION_WORKERS,
      });
      return scenes && sceneHost ? { ...blocks, scenes: sceneHost } : blocks;
    },
  };
}

/**
 * Subject mattes with Robust Video Matting when onnxruntime-node is
 * installed, or why not. The weights download into Zenvi's cache folder on
 * first use (SHA-256 checked), so a fresh container fetches them again.
 */
export function nodeMatteHosts(env: NodeJS.ProcessEnv = process.env): { factory?: MatteHostFactory; reason?: string } {
  if (env.ZENVI_MATTES?.trim() === "0") return { reason: "turned off (ZENVI_MATTES=0)" };
  if (!renderNode.onnxRuntimeAvailable()) return { reason: "onnxruntime-node is not installed" };
  const model = renderNode.rvmModel({ env });
  return {
    factory: ({ workDir, resolveMedia }) => renderNode.createNodeMatteHost({ projectFile: () => undefined, resolveMedia, model, scratchDir: workDir }),
  };
}
