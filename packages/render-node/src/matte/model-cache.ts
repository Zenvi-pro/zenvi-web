/**
 * Model weights (matting, speech recognition, shot embeddings), downloaded on
 * first use into Zenvi's cache folder (`<cache>/models/<id>/`) with their
 * licence text, each checked against a pinned SHA-256. Weights are never
 * committed or bundled.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheDir } from "../svg/fonts.js";
import { sha256File } from "../probe/fingerprint.js";

export interface ModelAsset {
  /** Path in the model's folder (may name a subfolder: `onnx/encoder.onnx`). */
  file: string;
  url: string;
  sha256: string;
  /** Exact size, when pinned: a larger download is refused before it is hashed. */
  bytes?: number;
}

export interface ModelDescriptor {
  id: string;
  name: string;
  version: string;
  /** SPDX id of the weights' licence. */
  license: string;
  homepage: string;
  weights: ModelAsset;
  licenseText: ModelAsset;
  /** Files the weights need beside them (configs, tokenizer, a second graph). */
  extra?: readonly ModelAsset[];
}

/**
 * Robust Video Matting (Lin et al. 2021), MobileNetV3 backbone, fp32 ONNX
 * from the v1.0.0 release. GPL-3.0, like Zenvi. Recurrent, so mattes are
 * steady from frame to frame without extra smoothing.
 */
export const RVM_MOBILENETV3: ModelDescriptor = {
  id: "rvm-mobilenetv3-1.0.0",
  name: "rvm_mobilenetv3_fp32",
  version: "1.0.0",
  license: "GPL-3.0",
  homepage: "https://github.com/PeterL1n/RobustVideoMatting",
  weights: {
    file: "rvm_mobilenetv3_fp32.onnx",
    url: "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx",
    sha256: "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828",
  },
  licenseText: {
    file: "LICENSE",
    url: "https://raw.githubusercontent.com/PeterL1n/RobustVideoMatting/v1.0.0/LICENSE",
    sha256: "8b1ba204bb69a0ade2bfcf65ef294a920f6bb361b317dba43c7ef29d96332b9b",
  },
};

const MAX_ASSET_BYTES = 64 * 1024 * 1024;

export interface ModelCacheOptions {
  env?: NodeJS.ProcessEnv;
  /** Cache root override (default `cacheDir(env)`). */
  root?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export function modelDir(model: ModelDescriptor, options: Pick<ModelCacheOptions, "env" | "root"> = {}): string {
  return path.join(options.root ?? cacheDir(options.env), "models", model.id);
}

const verified = new Set<string>();

async function present(file: string, sha256: string): Promise<boolean> {
  if (verified.has(file)) return true;
  const st = await stat(file).catch(() => undefined);
  if (!st?.isFile()) return false;
  if ((await sha256File(file)) !== sha256) return false;
  verified.add(file);
  return true;
}

async function download(asset: ModelAsset, dest: string, options: ModelCacheOptions): Promise<void> {
  const response = await (options.fetch ?? fetch)(asset.url, { signal: options.signal, redirect: "follow" });
  if (!response.ok) throw new Error(`downloading ${asset.url} failed: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > (asset.bytes ?? MAX_ASSET_BYTES)) throw new Error(`${asset.url} is larger than expected (${bytes.byteLength} bytes)`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.sha256) throw new Error(`${asset.url} does not match its pinned checksum (got ${digest}, want ${asset.sha256})`);
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(part, bytes);
    await rename(part, dest);
  } finally {
    await rm(part, { force: true });
  }
  verified.add(dest);
}

/** Every file of a model, the licence first and the weights last. */
export function modelAssets(model: ModelDescriptor): ModelAsset[] {
  return [model.licenseText, ...(model.extra ?? []), model.weights];
}

/** Megabytes `ensureModel` downloads, for the messages that ask before downloading. */
export function modelDownloadMb(model: ModelDescriptor): number {
  return Math.round(modelAssets(model).reduce((sum, a) => sum + (a.bytes ?? 0), 0) / 1e6);
}

/** Whether every file of the model is in the cache and matches its checksum (downloads nothing). */
export async function modelPresent(model: ModelDescriptor, options: Pick<ModelCacheOptions, "env" | "root"> = {}): Promise<boolean> {
  const dir = modelDir(model, options);
  for (const asset of modelAssets(model)) if (!(await present(path.join(dir, asset.file), asset.sha256))) return false;
  return true;
}

/**
 * The model's weights file, downloading the weights, the licence text and
 * the extra files first when they are missing or do not match their
 * checksums. The extra files sit next to the weights.
 */
export async function ensureModel(model: ModelDescriptor, options: ModelCacheOptions = {}): Promise<string> {
  const dir = modelDir(model, options);
  await mkdir(dir, { recursive: true });
  for (const asset of modelAssets(model)) {
    const dest = path.join(dir, asset.file);
    if (await present(dest, asset.sha256)) continue;
    options.log?.(`downloading ${model.name} ${asset.file} from ${asset.url}`);
    await download(asset, dest, options);
  }
  const about = path.join(dir, "SOURCE.txt");
  const text = `${model.name} ${model.version} (${model.license})\n${model.homepage}\n${model.weights.url}\nsha256 ${model.weights.sha256}\n`;
  if ((await readFile(about, "utf8").catch(() => "")) !== text) await writeFile(about, text);
  return path.join(dir, model.weights.file);
}
