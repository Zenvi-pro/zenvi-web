import { describe, expect, it } from "vitest";
import { decodePngBase64 } from "../io/png.js";
import { createProject } from "../model/defaults.js";
import { ProjectDocument } from "../history/document.js";
import { subjectOnCanvas } from "../matchcut/fit.js";
import { Interpolation, type Project } from "../model/types.js";
import { addClip, addFile, setClipKeyframes } from "../ops/index.js";
import { listProjectMotionTransitions } from "../ops/motion-transitions.js";
import { clipKeyframe } from "../render/plan/transform.js";
import type { RgbaImage } from "../render/types.js";
import { runTool } from "./registry.js";
import { hasDarkEdges } from "./subjects.js";
import { fakeHost } from "./test-support/fake-host.js";
import { audioInfo, media, videoInfo } from "./test-support/fixture.js";
import { pixelFrameHost, type Painter } from "./test-support/pixel-host.js";
import type { ToolHost } from "./types.js";

/** Discs on the source frames, in source pixels (1280×720): different places and sizes, like unaligned circle shots. */
const DISCS: Record<string, { x: number; y: number; r: number }> = {
  "/m/eye.mp4": { x: 640, y: 360, r: 150 },
  "/m/moon.mp4": { x: 420, y: 250, r: 90 },
  "/m/cup.mp4": { x: 900, y: 430, r: 210 },
  "/m/vinyl.mp4": { x: 700, y: 300, r: 60 },
};
const PATHS = Object.keys(DISCS);
const W = 1280;
const H = 720;

/** A bright disc on a dim background with a little texture, scaled to the size the renderer asks for. */
function paint(path: string, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const disc = DISCS[path];
  const sx = width / W;
  const sy = height / H;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = path.endsWith(".svg") ? 255 : 40 + ((x * 7 + y * 13) % 11);
      if (disc) {
        const d = Math.hypot((x + 0.5) / sx - disc.x, (y + 0.5) / sy - disc.y);
        const coverage = Math.min(1, Math.max(0, (disc.r - d) * sx + 0.5));
        v = v * (1 - coverage) + 230 * coverage;
      }
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Centre and radius of the bright disc in a rendered frame (centroid and area of pixels above mid grey). */
function measure(image: RgbaImage): { x: number; y: number; r: number } {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const v = image.data[(y * image.width + x) * 4]!;
      // Partial coverage counts in proportion, for sub-pixel accuracy.
      const w = Math.min(1, Math.max(0, (v - 50) / (230 - 50)));
      n += w;
      sx += w * (x + 0.5);
      sy += w * (y + 0.5);
    }
  }
  return { x: sx / n, y: sy / n, r: Math.sqrt(n / Math.PI) };
}

const boxOf = (path: string) => {
  const d = DISCS[path]!;
  return { x: (d.x - d.r) / W, y: (d.y - d.r) / H, w: (2 * d.r) / W, h: (2 * d.r) / H };
};

function project(): Project {
  const scratch = new ProjectDocument({ ...createProject({ id: "MATCHCUT01" }), width: W, height: H });
  scratch.transaction("fixture", (tx) => {
    PATHS.forEach((path, i) => {
      addFile(tx, media(path, videoInfo(path, 10, { width: W, height: H })), { id: `F${i}` });
      // Back-to-back 8-frame shots, each from a different source moment.
      addClip(tx, { fileId: `F${i}`, position: (i * 8) / 30, layer: tx.project.layers[0]!.number, start: 1 + i * 0.1, end: 1 + i * 0.1 + 8 / 30, id: `C${i}` });
    });
  });
  return { ...scratch.project, history: { undo: [], redo: [] } };
}

async function frameAt(host: ToolHost, p: Project, frame: number): Promise<RgbaImage> {
  const png = await host.frames!.renderFrame(p, (frame - 0.5) / 30, { width: W, format: "png" });
  return decodePngBase64(png.data);
}

describe("align_match_cut_tool", () => {
  it("puts every subject at the first clip's place and one size on each cut frame (±2 px), in one undo step", async () => {
    const doc = new ProjectDocument(project());
    const host: ToolHost = { frames: pixelFrameHost(paint) };
    // zoom_all: the cup's big off-centre disc needs a zoom to stay covered, so every subject grows with it.
    const result = await runTool({ doc, host }, "align_match_cut_tool", { clips: PATHS.map((p, i) => ({ clip_id: `C${i}`, box: boxOf(p) })), cover: "zoom_all" });
    expect(result.data?.status, result.data?.summary).toBe("applied");
    expect(doc.undoLabels).toEqual(["Align match cuts"]);
    const data = result.data?.data as { target: { x: number; y: number; size: number }; clips: { clip_id: string; cover_zoom: number }[] };
    expect(data.target).toMatchObject({ x: 0.5, y: 0.5 });
    expect(data.target.size).toBeGreaterThan(300 / 720);
    const reference = { ...DISCS["/m/eye.mp4"]!, r: (data.target.size * 720) / 2 };
    for (let i = 0; i < PATHS.length; i += 1) {
      for (const offset of [0, 7]) {
        const seen = measure(await frameAt(host, doc.project, i * 8 + 1 + offset));
        expect(Math.abs(seen.x - reference.x), `C${i} +${offset} x`).toBeLessThanOrEqual(2);
        expect(Math.abs(seen.y - reference.y), `C${i} +${offset} y`).toBeLessThanOrEqual(2);
        expect(Math.abs(seen.r - reference.r), `C${i} +${offset} r`).toBeLessThanOrEqual(2);
      }
    }
    expect(data.clips.map((c) => c.clip_id)).toEqual(["C0", "C1", "C2", "C3"]);
    doc.undo();
    expect(doc.project.clips.every((c) => (c.location_x as { Points: { co: { Y: number } }[] }).Points.every((p) => p.co.Y === 0))).toBe(true);
  });

  it("zooms a clip in when moving its subject would show black edges, and reports the zoom", async () => {
    const doc = new ProjectDocument(project());
    const host: ToolHost = { frames: pixelFrameHost(paint) };
    // The cup's disc sits right of centre: centring it at a small size uncovers the right edge.
    const result = await runTool({ doc, host }, "align_match_cut_tool", { clips: [{ clip_id: "C2", box: boxOf("/m/cup.mp4") }], target: { x: 0.5, y: 0.5, size: 0.3 } });
    const clip = (result.data?.data as { clips: { cover_zoom: number; scale: number }[] }).clips[0]!;
    expect(clip.cover_zoom).toBeGreaterThan(1);
    const frame = await frameAt(host, doc.project, 2 * 8 + 1);
    // No black: every corner shows the footage background.
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]] as const) expect(frame.data[(y * W + x) * 4]!).toBeGreaterThan(30);
    // Centred, larger than asked.
    const seen = measure(frame);
    expect(Math.abs(seen.x - 640)).toBeLessThanOrEqual(2);
    expect(seen.r).toBeGreaterThan(0.3 * 720 * 0.5);
    // cover=none keeps the size and leaves the edge black.
    const loose = new ProjectDocument(project());
    const none = await runTool({ doc: loose, host }, "align_match_cut_tool", { clips: [{ clip_id: "C2", box: boxOf("/m/cup.mp4") }], target: { x: 0.5, y: 0.5, size: 0.3 }, cover: "none" });
    expect(none.data?.warnings?.join(" ")).toMatch(/black edges/);
  });

  it("lets footage with black edges skip the zoom, so it does not raise everyone's size", async () => {
    const doc = new ProjectDocument(project());
    const host: ToolHost = { frames: pixelFrameHost(paint) };
    const clips = PATHS.map((p, i) => ({ clip_id: `C${i}`, box: boxOf(p), ...(i === 2 ? { allow_edges: true } : {}) }));
    const result = await runTool({ doc, host }, "align_match_cut_tool", { clips, cover: "zoom_all" });
    const data = result.data?.data as { target: { size: number }; clips: { cover_zoom: number }[] };
    // The cup was the clip that needed the zoom: without it the first clip's size stands.
    expect(data.target.size).toBeCloseTo(300 / 720, 2);
    expect(data.clips.map((c) => c.cover_zoom)).toEqual([1, 1, 1, 1]);
    expect(result.data?.warnings?.join(" ")).toMatch(/C2 leaves black edges/);
  });

  it("knows a night-sky frame by its black edges", () => {
    const sky = paint("/none.mp4", 64, 36);
    expect(hasDarkEdges(sky)).toBe(false);
    sky.data.fill(0);
    for (let i = 3; i < sky.data.length; i += 4) sky.data[i] = 255;
    expect(hasDarkEdges(sky)).toBe(true);
  });

  it("keeps a stretched clip's aspect and keyframes outside its visible window", async () => {
    const p = project();
    const doc = new ProjectDocument(p);
    doc.transaction("fixture", (tx) => {
      setClipKeyframes(tx, "C1", "scale_y", [{ frame: 1, value: 0.5, interpolation: Interpolation.LINEAR }]);
      // A key beyond the clip's out point (source frames 34-41 are visible).
      setClipKeyframes(tx, "C1", "location_x", [{ frame: 90, value: 0.25, interpolation: Interpolation.LINEAR }], { mode: "merge" });
    });
    const target = { x: 0.4, y: 0.6, size: 0.3 };
    for (const fit of ["position", "position_scale"] as const) {
      const result = await runTool({ doc, host: {} }, "align_match_cut_tool", { clips: [{ clip_id: "C1", box: boxOf("/m/moon.mp4") }], target, fit, cover: "none" });
      expect(result.data?.status, result.data?.summary).toBe("applied");
      const clip = doc.project.clips.find((c) => c.id === "C1")!;
      const frames = (result.data?.data as { clips: { keyframe_frames: number[] }[] }).clips[0]!.keyframe_frames;
      expect(frames).toEqual([34, 41]);
      for (const n of frames) {
        expect(clipKeyframe(clip, "scale_y", n) / clipKeyframe(clip, "scale_x", n), `${fit} aspect at ${n}`).toBeCloseTo(0.5, 6);
        const on = subjectOnCanvas(doc.project, clip, n, boxOf("/m/moon.mp4"));
        expect(Math.abs(on.cx - target.x) * W, `${fit} x at ${n}`).toBeLessThan(0.5);
        expect(Math.abs(on.cy - target.y) * H, `${fit} y at ${n}`).toBeLessThan(0.5);
        if (fit === "position_scale") expect(on.size).toBeCloseTo(target.size, 3);
      }
      expect((clip.location_x as { Points: { co: { X: number; Y: number } }[] }).Points.find((pt) => pt.co.X === 90)?.co.Y).toBe(0.25);
    }
  });

  it("refuses bad input before anything changes", async () => {
    const doc = new ProjectDocument(project());
    const host: ToolHost = {};
    for (const args of [
      { clips: [{ clip_id: "NOPE", box: boxOf("/m/eye.mp4") }] },
      { clips: [{ clip_id: "C0", box: { x: 0.9, y: 0.1, w: 0.4, h: 0.1 } }] },
      { clips: [{ clip_id: "C0", box: boxOf("/m/eye.mp4") }, { clip_id: "C0", box: boxOf("/m/eye.mp4") }] },
      { clips: [{ clip_id: "C0", box: boxOf("/m/eye.mp4"), end_time: 2 }] },
      // The subject's centre on the very edge cannot be centred without black edges.
      { clips: [{ clip_id: "C0", box: { x: 0.9, y: 0.4, w: 0.2, h: 0.2 } }], target: { x: 0.5, y: 0.5, size: 0.2 } },
    ]) {
      const result = await runTool({ doc, host }, "align_match_cut_tool", args);
      expect(result.data?.summary).toMatch(/^Error/);
      expect(doc.undoLabels).toEqual([]);
    }
  });
});

describe("detect_subject_tool", () => {
  it("finds the disc of a file and a clip, as a box align_match_cut_tool takes", async () => {
    const doc = new ProjectDocument(project());
    const host: ToolHost = { frames: pixelFrameHost(paint) };
    const byFile = await runTool({ doc, host }, "detect_subject_tool", { file_id: "F1", time: 2 });
    const subjects = (byFile.data?.data as { subjects: { center: { x: number; y: number }; radius: number }[] }).subjects;
    const moon = DISCS["/m/moon.mp4"]!;
    expect(Math.abs(subjects[0]!.center.x * W - moon.x)).toBeLessThan(3);
    expect(Math.abs(subjects[0]!.center.y * H - moon.y)).toBeLessThan(3);
    expect(Math.abs(subjects[0]!.radius * H - moon.r)).toBeLessThan(3);
    const byClip = await runTool({ doc, host }, "detect_subject_tool", { clip_id: "C2" });
    expect(byClip.data?.summary).toMatch(/Found \d+ circle\(s\) in F2 at 1\.2s/);
    expect(doc.undoLabels).toEqual([]);
  });

  it("is refused where frames cannot be rendered", async () => {
    const result = await runTool({ doc: new ProjectDocument(project()), host: {} }, "detect_subject_tool", { file_id: "F0" });
    expect(result.data?.summary).toMatch(/^Error: .*not available.*frame rendering/);
  });
});

describe("match_cut_montage_tool", () => {
  it("cuts a 3-8 frame chain, finds and aligns every circle, flashes downbeats, and returns sfx cues — one undo step", async () => {
    const base = project();
    base.clips = [];
    const doc = new ProjectDocument(base);
    const host: ToolHost = { ...fakeHost(), frames: pixelFrameHost(paint) };
    const result = await runTool({ doc, host }, "match_cut_montage_tool", { file_ids: ["F0", "F1", "F2", "F3"], duration_seconds: 6, target: { x: 0.5, y: 0.5, size: 0.4 } });
    expect(result.data?.status, result.data?.summary).toBe("applied");
    expect(result.data?.warnings?.join(" ")).not.toMatch(/did not fit/);
    expect(doc.undoLabels).toEqual(["Match-cut montage"]);
    const data = result.data?.data as {
      shots: { clip_id: string; file_id: string; start: number; frames: number; subject_from: string }[];
      flashes: number[];
      transitions: { cut: number }[];
      sfx_cues: { time: number; kind: string; accent: boolean }[];
      target: { size: number };
    };
    expect(data.shots[0]!.frames).toBeGreaterThanOrEqual(24);
    expect(data.shots[data.shots.length - 1]!.frames).toBeGreaterThanOrEqual(36);
    expect(data.shots.length).toBeGreaterThan(6);
    expect(new Set(data.shots.map((s) => s.file_id))).toEqual(new Set(["F0", "F1", "F2", "F3"]));
    for (const shot of data.shots.slice(1, -1)) expect(shot.frames).toBeGreaterThanOrEqual(3);
    for (const shot of data.shots.slice(1, -1)) expect(shot.frames).toBeLessThanOrEqual(8);
    expect(data.shots.every((s) => s.subject_from === "detected")).toBe(true);
    expect(data.sfx_cues.map((c) => c.time)).toEqual(data.shots.slice(1).map((s) => s.start));
    expect(data.flashes.length).toBeGreaterThan(0);
    // Every cut frame without a flash or a motion transition: the subject at the target (±2 px; the drift zooms in after it).
    const accented = new Set([...data.flashes, ...data.transitions.map((t) => t.cut)].map((t) => Math.round(t * 30)));
    for (const shot of data.shots.filter((s) => !accented.has(Math.round(s.start * 30))).slice(0, 6)) {
      const seen = measure(await frameAt(host, doc.project, Math.round(shot.start * 30) + 1));
      expect(Math.abs(seen.x - 640), shot.clip_id).toBeLessThanOrEqual(2);
      expect(Math.abs(seen.y - 360), shot.clip_id).toBeLessThanOrEqual(2);
      expect(Math.abs(seen.r - data.target.size * 360), shot.clip_id).toBeLessThanOrEqual(2);
    }
  });

  it("follows a drifting subject from its box and end_box when no time is given", async () => {
    // The moon slides right at 40 px per source second.
    const moonAt = (t: number) => ({ x: 300 + 40 * t, y: 250, r: 90 });
    const drifting: Painter = (path, width, height, seconds) => {
      if (path !== "/m/moon.mp4") return paint(path, width, height);
      const saved = DISCS[path]!;
      DISCS[path] = moonAt(seconds);
      try {
        return paint(path, width, height);
      } finally {
        DISCS[path] = saved;
      }
    };
    const boxAtTime = (t: number) => {
      const d = moonAt(t);
      return { x: (d.x - d.r) / W, y: (d.y - d.r) / H, w: (2 * d.r) / W, h: (2 * d.r) / H };
    };
    const host: ToolHost = { ...fakeHost(), frames: pixelFrameHost(drifting) };
    const args = { file_ids: ["F0", "F1", "F2", "F3"], duration_seconds: 6, flash: false, transitions: "none", zoom_drift: 0, target: { x: 0.5, y: 0.5, size: 0.4 } };
    type Shots = { shots: { file_id: string; start: number; source_start: number }[] };
    const fresh = () => {
      const base = project();
      base.clips = [];
      return new ProjectDocument(base);
    };
    // Source windows do not depend on the boxes: the first run says where F1's first shot starts in its file.
    const probed = await runTool({ doc: fresh(), host }, "match_cut_montage_tool", args);
    expect(probed.data?.status, probed.data?.summary).toBe("applied");
    const probe = probed.data?.data as Shots;
    const firstStart = probe.shots.find((s) => s.file_id === "F1")!.source_start;
    const doc = fresh();
    const result = await runTool({ doc, host }, "match_cut_montage_tool", { ...args, subjects: [{ file_id: "F1", box: boxAtTime(firstStart), end_box: boxAtTime(8), end_time: 8 }] });
    const moon = (result.data?.data as Shots).shots.filter((s) => s.file_id === "F1");
    expect(moon.length).toBeGreaterThan(1);
    for (const shot of moon) {
      const seen = measure(await frameAt(host, doc.project, Math.round(shot.start * 30) + 1));
      expect(Math.abs(seen.x - 640), `F1 at ${shot.source_start}s`).toBeLessThanOrEqual(2);
      expect(Math.abs(seen.y - 360), `F1 at ${shot.source_start}s`).toBeLessThanOrEqual(2);
    }
  });

  it("says which files a short montage leaves out", async () => {
    const base = project();
    base.clips = [];
    // 4 s at 120 BPM: the opening hold runs to the 2 s downbeat and the end hold starts there.
    const result = await runTool({ doc: new ProjectDocument(base), host: fakeHost() }, "match_cut_montage_tool", { file_ids: ["F0", "F1", "F2", "F3"], duration_seconds: 4 });
    expect(result.data?.warnings?.join(" ")).toMatch(/2 file\(s\) did not fit in 4 s: F1, F2/);
  });

  it("puts motion transitions on the shot track by default, once a bar between the flashes, landing on a zoom-through, in the one undo step", async () => {
    const base = project();
    base.clips = [];
    const doc = new ProjectDocument(base);
    doc.transaction("music", (tx) => void addFile(tx, media("/m/beat.mp3", audioInfo("/m/beat.mp3", 30)), { id: "MUSIC" }));
    const ids = ["F0", "F1", "F2", "F3"];
    const result = await runTool({ doc, host: fakeHost() }, "match_cut_montage_tool", { file_ids: ids, duration_seconds: 8, bpm: 120, offset_seconds: 0.5 });
    expect(result.data?.status, result.data?.summary).toBe("applied");
    expect(doc.undoLabels).toEqual(["music", "Match-cut montage"]);
    const data = result.data?.data as { bpm: number; shots: { clip_id: string; start: number }[]; flashes: number[]; transitions: { preset: string; cut: number }[] };
    expect(data.bpm).toBe(120);
    expect(data.transitions.length).toBeGreaterThan(1);
    expect(data.transitions[data.transitions.length - 1]).toMatchObject({ preset: "zoom_through", cut: data.shots[data.shots.length - 1]!.start });
    for (const t of data.transitions.slice(0, -1)) expect(["zoom_in", "glitch"]).toContain(t.preset);
    // Never on a flashed cut, never on two cuts in a row: accents are half a bar apart at least.
    const flashed = new Set(data.flashes);
    const indices = data.transitions.map((t) => data.shots.findIndex((s) => Math.abs(s.start - t.cut) < 1e-3));
    for (const t of data.transitions.slice(0, -1)) expect(flashed.has(t.cut)).toBe(false);
    for (let i = 1; i < indices.length; i += 1) expect(indices[i]! - indices[i - 1]!).toBeGreaterThan(1);
    // On the shots' own track, where the transition tools see them.
    const onTimeline = listProjectMotionTransitions(doc.project);
    expect(onTimeline).toHaveLength(data.transitions.length);
    expect(new Set(onTimeline.map((r) => r.layer))).toEqual(new Set([doc.project.clips.find((c) => c.id === data.shots[0]!.clip_id)!.layer]));

    const flash = await runTool({ doc, host: fakeHost() }, "match_cut_montage_tool", { file_ids: ids, duration_seconds: 8, bpm: 120, offset_seconds: 0.5, transitions: "flash", replace: true });
    const presets = (flash.data?.data as { transitions: { preset: string }[] }).transitions.map((t) => t.preset);
    expect(presets).toContain("flash_invert");
    for (const p of presets.slice(0, -1)) expect(["flash_invert", "glitch", "zoom_in"]).toContain(p);

    const none = await runTool({ doc, host: fakeHost() }, "match_cut_montage_tool", { file_ids: ids, duration_seconds: 8, transitions: "none", replace: true });
    expect((none.data?.data as { transitions: unknown[] }).transitions).toEqual([]);
    expect(listProjectMotionTransitions(doc.project)).toEqual([]);
  });

  it("warns when the files are too few for the pace and refuses with strict_variety, saying how many more", async () => {
    const base = project();
    base.clips = [];
    const doc = new ProjectDocument(base);
    const args = { file_ids: ["F0", "F1", "F2", "F3"], duration_seconds: 8 };
    const strict = await runTool({ doc, host: fakeHost() }, "match_cut_montage_tool", { ...args, strict_variety: true });
    expect(strict.data?.summary).toMatch(/^Error: \d+ shot\(s\) bring a file back within 3 s: this pace needs about \d+ different files and the cut uses 4\. Import \d+ more \(gather_stock_footage_tool/);
    expect(doc.undoLabels).toEqual([]);
    const loose = await runTool({ doc, host: fakeHost() }, "match_cut_montage_tool", args);
    expect(loose.data?.status).toBe("applied");
    expect(loose.data?.warnings?.join(" ")).toMatch(/bring a file back within 3 s/);
  });

  it("follows end_box to the end of the file when end_time is left out, and refuses end_time alone", async () => {
    const box = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    const fresh = () => {
      const base = project();
      base.clips = [];
      return new ProjectDocument(base);
    };
    const alone = await runTool({ doc: fresh(), host: fakeHost() }, "match_cut_montage_tool", { file_ids: ["F0", "F1"], subjects: [{ file_id: "F1", box, end_time: 5 }] });
    expect(alone.data?.summary).toMatch(/^Error: F1: end_time is where end_box was measured/);
    const followed = await runTool({ doc: fresh(), host: fakeHost() }, "match_cut_montage_tool", { file_ids: ["F0", "F1"], subjects: [{ file_id: "F1", box, end_box: { ...box, x: 0.6 } }] });
    expect(followed.data?.status, followed.data?.summary).toBe("applied");
  });

  it("refuses an occupied timeline unless replace is set", async () => {
    const doc = new ProjectDocument(project());
    const result = await runTool({ doc, host: fakeHost() }, "match_cut_montage_tool", { file_ids: ["F0", "F1"] });
    expect(result.data?.summary).toMatch(/^Error: the timeline already has 4 clip/);
    expect(doc.undoLabels).toEqual([]);
  });
});

