import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { sourceToCanvas, subjectOnCanvas } from "../matchcut/fit.js";
import { createProject } from "../model/defaults.js";
import type { Project } from "../model/types.js";
import { addClip, addFile } from "../ops/index.js";
import { clipKeyframe } from "../render/plan/transform.js";
import type { RgbaImage } from "../render/types.js";
import { frameWindow, localFrame } from "../timeline/windows.js";
import { runTool } from "./registry.js";
import { fakeHost } from "./test-support/fake-host.js";
import { media, videoInfo } from "./test-support/fixture.js";
import { pixelFrameHost } from "./test-support/pixel-host.js";
import type { ToolHost } from "./types.js";

const W = 640;
const H = 360;
const SIDE = 0.2;

/** The subject's centre at source second t (0-1): it drifts right and up. */
const subjectAt = (t: number) => ({ x: 0.3 + 0.12 * t, y: 0.55 - 0.05 * t });

/** A textured square on a softer textured background (subject.mp4); a UI with one busy corner (screen.mp4). */
function paint(path: string, width: number, height: number, seconds: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const c = subjectAt(seconds);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const px = u * W;
      const py = v * H;
      let value = 110 + 25 * Math.sin(px * 0.11) * Math.cos(py * 0.09) + 15 * Math.sin((px + py) * 0.031);
      let rgb: [number, number, number] = [value, value, value];
      if (path.endsWith("subject.mp4")) {
        const du = (u - c.x) * (W / H);
        const dv = v - c.y;
        if (Math.abs(du) < SIDE / 2 && Math.abs(dv) < SIDE / 2) {
          const sx = du * H;
          const sy = dv * H;
          value = 128 + 90 * Math.sin(sx * 0.35) * Math.sin(sy * 0.29) + 30 * Math.cos((sx - sy) * 0.6);
          rgb = [value, value * 0.8, value * 0.6];
        }
      } else if (path.endsWith("screen.mp4")) {
        // A counter ticking in the top-right card from 1 s to 2.6 s.
        const busy = seconds >= 1 && seconds <= 2.6 && u > 0.7 && u < 0.85 && v > 0.15 && v < 0.3;
        if (busy) value = 128 + 110 * Math.sin(px * 0.5 + seconds * 40) * Math.sin(py * 0.4);
        rgb = [value, value, value];
      }
      data.set([rgb[0], rgb[1], rgb[2], 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

function project(): Project {
  const doc = new ProjectDocument({ ...createProject({ id: "TRACKING01" }), width: 1280, height: 720, fps: { num: 30, den: 1 } });
  doc.transaction("setup", (tx) => {
    addFile(tx, media("/m/subject.mp4", videoInfo("/m/subject.mp4", 2, { width: W, height: H, fps: { num: 30, den: 1 } })), { id: "FSUB" });
    addFile(tx, media("/m/screen.mp4", videoInfo("/m/screen.mp4", 4, { width: W, height: H, fps: { num: 30, den: 1 } })), { id: "FSCR" });
    addClip(tx, { fileId: "FSUB", position: 0, layer: 1, start: 0, end: 2, id: "CSUB" });
  });
  return doc.project;
}

function setup(): { doc: ProjectDocument; host: ToolHost } {
  const host = fakeHost() as ToolHost;
  host.frames = pixelFrameHost(paint);
  return { doc: new ProjectDocument(project()), host };
}

const startBox = () => {
  const c = subjectAt(0);
  const w = (SIDE * H) / W;
  return { x: c.x - w / 2 + 0.01, y: c.y - SIDE / 2 + 0.01, w: w - 0.02, h: SIDE - 0.02 };
};

/** Where source point (u, v) of `clipId` is drawn at timeline second `t`, 0-1 of the canvas. */
function drawnAt(p: Project, clipId: string, t: number, u: number, v: number): { x: number; y: number } {
  const clip = p.clips.find((c) => c.id === clipId)!;
  const w = frameWindow(clip, p.fps);
  const n = localFrame(w, Math.round(t * 30) + 1);
  const [x, y] = sourceToCanvas(p, clip, n)(u, v);
  return { x: x / p.width, y: y / p.height };
}

/** Each case tracks real ffmpeg frames: about 2.5 s alone, over vitest's 5 s on a loaded CI runner. */
const TRACKING_TIMEOUT_MS = 60_000;

describe("track_point_tool", { timeout: TRACKING_TIMEOUT_MS }, () => {
  it("follows a moving subject and reads only", async () => {
    const { doc, host } = setup();
    const result = await runTool({ doc, host }, "track_point_tool", { clip_id: "CSUB", box: startBox() });
    expect(result.ok, result.text).toBe(true);
    const data = result.data?.data as { samples: { t: number; x: number; y: number; lost?: boolean }[] };
    const last = data.samples[data.samples.length - 1]!;
    const truth = subjectAt(last.t);
    expect(Math.abs(last.x - truth.x)).toBeLessThan(0.01);
    expect(Math.abs(last.y - truth.y)).toBeLessThan(0.01);
    expect(data.samples.some((s) => s.lost)).toBe(false);
    expect(doc.undoLabels).toHaveLength(0);
  });

  it("refuses two regions at once", async () => {
    const { doc, host } = setup();
    const result = await runTool({ doc, host }, "track_point_tool", { clip_id: "CSUB", box: startBox(), point: { x: 0.3, y: 0.5 } });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/exactly one of point, box or quad/);
  });
});

describe("pin_to_track_tool", { timeout: TRACKING_TIMEOUT_MS }, () => {
  it("creates a callout whose dot rides on the subject, in one undo step", async () => {
    const { doc, host } = setup();
    const result = await runTool({ doc, host }, "pin_to_track_tool", { footage_clip_id: "CSUB", point: subjectAt(0), label: "SENSOR" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.undoLabels).toHaveLength(1);
    const id = (result.data?.data as { clip_id: string }).clip_id;
    for (const t of [0, 1, 1.9]) {
      const dot = drawnAt(doc.project, id, t, 0.5, 0.5);
      const subject = drawnAt(doc.project, "CSUB", t, subjectAt(t).x, subjectAt(t).y);
      expect(Math.hypot(dot.x - subject.x, dot.y - subject.y)).toBeLessThan(0.012);
    }
  });

  it("undoes the callout, its graphic and its track in one step; refusals leave no undo step", async () => {
    const { doc, host } = setup();
    const before = doc.project;
    const self = await runTool({ doc, host }, "pin_to_track_tool", { footage_clip_id: "CSUB", clip_id: "CSUB", point: subjectAt(0) });
    expect(self.ok).toBe(false);
    expect(doc.undoLabels).toHaveLength(0);
    const result = await runTool({ doc, host }, "pin_to_track_tool", { footage_clip_id: "CSUB", point: subjectAt(0), label: "SENSOR" });
    expect(result.ok, result.text).toBe(true);
    expect(doc.project.layers.length).toBe(before.layers.length + 1);
    doc.undo();
    expect(doc.project.clips).toEqual(before.clips);
    expect(doc.project.layers).toEqual(before.layers);
    expect(doc.project.files).toEqual(before.files);
  });

  it("fits a clip onto a tracked surface", async () => {
    const { doc, host } = setup();
    doc.transaction("overlay", (tx) => {
      addFile(tx, media("/m/card.png", { ...videoInfo("/m/card.png", 10, { width: 400, height: 400 }), has_single_image: true, has_audio: false, type: "QtImageReader" }), { id: "FCARD" });
      addClip(tx, { fileId: "FCARD", position: 0, layer: 2, start: 0, end: 2, id: "CCARD" });
    });
    const c = subjectAt(0);
    const hw = (SIDE * H) / W / 2;
    const hh = SIDE / 2;
    const quad = [
      { x: c.x - hw, y: c.y - hh },
      { x: c.x + hw, y: c.y - hh },
      { x: c.x + hw, y: c.y + hh },
      { x: c.x - hw, y: c.y + hh },
    ];
    const result = await runTool({ doc, host }, "pin_to_track_tool", { footage_clip_id: "CSUB", clip_id: "CCARD", quad });
    expect(result.ok, result.text).toBe(true);
    const t = 1.5;
    const e = subjectAt(t);
    const tl = drawnAt(doc.project, "CCARD", t, 0, 0);
    const br = drawnAt(doc.project, "CCARD", t, 1, 1);
    const subjectTl = drawnAt(doc.project, "CSUB", t, e.x - hw, e.y - hh);
    const subjectBr = drawnAt(doc.project, "CSUB", t, e.x + hw, e.y + hh);
    expect(Math.hypot(tl.x - subjectTl.x, tl.y - subjectTl.y)).toBeLessThan(0.015);
    expect(Math.hypot(br.x - subjectBr.x, br.y - subjectBr.y)).toBeLessThan(0.015);
  });
});

describe("hold_point_reframe_tool", { timeout: TRACKING_TIMEOUT_MS }, () => {
  it("keeps the tracked point still while it punches in", async () => {
    const { doc, host } = setup();
    const result = await runTool({ doc, host }, "hold_point_reframe_tool", { clip_id: "CSUB", box: startBox(), target: { x: 0.5, y: 0.5 }, zoom: 1.3 });
    expect(result.ok, result.text).toBe(true);
    for (const t of [0.2, 1, 1.8]) {
      const s = subjectAt(t);
      const at = drawnAt(doc.project, "CSUB", t, s.x, s.y);
      expect(Math.abs(at.x - 0.5)).toBeLessThan(0.012);
      expect(Math.abs(at.y - 0.5)).toBeLessThan(0.012);
    }
    const clip = doc.project.clips.find((c) => c.id === "CSUB")!;
    expect(clipKeyframe(clip, "scale_x", 30)).toBeGreaterThanOrEqual(1.3);
    expect(doc.undoLabels).toHaveLength(1);
  });
});

describe("auto_reframe_tool", { timeout: TRACKING_TIMEOUT_MS }, () => {
  it("goes vertical, follows the subject and alternates medium and close", async () => {
    const { doc, host } = setup();
    const result = await runTool({ doc, host }, "auto_reframe_tool", { subjects: [{ clip_id: "CSUB", box: startBox() }], rhythm_seconds: 1, head_y: 0.5 });
    expect(result.ok, result.text).toBe(true);
    expect([doc.project.width, doc.project.height]).toEqual([1080, 1920]);
    const clip = doc.project.clips.find((c) => c.id === "CSUB")!;
    for (const t of [0.5, 1.5]) {
      const s = subjectAt(t);
      const at = drawnAt(doc.project, "CSUB", t, s.x, s.y);
      expect(Math.abs(at.x - 0.5)).toBeLessThan(0.02);
    }
    const n = (t: number) => localFrame(frameWindow(clip, doc.project.fps), Math.round(t * 30) + 1);
    expect(clipKeyframe(clip, "scale_x", n(1.5)) / clipKeyframe(clip, "scale_x", n(0.5))).toBeGreaterThan(1.2);
    // Covered: the canvas corners map back inside the source.
    const g = subjectOnCanvas(doc.project, clip, n(0.5), { x: 0, y: 0, w: 1, h: 1 });
    expect(g.size).toBeGreaterThan(1);
    expect(doc.undoLabels).toHaveLength(1);
  });
});

describe("screen_zoom_follow_tool", { timeout: TRACKING_TIMEOUT_MS }, () => {
  it("pushes in on the busy card and pulls back", async () => {
    const { doc, host } = setup();
    doc.transaction("screen", (tx) => addClip(tx, { fileId: "FSCR", position: 3, layer: 2, start: 0, end: 4, id: "CSCR" }));
    const result = await runTool({ doc, host }, "screen_zoom_follow_tool", { clip_id: "CSCR" });
    expect(result.ok, result.text).toBe(true);
    const stops = (result.data?.data as { stops: { start: number; end: number; x: number; y: number }[] }).stops;
    expect(stops).toHaveLength(1);
    expect(stops[0]!.x).toBeGreaterThan(0.7);
    expect(stops[0]!.y).toBeLessThan(0.3);
    const clip = doc.project.clips.find((c) => c.id === "CSCR")!;
    expect(clipKeyframe(clip, "scale_x", 1 + 30 * 1.8)).toBeCloseTo(1.3, 2);
    expect(clipKeyframe(clip, "scale_x", 1)).toBeCloseTo(1, 5);
    expect(clipKeyframe(clip, "scale_x", 1 + 30 * 3.9)).toBeCloseTo(1, 5);
  });

  it("refuses overlapping stops given by hand, with no undo step", async () => {
    const { doc, host } = setup();
    doc.transaction("screen", (tx) => addClip(tx, { fileId: "FSCR", position: 3, layer: 2, start: 0, end: 4, id: "CSCR" }));
    const undo = doc.undoLabels.length;
    const result = await runTool({ doc, host }, "screen_zoom_follow_tool", {
      clip_id: "CSCR",
      stops: [
        { start: 0.5, end: 3, x: 0.2, y: 0.2 },
        { start: 1, end: 2, x: 0.8, y: 0.8 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.text).toMatch(/overlap/);
    expect(doc.undoLabels).toHaveLength(undo);
  });
});

describe("add_guide_overlay_tool", { timeout: TRACKING_TIMEOUT_MS }, () => {
  it("draws a golden spiral on the subject", async () => {
    const { doc, host } = setup();
    const result = await runTool({ doc, host }, "add_guide_overlay_tool", { kind: "golden_spiral", clip_id: "CSUB", box: startBox() });
    expect(result.ok, result.text).toBe(true);
    const data = result.data?.data as { clip_id: string; center: { x: number; y: number } };
    const s = drawnAt(doc.project, "CSUB", 0, subjectAt(0).x, subjectAt(0).y);
    expect(Math.abs(data.center.x - s.x)).toBeLessThan(0.02);
    expect(doc.project.files.some((f) => /guide-golden_spiral-[0-9a-f]{8}\.svg$/.test(String(f.path)))).toBe(true);
  });

  it("follows the subject when asked", async () => {
    const { doc, host } = setup();
    const result = await runTool({ doc, host }, "add_guide_overlay_tool", { kind: "brackets", clip_id: "CSUB", box: startBox(), follow: "position" });
    expect(result.ok, result.text).toBe(true);
    const id = (result.data?.data as { clip_id: string }).clip_id;
    const t = 1.6;
    const centre = drawnAt(doc.project, id, t, 0.5, 0.5);
    const s = drawnAt(doc.project, "CSUB", t, subjectAt(t).x, subjectAt(t).y);
    expect(Math.hypot(centre.x - s.x, centre.y - s.y)).toBeLessThan(0.015);
  });
});

describe("tracking argument errors", { timeout: TRACKING_TIMEOUT_MS }, () => {
  it("refuse (not fail) a bad region or a time outside the clip, with no undo step", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["track_point_tool", { clip_id: "CSUB", box: startBox(), time: 9 }],
      ["pin_to_track_tool", { footage_clip_id: "CSUB", point: subjectAt(0), time: 9, label: "SENSOR" }],
      ["pin_to_track_tool", { footage_clip_id: "CSUB", label: "SENSOR" }],
      ["add_guide_overlay_tool", { kind: "ring", clip_id: "CSUB", box: startBox(), time: 9, follow: "position" }],
      ["hold_point_reframe_tool", { clip_id: "CSUB", box: startBox(), time: 9 }],
      ["hold_point_reframe_tool", { clip_id: "CSUB", point: subjectAt(0), box: startBox() }],
      ["auto_reframe_tool", { subjects: [{ clip_id: "CSUB", box: startBox(), time: 9 }] }],
      ["auto_reframe_tool", { subjects: [{ clip_id: "CSUB", box: startBox(), time: 9 }], follow: false }],
    ];
    for (const [tool, args] of calls) {
      const { doc, host } = setup();
      const result = await runTool({ doc, host }, tool, args);
      expect(result.data?.status, `${tool} ${result.text}`).toBe("refused");
      expect(result.data?.summary).toMatch(/^Error: .*(outside clip CSUB's source window|exactly one of point, box or quad)/);
      expect(doc.undoLabels).toHaveLength(0);
    }
  });

  it("still fails when the footage cannot be read", async () => {
    const { doc, host } = setup();
    host.frames = pixelFrameHost(() => {
      throw new Error("decoder gone");
    });
    const result = await runTool({ doc, host }, "track_point_tool", { clip_id: "CSUB", box: startBox() });
    expect(result.data?.status).toBe("error");
    expect(result.text).toMatch(/could not read the frames of FSUB to track: decoder gone/);
  });
});
