/**
 * `createNodeHost`: the ToolHost the CLI, the local MCP server and the cloud
 * render worker give the engine's tools: local media, rendering, frame
 * previews, audio analysis, project storage and the Zenvi backend.
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AssetHost, ExportOptions, ToolHost } from "@zenvi/engine";
import { analyzeAudio, decodePcm } from "../audio/analyze.js";
import { transcribeMediaFile } from "../audio/speech.js";
import { engineAssetsDir } from "../resources.js";
import { FORMATS } from "../render/encoder.js";
import type { RenderEngine } from "../render/engine.js";
import { renderFrame } from "../render/render-frame.js";
import { renderProject, type RenderProgress } from "../render/render-project.js";
import { backendSpeechUpload, createBackendHost, type BackendHostOptions } from "./backend.js";
import { createNodeMediaHost, type ImportPolicy } from "./media.js";
import { createMediaResolver } from "./paths.js";
import { readProjectFile, writeFileAtomic, writeProjectFile } from "./storage.js";

export interface NodeHostOptions {
  /** The open project file, or a getter (MCP sessions switch projects). */
  projectFile?: string | (() => string | undefined);
  importPolicy?: ImportPolicy;
  /** Environment for finding yt-dlp, ffmpeg and Zenvi's cache folder (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Bundled engine assets (transition masks, emojis); defaults to the package/bundle copy. */
  engineAssetsDir?: string;
  backend?: BackendHostOptions;
  maxDownloadBytes?: number;
  /** Planner + compositor override (tests). */
  renderEngine?: RenderEngine;
  /** Progress of `exporter.export`, with frame counts. */
  onRenderProgress?: (progress: RenderProgress) => void;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export interface NodeHost extends ToolHost {
  /** Map a project path to a local file. */
  resolveMedia(projectPath: string): string;
  /** The open project file, if any. */
  projectFile(): string | undefined;
}

const MAX_TEXT_BYTES = 16 * 1024 * 1024;

/**
 * Bundled engine assets by their path under `assets/` (`titles/Bar_1.svg`):
 * the title templates the title tools fill in. Paths outside the folder are
 * refused.
 */
export function createAssetHost(dir: string): AssetHost {
  const root = path.resolve(dir);
  return {
    async readText(assetPath) {
      const file = path.resolve(root, assetPath);
      const rel = path.relative(root, file);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${assetPath} is not a bundled asset.`);
      if ((await stat(file)).size > MAX_TEXT_BYTES) throw new Error(`${assetPath} is larger than ${MAX_TEXT_BYTES} bytes.`);
      return readFile(file, "utf8");
    },
  };
}

export function createNodeHost(options: NodeHostOptions = {}): NodeHost {
  const current = (): string | undefined => {
    const p = typeof options.projectFile === "function" ? options.projectFile() : options.projectFile;
    return p ? path.resolve(p) : undefined;
  };
  const assets = options.engineAssetsDir ?? engineAssetsDir();
  const resolveMedia = (value: string): string => createMediaResolver({ projectFile: current(), engineAssetsDir: assets })(value);
  const baseDir = (): string => {
    const p = current();
    return p ? path.dirname(p) : process.cwd();
  };
  const inProject = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(baseDir(), p));

  const defaultOutput = (options_: ExportOptions): string => {
    const ext = FORMATS[options_.format]?.extension ?? "mp4";
    const project = current();
    const stem = project ? path.basename(project, path.extname(project)) : "zenvi-export";
    return path.join(baseDir(), `${stem}.${ext}`);
  };

  const host: NodeHost = {
    resolveMedia,
    projectFile: current,
    media: createNodeMediaHost({ projectFile: current, policy: options.importPolicy, maxDownloadBytes: options.maxDownloadBytes, env: options.env }),
    exporter: {
      async export(project, exportOptions, onProgress) {
        const output = exportOptions.output ? inProject(exportOptions.output) : defaultOutput(exportOptions);
        await mkdir(path.dirname(output), { recursive: true });
        return renderProject(project, {
          resolveMedia,
          output,
          options: exportOptions,
          engine: options.renderEngine,
          signal: options.signal,
          onProgress: (p) => {
            onProgress?.(p.fraction);
            options.onRenderProgress?.(p);
          },
        });
      },
    },
    frames: {
      async renderFrame(project, seconds, frameOptions = {}) {
        const format = frameOptions.format ?? "png";
        const bytes = await renderFrame(project, seconds, {
          resolveMedia,
          width: frameOptions.width,
          format,
          overlay: frameOptions.overlay,
          engine: options.renderEngine,
          signal: options.signal,
        });
        return { mimeType: format === "jpeg" ? "image/jpeg" : "image/png", data: bytes.toString("base64") };
      },
    },
    audio: {
      analyzeAudio: (p, o) => analyzeAudio(resolveMedia(p), { ...o, signal: o?.signal ?? options.signal }),
      decodePcm: (p, o) => decodePcm(resolveMedia(p), { ...o, signal: o?.signal ?? options.signal }),
    },
    storage: {
      async save(project, target) {
        const file = target ? inProject(target) : current();
        if (!file) throw new Error("The project has not been saved yet: give a file path (e.g. my-edit.zvn).");
        await mkdir(path.dirname(file), { recursive: true });
        return writeProjectFile(file, project, { engineAssetsDir: assets });
      },
      open: (p) => readProjectFile(inProject(p)),
      async readText(p) {
        const file = inProject(p);
        if ((await stat(file)).size > MAX_TEXT_BYTES) throw new Error(`${file} is larger than ${MAX_TEXT_BYTES} bytes.`);
        return readFile(file, "utf8");
      },
      async writeText(p, text) {
        const file = inProject(p);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, text);
        return file;
      },
    },
    log: options.log,
  };
  if (assets) host.assets = createAssetHost(assets);
  if (options.backend) {
    host.backend = createBackendHost(options.backend);
    // Speech recognition through the Zenvi backend, as the person `zenvi login` signed in.
    const upload = backendSpeechUpload(options.backend);
    host.audio!.transcribe = (p, o) => transcribeMediaFile(resolveMedia(p), { ...o, signal: o?.signal ?? options.signal, upload });
  }
  return host;
}
