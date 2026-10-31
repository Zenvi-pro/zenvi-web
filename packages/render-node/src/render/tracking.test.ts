/**
 * Tracking end to end on real footage: ffmpeg moves a textured, tinted
 * square across a textured ground, track_point_tool follows it through the
 * frames this host renders (decoders kept open across the walk), and the
 * frames the renderer composites after hold_point_reframe_tool show the
 * square held at the canvas centre.
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
const SIDE = 180;
const SECONDS = 3;
/** The square's centre at source second t, pixels. */
const centreAt = (t: number) => ({ x: 300 + SIDE / 2 + 200 * t, y: 360 + SIDE / 2 - 40 * t });

let dir: string;

beforeAll(async () => {
  dir = await makeTempDir("zenvi-tracking-");
  await exec(resolveBinary("ffmpeg"), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `nullsrc=s=${W}x${H}:r=30:d=${SECONDS},geq=lum='110+25*sin(X*0.05)*cos(Y*0.045)':cb=128:cr=128`,
    "-f", "lavfi", "-i", `nullsrc=s=${SIDE}x${SIDE}:r=30:d=${SECONDS},geq=lum='128+90*sin(X*0.35)*sin(Y*0.29)':cb=100:cr=170`,
    "-filter_complex", "[0][1]overlay=x='300+200*t':y='360-40*t'",
    "-c:v", "libx264", "-crf", "16", "-preset", "ultrafast", "-pix_fmt", "yuv420p", path.join(dir, "subject.mp4"),
  ]);
}, 60_000);

afterAll(async () => {
  await removeDir(dir);
});

async function project(): Promise<Project> {
  const doc = new ProjectDocument({ ...createProject({ id: "TRACKINGE2" }), width: W, height: H });
  const info = await probe(path.join(dir, "subject.mp4"));
  doc.transaction("fixture", (tx) => {
    addFile(tx, { path: path.join(dir, "subject.mp4"), info }, { id: "F0" });
    addClip(tx, { fileId: "F0", position: 0, layer: tx.project.layers[0]!.number, start: 0, end: SECONDS, id: "C0" });
  });
  return { ...doc.project, history: { undo: [], redo: [] } };
}

/** Centroid of the tinted square (red well above blue), pixels. */
function tinted(image: RgbaImage): { x: number; y: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const i = (y * image.width + x) * 4;
      if (image.data[i]! - image.data[i + 2]! > 40) {
        n += 1;
        sx += x + 0.5;
        sy += y + 0.5;
      }
    }
  }
  return { x: sx / n, y: sy / n };
}

describe("tracking on ffmpeg footage", () => {
  it("follows the square to ±3 px and holds it at the centre while punching in", async () => {
    const doc = new ProjectDocument(await project());
    const host = createNodeHost();
    const c0 = centreAt(0);
    const box = { x: (c0.x - SIDE * 0.4) / W, y: (c0.y - SIDE * 0.4) / H, w: (SIDE * 0.8) / W, h: (SIDE * 0.8) / H };
    const tracked = await runTool({ doc, host }, "track_point_tool", { clip_id: "C0", box });
    expect(tracked.data?.status, tracked.data?.summary).toBe("applied");
    const samples = (tracked.data?.data as { samples: { t: number; x: number; y: number; lost?: boolean }[] }).samples;
    for (const s of samples) {
      const truth = centreAt(s.t);
      expect(s.lost, `t=${s.t}`).toBeUndefined();
      expect(Math.abs(s.x * W - truth.x), `x at ${s.t}`).toBeLessThan(3);
      expect(Math.abs(s.y * H - truth.y), `y at ${s.t}`).toBeLessThan(3);
    }

    const held = await runTool({ doc, host }, "hold_point_reframe_tool", { clip_id: "C0", box, target: { x: 0.5, y: 0.5 }, zoom: 1.4 });
    expect(held.data?.status, held.data?.summary).toBe("applied");
    expect(doc.undoLabels).toEqual(["Hold tracked point"]);
    for (const t of [0.5, 1.5, 2.6]) {
      const at = tinted(await renderFrameImage(doc.project, t, { resolveMedia: (p) => p, width: 640 }));
      expect(Math.abs(at.x - 320), `x at ${t}`).toBeLessThan(4);
      expect(Math.abs(at.y - 180), `y at ${t}`).toBeLessThan(4);
    }
  }, 120_000);
});
