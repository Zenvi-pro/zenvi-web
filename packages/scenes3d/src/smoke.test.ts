/**
 * Real renders: three frames of a scene at a tiny size through Blender and
 * ffmpeg. Skipped when Blender is not installed (CI has none).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
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

  /** Share of the safe width (9:16: 88 %) and centre height of the alpha's bounding box on one frame. */
  function inkBox(file: string, frame: number, width: number, height: number): { share: number; cy: number } {
    const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-vf", `select=eq(n\\,${frame}),alphaextract,bbox=min_val=100`, "-f", "null", "-"], { encoding: "utf8" });
    const box = /x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(stderr);
    if (!box) throw new Error(`no ink on frame ${frame}`);
    const [x1, x2, y1, y2] = box.slice(1).map(Number) as [number, number, number, number];
    return { share: (x2 - x1 + 1) / (0.88 * width), cy: (y1 + y2) / 2 / height };
  }

  it("imports a glTF model made with Blender primitives, stands it up and frames it; refuses a file it cannot read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-smoke-"));
    const model = path.join(root, "monkey.glb");
    execFileSync(blender!, ["-b", "--factory-startup", "--python-expr", `import bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.mesh.primitive_monkey_add()\nbpy.ops.export_scene.gltf(filepath=${JSON.stringify(model)}, export_format="GLB")`], { stdio: "ignore" });
    const broken = path.join(root, "broken.fbx");
    await writeFile(broken, "; FBX 7.4.0 project file\n");
    const renderer = createScene3dRenderer({ blender: blender!, cacheDir: root, tempDir: root, resolveMedia: (p) => p });
    try {
      const parsed = parseScene3dParams("model_showcase", { model, shadow: false, turn_degrees: 0 });
      if (!parsed.ok) throw new Error(parsed.error);
      const r = await renderer.render({ scene: "model_showcase", params: parsed.params, files: { model }, width: 216, height: 384, fps: { num: 30, den: 1 }, frames: 3, quality: "draft", media: {} });
      expect(r.codec).toBe("prores4444");
      // Turntable framing: the model's turning circle spans size (0.7) of the safe width, so the head itself a little less.
      const { share } = inkBox(r.path, 2, r.width, r.height);
      expect(share).toBeGreaterThan(0.45);
      expect(share).toBeLessThan(0.75);
      const bad = parseScene3dParams("model_showcase", { model: broken });
      if (!bad.ok) throw new Error(bad.error);
      await expect(renderer.render({ scene: "model_showcase", params: bad.params, files: { model: broken }, width: 64, height: 64, fps: { num: 30, den: 1 }, frames: 2, quality: "draft", media: {} })).rejects.toThrow(/Blender could not import broken\.fbx/);
      // No file: the generic product renders, standing on its floor.
      const product = parseScene3dParams("model_showcase", { product: "speaker", background: "light" });
      if (!product.ok) throw new Error(product.error);
      const p = await renderer.render({ scene: "model_showcase", params: product.params, width: 96, height: 96, fps: { num: 30, den: 1 }, frames: 2, quality: "draft", media: {} });
      expect(p.codec).toBe("h264");
      await expect(renderer.render({ scene: "model_showcase", params: bad.params, files: { model: path.join(root, "gone.glb") }, width: 64, height: 64, fps: { num: 30, den: 1 }, frames: 2, quality: "draft", media: {} })).rejects.toThrow(/does not exist/);
    } finally {
      renderer.close();
    }
  });

  it("extrudes an SVG logo that settles at 50-70 % of the safe width", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-smoke-"));
    const svg = path.join(root, "mark.svg");
    await writeFile(svg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><circle cx="50" cy="50" r="45" fill="#FF5A36"/><rect x="110" y="5" width="85" height="90" rx="12" fill="#2F6BFF"/></svg>`);
    const renderer = createScene3dRenderer({ blender: blender!, cacheDir: root, tempDir: root, resolveMedia: (p) => p });
    try {
      const parsed = parseScene3dParams("logo_extrude", { svg, style: "original", shadow: false });
      if (!parsed.ok) throw new Error(parsed.error);
      // 45 frames: landed (1 s) and settled (0.25 s) before the last one.
      const r = await renderer.render({ scene: "logo_extrude", params: parsed.params, files: { svg }, width: 216, height: 384, fps: { num: 30, den: 1 }, frames: 45, quality: "draft", media: {} });
      const { share, cy } = inkBox(r.path, 44, r.width, r.height);
      expect(share).toBeGreaterThan(0.5);
      expect(share).toBeLessThan(0.7);
      expect(cy).toBeGreaterThan(0.36);
      expect(cy).toBeLessThan(0.48);
    } finally {
      renderer.close();
    }
  });
});

describe.skipIf(!blender || !hasFfmpeg)("Blender smoke: terrain_glide", () => {
  /** Mean RGB of the bottom-centre of one frame (the ground just ahead of the camera). */
  function groundColour(file: string, frame: number): [number, number, number] {
    const out = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${frame}),crop=iw/3:ih/4:iw/3:ih*3/4,scale=1:1:flags=area`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    return [out[0]!, out[1]!, out[2]!];
  }

  it("the field runs past the end of the fastest, longest glide (180 m), so the ground never gives way to sky", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zenvi-scenes3d-smoke-"));
    const renderer = createScene3dRenderer({ blender: blender!, cacheDir: root, tempDir: root, resolveMedia: (p) => p });
    try {
      const parsed = parseScene3dParams("terrain_glide", { surface: "sand", speed: 12, haze: 0 });
      if (!parsed.ok) throw new Error(parsed.error);
      // 4 fps: 60 frames are a 15 s glide.
      const r = await renderer.render({ scene: "terrain_glide", params: parsed.params, width: 192, height: 108, fps: { num: 4, den: 1 }, frames: 60, quality: "draft", media: {} });
      const [red, , blue] = groundColour(r.path, 59);
      expect(red - blue, "warm sand, not the blue-grey sky").toBeGreaterThan(20);
    } finally {
      renderer.close();
    }
  });
});
