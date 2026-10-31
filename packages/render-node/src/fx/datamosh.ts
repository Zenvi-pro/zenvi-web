/**
 * Host half of the datamosh carry (`datamosh_carry`, engine/src/fx): decodes
 * the last frames of the footage before the cut, measures their motion with
 * the engine's `estimateFlow`, and writes the per-frame displace maps and
 * the footage's last frame where the filtergraph reads them (`[1:v]` x maps,
 * `[2:v]` y maps, `[3:v]` the last frame). The caller adds `args` after the
 * main `-i` and calls `dispose` when ffmpeg is done.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { estimateFlow, flowSpeed, FLOW_ANALYSIS_WIDTH, FLOW_FRAMES, moshFrameCount, moshMaps, type FxEffect, type GrayFrame } from "@zenvi/engine";
import { runBinary } from "../ffmpeg/process.js";
import { probeFxSource, type FxSourceInfo } from "./render.js";

export interface CarryInputs {
  /** ffmpeg input arguments for the three extra inputs (after the main `-i`). */
  args: string[];
  /** Frames the mosh lasts. */
  frames: number;
  /** Mean motion measured in the footage before the cut, in frame widths per second (0 = it was still). */
  speed: number;
  dispose(): Promise<void>;
}

export interface CarryRequest {
  ffmpeg: string;
  ffprobe: string;
  /** The footage before the cut (a local file) and the second it ends at. */
  source: string;
  at: number;
  effect: FxEffect<"datamosh_carry">;
  /** The clip being moshed: its size, rate and rendered length. */
  target: Pick<FxSourceInfo, "width" | "height" | "fps">;
  duration: number;
  signal?: AbortSignal;
}

export async function prepareCarry(request: CarryRequest): Promise<CarryInputs | null> {
  const { target, effect } = request;
  const frames = moshFrameCount(effect.params.length, target.fps, request.duration);
  if (frames < 1) return null;
  const before = await probeFxSource(request.ffprobe, request.source, request.signal);
  const fps = before.fps.num / before.fps.den;
  const aw = FLOW_ANALYSIS_WIDTH;
  const ah = Math.max(16, 2 * Math.round(((aw * before.height) / before.width) / 2));
  // A few more frames than the flow needs: seeking lands near the asked second.
  if (request.at * fps < 2) throw new Error(`the footage before the cut ends at ${request.at}s, less than two frames in: there is no motion to carry.`);
  const from = Math.max(0, request.at - (FLOW_FRAMES + 3) / fps);
  const window = ["-ss", String(from), "-t", String(Math.max(2 / fps, request.at - from))];
  const raw = await runBinary(request.ffmpeg, ["-hide_banner", "-nostdin", "-v", "error", ...window, "-i", request.source, "-an", "-vf", `scale=${aw}:${ah}:flags=area,format=gray`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
    signal: request.signal,
    what: "ffmpeg (datamosh flow)",
    maxStdout: 64 * 1024 * 1024,
  });
  const size = aw * ah;
  const count = Math.floor(raw.stdout.length / size);
  if (count < 2) throw new Error(`the footage before the cut has only ${count} frame(s) ending at ${request.at}s; datamosh needs the clip before it to be playing there.`);
  const grays: GrayFrame[] = [];
  for (let i = Math.max(0, count - FLOW_FRAMES); i < count; i++) grays.push({ width: aw, height: ah, data: new Uint8Array(raw.stdout.buffer, raw.stdout.byteOffset + i * size, size) });
  const flow = estimateFlow(grays);
  const k = Math.min(target.width, target.height) / 1080;
  const maps = moshMaps(flow, { width: target.width, height: target.height }, { frames, block: effect.params.block * k, amount: effect.amount });

  const dir = await mkdtemp(path.join(tmpdir(), "zenvi-mosh-"));
  try {
    await mkdir(dir, { recursive: true });
    const head = Buffer.from(`P5\n${maps.cols} ${maps.rows}\n255\n`, "ascii");
    for (let n = 0; n < frames; n++) {
      const name = String(n + 1).padStart(4, "0");
      await writeFile(path.join(dir, `x_${name}.pgm`), Buffer.concat([head, maps.x[n]!]));
      await writeFile(path.join(dir, `y_${name}.pgm`), Buffer.concat([head, maps.y[n]!]));
    }
    const last = path.join(dir, "last.png");
    await runBinary(request.ffmpeg, ["-hide_banner", "-nostdin", "-v", "error", "-y", ...window, "-i", request.source, "-an", "-vf", `select=eq(n\\,${count - 1})`, "-fps_mode", "passthrough", "-frames:v", "1", last], {
      signal: request.signal,
      what: "ffmpeg (datamosh last frame)",
    });
    const rate = `${target.fps.num}/${target.fps.den}`;
    const seconds = String((frames * target.fps.den) / target.fps.num);
    return {
      args: ["-framerate", rate, "-i", path.join(dir, "x_%04d.pgm"), "-framerate", rate, "-i", path.join(dir, "y_%04d.pgm"), "-loop", "1", "-framerate", rate, "-t", seconds, "-i", last],
      frames,
      speed: flowSpeed(flow) / aw * fps,
      dispose: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
