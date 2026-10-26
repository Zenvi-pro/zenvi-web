/**
 * `createNodeHost`: the ToolHost the CLI, the local MCP server and the cloud
 * render worker give the engine's tools: local media, rendering, frame
 * previews, audio analysis, project storage and the Zenvi backend.
 */

import { mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { AssetHost, ExportOptions, ToolHost } from "@zenvi/engine";
import { analyzeAudio, decodePcm } from "../audio/analyze.js";
import { transcribeMediaFile } from "../audio/speech.js";
import { engineAssetsDir } from "../resources.js";
import { encoderNames } from "../ffmpeg/capabilities.js";
import { ffmpegCanWrite, FORMATS } from "../render/encoder.js";
import type { RenderEngine } from "../render/engine.js";
import { inspectRender } from "../render/inspect-render.js";
import { renderFrame } from "../render/render-frame.js";
import { renderProject, type RenderProgress } from "../render/render-project.js";
import { installedFontFamilies } from "../svg/fonts.js";
import { backendSpeechUpload, createBackendHost, type BackendHostOptions } from "./backend.js";
import { createNodeMediaHost, missingOnDisk, type ImportPolicy } from "./media.js";
import { createMediaResolver } from "./paths.js";
import { customProfileFiles, desktopRecentProjects, recoveryCopiesFor, removeCustomProfileFile, restoreRecoveryCopy, writeCustomProfileFile } from "./desktop-files.js";
import { collectMedia, exportMediaFile, reclaimableMedia, removeMediaCopies, writeBytesFile } from "./files-out.js";
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
  /**
   * Zenvi desktop's user folder (`~/.openshot_qt`): with it the host reads the
   * desktop's recent projects and recovery copies and keeps custom profiles
   * where the desktop finds them.
   */
  desktopDir?: string;
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
  /** An export path: `~` is the home folder (the desktop's normalize_path), relative paths start at the project's folder. */
  const exportPath = (p: string): string => inProject(/^~(?=$|[\\/])/.test(p) ? path.join(homedir(), p.slice(1)) : p);

  const defaultOutput = (options_: ExportOptions): string => {
    const ext = FORMATS[options_.format]?.extension ?? "mp4";
    const project = current();
    const stem = project ? path.basename(project, path.extname(project)) : "zenvi-export";
    return path.join(baseDir(), `${stem}.${ext}`);
  };

  /** The open project file, for what only a saved project has. */
  const saved = (): string => {
    const file = current();
    if (!file) throw new Error("The project has not been saved yet: give a file path (e.g. my-edit.zvn).");
    return file;
  };
  const collectOptions = () => ({ projectFile: saved(), engineAssetsDir: assets, resolveMedia });

  const host: NodeHost = {
    resolveMedia,
    projectFile: current,
    media: {
      ...createNodeMediaHost({ projectFile: current, policy: options.importPolicy, maxDownloadBytes: options.maxDownloadBytes, env: options.env }),
      missing: (files) => missingOnDisk(files, resolveMedia),
      collect: (files) => collectMedia(files, collectOptions()),
      reclaimable: (files) => reclaimableMedia(files, collectOptions()),
      removeCopies: (paths) => removeMediaCopies(paths, collectOptions()),
      inspectRender: (p, o) => inspectRender(exportPath(p), { ...o, signal: o.signal ?? options.signal }),
    },
    exporter: {
      delivery: "files",
      // The desktop names an export after the project file (else "Untitled Project").
      defaultName: () => {
        const file = current();
        return file ? path.basename(file, path.extname(file)) : "Untitled Project";
      },
      async isFolder(p) {
        return stat(exportPath(p)).then(
          (s) => s.isDirectory(),
          () => false,
        );
      },
      async export(project, exportOptions, onProgress) {
        const output = exportOptions.output ? exportPath(exportOptions.output) : defaultOutput(exportOptions);
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
      // The containers this exporter writes, with encoders the local ffmpeg has (FFmpegWriter.IsValidCodec) and the muxer takes.
      async supports(format, videoCodec, audioCodec) {
        const encoders = await encoderNames().catch(() => new Set<string>());
        return ffmpegCanWrite(format, videoCodec, audioCodec, encoders);
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
      // The fonts SVG titles render with here (this computer's fonts and the bundled Lato).
      fontFamilies: () => installedFontFamilies(),
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
      writeBytes: (p, bytes, _contentType, opts) => writeBytesFile(inProject(p), bytes, opts?.overwrite),
      exportMedia: (file, name, folder, render) =>
        exportMediaFile({
          source: resolveMedia(String(file.path ?? "")),
          folder: folder ? inProject(folder) : baseDir(),
          name,
          render,
          resolveMedia,
          engine: options.renderEngine,
          signal: options.signal,
        }),
      currentPath: () => current() ?? null,
    },
    log: options.log,
  };
  if (assets) host.assets = createAssetHost(assets);
  const desktopDir = options.desktopDir;
  if (desktopDir) {
    Object.assign(host.storage!, {
      recentProjects: () => desktopRecentProjects(desktopDir),
      recoveryCopies: async () => {
        const file = current();
        return file ? recoveryCopiesFor(desktopDir, file) : [];
      },
      restoreRecoveryCopy: async (copy: string) => {
        const file = saved();
        const backup = await restoreRecoveryCopy(desktopDir, file, copy);
        return { project: await readProjectFile(file), path: file, backup };
      },
      customProfiles: () => customProfileFiles(desktopDir),
      writeCustomProfile: (name: string, text: string) => writeCustomProfileFile(desktopDir, name, text),
      removeCustomProfile: (name: string) => removeCustomProfileFile(desktopDir, name),
    } satisfies Partial<NonNullable<ToolHost["storage"]>>);
  }
  if (options.backend) {
    host.backend = createBackendHost(options.backend);
    // Speech recognition through the Zenvi backend, as the person `zenvi login` signed in.
    const upload = backendSpeechUpload(options.backend);
    host.audio!.transcribe = (p, o) => transcribeMediaFile(resolveMedia(p), { ...o, signal: o?.signal ?? options.signal, upload });
  }
  return host;
}
