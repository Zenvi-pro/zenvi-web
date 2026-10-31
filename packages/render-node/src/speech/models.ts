/**
 * On-device speech recognition: Whisper (OpenAI, MIT) exported to ONNX with
 * the cross-attention outputs word timestamps need (onnx-community
 * `*_timestamped`), run by Transformers.js (Apache-2.0) on onnxruntime-node.
 * Neither the runtime nor the weights ship with Zenvi: `zenvi speech setup`
 * says what it will download, then installs the runtime into Zenvi's cache
 * and fetches the weights pinned to one revision, each file checked against
 * its SHA-256 (matte/model-cache.ts).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { modelAssets, modelDir, type ModelAsset, type ModelDescriptor } from "../matte/model-cache.js";

export type SpeechModelId = "base" | "small";

export interface SpeechModel extends ModelDescriptor {
  /** The q8 graphs Transformers.js loads (`dtype`). */
  dtype: "q8";
}

const OPENAI_LICENSE: ModelAsset = {
  file: "LICENSE",
  url: "https://raw.githubusercontent.com/openai/whisper/ba3f3cd54b0e5b8ce1ab3de13e32122d0d5f98ab/LICENSE",
  sha256: "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d",
};

function hub(repo: string, revision: string, file: string, sha256: string, bytes: number): ModelAsset {
  return { file, url: `https://huggingface.co/onnx-community/${repo}/resolve/${revision}/${file}`, sha256, bytes };
}

const BASE_REV = "608c49e61301901684bc36cac8f74b95ff6b5a8e";
const SMALL_REV = "65caa70f294b46e1c33ff820aae6b16d048ab818";
const TOKENIZER_SHA = "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566";
const PREPROCESSOR_SHA = "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d";

/**
 * Whisper base (74M parameters): about 80 MB, a few times faster than real
 * time on a laptop CPU. Whisper small (244M) hears sung and noisy speech
 * better for about 255 MB.
 */
export const SPEECH_MODELS: Record<SpeechModelId, SpeechModel> = {
  base: {
    id: `whisper-base-timestamped-${BASE_REV.slice(0, 7)}`,
    name: "whisper-base (timestamped ONNX, q8)",
    version: BASE_REV,
    license: "MIT",
    homepage: "https://huggingface.co/onnx-community/whisper-base_timestamped",
    dtype: "q8",
    licenseText: OPENAI_LICENSE,
    extra: [
      hub("whisper-base_timestamped", BASE_REV, "config.json", "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b", 2243),
      hub("whisper-base_timestamped", BASE_REV, "generation_config.json", "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0", 3832),
      hub("whisper-base_timestamped", BASE_REV, "preprocessor_config.json", PREPROCESSOR_SHA, 339),
      hub("whisper-base_timestamped", BASE_REV, "tokenizer.json", TOKENIZER_SHA, 2480466),
      hub("whisper-base_timestamped", BASE_REV, "tokenizer_config.json", "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573", 282682),
      hub("whisper-base_timestamped", BASE_REV, "onnx/encoder_model_quantized.onnx", "2714484ebe1bae7c1646e8eadb768bb9d415cf11763466d21f23039a29c62e6f", 23159167),
    ],
    weights: hub("whisper-base_timestamped", BASE_REV, "onnx/decoder_model_merged_quantized.onnx", "cf9a8d5bcddc0917a0078135b484cedcaf44f28909cd91910abd29dced9171db", 53712708),
  },
  small: {
    id: `whisper-small-timestamped-${SMALL_REV.slice(0, 7)}`,
    name: "whisper-small (timestamped ONNX, q8)",
    version: SMALL_REV,
    license: "MIT",
    homepage: "https://huggingface.co/onnx-community/whisper-small_timestamped",
    dtype: "q8",
    licenseText: OPENAI_LICENSE,
    extra: [
      hub("whisper-small_timestamped", SMALL_REV, "config.json", "457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18", 2227),
      hub("whisper-small_timestamped", SMALL_REV, "generation_config.json", "f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0", 3893),
      hub("whisper-small_timestamped", SMALL_REV, "preprocessor_config.json", PREPROCESSOR_SHA, 339),
      hub("whisper-small_timestamped", SMALL_REV, "tokenizer.json", TOKENIZER_SHA, 2480466),
      hub("whisper-small_timestamped", SMALL_REV, "tokenizer_config.json", "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce", 282683),
      hub("whisper-small_timestamped", SMALL_REV, "onnx/encoder_model_quantized.onnx", "9f5635b596e6084045c7426ca6f6f99db8ce606ea895397c3b4a3c0aa3f9b070", 92240498),
    ],
    weights: hub("whisper-small_timestamped", SMALL_REV, "onnx/decoder_model_merged_quantized.onnx", "c831996a6d5a535cf17447b0d7ecc36da6b72696e6fb906852ba6136b9199abb", 156795750),
  },
};

export const DEFAULT_SPEECH_MODEL: SpeechModelId = "base";

/** `ZENVI_SPEECH_MODEL` (base | small), else base. */
export function speechModelId(env: NodeJS.ProcessEnv = process.env): SpeechModelId {
  const asked = env.ZENVI_SPEECH_MODEL?.trim().toLowerCase();
  return asked === "small" || asked === "base" ? asked : DEFAULT_SPEECH_MODEL;
}

/** Bytes `ensureModel` downloads for a model (licence and configs included). */
export function speechModelBytes(model: SpeechModel): number {
  return modelAssets(model).reduce((n, a) => n + (a.bytes ?? 0), 0);
}

/** Every file of the model is in the cache (checksums are checked when it loads). */
export function speechModelPresent(model: SpeechModel, options: { env?: NodeJS.ProcessEnv; root?: string } = {}): boolean {
  const dir = modelDir(model, options);
  return modelAssets(model).every((a) => existsSync(path.join(dir, a.file)));
}
