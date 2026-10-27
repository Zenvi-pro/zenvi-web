import { describe, expect, it } from "vitest";
import { measureLoudness } from "../../mastering/loudness.js";
import { addEffect } from "../../ops/effects.js";
import { curvePoints } from "../audio-mix.js";
import { runTool } from "../registry.js";
import type { ToolReceipt } from "../receipt.js";
import { MIX_RATE, mixProject, type MixProject } from "../test-support/mix-host.js";
import { planPeakRides, MAX_RIDE_DB } from "./master-limit.js";

async function loudness(p: MixProject) {
  const pcm = await p.host.audio!.mixPcm!(p.doc.project, {});
  return measureLoudness(pcm.channels, MIX_RATE);
}

/** The fixture with its six clicks 12 dB hot: their peaks stop the master short of -14 LUFS. */
function peaky(): MixProject {
  const p = mixProject({ transcript: true });
  p.doc.transaction("hot hits", (tx) => {
    for (const id of p.hits) addEffect(tx, id, "Compressor", { makeup_gain: 12, ratio: 1, threshold: 0 });
  });
  return p;
}

async function master(p: MixProject, args: Record<string, unknown>): Promise<ToolReceipt> {
  const result = await runTool({ doc: p.doc, host: p.host }, "master_audio_tool", { preset: "social", balance: "keep", score: false, ...args });
  expect(result.ok, result.text).toBe(true);
  return result.data as ToolReceipt;
}

describe("planPeakRides", () => {
  it("turns down only the frames that would pass the ceiling, holds a frame either side, eases in and out, and caps the depth", () => {
    const sr = 48000;
    const fps = 30;
    const x = new Float32Array(sr * 2).fill(0.1);
    x[Math.round(sr * 1.01)] = 0.9;
    const rides = planPeakRides([{ channels: [x], gainDb: 0 }], sr, fps, -1, 6)!;
    const peakFrame = 30;
    expect(rides[peakFrame]).toBeGreaterThan(0);
    expect(rides[peakFrame]).toBeLessThanOrEqual(MAX_RIDE_DB);
    expect(rides[peakFrame - 1]).toBe(rides[peakFrame]);
    expect(rides[peakFrame + 1]).toBe(rides[peakFrame]);
    expect(rides[peakFrame + 2]).toBeCloseTo(rides[peakFrame]! - 2, 6);
    expect(rides[5]).toBe(0);
    expect(planPeakRides([{ channels: [x], gainDb: -20 }], sr, fps, -1, 1)).toBeNull();
  });
});

describe("master_audio_tool peak rides", { timeout: 60_000 }, () => {
  it("rides the peaks down so the mix gets closer to the target in one undo step, leaving the voice alone", async () => {
    const off = peaky();
    expect((await master(off, { limit: false })).data).toMatchObject({ limitedBy: "peak" });
    const stopped = await loudness(off);

    const p = peaky();
    const undo = p.doc.undoLabels.length;
    const voiceCurve = JSON.stringify(curvePoints(p.doc.project.clips.find((c) => c.id === p.voice)));
    const receipt = await master(p, {});
    expect(p.doc.undoLabels.length).toBe(undo + 1);
    expect(receipt.summary).toMatch(/peaks ridden down/);
    const after = await loudness(p);
    expect(after.integrated).toBeGreaterThan(stopped.integrated + 1);
    expect(after.truePeakDb).toBeLessThanOrEqual(-0.9);
    // The voice keeps its own curve (gain may scale it, rides never touch it); the clicks carry the rides.
    const voice = curvePoints(p.doc.project.clips.find((c) => c.id === p.voice));
    expect(voice.length).toBeLessThanOrEqual(Math.max(1, JSON.parse(voiceCurve).length));
    expect(p.hits.some((id) => curvePoints(p.doc.project.clips.find((c) => c.id === id)).length > 2)).toBe(true);
  });
});
