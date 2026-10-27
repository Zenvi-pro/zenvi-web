import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addClip, addFile, createProject, defaultEffectJson, findProfile, ProjectDocument, type Project } from "@zenvi/engine";
import { createNodeHost } from "../host/node-host.js";
import { renderFrameImage } from "../render/render-frame.js";
import { renderProject } from "../render/render-project.js";
import { decodeRgba, makeTempDir, makeVideo, removeDir } from "../test-support/fixtures.js";

let dir: string | undefined;
afterEach(async () => {
  await removeDir(dir);
  dir = undefined;
});

/** A white disc (r = 30) moving right at 100 px/s from x = 60 over black, 320x240, 30 fps, 2 s. */
const DISC = "color=c=black:s=320x240:r=30:d=2,format=gray,geq=lum='if(lt(hypot(X-(60+100*T),Y-120),30),255,0)'";

function rgbAt(image: { width: number; data: ArrayLike<number> }, x: number, y: number): number[] {
  const i = (y * image.width + x) * 4;
  return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!];
}

/**
 * Two clips of the disc, both on screen at once and each cut out by a Mask
 * whose reader is the disc video itself: A from 0 s (disc at x = 110 at
 * t = 0.5) under B from 1 s (disc at x = 210 at t = 0.5).
 */
async function clonedDiscs(): Promise<{ project: Project; resolveMedia: (p: string) => string }> {
  dir = await makeTempDir("zenvi-sources-");
  const video = await makeVideo(dir, "disc.mp4", { width: 320, height: 240, duration: 2, source: DISC });
  const host = createNodeHost({ projectFile: path.join(dir, "disc.zvn") });
  const imported = await host.media!.importPath!(video);
  const profile = { ...findProfile("HD 720p 30 fps")!, width: 320, height: 240, display_ratio: { num: 4, den: 3 } };
  const doc = new ProjectDocument(createProject({ id: "DISCPROJ01", profile }));
  doc.transaction("fixture", (tx) => {
    addFile(tx, imported, { id: "DISCFILE01" });
    addClip(tx, { fileId: "DISCFILE01", position: 0, layer: 1_000_000, start: 0, end: 1, id: "DISCCLIPA1" });
    addClip(tx, { fileId: "DISCFILE01", position: 0, layer: 2_000_000, start: 1, end: 2, id: "DISCCLIPB1" });
  });
  const project = structuredClone(doc.project) as Project;
  const matte = project.files[0]!;
  project.clips.forEach((clip, i) => {
    clip.effects = [{ ...defaultEffectJson("Mask", `DISCMASK0${i}`), mask_reader: structuredClone(matte), mask_invert: true }];
  });
  return { project, resolveMedia: host.resolveMedia };
}

describe("SourceManager effect images", () => {
  it("gives each layer its own frame of a video mask that two layers read at once", async () => {
    const { project, resolveMedia } = await clonedDiscs();
    const frame = await renderFrameImage(project, 0.5, { resolveMedia });
    // Each clone's disc stays where its own source frame has it.
    for (const x of [110, 210]) for (const c of rgbAt(frame, x, 120)) expect(c).toBeGreaterThan(220);
    for (const c of rgbAt(frame, 160, 120)) expect(c).toBeLessThan(40);
  }, 60_000);

  it("does the same on composite workers, every frame", async () => {
    const { project, resolveMedia } = await clonedDiscs();
    const out = path.join(dir!, "pool", "f.png");
    const result = await renderProject(project, {
      resolveMedia,
      output: out,
      threads: 2,
      options: { format: "png-sequence", width: 320, height: 240, fps: { num: 30, den: 1 } },
    });
    expect(result.stats.threads).toBe(2);
    const names = (await readdir(path.dirname(out))).sort();
    expect(names.length).toBe(30);
    for (const i of [0, 15, 29]) {
      const data = await decodeRgba(path.join(path.dirname(out), names[i]!), { width: 320, height: 240 });
      const frame = { width: 320, data };
      for (const x of [60 + (100 * i) / 30, 160 + (100 * i) / 30]) for (const c of rgbAt(frame, Math.round(x), 120)) expect(c, `frame ${i + 1} x ${x}`).toBeGreaterThan(220);
    }
  }, 60_000);
});
