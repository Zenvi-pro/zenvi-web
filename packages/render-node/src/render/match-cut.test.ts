/**
 * Match-cut alignment end to end on real footage: ffmpeg draws discs at
 * different places and sizes, detect_subject_tool finds them in frames this
 * host renders, align_match_cut_tool writes the keyframes, and the frames
 * the renderer composites show every disc at the same place and size on
 * every cut (±2 px).
 */

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { addClip, addFile, createProject, ProjectDocument, type Project, type RgbaImage } from "@zenvi/engine";
import { runTool } from "@zenvi/engine/tools";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveBinary } from "../ffmpeg/binaries.js";
import { createNodeHost } from "../host/node-host.js";
import { probe } from "../probe/probe.js";
import { makeTempDir, removeDir } from "../test-support/fixtures.js";
import { renderFrameImage } from "./render-frame.js";

const exec = promisify(execFile);
const W = 1280;
const H = 720;
/** Disc centre and radius in source pixels; the sources are 1280×720 and 960×720 (a different aspect). */
const DISCS = [
  { name: "a.mp4", w: 1280, x: 640, y: 360, r: 150 },
  { name: "b.mp4", w: 1280, x: 420, y: 250, r: 90 },
  { name: "c.mp4", w: 960, x: 480, y: 380, r: 110 },
  { name: "d.mp4", w: 1280, x: 760, y: 330, r: 64 },
];
const SHOT_FRAMES = 6;

let dir: string;

/** A bright disc on a dark, finely textured ground (so the frame has edges that are not the subject). */
async function discVideo(file: string, d: (typeof DISCS)[number]): Promise<void> {
  const lum = `if(lte(hypot(X+0.5-${d.x},Y+0.5-${d.y}),${d.r}),225,40+mod(X*7+Y*13,11))`;
  await exec(resolveBinary("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `nullsrc=s=${d.w}x720:r=30:d=2,geq=lum='${lum}':cb=128:cr=128`,
    "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", "-pix_fmt", "yuv420p", file,
  ]);
}

/** Centre and radius of the bright disc: centroid and area of pixels above the ground, partial pixels in proportion. */
function measure(image: RgbaImage): { x: number; y: number; r: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const w = Math.min(1, Math.max(0, (image.data[(y * image.width + x) * 4]! - 70) / (240 - 70)));
      n += w;
      sx += w * (x + 0.5);
      sy += w * (y + 0.5);
    }
  }
  return { x: sx / n, y: sy / n, r: Math.sqrt(n / Math.PI) };
}

beforeAll(async () => {
  dir = await makeTempDir("zenvi-matchcut-");
  await Promise.all(DISCS.map((d) => discVideo(path.join(dir, d.name), d)));
}, 60_000);

afterAll(async () => {
  await removeDir(dir);
});

async function project(): Promise<Project> {
  const doc = new ProjectDocument({ ...createProject({ id: "MATCHCUTE2" }), width: W, height: H });
  const infos = await Promise.all(DISCS.map((d) => probe(path.join(dir, d.name))));
  doc.transaction("fixture", (tx) => {
    DISCS.forEach((d, i) => {
      addFile(tx, { path: path.join(dir, d.name), info: infos[i]! }, { id: `F${i}` });
      addClip(tx, { fileId: `F${i}`, position: (i * SHOT_FRAMES) / 30, layer: tx.project.layers[0]!.number, start: 0.5, end: 0.5 + SHOT_FRAMES / 30, id: `C${i}` });
    });
  });
  return { ...doc.project, history: { undo: [], redo: [] } };
}

describe("match cuts on ffmpeg footage", () => {
  it("detects every disc and aligns them on each cut frame to ±2 px", async () => {
    const doc = new ProjectDocument(await project());
    const host = createNodeHost();
    const boxes = [];
    for (let i = 0; i < DISCS.length; i += 1) {
      const found = await runTool({ doc, host }, "detect_subject_tool", { clip_id: `C${i}` });
      const best = (found.data?.data as { subjects: { box: { x: number; y: number; w: number; h: number }; center: { x: number; y: number } }[] }).subjects[0]!;
      const d = DISCS[i]!;
      expect(Math.abs(best.center.x * d.w - d.x), d.name).toBeLessThan(2);
      expect(Math.abs(best.center.y * 720 - d.y), d.name).toBeLessThan(2);
      boxes.push(best.box);
    }
    const aligned = await runTool({ doc, host }, "align_match_cut_tool", {
      clips: boxes.map((box, i) => ({ clip_id: `C${i}`, box })),
      target: { x: 0.5, y: 0.5, size: 0.45 },
      zoom_drift: 0.03,
    });
    expect(aligned.data?.status, aligned.data?.summary).toBe("applied");
    expect(doc.undoLabels).toEqual(["Align match cuts"]);
    // Every disc can reach the target without uncovering the frame: no extra zoom.
    expect((aligned.data?.data as { clips: { cover_zoom: number }[] }).clips.map((c) => c.cover_zoom)).toEqual([1, 1, 1, 1]);
    const want = { x: 0.5 * W, y: 0.5 * H, r: (0.45 * H) / 2 };
    for (let i = 0; i < DISCS.length; i += 1) {
      // The cut frame: the subject exactly on the target.
      const cut = measure(await renderFrameImage(doc.project, (i * SHOT_FRAMES + 0.5) / 30, { resolveMedia: (p) => p }));
      expect(Math.abs(cut.x - want.x), `${DISCS[i]!.name} x`).toBeLessThanOrEqual(2);
      expect(Math.abs(cut.y - want.y), `${DISCS[i]!.name} y`).toBeLessThanOrEqual(2);
      expect(Math.abs(cut.r - want.r), `${DISCS[i]!.name} r`).toBeLessThanOrEqual(2);
      // The last frame of the shot: still centred, zoomed in by the drift.
      const end = measure(await renderFrameImage(doc.project, (i * SHOT_FRAMES + SHOT_FRAMES - 0.5) / 30, { resolveMedia: (p) => p }));
      expect(Math.abs(end.x - want.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(end.y - want.y)).toBeLessThanOrEqual(2);
      expect(end.r / want.r).toBeCloseTo(1.03, 1);
    }
  }, 120_000);
});
