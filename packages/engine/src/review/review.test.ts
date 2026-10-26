import { describe, expect, it } from "vitest";
import { ProjectDocument } from "../history/document.js";
import { createProject } from "../model/defaults.js";
import type { Project } from "../model/types.js";
import { addClip, fadeClip, setClipProperty } from "../ops/clips.js";
import { addFile } from "../ops/files.js";
import { audioInfo, imageInfo, media, videoInfo } from "../tools/test-support/fixture.js";
import { alignCuts, findProblems, flashAndBlack, PACE_LIMITS, safeInsets, tileMark, type ProblemInput } from "./problems.js";
import { DEFAULT_SHEET_PIXELS, planSheet, sheetLayout } from "./sheet.js";
import { titleTextBoxes } from "./text-boxes.js";
import { reviewTimeline } from "./timeline.js";

interface Spec {
  path: string;
  at: number;
  length: number;
  layer?: number;
  /** Source in point. */
  from?: number;
}

/** A project (24 fps) with one clip per spec; `.mp4` plays video, `.png` is a still, `.mp3` audio. */
function build(specs: Spec[]): Project {
  const doc = new ProjectDocument(createProject({ id: "REVIEWPROJ" }));
  const ids = new Map<string, string>();
  doc.transaction("fixture", (tx) => {
    for (const spec of specs) {
      if (!ids.has(spec.path)) {
        const info = spec.path.endsWith(".png") ? imageInfo(spec.path) : spec.path.endsWith(".mp3") ? audioInfo(spec.path, 120) : videoInfo(spec.path, 120, spec.path.includes("mute") ? { has_audio: false } : {});
        ids.set(spec.path, addFile(tx, media(spec.path, info), { id: `F${ids.size}`.padEnd(10, "X") }).id);
      }
      addClip(tx, { fileId: ids.get(spec.path)!, position: spec.at, layer: spec.layer ?? 1_000_000, start: spec.from ?? 0, end: (spec.from ?? 0) + spec.length });
    }
  });
  return doc.project;
}

/** n back-to-back shots of `length` seconds from different files. */
function montage(n: number, length: number, name = "shot"): Spec[] {
  return Array.from({ length: n }, (_, i) => ({ path: `/m/${name}${i}.mp4`, at: i * length, length }));
}

function problemsFor(project: Project, extra: Partial<ProblemInput> = {}) {
  const review = reviewTimeline(project);
  return findProblems({ review, pace: "fast", frame: { width: project.width, height: project.height }, ...extra });
}

describe("reviewTimeline", () => {
  it("reads shots, cuts and pace from back-to-back clips", () => {
    const review = reviewTimeline(build(montage(5, 0.5)));
    expect(review.shots.map((s) => [s.start, s.end])).toEqual([[0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 2.5]]);
    expect(review.cuts.map((c) => c.time)).toEqual([0.5, 1, 1.5, 2]);
    expect(review.cutsPerSecond).toBe(1.6);
    expect(review.stats).toMatchObject({ count: 5, min: 0.5, median: 0.5, max: 0.5 });
    expect(review.empty).toEqual([]);
  });

  it("treats a clip split in two as one shot, not a cut", () => {
    const review = reviewTimeline(
      build([
        { path: "/m/a.mp4", at: 0, length: 1, from: 0 },
        { path: "/m/a.mp4", at: 1, length: 1, from: 1 },
        { path: "/m/b.mp4", at: 2, length: 1 },
      ]),
    );
    expect(review.shots).toHaveLength(2);
    expect(review.shots[0]).toMatchObject({ start: 0, end: 2 });
    expect(review.cuts.map((c) => c.time)).toEqual([2]);
  });

  it("shows the topmost clip and finds holes in the picture", () => {
    const review = reviewTimeline(
      build([
        { path: "/m/low.mp4", at: 0, length: 2, layer: 1_000_000 },
        { path: "/m/top.mp4", at: 0.5, length: 0.5, layer: 2_000_000 },
        { path: "/m/after.mp4", at: 3, length: 1, layer: 1_000_000 },
      ]),
    );
    expect(review.shots.map((s) => s.name)).toEqual(["low.mp4", "top.mp4", "low.mp4", "after.mp4"]);
    expect(review.empty).toEqual([{ start: 2, end: 3, title: false }]);
  });

  it("limits what it reports to a range but never cuts a shot at its edge", () => {
    const review = reviewTimeline(build(montage(8, 1)), { start: 2.5, end: 5.5 });
    expect(review.shots.map((s) => s.start)).toEqual([2, 3, 4, 5]);
    expect(review.cuts.map((c) => c.time)).toEqual([3, 4, 5]);
    expect(review.range).toEqual({ start: 2.5, end: 5.5 });
  });

  it("finds the longest still image that never moves", () => {
    const review = reviewTimeline(build([{ path: "/m/a.mp4", at: 0, length: 1 }, { path: "/m/b.png", at: 1, length: 2.5 }]));
    expect(review.longestStaticHold).toMatchObject({ start: 1, seconds: 2.5 });
    expect(review.longestShot).toMatchObject({ start: 1, seconds: 2.5 });
  });

  it("reports stretches no audio clip covers", () => {
    const review = reviewTimeline(build([...montage(4, 1, "mute"), { path: "/m/song.mp3", at: 0, length: 1.5, layer: 2_000_000 }]));
    expect(review.audioClips).toBe(1);
    expect(review.silentGaps).toEqual([{ start: 1.5, end: 4 }]);
  });

  it("counts a clip with its audio switched off as silent", () => {
    const doc = new ProjectDocument(build([{ path: "/m/a.mp4", at: 0, length: 2 }, { path: "/m/b.mp4", at: 2, length: 2 }]));
    doc.transaction("audio off", (tx) => setClipProperty(tx, String(tx.project.clips[1]!.id), "has_audio", 0));
    const review = reviewTimeline(doc.project);
    expect(review.audioClips).toBe(1);
    expect(review.silentGaps).toEqual([{ start: 2, end: 4 }]);
  });
});

describe("findProblems", () => {
  it("flags shots held too long for a fast edit and tolerates them in a slow one", () => {
    const project = build([...montage(4, 0.5), { path: "/m/long.mp4", at: 2, length: 2.5 }, { path: "/m/last.mp4", at: 4.5, length: 0.5 }]);
    const [problem] = problemsFor(project);
    expect(problem).toMatchObject({ code: "long-hold", at: 2, until: 4.5 });
    expect(problem!.message).toContain("2.50 s");
    expect(problemsFor(project, { pace: "slow" })).toEqual([]);
    expect(PACE_LIMITS.fast.maxHold).toBeLessThan(2);
  });

  it("lets the closing shot hold a little longer than the rest", () => {
    expect(problemsFor(build([...montage(4, 0.5), { path: "/m/end.mp4", at: 2, length: 2.2 }]))).toEqual([]);
  });

  it("flags a hole in the picture, but not a short title card on black", () => {
    const [problem] = problemsFor(build([{ path: "/m/a.mp4", at: 0, length: 0.5 }, { path: "/m/b.mp4", at: 1, length: 0.5 }]));
    expect(problem).toMatchObject({ code: "empty-frames", severity: "high", at: 0.5, until: 1 });
  });

  it("flags a slow edit and a slideshow of stills", () => {
    const codes = problemsFor(build(Array.from({ length: 4 }, (_, i) => ({ path: `/m/p${i}.png`, at: i * 1.4, length: 1.4 })))).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(["slow-pace", "stills-without-motion"]));
  });

  it("flags footage used again and again", () => {
    const codes = problemsFor(build(Array.from({ length: 4 }, (_, i) => ({ path: "/m/same.mp4", at: i * 0.5, length: 0.25, from: 0 })).map((s, i) => ({ ...s, at: i * 0.25 })))).map((p) => p.code);
    expect(codes).toContain("repeated-footage");
  });

  it("flags a clip back within 3 s in a fast edit, not one that rests longer", () => {
    // a b a b …: each clip is back 0.5 s after its last shot.
    const close = Array.from({ length: 6 }, (_, i) => ({ path: i % 2 ? "/m/b.mp4" : "/m/a.mp4", at: i * 0.5, length: 0.5, from: i }));
    expect(problemsFor(build(close)).map((p) => p.code)).toContain("clip-back-soon");
    expect(problemsFor(build(close), { pace: "slow" }).map((p) => p.code)).not.toContain("clip-back-soon");
    const rested = Array.from({ length: 8 }, (_, i) => ({ path: `/m/c${i}.mp4`, at: i * 0.5, length: 0.5, from: 0 }));
    expect(problemsFor(build(rested)).map((p) => p.code)).not.toContain("clip-back-soon");
  });

  it("measures cuts against the beat grid and the hits", () => {
    const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
    const onGrid = alignCuts([0.5, 1, 1.52, 2, 2.5], beats, [], 120, 24);
    expect(onGrid).toMatchObject({ bpm: 120, onBeat: 1, onTransient: 1 });
    const off = alignCuts([0.3, 0.8, 1.3, 1.8, 2.3], beats, [], 120, 24);
    expect(off.onBeat).toBe(0);
    expect(Math.abs(off.misses[0]!.offset)).toBeCloseTo(0.2, 2);
    // A hit right under a cut counts even between beats.
    expect(alignCuts([0.3], beats, [0.3], 120, 24)).toMatchObject({ onBeat: 0, onTransient: 1 });
  });

  it("flags cuts off the beat with their times", () => {
    const project = build(montage(6, 0.4));
    const review = reviewTimeline(project);
    const alignment = alignCuts(review.cuts.map((c) => c.time), Array.from({ length: 20 }, (_, i) => i * 0.5), [], 120, 24);
    const problem = problemsFor(project, { alignment }).find((p) => p.code === "cuts-off-beat");
    expect(problem).toBeDefined();
    expect(problem!.times!.length).toBeGreaterThan(0);
    expect(problemsFor(project, { alignment, pace: "slow" }).some((p) => p.code === "cuts-off-beat")).toBe(false);
  });

  it("flags silence, a quiet mix, clipping, and an edit with no sound", () => {
    const project = build([...montage(6, 0.5), { path: "/m/song.mp3", at: 0, length: 3, layer: 2_000_000 }]);
    const codes = problemsFor(project, { mix: { lufs: -31, peakDb: -0.1, silences: [{ start: 1, end: 2.6 }] } }).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(["silent-stretch", "mix-too-quiet", "mix-clips"]));
    expect(problemsFor(build(montage(6, 0.5, "mute"))).map((p) => p.code)).toContain("silent-edit");
    expect(problemsFor(project, { mix: { lufs: -14, peakDb: -1.5, silences: [] } })).toEqual([]);
  });

  it("finds flash and black frames from the sampled tiles", () => {
    const project = build([{ path: "/m/a.mp4", at: 0, length: 1 }, { path: "/m/b.mp4", at: 1, length: 0.12 }, { path: "/m/c.mp4", at: 1.12, length: 1 }]);
    const review = reviewTimeline(project);
    const frames = [
      { seconds: 0.5, luma: 0.4, peak: 0.9, shot: 0 },
      { seconds: 1.05, luma: 0.96, peak: 1, shot: 1 },
      { seconds: 1.5, luma: 0.01, peak: 0.02, shot: 2 },
      // Dark footage with a lit subject (a record on a black table) is not a black frame.
      { seconds: 1.9, luma: 0.015, peak: 0.4, shot: 2 },
    ];
    expect(flashAndBlack(frames, review)).toEqual({ flashes: [1.05], black: [1.5] });
    const problem = problemsFor(project, { frames }).find((p) => p.code === "black-frame");
    expect(problem).toMatchObject({ severity: "high", at: 1.5 });
  });

  it("marks a bright long shot no flash and a fade from black no black frame", () => {
    const doc = new ProjectDocument(build([{ path: "/m/a.mp4", at: 0, length: 2 }, { path: "/m/b.mp4", at: 2, length: 0.12 }, { path: "/m/c.mp4", at: 2.12, length: 2 }]));
    doc.transaction("fade in", (tx) => fadeClip(tx, String(tx.project.clips[0]!.id), { fadeIn: 0.5 }));
    const review = reviewTimeline(doc.project);
    // A white product shot, the fade's first frame, and a black flash cut.
    const frames = [
      { seconds: 1, luma: 0.95, peak: 1, shot: 0 },
      { seconds: 0.02, luma: 0, peak: 0, shot: 0, fading: true },
      { seconds: 2.05, luma: 0, peak: 0, shot: 1 },
    ];
    expect(frames.map((f) => tileMark(f, review))).toEqual(["black", undefined, "flash"]);
    expect(flashAndBlack(frames, review)).toEqual({ flashes: [], black: [] });
    expect(problemsFor(doc.project, { frames }).map((p) => p.code)).not.toContain("black-frame");
  });

  it("ranks high severity first and caps the list", () => {
    const project = build([{ path: "/m/a.png", at: 0, length: 4 }, { path: "/m/b.png", at: 5, length: 4 }, { path: "/m/c.png", at: 9, length: 4 }]);
    const problems = problemsFor(project);
    expect(problems[0]!.severity).toBe("high");
    expect(problems.length).toBeLessThanOrEqual(12);
  });

  it("flags text beyond the safe area, and past the frame edge", () => {
    expect(safeInsets(1080, 1920).bottom).toBe(0.2);
    const project = build(montage(6, 0.5));
    const inside = { clipId: "T", x0: 0.3, y0: 0.45, x1: 0.7, y1: 0.55 };
    expect(problemsFor(project, { textBoxes: [inside] })).toEqual([]);
    const edge = problemsFor(project, { textBoxes: [{ ...inside, clipId: "T1", x1: 1.05 }, { ...inside, clipId: "T2", x0: 0.04 }] });
    expect(edge.map((p) => p.code).sort()).toEqual(["text-off-frame", "text-outside-safe"]);
  });
});

describe("titleTextBoxes", () => {
  const svg = (x: number, anchor: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><text style="font-size:100px;text-anchor:${anchor}"><tspan x="${x}" y="540">HELLO WORLD</tspan></text></svg>`;

  it("maps the words into frame fractions through the clip's scale", () => {
    const project = build(montage(1, 1));
    const clip = project.clips[0]!;
    const [centred] = titleTextBoxes(project, clip, svg(960, "middle"));
    expect(centred!.x0).toBeGreaterThan(0.2);
    expect(centred!.x1).toBeLessThan(0.8);
    expect((centred!.x0 + centred!.x1) / 2).toBeCloseTo(0.5, 2);
    const [pushed] = titleTextBoxes(project, clip, svg(1900, "end"));
    expect(pushed!.x1).toBeGreaterThan(0.98);
  });

  it("returns nothing for an SVG without text", () => {
    const project = build(montage(1, 1));
    expect(titleTextBoxes(project, project.clips[0]!, `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>`)).toEqual([]);
    expect(titleTextBoxes(project, project.clips[0]!, "not xml")).toEqual([]);
  });
});

describe("sheet", () => {
  it("shows each cut as its last and first frame, in time order, within the tile budget", () => {
    const review = reviewTimeline(build(montage(6, 0.5)));
    const plan = planSheet(review, 24);
    expect(plan.cutsShown).toBe(5);
    const outs = plan.tiles.filter((t) => t.kind === "out").map((t) => t.label);
    expect(outs).toEqual(["0.50 out", "1.00 out", "1.50 out", "2.00 out", "2.50 out"]);
    const first = plan.tiles.find((t) => t.label === "1.00 in")!;
    const last = plan.tiles.find((t) => t.label === "1.00 out")!;
    expect(first.seconds).toBeGreaterThanOrEqual(1);
    expect(last.seconds).toBeLessThan(1);
    expect(plan.tiles.map((t) => t.seconds)).toEqual([...plan.tiles.map((t) => t.seconds)].sort((a, b) => a - b));
    expect(plan.tiles[0]!.kind).toBe("start");
    expect(plan.tiles[plan.tiles.length - 1]!.kind).toBe("end");
  });

  it("samples a long edit evenly and keeps the first and last cut", () => {
    const review = reviewTimeline(build(montage(60, 0.5)));
    const plan = planSheet(review, 24);
    expect(plan.tiles.length).toBeLessThanOrEqual(24);
    expect(plan.cutsTotal).toBe(59);
    expect(plan.cutsShown).toBe(11);
    expect(plan.tiles.some((t) => t.label === "0.50 out")).toBe(true);
    expect(plan.tiles.some((t) => t.label === "29.50 in")).toBe(true);
  });

  it("adds mid-shot frames of long shots with the room left", () => {
    const review = reviewTimeline(build([{ path: "/m/a.mp4", at: 0, length: 3 }, { path: "/m/b.mp4", at: 3, length: 0.3 }]));
    expect(planSheet(review, 24).tiles.filter((t) => t.kind === "mid").map((t) => t.seconds)).toEqual([1.5]);
  });

  it("sizes the sheet to about 1,500 image tokens for any number of tiles and aspect", () => {
    for (const [count, aspect] of [[24, 16 / 9], [24, 9 / 16], [8, 1], [48, 16 / 9], [4, 9 / 16]] as const) {
      const layout = sheetLayout(count, aspect);
      expect(layout.width * layout.height).toBeLessThanOrEqual(DEFAULT_SHEET_PIXELS);
      expect(layout.columns * layout.rows).toBeGreaterThanOrEqual(count);
      expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(1568);
      expect(layout.tileWidth).toBeGreaterThanOrEqual(56);
    }
  });

  it("honours a requested tile width while it fits", () => {
    expect(sheetLayout(6, 16 / 9, 2_800_000, 400).tileWidth).toBe(400);
    expect(sheetLayout(24, 16 / 9, 2_800_000, 640).tileWidth).toBeLessThan(640);
  });
});
