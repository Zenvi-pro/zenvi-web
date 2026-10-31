/**
 * The speech runtime, Transformers.js (Apache-2.0): resolved from Zenvi's own
 * node_modules when a developer or a container installed it, else from the
 * copy `zenvi speech setup` installed into Zenvi's cache. It is never a
 * dependency of the CLI: it brings onnxruntime builds for every platform
 * (about 450 MB on disk) that only people who transcribe on device need.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cacheDir } from "../svg/fonts.js";
import { runBinary } from "../ffmpeg/process.js";

export const TRANSFORMERS_PACKAGE = "@huggingface/transformers";
/** The version setup installs (and the API this module was written against). */
export const TRANSFORMERS_VERSION = "4.3.2";
/** What `npm install` puts on disk for it, for the setup prompt. */
export const TRANSFORMERS_INSTALL_BYTES = 470 * 1024 * 1024;

/** The slice of Transformers.js Zenvi calls. */
export interface TransformersModule {
  env: { localModelPath: string; allowRemoteModels: boolean; allowLocalModels: boolean };
  pipeline(task: "automatic-speech-recognition", model: string, options: { dtype: string; device?: string }): Promise<SpeechPipeline>;
}

export interface SpeechChunk {
  text: string;
  timestamp: [number, number | null];
}

export type SpeechPipeline = ((
  audio: Float32Array,
  options: { return_timestamps: "word"; chunk_length_s: number; stride_length_s?: number; language?: string; task?: "transcribe" },
) => Promise<{ text: string; chunks?: SpeechChunk[] }>) & { dispose?: () => Promise<void> };

export function speechRuntimeDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheDir(env), "speech-runtime");
}

/** The runtime's entry file, or undefined when neither place has it. */
export function resolveTransformers(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const bases = [import.meta.url, pathToFileURL(path.join(speechRuntimeDir(env), "package.json")).href];
  for (const base of bases) {
    try {
      return createRequire(base).resolve(TRANSFORMERS_PACKAGE);
    } catch {
      // not installed there
    }
  }
  return undefined;
}

export async function loadTransformers(env: NodeJS.ProcessEnv = process.env): Promise<TransformersModule> {
  const entry = resolveTransformers(env);
  if (!entry) throw new Error(`${TRANSFORMERS_PACKAGE} is not installed: run \`zenvi speech setup\``);
  const mod = (await import(pathToFileURL(entry).href)) as Partial<TransformersModule> & { default?: TransformersModule };
  // The CommonJS entry (what createRequire resolves) arrives as `default` from some Node versions.
  return (typeof mod.pipeline === "function" ? mod : mod.default) as TransformersModule;
}

/**
 * Install the runtime into the cache with npm (no install scripts: the
 * prebuilt onnxruntime and sharp binaries need none). Resolves with the
 * entry file.
 */
export async function installSpeechRuntime(options: { env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}): Promise<string> {
  const env = options.env ?? process.env;
  const dir = speechRuntimeDir(env);
  await mkdir(dir, { recursive: true });
  const manifest = path.join(dir, "package.json");
  if (!existsSync(manifest)) await writeFile(manifest, `${JSON.stringify({ name: "zenvi-speech-runtime", private: true }, null, 2)}\n`);
  // npm is npm.cmd on Windows, which Node refuses to spawn without a shell (CVE-2024-27980);
  // the npm-cli.js Node's installer puts beside node.exe needs none.
  const [npm, ...npmArgs] = process.platform === "win32" ? [process.execPath, path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : ["npm"];
  await runBinary(npm!, [...npmArgs, "install", "--prefix", dir, "--no-audit", "--no-fund", "--ignore-scripts", "--omit=dev", `${TRANSFORMERS_PACKAGE}@${TRANSFORMERS_VERSION}`], {
    signal: options.signal,
    what: `Installing ${TRANSFORMERS_PACKAGE} with npm failed`,
  });
  const entry = resolveTransformers(env);
  if (!entry) throw new Error(`npm installed ${TRANSFORMERS_PACKAGE} into ${dir} but it cannot be loaded from there`);
  return entry;
}
