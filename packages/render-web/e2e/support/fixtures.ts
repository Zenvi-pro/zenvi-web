/**
 * Node side of the browser suite: generated media, the harness bundle, and a
 * request router that serves both (with HTTP range requests) to the page.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Page, Route } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
export const ORIGIN = "http://localhost:9";

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, encoding: "utf8" }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args.join(" ")}: ${stderr}`));
      else resolve();
    });
  });
}

/** 8 blocks across the picture; block b is white when bit b of the frame index is set. */
const CODES = "geq=lum='if(bitand(N\\,pow(2\\,trunc(X*8/W)))\\,235\\,16)':cb=128:cr=128";

/** A 440 Hz sine at amplitude 0.5. */
const TONE = "0.5*sin(2*PI*440*t)";

export interface Fixtures {
  dir: string;
  files: Map<string, Buffer>;
  bundle: string;
  hasH264: boolean;
  cleanup(): void;
}

export async function prepareFixtures(): Promise<Fixtures> {
  const dir = mkdtempSync(join(tmpdir(), "zenvi-render-web-e2e-"));
  const ff = (args: string[]) => run("ffmpeg", ["-v", "error", "-y", "-nostdin", ...args], dir);
  await Promise.all([
    ff(["-f", "lavfi", "-i", `color=c=black:s=160x90:r=30:d=2,format=yuv420p,${CODES}`, "-c:v", "libvpx-vp9", "-lossless", "1", "-g", "30", "codes.webm"]),
    ff(["-f", "lavfi", "-i", `color=c=black:s=160x90:r=25:d=2,format=yuv420p,${CODES}`, "-c:v", "libvpx-vp9", "-lossless", "1", "-g", "25", "codes25.webm"]),
    // One keyframe for the whole clip: scrubbing has to decode up to 2 s to be exact.
    ff(["-f", "lavfi", "-i", `color=c=black:s=160x90:r=30:d=2,format=yuv420p,${CODES}`, "-c:v", "libvpx-vp9", "-lossless", "1", "-g", "600", "codesgop.webm"]),
    // Two channels from the source itself: `-ac 2` would upmix at -3 dB.
    ff(["-f", "lavfi", "-i", `aevalsrc=${TONE}|${TONE}:s=48000:d=3`, "-c:a", "pcm_f32le", "tone48.wav"]),
    ff(["-f", "lavfi", "-i", `aevalsrc=${TONE}|${TONE}:s=44100:d=3`, "-c:a", "pcm_f32le", "tone44.wav"]),
    ff(["-f", "lavfi", "-i", "color=c=0xC83232:s=64x36", "-frames:v", "1", "still.png"]),
    // The QA repro: two VP9 + Opus clips with 440 Hz and 660 Hz tones.
    ff(["-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2", "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*440*t):s=48000:d=2", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-shortest", "tone440.webm"]),
    ff(["-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=2", "-f", "lavfi", "-i", "aevalsrc=0.3*sin(2*PI*660*t):s=48000:d=2", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-shortest", "tone660.webm"]),
    // A realistic clip for the performance check: 720p30 VP9, 3 s, keyframe every 2 s.
    ff(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30:d=3", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "2M", "-g", "60", "hd.webm"]),
    ff(["-f", "lavfi", "-i", "color=c=black:s=160x90,format=gray,geq=lum='if(gt(X\\,79)\\,255\\,0)'", "-frames:v", "1", "halfmask.png"]),
  ]);
  let hasH264 = true;
  try {
    await ff(["-f", "lavfi", "-i", `color=c=black:s=160x90:r=30:d=2,format=yuv420p,${CODES}`, "-c:v", "libx264", "-crf", "1", "-pix_fmt", "yuv420p", "-g", "30", "codes.mp4"]);
  } catch {
    hasH264 = false;
  }

  const files = new Map<string, Buffer>();
  for (const name of ["codes.webm", "codes25.webm", "codesgop.webm", "hd.webm", "tone440.webm", "tone660.webm", "tone48.wav", "tone44.wav", "still.png", "halfmask.png", ...(hasH264 ? ["codes.mp4"] : [])]) {
    files.set(name, readFileSync(join(dir, name)));
  }

  const result = await build({
    entryPoints: [join(here, "../harness/entry.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    sourcemap: "inline",
    logLevel: "error",
  });
  const bundle = result.outputFiles[0]!.text;
  return { dir, files, bundle, hasH264, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const TYPES: Record<string, string> = {
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".png": "image/png",
};

async function serveMedia(route: Route, fixtures: Fixtures, url: URL): Promise<void> {
  const name = decodeURIComponent(url.pathname.slice("/media/".length));
  const body = fixtures.files.get(name);
  if (!body) return route.fulfill({ status: 404, body: "not found" });
  // An expired signed URL, as Azure answers.
  if (url.searchParams.get("sig") === "old") return route.fulfill({ status: 403, body: "AuthenticationFailed" });
  const headers: Record<string, string> = { "content-type": TYPES[extname(name)] ?? "application/octet-stream", "accept-ranges": "bytes" };
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()["range"] ?? "");
  if (!range) return route.fulfill({ status: 200, headers: { ...headers, "content-length": String(body.length) }, body });
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  const chunk = body.subarray(start, end + 1);
  return route.fulfill({
    status: 206,
    headers: { ...headers, "content-range": `bytes ${start}-${end}/${body.length}`, "content-length": String(chunk.length) },
    body: chunk,
  });
}

/** Serve the harness page, its bundle and the fixtures at ORIGIN (a secure context). */
export async function attach(page: Page, fixtures: Fixtures): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      return route.fulfill({ status: 200, contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><title>render-web e2e</title><body><script type="module" src="/bundle.js"></script></body>' });
    }
    if (url.pathname === "/bundle.js") return route.fulfill({ status: 200, contentType: "text/javascript", body: fixtures.bundle });
    if (url.pathname.startsWith("/media/")) return serveMedia(route, fixtures, url);
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => "harness" in window);
}
