import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { findClip } from "../../model/query.js";
import { setClipSpeed, setClipTiming } from "../../ops/clips.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { IDS, fixtureDoc, snapshotOf } from "../test-support/fixture.js";

const SR = BEAT_SAMPLE_RATE;

/** `seconds` of near-silence with a sharp click at each of `hits` (file seconds). */
function clicks(seconds: number, hits: readonly number[]): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i += 1) out[i] = 0.001 * Math.sin(i * 0.37);
  for (const t of hits) {
    const at = Math.round(t * SR);
    for (let k = 0; k < 0.05 * SR && at + k < out.length; k += 1) out[at + k] = out[at + k]! + 0.8 * Math.exp(-k / (0.006 * SR)) * Math.sin((2 * Math.PI * 900 * k) / SR);
  }
  return out;
}

/** The fixture's sounds: the b-roll hits 0.1 s in, the interview 0.1 s before its second clip's in point (10 s). */
const SOUNDS: Record<string, Float32Array> = {
  "/media/broll.mp4": clicks(12, [0.1, 3]),
  "/media/interview.mp4": clicks(20, [5, 9.9]),
  "/media/music.mp3": clicks(60, [9.95, 15.06]),
};

function hostWithAudio(): FakeHost {
  const host = fakeHost();
  host.audio!.decodePcm = async (path) => {
    const samples = SOUNDS[path];
    if (!samples) throw new Error(`${path} has no audio stream.`);
    return { sampleRate: SR, samples };
  };
  return host;
}

async function run(doc: ReturnType<typeof fixtureDoc>, name: string, args: Record<string, unknown>, host: FakeHost = hostWithAudio()) {
  const result = await runTool({ doc, host }, name, args);
  const receipt = result.data as ToolReceipt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- receipts are read field by field
  return { receipt, data: receipt.data as Record<string, any> };
}

describe("detect_onsets_tool", () => {
  it("lists a clip's transients on the timeline clock and proposes cuts on them", async () => {
    const doc = fixtureDoc();
    const { receipt, data } = await run(doc, "detect_onsets_tool", { clip_id: IDS.clipB });
    expect(receipt.status).toBe("applied");
    expect(data.clock).toBe("timeline");
    // b-roll plays from source 0 at timeline 10: its hits are at 10.1 and 13.
    const times = data.onsets.map((o: { timeSec: number }) => o.timeSec);
    expect(times).toHaveLength(2);
    expect(Math.abs(times[0] - 10.1)).toBeLessThan(0.02);
    expect(Math.abs(times[1] - 13)).toBeLessThan(0.02);
    expect(data.proposed_cuts).toHaveLength(2);
  });

  it("reads a file on its own clock and refuses without audio decoding", async () => {
    const doc = fixtureDoc();
    const { data } = await run(doc, "detect_onsets_tool", { file_id: IDS.music });
    expect(data.clock).toBe("file");
    expect(data.onsets.map((o: { timeSec: number }) => Math.round(o.timeSec * 10) / 10)).toEqual([10, 15.1]);
    const off = await run(doc, "detect_onsets_tool", { file_id: IDS.music }, fakeHost());
    expect(off.receipt.status).toBe("refused");
    expect(off.receipt.summary).toMatch(/cannot decode audio/);
  });
});

describe("snap_cuts_to_onsets_tool", () => {
  it("rolls each cut onto the incoming shot's own hit: nothing else moves, one undo step", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const { receipt, data } = await run(doc, "snap_cuts_to_onsets_tool", { track: "1", tolerance_frames: "4" });
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(data.moved.map((m: { frames: number }) => m.frames)).toEqual([3, -3]);
    const a = findClip(doc.project, IDS.clipA)!;
    const b = findClip(doc.project, IDS.clipB)!;
    const tail = findClip(doc.project, IDS.clipTail)!;
    // Roll edits: the outgoing out point and the incoming in point move together, the cut stays butt.
    expect(a.end).toBeCloseTo(10.1, 6);
    expect(b.position).toBeCloseTo(10.1, 6);
    expect(b.start).toBeCloseTo(0.1, 6);
    expect(b.end).toBeCloseTo(4.9, 6);
    expect(tail.position).toBeCloseTo(14.9, 6);
    expect(tail.start).toBeCloseTo(9.9, 6);
    // The b-roll's footage did not move on the timeline: source 3 s still plays at timeline 13 s.
    expect(b.position - b.start).toBeCloseTo(10, 6);
    doc.undo();
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("dry_run proposes without changing anything; a second run finds the cuts already on their hits", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const dry = await run(doc, "snap_cuts_to_onsets_tool", { track: "1", dry_run: "true" });
    expect(dry.receipt.summary).toMatch(/^Would snap 2 of 2 cut\(s\)/);
    expect(snapshotOf(doc.project)).toEqual(before);
    await run(doc, "snap_cuts_to_onsets_tool", { track: "1" });
    const again = await run(doc, "snap_cuts_to_onsets_tool", { track: "1" });
    expect(again.receipt.status).toBe("unchanged");
    expect(again.data.kept.map((k: { reason: string }) => k.reason)).toEqual(["already on a transient", "already on a transient"]);
  });

  it("snaps to another clip's hits within the tolerance, and keeps cuts the media cannot reach", async () => {
    const doc = fixtureDoc();
    // The music hits at 9.95 (1.5 frames before the first cut) and 15.06 (2 frames after the second).
    const { data } = await run(doc, "snap_cuts_to_onsets_tool", { onsets_from: "clip", onset_clip_id: IDS.clipMusic, track: "1" });
    // The b-roll starts at its first frame, so the first cut cannot move earlier.
    expect(data.moved.map((m: { incoming: string; frames: number }) => [m.incoming, m.frames])).toEqual([[IDS.clipTail, 2]]);
    expect(data.kept[0].reason).toMatch(/media can reach/);
  });

  it("counts what the first roll took from a short clip between two snapped cuts", async () => {
    const doc = fixtureDoc();
    // A 0.5 s b-roll insert (timeline 10-10.5) between the interview's two clips.
    doc.transaction("insert", (tx) => {
      setClipTiming(tx, IDS.clipB, { end: 0.5 });
      setClipTiming(tx, IDS.clipTail, { position: 10.5 });
    });
    const host = hostWithAudio();
    // The insert's hit is 0.4 s in (cut 1 rolls 12 frames later); the tail's 0.25 s before its in point would roll cut 2 earlier than where the insert now starts.
    const sounds: Record<string, Float32Array> = { "/media/broll.mp4": clicks(12, [0.4]), "/media/interview.mp4": clicks(20, [9.75]) };
    host.audio!.decodePcm = async (path) => ({ sampleRate: SR, samples: sounds[path]! });
    const { receipt, data } = await run(doc, "snap_cuts_to_onsets_tool", { track: "1", tolerance_frames: 12 }, host);
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(data.moved.map((m: { incoming: string; frames: number }) => [m.incoming, m.frames])).toEqual([[IDS.clipB, 12]]);
    expect(data.kept).toEqual(expect.arrayContaining([expect.objectContaining({ incoming: IDS.clipTail, reason: expect.stringMatching(/media can reach/) })]));
    const insert = findClip(doc.project, IDS.clipB)!;
    expect([insert.position, insert.start, insert.end].map((v) => Math.round(v * 30))).toEqual([312, 12, 15]);
  });

  it("keeps a cut between retimed clips and names it", async () => {
    const doc = fixtureDoc();
    doc.transaction("speed", (tx) => setClipSpeed(tx, IDS.clipTail, 2));
    const { data } = await run(doc, "snap_cuts_to_onsets_tool", { clip_ids: [IDS.clipTail] });
    expect(data.kept).toEqual([expect.objectContaining({ incoming: IDS.clipTail, reason: expect.stringMatching(/retimed/) })]);
  });

  it("keeps every cut of a locked track and adds no undo step", async () => {
    const doc = fixtureDoc();
    doc.setUntracked(["layers", { number: 1_000_000 }, "lock"], true);
    const before = snapshotOf(doc.project);
    const { receipt, data } = await run(doc, "snap_cuts_to_onsets_tool", { track: "1" });
    expect(receipt.status).toBe("unchanged");
    expect(receipt.undoSteps).toBe(0);
    expect(data.kept.map((k: { reason: string }) => k.reason)).toEqual(["the track is locked", "the track is locked"]);
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("refuses an unknown clip and a missing onset clip before reading audio", async () => {
    const doc = fixtureDoc();
    expect((await run(doc, "snap_cuts_to_onsets_tool", { clip_ids: ["NOPE"] })).receipt.summary).toMatch(/No timeline clip with id='NOPE'/);
    expect((await run(doc, "snap_cuts_to_onsets_tool", { onsets_from: "clip" })).receipt.summary).toMatch(/needs onset_clip_id/);
  });
});
