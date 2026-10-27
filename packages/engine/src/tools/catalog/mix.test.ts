/**
 * The mixing tools on rendered audio (test-support/mix-host.ts renders clips
 * through their libopenshot audio effects and volume curves): what each tool
 * writes is what the score then measures.
 */

import { describe, expect, it } from "vitest";
import { median, monoOf, percentile, rmsEnvelopeDb } from "../../mastering/analysis.js";
import { loudnessSeries, measureLoudness } from "../../mastering/loudness.js";
import type { MixScore } from "../../mastering/score.js";
import { parametricEq } from "../../render/audio/parametric-eq.js";
import { runTool } from "../registry.js";
import type { ToolReceipt } from "../receipt.js";
import { MIX_RATE, mixProject, type MixProject } from "../test-support/mix-host.js";
import { measureMix } from "./analyze-mix.js";

async function run(p: MixProject, tool: string, args: Record<string, unknown>): Promise<ToolReceipt> {
  return (await runTool({ doc: p.doc, host: p.host }, tool, args)).data!;
}

async function score(p: MixProject): Promise<MixScore> {
  const call = { host: p.host, doc: p.doc } as unknown as Parameters<typeof measureMix>[0];
  return (await measureMix(call, p.doc.project, "saas_ui")).score;
}

async function render(p: MixProject, clipIds?: string[]): Promise<Float32Array[]> {
  return (await p.host.audio!.mixPcm!(p.doc.project, { clipIds })).channels;
}

describe("mix tools", { timeout: 60_000 }, () => {
  it("analyze_mix_tool files clips by stem and names the duck the buried voice needs", async () => {
    const p = mixProject();
    const receipt = await run(p, "analyze_mix_tool", { genre: "saas_ui", hit_times: [0.5, 1.5, 3.8, 4.2, 5.5, 7.5] });
    expect(receipt.status).toBe("unchanged");
    expect(receipt.undoSteps).toBe(0);
    expect(receipt.summary).toMatch(/^Sound Score \d+\/100/);
    expect(receipt.summary).toMatch(/Stems: voice 1, music 1, sfx 6, ambience 0/);
    const data = receipt.data as { metrics: Record<string, { status: string; calls?: unknown[] }>; topFixes: { metric: string }[] };
    expect(data.metrics.B1_vbr_median!.status).toBe("low");
    expect(data.metrics.B1_vbr_median!.calls).toEqual([{ tool: "duck_tool", args: { bed: ["music"], under: "voice", target_vbr_db: 10 } }]);
    expect(data.metrics.H1_coverage).toBeDefined();
    // Compact: well under the 1.5 K token budget.
    expect(JSON.stringify(receipt).length).toBeLessThan(6000);
  });

  it("duck_tool brings the voice to 10 dB over the bed, line by line, in one undo step", async () => {
    const p = mixProject({ transcript: true });
    const before = await score(p);
    expect(before.metrics.B1_vbr_median!.value!).toBeLessThan(7);
    const undo = p.doc.undoLabels.length;
    const receipt = await run(p, "duck_tool", { bed: "music", under: "voice", target_vbr_db: 10 });
    expect(receipt.status).toBe("applied");
    expect((receipt.data as { windows: unknown[] }).windows).toHaveLength(2);
    expect(p.doc.undoLabels.length).toBe(undo + 1);
    const after = await score(p);
    expect(after.metrics.B1_vbr_median!.value!).toBeGreaterThanOrEqual(9);
    expect(after.metrics.B1_vbr_median!.value!).toBeLessThanOrEqual(11);
    // Voice over the music it ducked (the SFX hits on words are F2's business): p10 >= 4 dB.
    const voice = loudnessSeries(await render(p, [p.voice]), MIX_RATE).momentary;
    const music = loudnessSeries(await render(p, [p.music]), MIX_RATE).momentary;
    const vI = measureLoudness(await render(p, [p.voice]), MIX_RATE).integrated;
    const vbr = Array.from(voice, (v, i) => v - music[i]!).filter((_, i) => voice[i]! >= vI - 8);
    expect(percentile(vbr, 10)).toBeGreaterThanOrEqual(4);
    // Between the lines (3.5-4.5 s) the bed comes back to within 1 dB of where it was within 0.5 s.
    const fresh = mixProject();
    const bedBefore = rmsEnvelopeDb(monoOf(await render(fresh, [fresh.music])), MIX_RATE);
    const bedAfter = rmsEnvelopeDb(monoOf(await render(p, [p.music])), MIX_RATE);
    const at = (env: Float64Array, t: number) => median(env.subarray(Math.round(t / 0.01) - 3, Math.round(t / 0.01) + 3));
    expect(Math.abs(at(bedAfter, 4.25) - at(bedBefore, 4.25))).toBeLessThan(1);
    // Running it again adds nothing: the voice already sits there.
    const again = await run(p, "duck_tool", { bed: "music", under: "voice", target_vbr_db: 10 });
    expect(again.status).toBe("unchanged");
    expect(p.doc.undoLabels.length).toBe(undo + 1);
    expect(after.rawScore!).toBeGreaterThan(before.rawScore!);
  });

  it("automate_volume_tool suck_out dips the bed 18 dB for 200 ms before the hit", async () => {
    const p = mixProject();
    const receipt = await run(p, "automate_volume_tool", { role: "music", shape: "suck_out", at_seconds: 5.5 });
    expect(receipt.status).toBe("applied");
    const env = rmsEnvelopeDb(monoOf(await render(p, [p.music])), MIX_RATE, 0.02);
    const base = median(env.subarray(450, 500));
    const inside = median(env.subarray(533, 545));
    expect(base - inside).toBeGreaterThan(17);
    expect(base - inside).toBeLessThan(19);
    // Below the base by > 9 dB for 200 ms (+-1 frame).
    let low = 0;
    for (let i = 500; i < 560; i += 1) if (env[i]! < base - 9) low += 1;
    expect(low * 10).toBeGreaterThanOrEqual(200 - 34);
    expect(low * 10).toBeLessThanOrEqual(200 + 34);
  });

  it("automate_volume_tool is a no-op (no undo step) when the shape misses every clip", async () => {
    const p = mixProject();
    const undo = p.doc.undoLabels.length;
    const receipt = await run(p, "automate_volume_tool", { clip_ids: p.hits[0], shape: "dip", start_seconds: 7.9, end_seconds: 8 });
    expect(receipt.status).toBe("unchanged");
    expect(p.doc.undoLabels.length).toBe(undo);
  });

  it("set_audio_gain_tool moves a whole stem by dB and keeps its automation", async () => {
    const p = mixProject();
    await run(p, "automate_volume_tool", { role: "music", shape: "dip", start_seconds: 2, end_seconds: 3, db: -6 });
    const before = rmsEnvelopeDb(monoOf(await render(p, [p.music])), MIX_RATE);
    const receipt = await run(p, "set_audio_gain_tool", { role: "music", gain_db: -4 });
    expect(receipt.status).toBe("applied");
    const after = rmsEnvelopeDb(monoOf(await render(p, [p.music])), MIX_RATE);
    for (const t of [1, 2.5, 5]) expect(after[t * 100]! - before[t * 100]!).toBeCloseTo(-4, 0);
    const sfx = await run(p, "set_audio_gain_tool", { track: "2000000", gain_db: -3 });
    expect(sfx.summary).toMatch(/^-3\.0 dB on 6 clip\(s\)/);
  });

  it("eq_tool writes ParametricEQ bands that do what they say, and replaces rather than stacks", async () => {
    const p = mixProject();
    await run(p, "eq_tool", { role: "music", preset: "voice_pocket" });
    await run(p, "eq_tool", { role: "music", bands: [{ type: "peak", freq: 3000, gain_db: -6, q: 1 }, { type: "high_pass", freq: 40 }] });
    const clip = p.doc.project.clips.find((c) => c.id === p.music)!;
    const eqs = (clip.effects ?? []).filter((e) => e.class_name === "ParametricEQ");
    expect(eqs).toHaveLength(2);
    expect(eqs.map((e) => e.filter_type)).toEqual([6, 1]);
    // The kernel with those parameters: -6 dB at 3 kHz, ~0 dB two octaves away.
    const gainAt = (freq: number): number => {
      const x = Float32Array.from({ length: MIX_RATE }, (_, i) => Math.sin((2 * Math.PI * freq * i) / MIX_RATE));
      const state = new Map<string, unknown>();
      for (let at = 0; at < x.length; at += 1600) parametricEq([x.subarray(at, at + 1600)], MIX_RATE, { filter_type: 6, frequency: 3000, gain: -6, q_factor: 1 }, state);
      let e = 0;
      for (let i = MIX_RATE / 2; i < MIX_RATE; i += 1) e += x[i]! * x[i]!;
      return 10 * Math.log10(e / (MIX_RATE / 2) / 0.5);
    };
    expect(gainAt(3000)).toBeCloseTo(-6, 0);
    expect(Math.abs(gainAt(500))).toBeLessThan(1);
    const removed = await run(p, "eq_tool", { role: "music", preset: "none" });
    expect(removed.status).toBe("applied");
    expect(p.doc.project.clips.find((c) => c.id === p.music)!.effects ?? []).toHaveLength(0);
  });

  it("compress_tool limit keeps peaks near its threshold; master_audio_tool's gain stages are left alone", async () => {
    const p = mixProject();
    await run(p, "set_audio_gain_tool", { role: "sfx", gain_db: 6 });
    const hot = await render(p, p.hits);
    const peak = (pcm: Float32Array[]) => 20 * Math.log10(pcm[0]!.reduce((m, x) => Math.max(m, Math.abs(x)), 0));
    expect(peak(hot)).toBeGreaterThan(-1);
    await run(p, "compress_tool", { role: "sfx", preset: "limit" });
    expect(peak(await render(p, p.hits))).toBeLessThan(-0.5);
    const clip = p.doc.project.clips.find((c) => c.id === p.hits[0])!;
    const comps = (clip.effects ?? []).filter((e) => e.class_name === "Compressor");
    // The +6 dB went partly through a ratio-1 makeup stage (set_audio_gain_tool), which compress_tool keeps.
    expect(comps.some((e) => (e as { zenvi_mix?: string }).zenvi_mix === "compressor")).toBe(true);
    expect(comps.filter((e) => (e as { zenvi_mix?: string }).zenvi_mix === undefined).length).toBeGreaterThan(0);
  });

  it("space_tool chains Echo stages and set_track_role_tool re-files a track", async () => {
    const p = mixProject();
    const r = await run(p, "space_tool", { role: "sfx", space: "room", mix: 0.2 });
    expect(r.status).toBe("applied");
    const echoes = p.doc.project.clips.find((c) => c.id === p.hits[1])!.effects!.filter((e) => e.class_name === "Echo");
    expect(echoes).toHaveLength(3);
    const again = await run(p, "space_tool", { role: "sfx", space: "room", mix: 0.2 });
    expect(again.status).toBe("unchanged");
    const role = await run(p, "set_track_role_tool", { track: "1000000", role: "ambience" });
    expect(role.status).toBe("applied");
    const s = await run(p, "analyze_mix_tool", {});
    expect(s.summary).toMatch(/Stems: voice 1, music 0, sfx 6, ambience 1/);
  });

  it("the analyze -> fix loop raises the score", async () => {
    const p = mixProject();
    const first = await score(p);
    for (const fix of first.topFixes) for (const call of fix.calls) await run(p, call.tool, call.args);
    const second = await score(p);
    expect(second.rawScore!).toBeGreaterThan(first.rawScore!);
  });
});

