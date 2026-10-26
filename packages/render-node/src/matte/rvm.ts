/**
 * Matting models: a frame of RGB in, an alpha matte out, with whatever state
 * the model carries between frames. Robust Video Matting runs in
 * onnxruntime-node (MIT), an optional dependency loaded on first use: the
 * CLI works without it and only matting is unavailable.
 */

import { createRequire } from "node:module";
import { ensureModel, RVM_MOBILENETV3, type ModelCacheOptions } from "./model-cache.js";

export interface MatteSession {
  /** One frame, rgb24 rows top to bottom → gray8 alpha (255 = subject). Frames must come in order. */
  matte(rgb: Uint8Array): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface MatteModel {
  readonly name: string;
  readonly version: string;
  /** SPDX licence of the weights. */
  readonly license: string;
  /** Start a clip at this frame size (fresh temporal state). */
  open(width: number, height: number): Promise<MatteSession>;
}

const ORT = "onnxruntime-node";

/** Whether onnxruntime-node can be loaded from here (it is an optional dependency). */
export function onnxRuntimeAvailable(): boolean {
  try {
    createRequire(import.meta.url).resolve(ORT);
    return true;
  } catch {
    return false;
  }
}

type Ort = typeof import("onnxruntime-node");

async function loadOrt(): Promise<Ort> {
  try {
    const mod = (await import(ORT)) as Ort & { default?: Ort };
    return mod.default ?? mod;
  } catch (error) {
    throw new Error(`subject matting needs onnxruntime-node (npm install onnxruntime-node): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** RVM's own advice: run the backbone near 512 px on the long side (0.25 at 1080p, 0.4 at 720p). */
export function rvmDownsampleRatio(width: number, height: number): number {
  return Math.min(1, 512 / Math.max(width, height));
}

export interface RvmOptions extends ModelCacheOptions {
  /** onnxruntime intra-op threads (default: its own choice, the physical cores). */
  threads?: number;
}

/** Robust Video Matting, MobileNetV3, on the CPU (CoreML partitions the graph and runs slower). */
export function rvmModel(options: RvmOptions = {}): MatteModel {
  const model = RVM_MOBILENETV3;
  return {
    name: model.name,
    version: model.version,
    license: model.license,
    async open(width, height) {
      const ort = await loadOrt();
      const weights = await ensureModel(model, options);
      const session = await ort.InferenceSession.create(weights, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
        ...(options.threads ? { intraOpNumThreads: options.threads } : {}),
      });
      const plane = width * height;
      const input = new Float32Array(3 * plane);
      const ratio = new ort.Tensor("float32", new Float32Array([rvmDownsampleRatio(width, height)]), [1]);
      const empty = () => new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
      let state: InstanceType<Ort["Tensor"]>[] = [empty(), empty(), empty(), empty()];
      return {
        async matte(rgb) {
          if (rgb.length !== plane * 3) throw new Error(`frame is ${rgb.length} bytes, expected ${plane * 3}`);
          for (let i = 0, j = 0; i < plane; i += 1, j += 3) {
            input[i] = rgb[j]! / 255;
            input[plane + i] = rgb[j + 1]! / 255;
            input[2 * plane + i] = rgb[j + 2]! / 255;
          }
          const src = new ort.Tensor("float32", input, [1, 3, height, width]);
          const out = await session.run({ src, r1i: state[0]!, r2i: state[1]!, r3i: state[2]!, r4i: state[3]!, downsample_ratio: ratio });
          state = [out.r1o!, out.r2o!, out.r3o!, out.r4o!];
          const pha = out.pha!.data as Float32Array;
          const gray = new Uint8Array(plane);
          for (let i = 0; i < plane; i += 1) gray[i] = Math.round(Math.min(1, Math.max(0, pha[i]!)) * 255);
          return gray;
        },
        async close() {
          await session.release();
        },
      };
    },
  };
}
