/**
 * What the local ffmpeg build can do: version, encoders, and which decoder
 * FFmpeg picks for each codec.
 *
 * libopenshot records the *decoder* name (`aCodecCtx->codec->name`), e.g.
 * "mp3float" for MP3 and "libdav1d" for AV1, not the codec name ffprobe
 * reports. `avcodec_find_decoder` returns the first non-experimental decoder
 * registered for a codec, and `ffmpeg -decoders` prints decoders of one codec
 * in that same registration order, so the first non-experimental line per
 * codec is the name libopenshot would store.
 */

import { resolveBinary } from "./binaries.js";
import { runBinary } from "./process.js";

interface CodecEntry {
  name: string;
  codec: string;
  experimental: boolean;
  kind: "video" | "audio" | "subtitle" | "data";
}

function parseCodecList(text: string): CodecEntry[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().startsWith("------"));
  const entries: CodecEntry[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\s*([VASD.][F.][S.][X.][B.][D.])\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const flags = m[1]!;
    const name = m[2]!;
    const codec = /\(codec ([^)\s]+)\)\s*$/.exec(m[3]!)?.[1] ?? name;
    const kind = flags[0] === "V" ? "video" : flags[0] === "A" ? "audio" : flags[0] === "S" ? "subtitle" : "data";
    entries.push({ name, codec, experimental: flags[3] === "X", kind });
  }
  return entries;
}

let decodersPromise: Promise<Map<string, string>> | undefined;
let encodersPromise: Promise<Set<string>> | undefined;

/** codec name → decoder name FFmpeg would open. */
export function decoderNames(): Promise<Map<string, string>> {
  decodersPromise ??= runBinary(resolveBinary("ffmpeg"), ["-hide_banner", "-decoders"], { timeoutMs: 15_000 })
    .then(({ stdout }) => {
      const map = new Map<string, string>();
      const experimental = new Map<string, string>();
      for (const entry of parseCodecList(stdout.toString("utf8"))) {
        if (entry.experimental) {
          if (!experimental.has(entry.codec)) experimental.set(entry.codec, entry.name);
        } else if (!map.has(entry.codec)) {
          map.set(entry.codec, entry.name);
        }
      }
      for (const [codec, name] of experimental) if (!map.has(codec)) map.set(codec, name);
      return map;
    })
    .catch((error: unknown) => {
      decodersPromise = undefined;
      throw error;
    });
  return decodersPromise;
}

/** Names of every encoder in the local ffmpeg build. */
export function encoderNames(): Promise<Set<string>> {
  encodersPromise ??= runBinary(resolveBinary("ffmpeg"), ["-hide_banner", "-encoders"], { timeoutMs: 15_000 })
    .then(({ stdout }) => new Set(parseCodecList(stdout.toString("utf8")).map((e) => e.name)))
    .catch((error: unknown) => {
      encodersPromise = undefined;
      throw error;
    });
  return encodersPromise;
}

/** The decoder libopenshot would report for `codec` (falls back to the codec name). */
export async function decoderNameFor(codec: string | undefined): Promise<string> {
  if (!codec) return "";
  try {
    return (await decoderNames()).get(codec) ?? codec;
  } catch {
    return codec;
  }
}

export interface BinaryVersion {
  path: string;
  version: string;
  /** First line of `-version`. */
  banner: string;
}

export async function binaryVersion(name: "ffmpeg" | "ffprobe"): Promise<BinaryVersion> {
  const bin = resolveBinary(name);
  const { stdout } = await runBinary(bin, ["-hide_banner", "-version"], { timeoutMs: 15_000 });
  const banner = stdout.toString("utf8").split(/\r?\n/)[0] ?? "";
  const version = /version\s+(\S+)/.exec(banner)?.[1] ?? "unknown";
  return { path: bin, version, banner };
}

/** Test hook: forget cached capability probes (after changing ZENVI_FFMPEG). */
export function resetCapabilityCache(): void {
  decodersPromise = undefined;
  encodersPromise = undefined;
}
