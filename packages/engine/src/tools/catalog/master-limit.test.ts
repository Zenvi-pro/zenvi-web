import { describe, expect, it } from "vitest";
import { measureLoudness } from "../../mastering/loudness.js";
import { addEffect } from "../../ops/effects.js";
import { curvePoints } from "../audio-mix.js";
import { runTool } from "../registry.js";
import type { ToolReceipt } from "../receipt.js";
import { MIX_RATE, mixProject, type MixProject } from "../test-support/mix-host.js";
import { MAX_BED_RIDE_DB, MAX_RIDE_DB, planPeakRides } from "./master-limit.js";

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
  const sr = 48000;
  const fps = 30;
  const peakFrame = 30;
  /** A steady bed and a click at 1.01 s. */
  function parts(click: number): { bed: Float32Array; hit: Float32Array } {
    const bed = new Float32Array(sr * 2).fill(0.3);
    const hit = new Float32Array(sr * 2);
    hit[Math.round(sr * 1.01)] = click;
    return { bed, hit };
  }

  it("takes the bed down under a hit first, held a frame either side and eased in and out", () => {
    const { bed, hit } = parts(0.55);
    const rides = planPeakRides([{ channels: [bed], gainDb: 0, bed: true }, { channels: [hit], gainDb: 0, bed: false }], sr, fps, -1, 1)!;
    expect(rides.all.every((d) => d === 0)).toBe(true);
    expect(rides.bed[peakFrame]).toBeGreaterThan(0);
    expect(rides.bed[peakFrame]).toBeLessThanOrEqual(MAX_BED_RIDE_DB);
    expect(rides.bed[peakFrame - 1]).toBe(rides.bed[peakFrame]);
    expect(rides.bed[peakFrame + 1]).toBe(rides.bed[peakFrame]);
    expect(rides.bed[peakFrame + 2]).toBeCloseTo(Math.max(0, rides.bed[peakFrame]! - 2), 6);
    expect(rides.bed[5]).toBe(0);
  });

  it("rides everything, capped, where the hit itself passes the ceiling, and nothing when no frame does", () => {
    const { bed, hit } = parts(0.95);
    const rides = planPeakRides([{ channels: [bed], gainDb: 0, bed: true }, { channels: [hit], gainDb: 0, bed: false }], sr, fps, -1, 6)!;
    expect(rides.all[peakFrame]).toBeGreaterThan(0);
    expect(rides.all[peakFrame]).toBeLessThanOrEqual(MAX_RIDE_DB);
    expect(planPeakRides([{ channels: [hit], gainDb: -20, bed: false }], sr, fps, -1, 1)).toBeNull();
  });
});

describe("master_audio_tool peak rides", { timeout: 60_000 }, () => {
  it("rides the peaks down so the mix gets closer to the target in one undo step", async () => {
    const off = peaky();
    expect((await master(off, { limit: false })).data).toMatchObject({ limitedBy: "peak" });
    const stopped = await loudness(off);

    const p = peaky();
    const undo = p.doc.undoLabels.length;
    const receipt = await master(p, {});
    expect(p.doc.undoLabels.length).toBe(undo + 1);
    expect(receipt.summary).toMatch(/peaks ridden down/);
    const after = await loudness(p);
    expect(after.integrated).toBeGreaterThan(stopped.integrated + 1);
    expect(after.truePeakDb).toBeLessThanOrEqual(-0.9);
    // The clicks carry the rides.
    expect(p.hits.some((id) => curvePoints(p.doc.project.clips.find((c) => c.id === id)).length > 2)).toBe(true);
  });
});
