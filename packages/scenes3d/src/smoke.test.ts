/**
 * Real renders: three frames of a scene at a tiny size through Blender and
 * ffmpeg. Skipped when Blender is not installed (CI has none).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseScene3dParams, type Scene3dId } from "@zenvi/engine";
import { findBlender } from "./blender.js";
import { createScene3dRenderer } from "./renderer.js";

const blender = findBlender();
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-hide_banner", "-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function probe(file: string): { pix_fmt: string; width: number; height: number; nb_frames: string } {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,width,height,nb_frames", "-of", "json", file], { encoding: "utf8" });
  return (JSON.parse(out) as { streams: { pix_fmt: string; width: number; height: number; nb_frames: string }[] }).streams[0]!;
}

describe.skipIf(!blender || !hasFfmpeg)("Blender smoke", () => {
  it("renders a transparent title to ProRes 4444 and serves the same request from the cache", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-smoke-"));
    const renderer = createScene3dRenderer({ blender: blender!, cacheDir: root, tempDir: root, resolveMedia: (p) => p });
    try {
      const parsed = parseScene3dParams("title_3d", { text: "Hi" });
      if (!parsed.ok) throw new Error(parsed.error);
      const request = { scene: "title_3d" as Scene3dId, params: parsed.params, width: 128, height: 224, fps: { num: 30, den: 1 }, frames: 3, quality: "draft" as const, media: {} };
      const first = await renderer.render(request);
      expect(first).toMatchObject({ codec: "prores4444", width: 64, height: 112, frames: 3, cached: false });
      expect(existsSync(first.path)).toBe(true);
      expect(probe(first.path)).toMatchObject({ pix_fmt: expect.stringMatching(/^yuva444p1[02]le$/), width: 64, height: 112 });
      const again = await renderer.render(request);
      expect(again).toMatchObject({ path: first.path, cached: true, fingerprint: first.fingerprint });
    } finally {
      renderer.close();
    }
  });

  it("frames a vertical title at ~2/3 of the safe width, a little above the middle of the safe area", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-smoke-"));
    const renderer = createScene3dRenderer({ blender: blender!, cacheDir: root, tempDir: root, resolveMedia: (p) => p });
    try {
      const parsed = parseScene3dParams("title_3d", { text: "ZENVI", shadow: false });
      if (!parsed.ok) throw new Error(parsed.error);
      // 40 frames: the letters have landed (tumble ends ~frame 32) before the last one.
      const r = await renderer.render({ scene: "title_3d", params: parsed.params, width: 216, height: 384, fps: { num: 30, den: 1 }, frames: 40, quality: "draft", media: {} });
      const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-i", r.path, "-vf", "select=eq(n\\,39),alphaextract,bbox=min_val=100", "-f", "null", "-"], { encoding: "utf8" });
      const box = /x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(stderr);
      expect(box).not.toBeNull();
      const [x1, x2, y1, y2] = box!.slice(1).map(Number) as [number, number, number, number];
      // Safe width on 9:16: 88 % of the frame (camera.safe_area); default size 0.66.
      const share = (x2 - x1 + 1) / (0.88 * r.width);
      expect(share).toBeGreaterThan(0.63);
      expect(share).toBeLessThan(0.74);
      const cy = (y1 + y2) / 2 / r.height;
      expect(cy).toBeGreaterThan(0.38);
      expect(cy).toBeLessThan(0.46);
      expect(y1 / r.height).toBeGreaterThan(0.12);
    } finally {
      renderer.close();
    }
  });

  it("renders an opaque scene over its backdrop as H.264", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-smoke-"));
    const renderer = createScene3dRenderer({ blender: blender!, cacheDir: root, tempDir: root, resolveMedia: (p) => p });
    try {
      const parsed = parseScene3dParams("particle_burst", { background: "dark", count: 20 });
      if (!parsed.ok) throw new Error(parsed.error);
      const r = await renderer.render({ scene: "particle_burst", params: parsed.params, width: 96, height: 96, fps: { num: 30, den: 1 }, frames: 3, quality: "final", media: {} });
      expect(r.codec).toBe("h264");
      expect(probe(r.path)).toMatchObject({ pix_fmt: "yuv420p", width: 96, height: 96 });
    } finally {
      renderer.close();
    }
  });
});
