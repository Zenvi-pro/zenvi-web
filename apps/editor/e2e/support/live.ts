/** Shared by the live specs: what they watch for on the page, and the media they import. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** Requests that may fail without the editor being broken (analytics, aborted media previews). */
const NOISE = /sentry|google-analytics|googletagmanager|favicon|videos\.pexels\.com|cdn\.freesound\.org/;
const HANG_MS = 20_000;

export interface Watch {
  problems: string[];
  hanging(): string[];
}

export function watch(page: Page): Watch {
  const problems: string[] = [];
  const started = new Map<object, { at: number; url: string }>();
  page.on("pageerror", (e) => problems.push(`page error: ${String(e).slice(0, 300)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !NOISE.test(m.location().url ?? "")) problems.push(`console error: ${m.text().slice(0, 300)}`);
  });
  page.on("request", (r) => started.set(r, { at: Date.now(), url: r.url() }));
  page.on("requestfinished", (r) => started.delete(r));
  page.on("requestfailed", (r) => {
    started.delete(r);
    // ERR_ABORTED: the editor cancelled it (a search replaced by a newer one).
    const error = r.failure()?.errorText ?? "";
    if (!NOISE.test(r.url()) && !error.includes("ERR_ABORTED")) problems.push(`request failed: ${r.method()} ${r.url().slice(0, 160)} (${error})`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !NOISE.test(r.url())) problems.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url().slice(0, 160)}`);
  });
  return {
    problems,
    hanging: () => [...started.values()].filter((s) => Date.now() - s.at > HANG_MS && !NOISE.test(s.url)).map((s) => `hanging ${Math.round((Date.now() - s.at) / 1000)} s: ${s.url.slice(0, 160)}`),
  };
}

/** A 4 s 9:16 test pattern with a tone, made with ffmpeg; null without ffmpeg. */
export function videoFixture(prefix: string): { dir: string; video: string } | null {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const video = join(dir, "smoke.webm");
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=540x960:r=30:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libvpx-vp9", "-b:v", "400k", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-shortest", video]);
    return { dir, video };
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
}
