/**
 * Tool truth fixtures: tiny lavfi media (320×180, 1 s) generated once per
 * machine into a shared cache folder and reused by every shard. Each file is
 * written under a unique temp name and renamed into place, so parallel
 * workers never read a half-written fixture.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveBinary } from "../ffmpeg/binaries.js";

const exec = promisify(execFile);

/** Bump when a recipe changes so stale caches are not reused. */
export const FIXTURE_WIDTH = 320;
export const FIXTURE_HEIGHT = 180;
export const FIXTURE_SECONDS = 1;
/** Frames are composited at the fixtures' own size: effects scale their radii by frame height, as libopenshot does. */
export const RENDER_WIDTH = 320;

const SIZE = `${FIXTURE_WIDTH}x${FIXTURE_HEIGHT}`;
const D = FIXTURE_SECONDS;
const H264 = ["-c:v", "libx264", "-preset", "ultrafast", "-qp", "8", "-pix_fmt", "yuv420p"];

/** ffmpeg arguments (after the inputs' -f lavfi) for every fixture. */
const RECIPES = {
  /** testsrc2 colour bars and motion, a stereo 440 Hz tone (the left channel louder, so pan and channel tools show). */
  "bars.mp4": [
    "-f", "lavfi", "-i", `testsrc2=size=${SIZE}:rate=30:duration=${D}`,
    "-f", "lavfi", "-i", `aevalsrc=0.3*sin(2*PI*440*t)|0.2*sin(2*PI*440*t):s=48000:d=${D}`,
    ...H264, "-c:a", "aac", "-b:a", "192k", "-shortest",
  ],
  /** A second shot (different picture and pitch) for transitions and multi-clip tools. */
  "rings.mp4": [
    "-f", "lavfi", "-i", `nullsrc=s=${SIZE}:r=30:d=${D},geq=r='128+100*sin(hypot(X-160,Y-90)/6)':g='60+40*cos(X/9)':b='200-Y/2'`,
    "-f", "lavfi", "-i", `aevalsrc=0.25*sin(2*PI*660*t)|0.25*sin(2*PI*660*t):s=48000:d=${D}`,
    ...H264, "-c:a", "aac", "-b:a", "192k", "-shortest",
  ],
  /** A red disc on unevenly lit studio green (brighter left to right): keying methods differ on the falloff. */
  "green.mp4": [
    "-f", "lavfi", "-i", `nullsrc=s=${SIZE}:r=30:d=${D},geq=r='if(lte(hypot(X-160,Y-90),50),220,10+X/8)':g='if(lte(hypot(X-160,Y-90),50),30,110+X/2.5)':b='if(lte(hypot(X-160,Y-90),50),40,20+X/10)'`,
    ...H264,
  ],
  /** A small portrait shot (96×128): scale modes and gravity show around it. */
  "small.mp4": ["-f", "lavfi", "-i", `testsrc2=size=96x128:rate=30:duration=${D}`, ...H264],
  /** Mid-grey with a horizontal ramp: colour grades move it predictably. */
  "ramp.mp4": [
    "-f", "lavfi", "-i", `nullsrc=s=${SIZE}:r=30:d=${D},geq=r='40+X/2':g='60+X/2.2':b='80+X/2.5'`,
    ...H264,
  ],
  /** A white disc on a transparent ground: shadows, glows and outlines draw around its alpha edge. */
  "disc.png": [
    "-f", "lavfi", "-i", `color=c=black@0:s=${SIZE},format=rgba,geq=r='230':g='230':b='230':a='if(lte(hypot(X-160,Y-90),45),255,0)'`,
    "-frames:v", "1",
  ],
  /** testsrc2 over four clicks: what beat- and audio-driven effects react to. */
  "beat.mp4": [
    "-f", "lavfi", "-i", `testsrc2=size=${SIZE}:rate=30:duration=${D}`,
    "-f", "lavfi", "-i", `aevalsrc='0.9*exp(-60*mod(t,0.25))*sin(2*PI*120*t)+0.3*exp(-300*mod(t,0.25))*sin(2*PI*4000*t)':s=48000:d=${D}`,
    ...H264, "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-shortest",
  ],
  /** Stereo pink noise (broadband, so EQ and filters show in the spectrum). */
  "noise.wav": ["-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.25:sample_rate=48000:duration=${D}:seed=7`, "-ac", "2", "-c:a", "pcm_s16le"],
  /** Four clicks on a quiet tone: onsets for timing tools. */
  "clicks.wav": [
    "-f", "lavfi", "-i", `aevalsrc='0.05*sin(2*PI*220*t)+0.8*exp(-400*mod(t,0.25))*sin(2*PI*2000*t)':s=48000:d=${D}`,
    "-ac", "2", "-c:a", "pcm_s16le",
  ],
} as const satisfies Record<string, readonly string[]>;

export type FixtureName = keyof typeof RECIPES;
/** Names the cache folder: editing a recipe can never reuse a fixture made by the old one. */
const RECIPES_HASH = createHash("sha256").update(JSON.stringify(RECIPES)).digest("hex").slice(0, 12);
export const FIXTURE_NAMES = Object.keys(RECIPES) as FixtureName[];

export function fixtureCacheDir(): string {
  return process.env.ZENVI_TOOL_TRUTH_CACHE ?? path.join(tmpdir(), `zenvi-tool-truth-${RECIPES_HASH}`);
}

/** Where a fixture lives once generated (arguments that name a file, like an effect's mask reader). */
export function fixturePath(name: FixtureName): string {
  return path.join(fixtureCacheDir(), name);
}

const pending = new Map<FixtureName, Promise<string>>();

/** Path of a fixture, generating it the first time any worker asks. */
export function fixture(name: FixtureName): Promise<string> {
  let job = pending.get(name);
  if (!job) {
    job = generate(name);
    pending.set(name, job);
  }
  return job;
}

async function generate(name: FixtureName): Promise<string> {
  const dir = fixtureCacheDir();
  const out = fixturePath(name);
  if (existsSync(out)) return out;
  await mkdir(dir, { recursive: true });
  const part = path.join(dir, `.${process.pid}-${Math.random().toString(36).slice(2)}-${name}`);
  try {
    await exec(resolveBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...RECIPES[name], part], { maxBuffer: 8 * 1024 * 1024 });
    await rename(part, out);
  } finally {
    await rm(part, { force: true });
  }
  return out;
}
