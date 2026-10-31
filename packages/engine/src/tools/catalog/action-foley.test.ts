import { describe, expect, it } from "vitest";
import type { LumaFrames } from "../../analysis/action.js";
import { BEAT_SAMPLE_RATE } from "../../analysis/beats.js";
import { isSfxClip } from "../../sfx/moments.js";
import type { ToolReceipt } from "../receipt.js";
import { runTool } from "../registry.js";
import { fakeHost, type FakeHost } from "../test-support/fake-host.js";
import { IDS, fixtureDoc, snapshotOf } from "../test-support/fixture.js";

/** The b-roll's picture: a box falls and lands on file frame 30 (1 s), then a fingertip taps down on frame 75 (2.5 s). */
function broll(options: { width: number; height: number; fps: number; startSeconds?: number; maxSeconds?: number }): LumaFrames {
  const { width, height, fps } = options;
  const first = Math.round((options.startSeconds ?? 0) * fps);
  const count = Math.round((options.maxSeconds ?? 5) * fps);
  const frames: Uint8Array[] = [];
  for (let k = 0; k < count; k += 1) {
    const f = first + k;
    const img = new Uint8Array(width * height).fill(30);
    const box = (x: number, y: number, w: number, h: number) => {
      for (let r = Math.max(0, y); r < Math.min(height, y + h); r += 1) for (let c = x; c < x + w; c += 1) img[r * width + c] = 230;
    };
    box(40, 2 + 2 * Math.min(Math.max(f - 10, 0), 20), 14, 12);
    box(80, 10 + 2 * (Math.min(Math.max(f, 72), 75) - 72), 4, 4);
    frames.push(img);
  }
  return { fps, width, height, startSeconds: options.startSeconds ?? 0, frames };
}

/** The b-roll's sound: the landing is heard one frame late (1.033 s). */
function brollSound(): Float32Array {
  const sr = BEAT_SAMPLE_RATE;
  const out = new Float32Array(12 * sr);
  const at = Math.round((31 / 30) * sr);
  for (let k = 0; k < 0.05 * sr; k += 1) out[at + k] = 0.8 * Math.exp(-k / (0.006 * sr)) * Math.sin((2 * Math.PI * 900 * k) / sr);
  return out;
}

function hostWithPicture(): FakeHost {
  const host = fakeHost();
  host.media!.decodeLuma = async (_path, options) => broll(options);
  host.audio!.decodePcm = async () => ({ sampleRate: BEAT_SAMPLE_RATE, samples: brollSound() });
  return host;
}

interface Row {
  at: number;
  kind: string;
  heard: boolean;
  recipe: string;
}

async function spot(doc: ReturnType<typeof fixtureDoc>, args: Record<string, unknown>, host = hostWithPicture()) {
  const result = await runTool({ doc, host }, "spot_action_foley_tool", args);
  const receipt = result.data as ToolReceipt;
  return { receipt, data: receipt.data as { cues: Row[]; createdClipIds?: string[] } };
}

describe("spot_action_foley_tool", () => {
  it("spots the landing and the tap on the timeline, and moves a cue onto the hit the clip already has", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const { receipt, data } = await spot(doc, { clip_id: IDS.clipB, sensitivity: "high" });
    expect(receipt.status).toBe("applied");
    expect(receipt.undoSteps).toBe(0);
    // The b-roll plays from source 0 at timeline 10: landing at 11.0 (heard at 11.033), tap at 12.5.
    expect(data.cues.map((c) => [c.at, c.kind, c.heard])).toEqual([
      [11.033, expect.stringMatching(/impact|contact/), true],
      [12.5, "tap", false],
    ]);
    expect(data.cues[1]!.recipe).toBe("keyboard_key");
    expect(receipt.summary).toMatch(/^2 foley cue\(s\) in .*\(10\.00-15\.00 s\)/);
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("place=true puts the suggested sounds on the SFX track in one undo step", async () => {
    const doc = fixtureDoc();
    const before = snapshotOf(doc.project);
    const { receipt, data } = await spot(doc, { clip_id: IDS.clipB, sensitivity: "high", place: "true" });
    expect(receipt.undoSteps).toBe(1);
    expect(data.createdClipIds).toHaveLength(2);
    const placed = doc.project.clips.filter((c) => data.createdClipIds!.includes(c.id));
    expect(placed.every(isSfxClip)).toBe(true);
    doc.undo();
    expect(snapshotOf(doc.project)).toEqual(before);
  });

  it("analyses high-frame-rate footage at no more than 60 fps", async () => {
    const doc = fixtureDoc();
    const fileId = String(doc.project.clips.find((c) => c.id === IDS.clipB)!.file_id);
    doc.transaction("slow-motion source", (tx) => tx.update(["files", { id: fileId }], { fps: { num: 240, den: 1 } }));
    const host = hostWithPicture();
    const rates: number[] = [];
    host.media!.decodeLuma = async (_path, options) => {
      rates.push(options.fps);
      return broll(options);
    };
    expect((await spot(doc, { clip_id: IDS.clipB }, host)).receipt.status).toBe("applied");
    expect(rates).toEqual([60]);
  });

  it("refuses a range outside the clip and surfaces that cannot decode frames", async () => {
    const doc = fixtureDoc();
    expect((await spot(doc, { clip_id: IDS.clipB, start: "30" })).receipt.summary).toMatch(/range is outside/);
    const off = await spot(doc, { clip_id: IDS.clipB }, fakeHost());
    expect(off.receipt.status).toBe("refused");
    expect(off.receipt.summary).toMatch(/cannot decode video frames/);
  });
});
