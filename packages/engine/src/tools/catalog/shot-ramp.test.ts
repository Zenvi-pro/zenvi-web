import { describe, expect, it } from "vitest";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { IDS, L1, fixtureDoc, snapshotOf } from "../test-support/fixture.js";

const SR = BEAT_SAMPLE_RATE;

/** A click every half second (120 BPM) for `seconds`. */
function metronome(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let t = 0; t < seconds; t += 0.5) {
    const at = Math.round(t * SR);
    for (let k = 0; k < 0.03 * SR && at + k < out.length; k += 1) out[at + k] = 0.8 * Math.exp(-k / (0.005 * SR)) * Math.sin((2 * Math.PI * 1000 * k) / SR);
  }
  return out;
}

function hostWithMusic(): FakeHost {
  const host = fakeHost();
  host.audio!.decodePcm = async () => ({ sampleRate: SR, samples: metronome(60) });
  return host;
}

interface Shot {
  timeline_clip_id: string;
  file_id: string;
  start: number;
  length: number;
  source_start: number;
  motif?: boolean;
}

async function ramp(doc: ReturnType<typeof fixtureDoc>, args: Record<string, unknown>, host = hostWithMusic()) {
  const result = await runTool({ doc, host }, "shot_length_ramp_tool", args);
  const receipt = result.data as ToolReceipt;
  return { receipt, data: receipt.data as { shots: Shot[]; snapped?: number; cuts?: number; layer: number; createdClipIds: string[] } };
}

describe("shot_length_ramp_tool", () => {
  it("cuts a shortening ramp on a new track, settles, and is one undo step", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const { receipt, data } = await ramp(doc, { file_ids: [IDS.broll, IDS.interview], shots: "8", first_shot_seconds: "2", last_shot_seconds: "0.3", settle_seconds: "1.5", settle_file_id: IDS.logo });
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(1);
    expect(receipt.summary).toMatch(/^Cut a 8-shot ramp from 2\.00 s to 0\.30 s, settling on a 1\.50 s shot on a new track \(track 6\), 0\.00-\d+\.\d\d s\.$/);
    expect(data.shots).toHaveLength(9);
    const lengths = data.shots.slice(0, 8).map((s) => s.length);
    for (let i = 1; i < lengths.length; i += 1) expect(lengths[i]!).toBeLessThanOrEqual(lengths[i - 1]! + 1e-9);
    expect(data.shots[8]).toMatchObject({ file_id: IDS.logo, length: 1.5 });
    // Butt cuts: each shot starts where the one before ends.
    for (let i = 1; i < data.shots.length; i += 1) expect(data.shots[i]!.start).toBeCloseTo(data.shots[i - 1]!.start + data.shots[i - 1]!.length, 3);
    expect(data.layer).toBeGreaterThan(L1);
    doc.undo();
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("lands cuts on the music's beats without losing the ramp's shape, and brings the motif back", async () => {
    const doc = fixtureDoc();
    const { data } = await ramp(doc, {
      file_ids: [IDS.broll, IDS.interview],
      shots: "10",
      first_shot_seconds: "1.6",
      last_shot_seconds: "0.5",
      snap: "beats",
      snap_clip_id: IDS.clipMusic,
      position: "0",
      motif_file_id: IDS.logo,
      motif_every: "3",
      audio: "mute",
    });
    expect(data.cuts).toBe(9);
    expect(data.snapped).toBeGreaterThanOrEqual(3);
    // Snapping never makes a shot longer than the one before it.
    for (let i = 1; i < data.shots.length; i += 1) expect(data.shots[i]!.length).toBeLessThanOrEqual(data.shots[i - 1]!.length + 1 / 30 + 1e-6);
    // Snapped cuts sit on the 0.5 s grid (the music clip plays from 0 at timeline 0).
    const onBeat = data.shots.slice(1).filter((s) => Math.abs(s.start * 2 - Math.round(s.start * 2)) < 0.02);
    expect(onBeat.length).toBe(data.snapped);
    expect(data.shots.filter((s) => s.motif).map((s) => s.file_id)).toEqual([IDS.logo, IDS.logo, IDS.logo]);
    expect(data.shots[0]!.length).toBeGreaterThan(data.shots[9]!.length);
    const clip = doc.project.clips.find((c) => c.id === data.createdClipIds[0])!;
    expect(clip.volume.Points[0]!.co.Y).toBe(0);
  });

  it("refuses a ramp that would cover clips, and snapping without a clip, before changing anything", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    expect((await ramp(doc, { file_ids: [IDS.broll], track: "1", position: "0" })).receipt.summary).toMatch(/would cover \d+ clip\(s\) on track 1/);
    expect((await ramp(doc, { file_ids: [IDS.broll], snap: "beats" })).receipt.summary).toMatch(/needs snap_clip_id/);
    expect((await ramp(doc, { file_ids: [IDS.music] })).receipt.summary).toMatch(/has no picture/);
    expect(snapshotOf(doc.project)).toEqual(before);
  });
});
