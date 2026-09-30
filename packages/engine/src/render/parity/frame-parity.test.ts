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
import type { RgbaImage } from "../types.js";

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

/** Every frame of a media file as straight RGBA (lossless sources decode exactly). */
function decode(path: string): Decoded {
  const { width, height } = probeSize(path);
  const r = cp.spawnSync("ffmpeg", ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${path}: ${r.stderr.toString("utf8")}`);
  const size = width * height * 4;
  const frames: Uint8ClampedArray[] = [];
  for (let o = 0; o + size <= r.stdout.length; o += size) frames.push(new Uint8ClampedArray(r.stdout.slice(o, o + size)));
  return { width, height, frames };
}

interface ManifestCase {
  name: string;
  project: string;
  frames: Record<string, { path: string; width: number; height: number }>;
  preview?: [number, number];
}

const enabled = available();
const results: { name: string; frame: number; psnr: number }[] = [];

describe.skipIf(!enabled)("frame parity with libopenshot 1.0", () => {
  let dir = "";
  let cases: ManifestCase[] = [];
  const media = new Map<string, Decoded>();

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
          : planFrame(project, frame);
        const layers = plan.layers.map((layer): RgbaImage | null => {
          const s = layer.source;
          if (s.kind === "color") return null;
          const m = media.get(s.path);
          if (!m) return null;
          const data = s.kind === "video" ? m.frames[Math.min(m.frames.length, s.frame) - 1] : m.frames[0];
          return data ? { width: m.width, height: m.height, data } : null;
        });
        const images = new Map<string, RgbaImage>();
        for (const [path, m] of media) if (m.frames.length === 1) images.set(path, { width: m.width, height: m.height, data: m.frames[0]! });
        const out = compositeFrame(plan, { layers, images });
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
