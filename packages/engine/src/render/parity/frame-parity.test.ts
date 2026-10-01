/**
 * Desktop parity: renders the same projects with libopenshot 1.0 (Python
 * bindings, scripts/parity/render_references.py) and with planFrame +
 * compositeFrame, and requires PSNR >= 35 dB per frame.
 *
 * Needs ffmpeg and libopenshot's Python bindings; skipped when either is
 * missing. Override the interpreter with ZENVI_PARITY_PYTHON and its module
 * path with ZENVI_PARITY_PYTHONPATH.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "../../model/types.js";
import { compositeFrame } from "../cpu/compositor.js";
import { planFrame } from "../plan/frame-plan.js";
import { psnrRgb } from "../testing/images.js";
import type { KernelAudio, RgbaImage } from "../types.js";

// Node APIs, typed locally so the engine's compilation stays free of Node types.
interface SpawnResult {
  status: number | null;
  stdout: Uint8Array & { toString(encoding?: string): string };
  stderr: Uint8Array & { toString(encoding?: string): string };
}
interface ChildProcessApi {
  spawnSync(cmd: string, args: string[], opts?: { env?: Record<string, string | undefined>; maxBuffer?: number; timeout?: number }): SpawnResult;
}
interface FsApi {
  mkdtempSync(prefix: string): string;
  readFileSync(path: string, encoding?: string): string & Uint8Array;
  rmSync(path: string, opts: { recursive: boolean; force: boolean }): void;
  existsSync(path: string): boolean;
}
interface ProcessApi {
  env: Record<string, string | undefined>;
}

const load = async <T,>(name: string): Promise<T> => (await import(/* @vite-ignore */ name)) as T;
const cp = await load<ChildProcessApi>("node:child_process");
const fs = await load<FsApi>("node:fs");
const os = await load<{ tmpdir(): string; homedir(): string }>("node:os");
const pathApi = await load<{ join(...parts: string[]): string; resolve(...parts: string[]): string }>("node:path");
const proc = (globalThis as unknown as { process: ProcessApi }).process;
const url = await load<{ fileURLToPath(u: string): string }>("node:url");

const home = os.homedir();
const python = proc.env.ZENVI_PARITY_PYTHON ?? `${home}/Projects/zenvi/.venv/bin/python`;
const pythonPath = proc.env.ZENVI_PARITY_PYTHONPATH ?? `${home}/zenvi-deps-1.0/python`;
const pyEnv = { ...proc.env, PYTHONPATH: pythonPath, DYLD_LIBRARY_PATH: proc.env.DYLD_LIBRARY_PATH ?? `${home}/zenvi-deps-1.0/lib` };
const script = pathApi.resolve(url.fileURLToPath(import.meta.url), "../../../../scripts/parity/render_references.py");

function available(): boolean {
  if (!fs.existsSync(python)) return false;
  const py = cp.spawnSync(python, ["-c", "import openshot"], { env: pyEnv, timeout: 120000 });
  const ff = cp.spawnSync("ffmpeg", ["-version"], { timeout: 30000 });
  return py.status === 0 && ff.status === 0;
}

interface Decoded {
  width: number;
  height: number;
  frames: Uint8ClampedArray[];
}

function probeSize(path: string): { width: number; height: number } {
  const r = cp.spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path]);
  const [w, h] = r.stdout.toString("utf8").trim().split(",").map(Number);
  return { width: w!, height: h! };
}

/**
 * Every frame of a media file as straight RGBA (lossless sources decode
 * exactly). With `size`, frames are scaled by swscale with `flags` in the
 * decoder, like FFmpegReader (SWS_FAST_BILINEAR in preview, SWS_BICUBIC when
 * exporting).
 */
function decode(path: string, size?: { width: number; height: number; flags: string }): Decoded {
  const natural = probeSize(path);
  const { width, height } = size ?? natural;
  const scale = size ? ["-vf", `scale=${size.width}:${size.height}:flags=${size.flags}`] : [];
  const r = cp.spawnSync("ffmpeg", ["-v", "error", "-i", path, ...scale, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${path}: ${r.stderr.toString("utf8")}`);
  const bytes = width * height * 4;
  const frames: Uint8ClampedArray[] = [];
  for (let o = 0; o + bytes <= r.stdout.length; o += bytes) frames.push(new Uint8ClampedArray(r.stdout.slice(o, o + bytes)));
  return { width, height, frames };
}

const pcmCache = new Map<string, Float32Array[]>();

/** A file's audio as planar float samples at `rate`, like FFmpegReader + FrameMapper deliver it. */
function audioOf(path: string, rate: number, channels: number): Float32Array[] {
  const key = `${path}@${rate}/${channels}`;
  const hit = pcmCache.get(key);
  if (hit) return hit;
  const r = cp.spawnSync("ffmpeg", ["-v", "error", "-i", path, "-vn", "-ac", String(channels), "-ar", String(rate), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg audio failed on ${path}: ${r.stderr.toString("utf8")}`);
  const bytes = new Uint8Array(r.stdout);
  const all = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
  const n = Math.floor(all.length / channels);
  const planar = Array.from({ length: channels }, (_, c) => {
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i += 1) ch[i] = all[i * channels + c]!;
    return ch;
  });
  pcmCache.set(key, planar);
  return planar;
}

interface ManifestCase {
  name: string;
  project: string;
  frames: Record<string, { path: string; width: number; height: number }>;
  preview?: [number, number];
  export?: [number, number];
}

const enabled = available();
const results: { name: string; frame: number; psnr: number }[] = [];

describe.skipIf(!enabled)("frame parity with libopenshot 1.0", () => {
  let dir = "";
  let cases: ManifestCase[] = [];
  const media = new Map<string, Decoded>();
  const scaled = new Map<string, Decoded>();

  beforeAll(() => {
    dir = fs.mkdtempSync(pathApi.join(os.tmpdir(), "zenvi-parity-"));
    const r = cp.spawnSync(python, [script, dir], { env: pyEnv, timeout: 600000, maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`render_references.py failed: ${r.stderr.toString("utf8")}`);
    const manifest = JSON.parse(fs.readFileSync(pathApi.join(dir, "manifest.json"), "utf8")) as { media: Record<string, string>; cases: ManifestCase[] };
    for (const path of Object.values(manifest.media)) media.set(path, decode(path));
    cases = manifest.cases;
  }, 900000);

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    if (results.length) {
      const lines = results.map((r) => `${r.name.padEnd(32)} ${String(r.frame).padStart(4)}  ${Number.isFinite(r.psnr) ? r.psnr.toFixed(2) : "exact"}`);
      console.log(`frame parity (PSNR dB, RGB):\n${lines.join("\n")}`);
    }
  });

  it("renders every case within 35 dB of the desktop", () => {
    expect(cases.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const c of cases) {
      const project = JSON.parse(fs.readFileSync(c.project, "utf8")) as Project;
      for (const [frameText, ref] of Object.entries(c.frames)) {
        const frame = Number(frameText);
        const plan = c.preview
          ? planFrame(project, frame, { width: c.preview[0], height: c.preview[1] }, { preview: true })
          : c.export
            ? planFrame(project, frame, { width: c.export[0], height: c.export[1] })
            : planFrame(project, frame);
        const flags = c.export ? "bicubic" : "fast_bilinear";
        const layers = plan.layers.map((layer): RgbaImage | null => {
          const s = layer.source;
          if (s.kind === "color") return null;
          let m = media.get(s.path);
          if (!m) return null;
          if (s.kind === "video" && (m.width !== layer.drawWidth || m.height !== layer.drawHeight)) {
            // FFmpegReader scales in the decoder: fast bilinear in preview, bicubic when exporting.
            const key = `${s.path}@${layer.drawWidth}x${layer.drawHeight}/${flags}`;
            m = scaled.get(key) ?? decode(s.path, { width: layer.drawWidth, height: layer.drawHeight, flags });
            scaled.set(key, m);
          }
          const data = s.kind === "video" ? m.frames[Math.min(m.frames.length, s.frame) - 1] : m.frames[0];
          return data ? { width: m.width, height: m.height, data } : null;
        });
        const audio = plan.layers.map((layer): KernelAudio | null => {
          const req = layer.audio;
          if (!req || req.silent) return null;
          const pcm = audioOf(req.path, req.sampleRate, req.channels);
          const from = Math.round(req.sourceStart * req.sampleRate);
          return {
            sampleRate: req.sampleRate,
            channels: pcm.map((ch) => {
              const out = new Float32Array(req.samples);
              out.set(ch.subarray(Math.max(0, from), Math.max(0, Math.min(ch.length, from + req.samples))));
              return out;
            }),
          };
        });
        const images = new Map<string, RgbaImage>();
        for (const [path, m] of media) if (m.frames.length === 1) images.set(path, { width: m.width, height: m.height, data: m.frames[0]! });
        const out = compositeFrame(plan, { layers, images, audio });
        const expected = new Uint8ClampedArray(fs.readFileSync(ref.path));
        if (out.width !== ref.width || out.height !== ref.height) {
          failures.push(`${c.name}@${frame}: size ${out.width}x${out.height} vs ${ref.width}x${ref.height}`);
          continue;
        }
        const psnr = psnrRgb(expected, out.data);
        results.push({ name: c.name, frame, psnr });
        if (psnr < 35) failures.push(`${c.name}@${frame}: ${psnr.toFixed(2)} dB`);
      }
    }
    expect(failures).toEqual([]);
  }, 900000);
});
