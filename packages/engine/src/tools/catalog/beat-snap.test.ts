import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { findClip } from "../../model/query.js";
import { deleteClips } from "../../ops/clips.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { IDS, fixtureDoc, snapshotOf } from "../test-support/fixture.js";

const SR = BEAT_SAMPLE_RATE;

/** A click track: a kick-like thump every `period` seconds from `offset`, louder on every fourth. */
function clickTrack(seconds: number, period: number, offset: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let n = 0, t = offset; t < seconds; n += 1, t += period) {
    const at = Math.round(t * SR);
    const gain = n % 4 === 0 ? 0.9 : 0.5;
    for (let k = 0; k < 0.08 * SR && at + k < out.length; k += 1) out[at + k] = gain * Math.exp(-k / (0.015 * SR)) * Math.sin((2 * Math.PI * 70 * k) / SR);
  }
  return out;
}

function hostWithMusic(): FakeHost {
  const host = fakeHost();
  const music = clickTrack(60, 0.5, 0.07);
  host.audio!.decodePcm = async (path) => {
    if (path !== "/media/music.mp3") throw new Error(`${path} has no audio stream.`);
    return { sampleRate: SR, samples: music };
  };
  return host;
}

async function run(doc: ReturnType<typeof fixtureDoc>, args: Record<string, unknown>, host: FakeHost = hostWithMusic()) {
  const result = await runTool({ doc, host }, "snap_cuts_to_beats_tool", args);
  const receipt = result.data as ToolReceipt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- receipts are read field by field
  return { receipt, data: receipt.data as Record<string, any> };
}

describe("snap_cuts_to_beats_tool", () => {
  it("rolls each cut onto the music clip's nearest tracked beat: nothing else moves, one undo step", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    // Cuts at 10 and 15; the beat is at 0.07 + 0.5k, so both move 0.07 s later (2 frames at 30 fps).
    const { receipt, data } = await run(doc, { track: "1" });
    expect(receipt.status, receipt.summary).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(data.source).toMatch(/120 BPM/);
    expect(data.moved.map((m: { to: number }) => m.to)).toEqual([10.067, 15.067]);
    const a = findClip(doc.project, IDS.clipA)!;
    const b = findClip(doc.project, IDS.clipB)!;
    expect(a.end).toBeCloseTo(10 + 2 / 30, 6);
    expect(b.position).toBeCloseTo(10 + 2 / 30, 6);
    expect(b.start).toBeCloseTo(2 / 30, 6);
    // The music, the logo and the sequence length stay put.
    expect(findClip(doc.project, IDS.clipMusic)).toMatchObject({ position: 0, start: 0, end: 19 });
    const tail = findClip(doc.project, IDS.clipTail)!;
    expect(tail.position + tail.end - tail.start).toBeCloseTo(19, 6);
    doc.undo();
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("uses the caller's grid, snaps to bar lines, and only proposes on a dry run", async () => {
    const doc = fixtureDoc();
    // 100 BPM from 0.4 s in the music: bars every 2.4 s, so 10 is on one and 15 moves to the one at 14.8.
    const { receipt, data } = await run(doc, { track: "1", bpm: 100, offset_seconds: 0.4, grid: "downbeats", dry_run: true });
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(0);
    expect(receipt.summary).toMatch(/dry run/);
    expect(data.kept.map((k: { reason: string }) => k.reason)).toEqual(["already on the beat"]);
    expect(data.moved.map((m: { from: number; to: number }) => [m.from, m.to])).toEqual([[15, 14.8]]);
    expect(doc.undoLabels).toEqual([]);
  });

  it("says when every cut is on the beat, and refuses without music or a grid", async () => {
    const doc = fixtureDoc();
    const done = await run(doc, { track: "1", bpm: 120, offset_seconds: 0 });
    expect(done.receipt.status).toBe("unchanged");
    expect(done.receipt.summary).toMatch(/every cut is on the beat already/);
    doc.transaction("drop music", (tx) => deleteClips(tx, [IDS.clipMusic], { ripple: false }));
    const none = await run(doc, { track: "1" });
    expect(none.receipt.summary).toMatch(/^Error: no music on the timeline/);
    const bad = await run(doc, { track: "1", offset_seconds: 1 });
    expect(bad.receipt.summary).toMatch(/^Error: offset_seconds goes with bpm/);
  });
});
