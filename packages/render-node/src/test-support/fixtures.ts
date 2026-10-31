/**
 * Test fixtures: small media generated with ffmpeg into unique temp dirs.
 * Shared by render-node and CLI tests (exported as
 * `@zenvi/render-node/test-support`). Never used at runtime.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveBinary } from "../ffmpeg/binaries.js";

const exec = promisify(execFile);

export async function makeTempDir(prefix = "zenvi-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function removeDir(dir: string | undefined): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true });
}

async function ffmpeg(args: string[]): Promise<void> {
  await exec(resolveBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...args], { maxBuffer: 8 * 1024 * 1024 });
}

export interface VideoFixture {
  width?: number;
  height?: number;
  /** "30", "30000/1001" … */
  fps?: string;
  duration?: number;
  /** Add a sine tone (Hz). */
  audioHz?: number;
  audioRate?: number;
  /** lavfi source; default testsrc2. */
  source?: string;
  /** Extra output args, e.g. ["-c:v", "libvpx-vp9"]. */
  codecArgs?: string[];
}

export async function makeVideo(dir: string, name: string, opts: VideoFixture = {}): Promise<string> {
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, name);
  const w = opts.width ?? 320;
  const h = opts.height ?? 240;
  const fps = opts.fps ?? "30";
  const duration = opts.duration ?? 2;
  const source = opts.source ?? `testsrc2=size=${w}x${h}:rate=${fps}:duration=${duration}`;
  const args = ["-f", "lavfi", "-i", source];
  if (opts.audioHz) {
    args.push("-f", "lavfi", "-i", `sine=frequency=${opts.audioHz}:sample_rate=${opts.audioRate ?? 48000}:duration=${duration}`);
  }
  const ext = path.extname(name).toLowerCase();
  const codec =
    opts.codecArgs ??
    (ext === ".webm"
      ? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "40", "-deadline", "realtime", "-cpu-used", "8", ...(opts.audioHz ? ["-c:a", "libopus"] : [])]
      : ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", ...(opts.audioHz ? ["-c:a", "aac"] : [])]);
  await ffmpeg([...args, ...codec, ...(opts.audioHz ? ["-shortest"] : []), out]);
  return out;
}

export interface AudioFixture {
  hz?: number;
  duration?: number;
  sampleRate?: number;
  channels?: 1 | 2;
  /** Linear amplitude 0..1 of the sine (default ffmpeg sine amplitude 1/8). */
  amplitude?: number;
}

export async function makeAudio(dir: string, name: string, opts: AudioFixture = {}): Promise<string> {
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, name);
  const hz = opts.hz ?? 1000;
  const duration = opts.duration ?? 2;
  const rate = opts.sampleRate ?? 48000;
  const amp = opts.amplitude;
  const source =
    amp !== undefined
      ? `aevalsrc=${amp}*sin(2*PI*${hz}*t):s=${rate}:d=${duration}`
      : `sine=frequency=${hz}:sample_rate=${rate}:duration=${duration}`;
  const ext = path.extname(name).toLowerCase();
  const codec = ext === ".mp3" ? ["-c:a", "libmp3lame", "-b:a", "128k"] : ext === ".wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac"];
  await ffmpeg(["-f", "lavfi", "-i", source, "-ac", String(opts.channels ?? 1), ...codec, out]);
  return out;
}

/** A solid color (or test pattern) still image. */
export async function makeImage(dir: string, name: string, opts: { width?: number; height?: number; color?: string } = {}): Promise<string> {
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, name);
  const w = opts.width ?? 64;
  const h = opts.height ?? 48;
  const source = opts.color ? `color=c=${opts.color}:s=${w}x${h}` : `testsrc2=size=${w}x${h}`;
  await ffmpeg(["-f", "lavfi", "-i", source, "-frames:v", "1", out]);
  return out;
}

/**
 * Spoken `text` as 16 kHz mono WAV from the system's text-to-speech (`say`
 * on macOS, `espeak-ng` elsewhere), or undefined where there is none: speech
 * recognition tests skip then. Silence of `padSeconds` goes before the voice.
 */
export async function makeSpeech(dir: string, name: string, text: string, opts: { padSeconds?: number } = {}): Promise<string | undefined> {
  await mkdir(dir, { recursive: true });
  const raw = path.join(dir, `${name}.raw${process.platform === "darwin" ? ".aiff" : ".wav"}`);
  try {
    if (process.platform === "darwin") await exec("say", ["-o", raw, text]);
    else await exec("espeak-ng", ["-w", raw, text]);
  } catch {
    return undefined;
  }
  const out = path.join(dir, name);
  const pad = opts.padSeconds ?? 0;
  const delay = pad > 0 ? ["-af", `adelay=${Math.round(pad * 1000)}:all=1`] : [];
  await ffmpeg(["-i", raw, ...delay, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out]);
  return out;
}

export async function writeText(dir: string, name: string, text: string): Promise<string> {
  const out = path.join(dir, name);
  await writeFile(out, text);
  return out;
}

/** Decode one frame of any media to raw RGBA at its own size (for assertions). */
export async function decodeRgba(file: string, opts: { seconds?: number; width: number; height: number }): Promise<Uint8Array> {
  const { stdout } = await exec(
    resolveBinary("ffmpeg"),
    [
      "-hide_banner", "-loglevel", "error",
      ...(opts.seconds ? ["-ss", String(opts.seconds)] : []),
      "-i", file, "-frames:v", "1",
      "-vf", `scale=${opts.width}:${opts.height}:flags=bicubic`,
      "-f", "rawvideo", "-pix_fmt", "rgba", "-",
    ],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
  );
  return new Uint8Array(stdout);
}

/** ffprobe JSON of a produced file. */
export async function ffprobeJson(file: string): Promise<{ streams: Array<Record<string, unknown>>; format: Record<string, unknown> }> {
  const { stdout } = await exec(resolveBinary("ffprobe"), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  return JSON.parse(stdout) as { streams: Array<Record<string, unknown>>; format: Record<string, unknown> };
}

/** Linear RMS of a file's audio over all channels (ffmpeg astats "Overall"), or of one channel. */
export async function audioRms(file: string, range?: { start: number; duration: number }, channel?: number): Promise<number> {
  const seek = range ? ["-ss", String(range.start), "-t", String(range.duration)] : [];
  const pick = channel !== undefined ? `pan=mono|c0=c${channel},` : "";
  const { stderr } = await exec(
    resolveBinary("ffmpeg"),
    ["-hide_banner", "-nostats", ...seek, "-i", file, "-vn", "-af", `${pick}astats=measure_perchannel=none`, "-f", "null", "-"],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const matches = [...stderr.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)];
  const last = matches[matches.length - 1]?.[1];
  if (!last || last === "-inf") return 0;
  return 10 ** (Number(last) / 20);
}

// ---------------------------------------------------------------------------
// libopenshot oracle (maintainer machines only; CI skips)
// ---------------------------------------------------------------------------

function libopenshotPython(): { python: string; env: NodeJS.ProcessEnv } | undefined {
  const home = homedir();
  const python = process.env.ZENVI_LIBOPENSHOT_PYTHON ?? path.join(home, "Projects", "zenvi", ".venv", "bin", "python");
  const deps = process.env.ZENVI_LIBOPENSHOT_DEPS ?? path.join(home, "zenvi-deps-1.0");
  if (!existsSync(python) || !existsSync(path.join(deps, "python"))) return undefined;
  return {
    python,
    env: { ...process.env, PYTHONPATH: path.join(deps, "python"), DYLD_LIBRARY_PATH: path.join(deps, "lib") },
  };
}

const ORACLE = `
import json, sys, openshot
out = {}
for p in sys.argv[1:]:
    try:
        r = openshot.Clip.CreateReader(p, False)
        try:
            r.Open()
        except Exception:
            r = openshot.Clip.CreateReader(p, True)
            r.Open()
        out[p] = json.loads(r.Json())
        r.Close()
    except Exception as e:
        out[p] = {"error": str(e)}
print(json.dumps(out))
`;

/** Reader JSON libopenshot produces for each file, or undefined when the bindings are unavailable. */
export async function libopenshotReaderJson(files: string[]): Promise<Record<string, Record<string, unknown>> | undefined> {
  const py = libopenshotPython();
  if (!py) return undefined;
  try {
    const { stdout } = await exec(py.python, ["-c", ORACLE, ...files], { env: py.env, maxBuffer: 16 * 1024 * 1024 });
    const line = stdout.trim().split(/\r?\n/).pop() ?? "{}";
    return JSON.parse(line) as Record<string, Record<string, unknown>>;
  } catch {
    return undefined;
  }
}

const TIMELINE_ORACLE = `
import json, sys, openshot
project_file, out_dir, high_quality = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
frames = [int(f) for f in sys.argv[4:]]
openshot.Settings.Instance().HIGH_QUALITY_SCALING = high_quality
with open(project_file) as f:
    project = json.load(f)
t = openshot.Timeline(project["width"], project["height"], openshot.Fraction(project["fps"]["num"], project["fps"]["den"]),
                      project["sample_rate"], project["channels"], project["channel_layout"])
t.SetJson(json.dumps(project))
t.Open()
for n in frames:
    t.GetFrame(n).Save("%s/frame-%d.png" % (out_dir, n), 1.0)
t.Close()
print("ok")
`;

/**
 * Timeline frames rendered by libopenshot's own Timeline (the desktop's
 * renderer) from an in-memory project with absolute media paths, as RGBA;
 * undefined when the bindings are unavailable. `highQuality` is the
 * desktop's export setting (SWS_BICUBIC decode scaling).
 */
export async function libopenshotTimelineFrames(
  project: { width: number; height: number },
  frames: number[],
  options: { highQuality?: boolean } = {},
): Promise<Map<number, { width: number; height: number; data: Uint8Array }> | undefined> {
  const py = libopenshotPython();
  if (!py) return undefined;
  const dir = await makeTempDir("zenvi-libopenshot-");
  try {
    const projectFile = path.join(dir, "project.json");
    await writeFile(projectFile, JSON.stringify(project));
    await exec(py.python, ["-c", TIMELINE_ORACLE, projectFile, dir, options.highQuality ? "1" : "0", ...frames.map(String)], {
      env: py.env,
      maxBuffer: 16 * 1024 * 1024,
    });
    const out = new Map<number, { width: number; height: number; data: Uint8Array }>();
    const { width, height } = project;
    for (const n of frames) out.set(n, { width, height, data: await decodeRgba(path.join(dir, `frame-${n}.png`), { width, height }) });
    return out;
  } finally {
    await removeDir(dir);
  }
}

