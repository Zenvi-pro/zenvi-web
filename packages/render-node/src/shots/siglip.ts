/**
 * SigLIP (Zhai et al. 2023), base, patch 16, 224 px: image and text
 * embeddings in one space, in onnxruntime-node (an optional dependency, like
 * matting). Weights: google/siglip-base-patch16-224 (Apache-2.0) as the
 * 8-bit ONNX export transformers.js uses (Xenova/siglip-base-patch16-224),
 * 213 MB, downloaded once after the person agrees (`setup`).
 *
 * SigLIP 2 base scores better but its text tower carries Gemma's 256k-token
 * vocabulary: 283 MB at 8 bits against 111 MB here.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalize, siglipPixels, siglipTokenize, unigramVocab, SIGLIP_IMAGE_SIZE, SIGLIP_TEXT_TOKENS, type ShotModelInfo, type UnigramVocab, type Vector } from "@zenvi/engine";
import { ensureModel, modelDir, type ModelCacheOptions, type ModelDescriptor } from "../matte/model-cache.js";

const REVISION = "4649052661e53c7000355844105f8a1792088239";
const HF = `https://huggingface.co/Xenova/siglip-base-patch16-224/resolve/${REVISION}`;

export const SIGLIP_BASE: ModelDescriptor = {
  id: "siglip-base-patch16-224-q8",
  name: "siglip-base-patch16-224",
  version: REVISION.slice(0, 8),
  license: "Apache-2.0",
  homepage: "https://huggingface.co/google/siglip-base-patch16-224",
  weights: {
    file: "vision_model_quantized.onnx",
    url: `${HF}/onnx/vision_model_quantized.onnx`,
    sha256: "ef14a954f3d57e1806666432bd9785004c1dc27100aa260eee0cb0f10a5de058",
    bytes: 99_499_129,
  },
  licenseText: {
    file: "LICENSE",
    url: "https://www.apache.org/licenses/LICENSE-2.0.txt",
    sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  },
  extra: [
    {
      file: "text_model_quantized.onnx",
      url: `${HF}/onnx/text_model_quantized.onnx`,
      sha256: "ad0329b1f35acc66d8953ff2559ce358da8eb0a7011794cf951523d63a4dbce2",
      bytes: 111_475_220,
    },
    {
      file: "tokenizer.json",
      url: `${HF}/tokenizer.json`,
      sha256: "4a17c975210be5ab4c36b47d8dae4eefb866dbfb1e676e394aad85dc30a3ae08",
      bytes: 2_398_744,
    },
  ],
};

/**
 * The model's image–text head (logit_scale.exp(), logit_bias of the
 * checkpoint), read from the full ONNX export: a cosine of 0.11 between a
 * frame and a text is an even chance that the frame shows it.
 */
export const SIGLIP_BASE_INFO: ShotModelInfo = {
  name: SIGLIP_BASE.name,
  version: SIGLIP_BASE.version,
  license: SIGLIP_BASE.license,
  dims: 768,
  logitScale: 117.33,
  logitBias: -12.93,
};

/** Frames per inference call: SigLIP base takes ~0.6 GB of activations at 32. */
const BATCH = 16;

type Ort = typeof import("onnxruntime-node");
type Session = Awaited<ReturnType<Ort["InferenceSession"]["create"]>>;

async function loadOrt(): Promise<Ort> {
  try {
    const mod = (await import("onnxruntime-node")) as Ort & { default?: Ort };
    return mod.default ?? mod;
  } catch (error) {
    throw new Error(`shot embeddings need onnxruntime-node (npm install onnxruntime-node): ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface SiglipOptions extends ModelCacheOptions {
  /** onnxruntime intra-op threads (default: its own choice, the physical cores). */
  threads?: number;
}

/** SigLIP sessions, opened on first use from the cached model (call `ensureModel` / setup first). */
export class Siglip {
  readonly info = SIGLIP_BASE_INFO;
  private sessions?: Promise<{ ort: Ort; vision: Session; text: Session; vocab: UnigramVocab }>;

  constructor(private readonly options: SiglipOptions = {}) {}

  private open(): Promise<{ ort: Ort; vision: Session; text: Session; vocab: UnigramVocab }> {
    this.sessions ??= (async () => {
      const ort = await loadOrt();
      const weights = await ensureModel(SIGLIP_BASE, this.options);
      const dir = modelDir(SIGLIP_BASE, this.options);
      const config = { executionProviders: ["cpu"], graphOptimizationLevel: "all" as const, ...(this.options.threads ? { intraOpNumThreads: this.options.threads } : {}) };
      const vision = await ort.InferenceSession.create(weights, config);
      const text = await ort.InferenceSession.create(path.join(dir, "text_model_quantized.onnx"), config);
      const vocab = unigramVocab(JSON.parse(await readFile(path.join(dir, "tokenizer.json"), "utf8")));
      return { ort, vision, text, vocab };
    })();
    this.sessions.catch(() => (this.sessions = undefined));
    return this.sessions;
  }

  /** Unit embeddings of 224 × 224 rgb24 frames. */
  async embedImages(frames: readonly Uint8Array[], signal?: AbortSignal): Promise<Vector[]> {
    const { ort, vision } = await this.open();
    const plane = 3 * SIGLIP_IMAGE_SIZE * SIGLIP_IMAGE_SIZE;
    const out: Vector[] = [];
    for (let i = 0; i < frames.length; i += BATCH) {
      if (signal?.aborted) throw new Error("cancelled");
      const batch = frames.slice(i, i + BATCH);
      const input = new Float32Array(batch.length * plane);
      batch.forEach((rgb, k) => siglipPixels(rgb, input, k * plane));
      const result = await vision.run({ pixel_values: new ort.Tensor("float32", input, [batch.length, 3, SIGLIP_IMAGE_SIZE, SIGLIP_IMAGE_SIZE]) });
      out.push(...rows(result.pooler_output!.data as Float32Array, batch.length));
    }
    return out;
  }

  /** Unit embeddings of texts. */
  async embedText(texts: readonly string[], signal?: AbortSignal): Promise<Vector[]> {
    const { ort, text, vocab } = await this.open();
    const out: Vector[] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      if (signal?.aborted) throw new Error("cancelled");
      const batch = texts.slice(i, i + BATCH);
      const ids = new BigInt64Array(batch.length * SIGLIP_TEXT_TOKENS);
      batch.forEach((t, k) => siglipTokenize(t, vocab).forEach((id, j) => (ids[k * SIGLIP_TEXT_TOKENS + j] = BigInt(id))));
      const result = await text.run({ input_ids: new ort.Tensor("int64", ids, [batch.length, SIGLIP_TEXT_TOKENS]) });
      out.push(...rows(result.pooler_output!.data as Float32Array, batch.length));
    }
    return out;
  }

  async close(): Promise<void> {
    const open = this.sessions;
    this.sessions = undefined;
    if (!open) return;
    const { vision, text } = await open.catch(() => ({ vision: undefined, text: undefined }));
    await vision?.release();
    await text?.release();
  }
}

function rows(data: Float32Array, n: number): Vector[] {
  const dims = data.length / n;
  return Array.from({ length: n }, (_, i) => normalize(data.subarray(i * dims, (i + 1) * dims)));
}
