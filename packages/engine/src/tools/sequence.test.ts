import { describe, expect, it } from "vitest";
import { createProject } from "../model/defaults.js";
import { ProjectDocument } from "../history/document.js";
import type { Project } from "../model/types.js";
import { addClip, addFile } from "../ops/index.js";
import type { RgbaImage } from "../render/types.js";
import { runTool } from "./registry.js";
import { storeTranscript, type StoredTranscript } from "./transcripts.js";
import { audioInfo, media, videoInfo } from "./test-support/fixture.js";
import { fakeHost } from "./test-support/fake-host.js";
import { pixelFrameHost } from "./test-support/pixel-host.js";
import type { FrameHost, ToolHost } from "./types.js";

const W = 320;
const H = 180;
const FPS = 30;

/** One continuous take: a bright square sweeping right at a fifth of the frame a second, on a dark ramp. */
function paint(_path: string, width: number, height: number, seconds: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  const x0 = (0.05 + 0.2 * seconds) * width;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= x0 && x < x0 + width / 6 && y >= height / 3 && y < (2 * height) / 3;
      const v = inside ? 230 : 20 + Math.round((40 * y) / height);
      data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** A FrameHost with sampleFrames over the same painter (what render-node answers with ffmpeg). */
function sampler(): FrameHost & { samples: number } {
  const host = {
    samples: 0,
    renderFrame: () => Promise.reject(new Error("renderFrame should not be needed")),
    sampleFrames: (path: string, o: { start: number; end: number; every: number; width: number; height: number }) => {
      host.samples += 1;
      const out: Uint8Array[] = [];
      for (let t = o.start; t <= o.end + 1e-9; t += o.every) {
        const img = paint(path, o.width, o.height, t);
        const rgb = new Uint8Array(o.width * o.height * 3);
        for (let i = 0; i < o.width * o.height; i += 1) rgb.set(img.data.subarray(4 * i, 4 * i + 3), 3 * i);
        out.push(rgb);
      }
      return Promise.resolve(out);
    },
  };
  return host;
}

/** The take cut into four 0.5 s windows, given shuffled; a voice file; optionally the windows on the timeline. */
const WINDOWS = [1, 3, 0, 2].map((k) => ({ start: k * 0.5, end: (k + 1) * 0.5 }));

function project(withClips: boolean): Project {
  const doc = new ProjectDocument({ ...createProject({ id: "SEQUENCE01" }), width: W, height: H, fps: { num: FPS, den: 1 } });
  doc.transaction("fixture", (tx) => {
    addFile(tx, media("/m/take.mp4", videoInfo("/m/take.mp4", 4, { width: W, height: H, fps: { num: FPS, den: 1 } })), { id: "TAKE" });
    addFile(tx, media("/m/voice.wav", audioInfo("/m/voice.wav", 10)), { id: "VOICE" });
    if (withClips) {
      WINDOWS.forEach((w, i) => addClip(tx, { fileId: "TAKE", position: i * 0.5, layer: tx.project.layers[0]!.number, start: w.start, end: w.end, id: `C${i}` }));
    }
  });
  return { ...doc.project, history: { undo: [], redo: [] } };
}

type Row = { id: string; at: number; source_in: number; role: string; sync?: { from: string; voice_seconds: number } };
type Data = { order: Row[]; file_ids: string[]; cuts: { reasons: string[]; match: number }[]; mean_match: number; given_order_match: number; clip_ids?: string[]; track?: number };

describe("sequence_shots_tool", () => {
  it("lays windows of a take back in the order the action runs, on an empty track, in one undo step", async () => {
    const doc = new ProjectDocument(project(false));
    const frames = sampler();
    const result = await runTool({ doc, host: { frames } }, "sequence_shots_tool", { shots: WINDOWS.map((w) => ({ file_id: "TAKE", ...w })), arc: "flat", close: "none" });
    expect(result.data?.status, result.data?.summary).toMatch(/^(applied|unchanged)$/);
    const data = result.data?.data as Data;
    expect(data.order.map((r) => r.source_in)).toEqual([0, 0.5, 1, 1.5]);
    expect(data.order.map((r) => r.at)).toEqual([0, 0.5, 1, 1.5]);
    expect(data.cuts.every((c) => c.reasons.includes("next moment of the same source"))).toBe(true);
    expect(data.mean_match).toBeGreaterThan(data.given_order_match);
    expect(doc.undoLabels).toEqual(["Sequence shots"]);
    const placed = doc.project.clips.filter((c) => data.clip_ids!.includes(String(c.id))).sort((a, b) => a.position - b.position);
    expect(placed.map((c) => [c.position, c.start, c.end])).toEqual([[0, 0, 0.5], [0.5, 0.5, 1], [1, 1, 1.5], [1.5, 1.5, 2]]);
    expect(frames.samples).toBeGreaterThan(0);
  });

  it("reorders the clips of a track in place, then reports nothing to do", async () => {
    const doc = new ProjectDocument(project(true));
    const host: ToolHost = { frames: sampler() };
    const track = doc.project.layers[0]!.number;
    const first = await runTool({ doc, host }, "sequence_shots_tool", { track, arc: "flat", close: "none" });
    expect(first.data?.status, first.data?.summary).toBe("applied");
    const byPosition = [...doc.project.clips].sort((a, b) => a.position - b.position).map((c) => c.id);
    expect(byPosition).toEqual(["C2", "C0", "C3", "C1"]);
    const again = await runTool({ doc, host }, "sequence_shots_tool", { track, arc: "flat", close: "none" });
    expect(again.data?.summary).toMatch(/already in this order/);
    expect(doc.undoLabels).toEqual(["Sequence shots"]);
  });

  it("dry_run plans without touching the timeline", async () => {
    const doc = new ProjectDocument(project(true));
    const result = await runTool({ doc, host: { frames: sampler() } }, "sequence_shots_tool", { track: doc.project.layers[0]!.number, dry_run: true, arc: "flat", close: "none" });
    expect(result.data?.status, result.data?.summary).toMatch(/^(applied|unchanged)$/);
    expect(result.data?.summary).toMatch(/dry run/);
    expect((result.data?.data as Data).order.map((r) => r.id)).toEqual(["C2", "C0", "C3", "C1"]);
    expect(doc.undoLabels).toEqual([]);
    expect(doc.project.clips.find((c) => c.id === "C0")!.position).toBe(0);
    // A track is named the way every tool names one: UI track 1 is the bottom layer.
    const ui = await runTool({ doc, host: { frames: sampler() } }, "sequence_shots_tool", { track: 1, dry_run: true, arc: "flat", close: "none" });
    expect((ui.data?.data as Data).order.map((r) => r.id)).toEqual(["C2", "C0", "C3", "C1"]);
  });

  it("starts a speaker shot on its words in the voice (says + the voice's transcript)", async () => {
    const doc = new ProjectDocument(project(false));
    const transcript: StoredTranscript = {
      modelId: "test",
      language: "en",
      requestLanguage: "auto",
      generation: 1,
      transcriptionSource: "server",
      createdAt: 0,
      words: ["so", "this", "is", "where", "it", "starts"].map((text, k) => ({ text, startSec: 0.5 + k * 0.25, endSec: 0.7 + k * 0.25 })),
      segments: [],
    };
    doc.transaction("transcribe", () => storeTranscript(doc, "VOICE", transcript));
    // The last window says "where it starts": 1.25 s into the voice, which starts on the timeline at 0.25 s.
    const shots = WINDOWS.map((w, i) => ({ file_id: "TAKE", ...w, ...(i === 3 ? { says: "where it starts" } : {}) }));
    const result = await runTool({ doc, host: { frames: sampler() } }, "sequence_shots_tool", { shots, voice_file_id: "VOICE", voice_at: 0.25, arc: "flat", close: "none" });
    expect(result.data?.status, result.data?.summary).toMatch(/^(applied|unchanged)$/);
    const synced = (result.data?.data as Data).order.find((r) => r.sync)!;
    expect(synced.source_in).toBe(1);
    expect(synced.at).toBe(1.5);
    expect(synced.sync).toEqual({ voice_seconds: 1.25, from: "says", score: 1 });
  });

  it("refuses what it cannot do, changing nothing", async () => {
    const doc = new ProjectDocument(project(true));
    const host: ToolHost = { frames: sampler() };
    const run = (args: Record<string, unknown>) => runTool({ doc, host }, "sequence_shots_tool", args);
    expect((await run({})).data?.summary).toMatch(/^Error: give shots, file_ids, or a track/);
    expect((await run({ file_ids: ["TAKE", "NOPE"] })).data?.summary).toMatch(/^Error: unknown file_id NOPE/);
    expect((await run({ shots: [{ clip_id: "C0" }, { file_id: "TAKE" }] })).data?.summary).toMatch(/not a mix/);
    expect((await run({ shots: [{ clip_id: "C0" }, { clip_id: "C1" }], slots: [1, 1, 1] })).data?.summary).toMatch(/3 slots but only 2 shots/);
    expect((await run({ shots: [{ clip_id: "C0" }, { clip_id: "C1" }], slots: [2, 2] })).data?.summary).toMatch(/shorter than their slots/);
    expect((await run({ shots: [{ clip_id: "C0", says: "hi" }, { clip_id: "C1" }] })).data?.summary).toMatch(/give voice_file_id/);
    expect((await run({ shots: [{ clip_id: "C0", says: "hi" }, { clip_id: "C1" }], voice_file_id: "VOICE" })).data?.summary).toMatch(/transcribe_media_tool/);
    // Pinned shots each need a slot; the default payoff gives way when none is left for it.
    expect((await run({ track: doc.project.layers[0]!.number, open: "C0", close: "C1", slots: [0.5] })).data?.summary).toMatch(/2 shots must stay .* only 1 slots/);
    const one = await run({ track: doc.project.layers[0]!.number, open: "C0", slots: [0.5], dry_run: true });
    expect((one.data?.data as Data).order.map((r) => [r.id, r.at])).toEqual([["C0", 0]]);
    // A subset of a track's clips laid back to back would cover the clip between them.
    expect((await run({ shots: [{ clip_id: "C0" }, { clip_id: "C2" }], arc: "flat", close: "none" })).data?.summary).toMatch(/would cover clip\(s\) C1/);
    expect(doc.undoLabels).toEqual([]);
  });

  it("reads rendered frames where the host has no sampleFrames", async () => {
    const doc = new ProjectDocument(project(false));
    const result = await runTool({ doc, host: { frames: pixelFrameHost(paint) } }, "sequence_shots_tool", { shots: WINDOWS.map((w) => ({ file_id: "TAKE", ...w })), arc: "flat", close: "none", dry_run: true });
    expect(result.data?.status, result.data?.summary).toMatch(/^(applied|unchanged)$/);
    expect((result.data?.data as Data).order.map((r) => r.source_in)).toEqual([0, 0.5, 1, 1.5]);
  });

  it("has the genre tools order a file list that is just the bin's own order (a montage's file_ids, a reel's default), unless keep_order", async () => {
    const doc = new ProjectDocument(project(false));
    doc.transaction("more files", (tx) => {
      for (const k of [1, 2, 3]) addFile(tx, media(`/m/take${k}.mp4`, videoInfo(`/m/take${k}.mp4`, 2, { width: W, height: H, fps: { num: FPS, den: 1 } })), { id: `TAKE${k}` });
    });
    const ids = ["TAKE", "TAKE1", "TAKE2", "TAKE3"];
    const host: ToolHost = { ...fakeHost(), frames: sampler() };
    const montage = await runTool({ doc, host }, "match_cut_montage_tool", { file_ids: ids, duration_seconds: 4, flash: false, transitions: "none" });
    expect(montage.data?.status, montage.data?.summary).toBe("applied");
    expect(montage.data?.notes?.join(" ")).toMatch(/^The files were in bin order: ordered by continuity first .* Pass keep_order: true/);
    const kept = await runTool({ doc, host }, "match_cut_montage_tool", { file_ids: ids, duration_seconds: 4, flash: false, transitions: "none", replace: true, keep_order: true });
    expect(kept.data?.notes ?? []).toEqual([]);
    // A chosen order is left alone.
    const chosen = await runTool({ doc, host }, "match_cut_montage_tool", { file_ids: ["TAKE2", "TAKE", "TAKE3", "TAKE1"], duration_seconds: 4, flash: false, transitions: "none", replace: true });
    expect(chosen.data?.notes ?? []).toEqual([]);
    // Frames that cannot be read (ffmpeg could not start) keep the order given, with a warning that says so.
    const broken: ToolHost = { ...host, frames: { renderFrame: () => Promise.reject(new Error("spawn ffmpeg EAGAIN")), sampleFrames: () => Promise.reject(new Error("spawn ffmpeg EAGAIN")) } };
    const unordered = await runTool({ doc, host: broken }, "match_cut_montage_tool", { file_ids: ids, duration_seconds: 4, flash: false, transitions: "none", replace: true, subjects: ids.map((file_id) => ({ file_id, box: { x: 0, y: 0, w: 1, h: 1 } })) });
    expect(unordered.data?.warnings?.join(" ")).toMatch(/The files are in bin order and could not be ordered \(could not read the frames of TAKE: spawn ffmpeg EAGAIN\)/);
    // build_reel_tool orders the bin it defaults to; file_ids it is given are a story order, even the bin's.
    const reel = await runTool({ doc, host }, "build_reel_tool", { style: "hype", duration_seconds: 4, replace: true });
    expect(reel.data?.status, reel.data?.summary).toBe("applied");
    expect(reel.data?.notes?.[0]).toMatch(/^The files were in bin order: ordered by continuity first/);
    const story = await runTool({ doc, host }, "build_reel_tool", { style: "hype", file_ids: ids, duration_seconds: 4, replace: true });
    expect(story.data?.notes?.join(" ")).not.toMatch(/bin order/);
  });
});
