import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { ProjectDocument } from "../../history/document.js";
import { createProject } from "../../model/defaults.js";
import type { Project } from "../../model/types.js";
import { addClip, addFile } from "../../ops/index.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { audioInfo, imageInfo, media, videoInfo } from "../test-support/fixture.js";

const SR = BEAT_SAMPLE_RATE;

/**
 * An 8 s edit: shots A and B (4 s each, from 0.2 s into 10 s files), a card over
 * its last 2 s, a song under it, and a spare file in the bin.
 */
function shortEdit(songSeconds = 25): ProjectDocument {
  const scratch = new ProjectDocument(createProject({ id: "FILLPROJ01" }));
  scratch.transaction("fixture", (tx) => {
    addFile(tx, media("/m/a.mp4", videoInfo("/m/a.mp4", 10)), { id: "FILEAAAAAA" });
    addFile(tx, media("/m/b.mp4", videoInfo("/m/b.mp4", 10)), { id: "FILEBBBBBB" });
    addFile(tx, media("/m/spare.mp4", videoInfo("/m/spare.mp4", 20)), { id: "FILESPARE1" });
    addFile(tx, media("/m/song.mp3", audioInfo("/m/song.mp3", songSeconds)), { id: "FILESONG01" });
    addFile(tx, media("/m/card.png", imageInfo("/m/card.png")), { id: "FILECARD01" });
    const [l1, l2, l3] = tx.project.layers.map((l) => l.number).sort((a, b) => a - b);
    addClip(tx, { fileId: "FILEAAAAAA", position: 0, layer: l3!, start: 0.2, end: 4.2, id: "CLIPAAAAAA" });
    addClip(tx, { fileId: "FILEBBBBBB", position: 4, layer: l3!, start: 0.2, end: 4.2, id: "CLIPBBBBBB" });
    addClip(tx, { fileId: "FILECARD01", position: 6, layer: l2!, start: 0, end: 2, id: "CLIPCARD01" });
    addClip(tx, { fileId: "FILESONG01", position: 0, layer: l1!, start: 0, end: 8, id: "CLIPSONG01" });
  });
  const project: Project = structuredClone(scratch.project);
  project.history = { undo: [], redo: [] };
  return new ProjectDocument(project);
}

/** A 120 BPM click track from 0.07 s. */
function clicks(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let n = 0, t = 0.07; t < seconds; n += 1, t += 0.5) {
    const at = Math.round(t * SR);
    for (let k = 0; k < 0.08 * SR && at + k < out.length; k += 1) out[at + k] = (n % 4 === 0 ? 0.9 : 0.5) * Math.exp(-k / (0.015 * SR)) * Math.sin((2 * Math.PI * 70 * k) / SR);
  }
  return out;
}

async function fill(doc: ProjectDocument, args: Record<string, unknown>, host: FakeHost = fakeHost()) {
  const result = await runTool({ doc, host }, "fill_to_length_tool", args);
  const receipt = result.data as ToolReceipt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- receipts are read field by field
  return { receipt, data: receipt.data as Record<string, any> };
}

const picture = (doc: ProjectDocument) =>
  doc.project.clips
    .filter((c) => c.layer === doc.project.clips.find((k) => k.id === "CLIPAAAAAA")!.layer)
    .sort((a, b) => a.position - b.position)
    .map((c) => [String(c.file_id), Math.round(c.position * 1000) / 1000, Math.round(c.start * 1000) / 1000, Math.round(c.end * 1000) / 1000]);

describe("fill_to_length_tool", () => {
  it("holds the last shot, adds unseen footage after it, moves the end card and runs the music on: one undo step", async () => {
    const doc = shortEdit();
    const { receipt, data } = await fill(doc, { seconds: 20 });
    expect(receipt.status, receipt.summary).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(data.to_seconds).toBe(20);
    expect(picture(doc)).toEqual([
      ["FILEAAAAAA", 0, 0.2, 4.2],
      // The hold: B runs on 3 s into its media.
      ["FILEBBBBBB", 4, 0.2, 7.2],
      // The spare file first, then moments of A and B not shown yet (the last one shorter, so nothing is left a sliver).
      ["FILESPARE1", 11, 0.2, 4.2],
      ["FILEAAAAAA", 15, 4.2, 8.2],
      ["FILEBBBBBB", 19, 7.2, 8.2],
    ]);
    const card = doc.project.clips.find((c) => c.id === "CLIPCARD01")!;
    expect(card.position + card.end - card.start).toBeCloseTo(20, 6);
    const song = doc.project.clips.find((c) => c.id === "CLIPSONG01")!;
    expect(song.end).toBeCloseTo(20, 6);
    doc.undo();
    expect(picture(doc)).toHaveLength(2);
  });

  it("repeats the music's last bars on a bar line when the song runs out, and cuts the new shots in whole beats", async () => {
    const doc = shortEdit(10);
    const host = fakeHost();
    const song = clicks(10);
    host.audio!.decodePcm = async () => ({ sampleRate: SR, samples: song });
    const { receipt, data } = await fill(doc, { seconds: 20, steps: ["broll"] }, host);
    expect(receipt.status, receipt.summary).toBe("applied");
    expect(receipt.summary).toMatch(/whole beats/);
    expect(receipt.warnings?.join(" ")).toMatch(/runs out: its last 4 bar\(s\) from 0\.07 s repeat/);
    expect(data.music[0].loops_from).toBeCloseTo(0.07, 2);
    const bed = doc.project.clips.filter((c) => c.file_id === "FILESONG01").sort((a, b) => a.position - b.position);
    // Cut on its last bar line inside the clip (6.07 s), then 0.07-6.07 again until the new end.
    expect(bed[0]!.end).toBeCloseTo(6.07, 1);
    expect(bed.slice(1).every((c) => Math.abs(c.start - bed[1]!.start) < 1e-6)).toBe(true);
    expect(Math.max(...bed.map((c) => c.position + c.end - c.start))).toBeCloseTo(20, 2);
  });

  it("slows the track's last shots when no footage is left, says what is still short, and proposes only on a dry run", async () => {
    const doc = shortEdit();
    const dry = await fill(doc, { seconds: 30, steps: ["slow"], max_slow: 0.5, dry_run: true });
    expect(dry.receipt.undoSteps).toBe(0);
    expect(dry.data.slow).toBe(0.5);
    expect(dry.data.slowed_clip_ids).toEqual(["CLIPAAAAAA", "CLIPBBBBBB"]);
    expect(dry.data.short_seconds).toBeCloseTo(14, 2);
    expect(dry.receipt.warnings?.join(" ")).toMatch(/Still 14 s short/);
    expect(doc.undoLabels).toEqual([]);
    // Only as many shots as cover it: 1 s more is the last shot at 80 %.
    const done2 = await fill(doc, { seconds: 9, steps: ["slow"] });
    expect(done2.data.slowed_clip_ids).toEqual(["CLIPBBBBBB"]);
    const b = doc.project.clips.find((c) => c.id === "CLIPBBBBBB")!;
    expect(b.position).toBeCloseTo(4, 6);
    expect(b.position + b.end - b.start).toBeCloseTo(9, 2);
    doc.undo();
    const done = await fill(doc, { seconds: 7 });
    expect(done.receipt.status).toBe("unchanged");
  });
});
