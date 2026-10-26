/**
 * Media for and about a scenario: generate its fixtures with ffmpeg lavfi
 * sources (or the OS voice), and the cheap checks of what the tools made —
 * duration and streams (ffprobe), integrated loudness (ebur128) and whether
 * a frame is black (mean luma of the frame scaled to one grey pixel).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveBinary, runBinary, whichSync } from "@zenvi/render-node";
import type { Fixture, MediaCheck } from "./scenario.js";
import { inRange } from "./scenario.js";

async function ffmpeg(args: readonly string[]): Promise<string> {
  const run = await runBinary(resolveBinary("ffmpeg"), ["-hide_banner", "-nostdin", "-y", ...args], { timeoutMs: 120_000 });
  return run.stderr;
}

/** Host programs a scenario may require, present or not. */
export function hostHas(program: "ffmpeg" | "say"): boolean {
  if (program === "ffmpeg") {
    try {
      resolveBinary("ffmpeg");
      resolveBinary("ffprobe");
      return true;
    } catch {
      return false;
    }
  }
  return whichSync("say") !== undefined;
}

/** Make one fixture in `dir`; returns its absolute path. */
export async function makeFixture(dir: string, fixture: Fixture): Promise<string> {
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, fixture.file);
  if (fixture.say) {
    const aiff = `${out}.aiff`;
    await runBinary(whichSync("say")!, ["-o", aiff, fixture.say], { timeoutMs: 60_000 });
    await ffmpeg(["-i", aiff, ...(fixture.output ?? ["-ar", "48000", "-ac", "2"]), out]);
    return out;
  }
  const inputs = fixture.lavfi!.flatMap((src) => ["-f", "lavfi", "-i", src]);
  const output = fixture.output ?? ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"];
  await ffmpeg([...inputs, ...output, out]);
  return out;
}

interface Probe {
  streams: Array<{ codec_type: string }>;
  format: { duration?: string };
}

async function ffprobe(file: string): Promise<Probe> {
  const run = await runBinary(resolveBinary("ffprobe"), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeoutMs: 60_000 });
  return JSON.parse(run.stdout.toString("utf8")) as Probe;
}

/** Integrated loudness of a file's audio, LUFS (null when silent or no audio). */
export async function integratedLoudness(file: string): Promise<number | null> {
  const log = await ffmpeg(["-i", file, "-vn", "-af", "ebur128=peak=none", "-f", "null", "-"]);
  const tail = log.slice(log.lastIndexOf("Summary:"));
  const m = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(tail);
  return m && m[1] !== "-inf" ? Number(m[1]) : null;
}

/** Mean luma (0-255) of the frame at `seconds`: the frame averaged down to one grey pixel. (-ss 0 on a still yields no frame.) */
export async function frameLuma(file: string, seconds: number): Promise<number> {
  const run = await runBinary(
    resolveBinary("ffmpeg"),
    ["-hide_banner", "-nostdin", ...(seconds > 0 ? ["-ss", String(seconds)] : []), "-i", file, "-frames:v", "1", "-vf", "scale=1:1:flags=area,format=gray", "-f", "rawvideo", "-"],
    { timeoutMs: 60_000 },
  );
  const bytes = run.stdout;
  if (bytes.length === 0) throw new Error(`no frame at ${seconds}s in ${path.basename(file)}`);
  return bytes[0]!;
}

/** Mean luma of an image an MCP tool returned (base64 JPEG/PNG). */
export async function imageLuma(dir: string, data: string, mimeType: string): Promise<number> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${mimeType.includes("png") ? "png" : "jpg"}`);
  await writeFile(file, Buffer.from(data, "base64"));
  return frameLuma(file, 0);
}

export interface CheckOutcome {
  name: string;
  ok: boolean;
  detail: string;
}

/** Run a media check on an exported file; one outcome per property asked for. */
export async function checkMedia(check: MediaCheck): Promise<CheckOutcome[]> {
  const name = path.basename(check.file);
  const out: CheckOutcome[] = [];
  let probe: Probe;
  try {
    probe = await ffprobe(check.file);
  } catch (error) {
    return [{ name: `${name} readable`, ok: false, detail: (error as Error).message.split("\n")[0]! }];
  }
  if (check.durationSeconds) {
    const d = Number(probe.format.duration);
    out.push({ name: `${name} duration`, ok: Number.isFinite(d) && inRange(d, check.durationSeconds), detail: `${d.toFixed(2)} s` });
  }
  if (check.streams) {
    const have = new Set(probe.streams.map((s) => s.codec_type));
    const missing = check.streams.filter((s) => !have.has(s));
    out.push({ name: `${name} streams`, ok: missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : [...have].sort().join("+") });
  }
  if (check.loudnessLufs) {
    const lufs = await integratedLoudness(check.file);
    out.push({ name: `${name} loudness`, ok: lufs !== null && inRange(lufs, check.loudnessLufs), detail: lufs === null ? "silent" : `${lufs.toFixed(1)} LUFS` });
  }
  if (check.frame) {
    const luma = await frameLuma(check.file, check.frame.at).catch((error: Error) => error);
    out.push(
      luma instanceof Error
        ? { name: `${name} frame ${check.frame.at}s`, ok: false, detail: luma.message }
        : { name: `${name} frame ${check.frame.at}s not black`, ok: luma >= check.frame.minLuma, detail: `mean luma ${luma}` },
    );
  }
  return out;
}
