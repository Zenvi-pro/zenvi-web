/**
 * SigLIP's input side, shared by every host that runs the model (the CLI in
 * onnxruntime-node, a browser in onnxruntime-web): the SentencePiece
 * Unigram tokenizer and the pixel normalisation. Ports of Hugging Face
 * transformers `SiglipTokenizer` (canonicalize_text: lower case, no
 * punctuation, single spaces; `</s>` appended, padded with `</s>` to 64
 * tokens, the length the model was trained at) and `SiglipImageProcessor`
 * (224 × 224 bicubic, no crop, (x / 255 - 0.5) / 0.5), and of the Unigram
 * Viterbi in huggingface/tokenizers `models/unigram/lattice.rs`.
 */

export interface UnigramVocab {
  pieces: Map<string, { id: number; score: number }>;
  maxPieceLength: number;
  unkId: number;
  /** Score of an unknown character (the lowest piece score minus 10, like `unk_score` in tokenizers). */
  unkScore: number;
  eosId: number;
  padId: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The vocabulary of a Hugging Face `tokenizer.json` with a Unigram model. Throws on anything else. */
export function unigramVocab(tokenizerJson: unknown): UnigramVocab {
  const model = isRecord(tokenizerJson) ? tokenizerJson.model : undefined;
  if (!isRecord(model) || model.type !== "Unigram" || !Array.isArray(model.vocab)) throw new Error("tokenizer.json has no Unigram model");
  const pieces = new Map<string, { id: number; score: number }>();
  let maxPieceLength = 1;
  let minScore = 0;
  model.vocab.forEach((entry, id) => {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || typeof entry[1] !== "number") throw new Error(`tokenizer.json vocab entry ${id} is not [piece, score]`);
    pieces.set(entry[0], { id, score: entry[1] });
    maxPieceLength = Math.max(maxPieceLength, [...entry[0]].length);
    minScore = Math.min(minScore, entry[1]);
  });
  const idOf = (piece: string, fallback: number): number => pieces.get(piece)?.id ?? fallback;
  const unkId = typeof model.unk_id === "number" ? model.unk_id : idOf("<unk>", 2);
  const eosId = idOf("</s>", 1);
  return { pieces, maxPieceLength, unkId, unkScore: minScore - 10, eosId, padId: eosId };
}

/** SiglipTokenizer.canonicalize_text with do_lower_case. */
export function canonicalText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best segmentation of `text` into pieces (Viterbi over the piece lattice); unknown characters become `unkId`. */
export function unigramEncode(text: string, vocab: UnigramVocab): number[] {
  const chars = [...text];
  const n = chars.length;
  const best = new Float64Array(n + 1).fill(-Infinity);
  const from = new Int32Array(n + 1).fill(-1);
  const token = new Int32Array(n + 1).fill(-1);
  best[0] = 0;
  for (let i = 0; i < n; i += 1) {
    if (best[i] === -Infinity) continue;
    let matched = false;
    let piece = "";
    for (let len = 1; len <= vocab.maxPieceLength && i + len <= n; len += 1) {
      piece += chars[i + len - 1]!;
      const hit = vocab.pieces.get(piece);
      if (!hit) continue;
      if (len === 1) matched = true;
      const score = best[i]! + hit.score;
      if (score > best[i + len]!) {
        best[i + len] = score;
        from[i + len] = i;
        token[i + len] = hit.id;
      }
    }
    if (!matched && best[i]! + vocab.unkScore > best[i + 1]!) {
      best[i + 1] = best[i]! + vocab.unkScore;
      from[i + 1] = i;
      token[i + 1] = vocab.unkId;
    }
  }
  const ids: number[] = [];
  for (let at = n; at > 0; at = from[at]!) ids.push(token[at]!);
  ids.reverse();
  // Runs of unknown characters are one unknown token (tokenizers fuses them).
  return ids.filter((id, i) => id !== vocab.unkId || ids[i - 1] !== vocab.unkId);
}

/** SigLIP's text length: the model was trained on 64 tokens padded with `</s>`. */
export const SIGLIP_TEXT_TOKENS = 64;

/** Token ids for the text model: canonical text, Metaspace (`▁` for spaces and in front), `</s>`, padded. */
export function siglipTokenize(text: string, vocab: UnigramVocab, length = SIGLIP_TEXT_TOKENS): number[] {
  const canonical = canonicalText(text);
  const ids = canonical ? unigramEncode(`▁${canonical.replaceAll(" ", "▁")}`, vocab) : [];
  const out = ids.slice(0, length - 1);
  out.push(vocab.eosId);
  while (out.length < length) out.push(vocab.padId);
  return out;
}

/** SigLIP's image size. */
export const SIGLIP_IMAGE_SIZE = 224;

/** One `size` × `size` rgb24 frame into planar float32 at `out[offset…]`, scaled to [-1, 1]. */
export function siglipPixels(rgb: Uint8Array, out: Float32Array, offset = 0, size = SIGLIP_IMAGE_SIZE): void {
  const plane = size * size;
  if (rgb.length !== plane * 3) throw new Error(`frame is ${rgb.length} bytes, expected ${plane * 3}`);
  for (let i = 0, j = 0; i < plane; i += 1, j += 3) {
    out[offset + i] = rgb[j]! / 127.5 - 1;
    out[offset + plane + i] = rgb[j + 1]! / 127.5 - 1;
    out[offset + 2 * plane + i] = rgb[j + 2]! / 127.5 - 1;
  }
}
