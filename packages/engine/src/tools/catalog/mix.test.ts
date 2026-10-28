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
import type { ChangeEvent } from "../../history/document.js";
import { runTool } from "../registry.js";
import type { ToolReceipt } from "../receipt.js";
import { addClip } from "../../ops/clips.js";
import { addFile } from "../../ops/files.js";
import { audioInfo, media, videoInfo } from "../test-support/fixture.js";
import { MIX_RATE, decodeWav, mixProject, type MixProject } from "../test-support/mix-host.js";
import { finishGaps, masterMark } from "../../review/finish.js";
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


describe("pan_tool", { timeout: 60_000 }, () => {
  const sides = (pcm: Float32Array[]) => pcm.map((c) => 10 * Math.log10(c.reduce((s, x) => s + x * x, 0) / c.length + 1e-20));

  it("pans with a -3 dB constant-power law, keeps the loudness, and pan 0 puts the original back", async () => {
    const p = mixProject();
    const hit = p.hits[2]!;
    const [l0, r0] = sides(await render(p, [hit]));
    const before = measureLoudness(await render(p, [hit]), MIX_RATE).integrated;
    const undo = p.doc.undoLabels.length;
    const receipt = await run(p, "pan_tool", { clip_ids: hit, pan: 0.6 });
    expect(receipt.status).toBe("applied");
    expect(p.doc.undoLabels.length).toBe(undo + 1);
    const [l, r] = sides(await render(p, [hit]));
    const theta = ((0.6 + 1) * Math.PI) / 4;
    expect(l! - l0!).toBeCloseTo(20 * Math.log10(Math.SQRT2 * Math.cos(theta)), 0);
    expect(r! - r0!).toBeCloseTo(20 * Math.log10(Math.SQRT2 * Math.sin(theta)), 0);
    const after = measureLoudness(await render(p, [hit]), MIX_RATE).integrated;
    expect(Math.abs(after - before)).toBeLessThan(0.3);
    // Mono fold-down (METRICS.md P2) of a hero at 0.6: within 2 LU.
    const panned = await render(p, [hit]);
    const mono = panned[0]!.map((x, i) => (x + panned[1]![i]!) / 2);
    expect(measureLoudness([mono, mono], MIX_RATE).integrated - after).toBeGreaterThan(-2);
    const clip = p.doc.project.clips.find((c) => c.id === hit)!;
    expect(String(p.doc.project.files.find((f) => f.id === clip.file_id)!.path)).toMatch(/^\/generated\/pan-/);
    // Pan 0: the original file, the render gone from the bin.
    const files = p.doc.project.files.length;
    const back = await run(p, "pan_tool", { clip_ids: hit, pan: 0 });
    expect(back.status).toBe("applied");
    expect(p.doc.project.files.length).toBe(files - 1);
    const [l2, r2] = sides(await render(p, [hit]));
    expect(l2).toBeCloseTo(l0!, 3);
    expect(r2).toBeCloseTo(r0!, 3);
    expect((await run(p, "pan_tool", { clip_ids: hit, pan: 0 })).status).toBe("unchanged");
  });

  it("does not stack the peak compensation of a hard pan: a re-pan and pan 0 leave the clip's gain where it was", async () => {
    const p = mixProject();
    const hit = p.hits[2]!;
    p.doc.transaction("hot", (tx) => {
      const file = tx.project.clips.find((c) => c.id === hit)!.file_id;
      tx.update(["files", { id: String(file) }], { path: "/media/hot.wav" });
    });
    const peak = (pcm: Float32Array[]) => 20 * Math.log10(Math.max(...pcm.map((c) => c.reduce((m, x) => Math.max(m, Math.abs(x)), 0))));
    const [l0, r0] = sides(await render(p, [hit]));
    const first = await run(p, "pan_tool", { clip_ids: hit, pan: 1 });
    const gain = (first.data as { clips: { gainDb: number }[] }).clips[0]!.gainDb;
    // The fixture's click peaks above -3 dBFS, so a hard pan has to be scaled down and the clip raised.
    expect(gain).toBeGreaterThan(0.1);
    const hard = await render(p, [hit]);
    expect(await run(p, "pan_tool", { clip_ids: hit, pan: 0.9 })).toMatchObject({ status: "applied" });
    expect(await run(p, "pan_tool", { clip_ids: hit, pan: 1 })).toMatchObject({ status: "applied" });
    expect(peak(await render(p, [hit]))).toBeCloseTo(peak(hard), 1);
    expect(await run(p, "pan_tool", { clip_ids: hit, pan: 0 })).toMatchObject({ status: "applied" });
    const [l2, r2] = sides(await render(p, [hit]));
    expect(l2).toBeCloseTo(l0!, 2);
    expect(r2).toBeCloseTo(r0!, 2);
  });

  /** A 4 s audio-only clip of `stereo.wav` on track 1, at the timeline start. */
  function stereoClip(p: MixProject): string {
    return p.doc.transaction("stereo", (tx) => {
      const file = addFile(tx, media("/media/stereo.wav", audioInfo("/media/stereo.wav", 4))).id;
      return addClip(tx, { fileId: file, position: 0, layer: 1_000_000, start: 0, end: 4 }).id;
    });
  }
  /** Energy of `tone` Hz in a channel (a one-bin DFT). */
  const toneOf = (x: Float32Array, hz: number): number => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i += 1) {
      re += x[i]! * Math.cos((2 * Math.PI * hz * i) / MIX_RATE);
      im += x[i]! * Math.sin((2 * Math.PI * hz * i) / MIX_RATE);
    }
    return Math.hypot(re, im) / x.length;
  };

  it("balances a stereo source: each side keeps its own channel", async () => {
    const p = mixProject();
    const id = stereoClip(p);
    expect((await run(p, "pan_tool", { clip_ids: id, pan: 0.5 })).status).toBe("applied");
    const [l, r] = (await render(p, [id])).map((c) => c.subarray(0, 4 * MIX_RATE));
    const theta = ((0.5 + 1) * Math.PI) / 4;
    // Left still carries the left tone (attenuated), right the right tone; neither picks up the other side.
    expect(toneOf(l!, 440) / 0.125).toBeCloseTo(Math.SQRT2 * Math.cos(theta), 1);
    expect(toneOf(r!, 660) / 0.125).toBeCloseTo(Math.SQRT2 * Math.sin(theta), 1);
    expect(toneOf(l!, 660)).toBeLessThan(0.002);
    expect(toneOf(r!, 440)).toBeLessThan(0.002);
  });

  it("puts a keyframed pan where each source frame is heard under a time remap", async () => {
    const p = mixProject();
    const id = stereoClip(p);
    // Reversed: clip frame 1 plays source frame 121 (4 s at 30 fps), frame 121 plays source frame 1.
    p.doc.transaction("reverse", (tx) => {
      tx.update(["clips", { id }], { time: { Points: [{ co: { X: 1, Y: 121 }, interpolation: 1 }, { co: { X: 121, Y: 1 }, interpolation: 1 }] } });
    });
    expect((await run(p, "pan_tool", { clip_ids: id, points: [{ t: 0, pan: -1 }, { t: 4, pan: 1 }] })).status).toBe("applied");
    const clip = p.doc.project.clips.find((c) => c.id === id)!;
    const path = String(p.doc.project.files.find((f) => f.id === clip.file_id)!.path);
    const [l, r] = decodeWav(p.host.written.get(path) as Uint8Array);
    // The source's start is heard last, when the pan is right: its left side is all but gone; its end is heard first, panned left.
    const head = (x: Float32Array) => x.subarray(0, MIX_RATE / 2);
    const tail = (x: Float32Array) => x.subarray(3.5 * MIX_RATE, 4 * MIX_RATE);
    expect(toneOf(head(l!), 440)).toBeLessThan(toneOf(head(r!), 660) / 3);
    expect(toneOf(tail(r!), 660)).toBeLessThan(toneOf(tail(l!), 440) / 3);
  });

  it("keyframes a travelling pan and refuses clips with picture", async () => {
    const p = mixProject();
    const music = p.music;
    const r = await run(p, "pan_tool", { clip_ids: music, points: [{ t: 0, pan: -0.8 }, { t: 8, pan: 0.8 }] });
    expect(r.status).toBe("applied");
    const pcm = await render(p, [music]);
    const early = sides([pcm[0]!.subarray(0, MIX_RATE), pcm[1]!.subarray(0, MIX_RATE)]);
    const late = sides([pcm[0]!.subarray(7 * MIX_RATE), pcm[1]!.subarray(7 * MIX_RATE)]);
    expect(early[0]! - early[1]!).toBeGreaterThan(6);
    expect(late[1]! - late[0]!).toBeGreaterThan(6);
  });
});

describe("master_audio_tool iterate", { timeout: 120_000 }, () => {
  it("fixes, re-scores and masters in one undo step, never worse, under the true-peak ceiling", async () => {
    const p = mixProject({ transcript: true });
    const before = await score(p);
    const undo = p.doc.undoLabels.length;
    const tracked: ChangeEvent[] = [];
    p.doc.subscribe((e) => {
      if (e.source !== "untracked") tracked.push(e);
    });
    const receipt = await run(p, "master_audio_tool", { iterate: true, genre: "saas_ui" });
    expect(receipt.status).toBe("applied");
    expect(p.doc.undoLabels.length).toBe(undo + 1);
    const data = receipt.data as { rawBefore: number; rawAfter: number; rounds: { kept: boolean; fixes: string[] }[] };
    expect(data.rounds.length).toBeGreaterThan(0);
    expect(data.rawAfter).toBeGreaterThanOrEqual(data.rawBefore);
    const after = await score(p);
    expect(after.rawScore!).toBeGreaterThan(before.rawScore!);
    expect(after.metrics.L2_true_peak!.value!).toBeLessThanOrEqual(-1);
    expect(after.gatesFailed).not.toContain("L1_integrated");
    // The master mark is written untracked: the undo step holds the mix edits, never the mark.
    expect(tracked.flatMap((e) => e.actions).some((a) => String(a.key[0]) === "settings")).toBe(false);
    expect(masterMark(p.doc.project)).not.toBeNull();
    expect(finishGaps(p.doc.project).map((g) => g.kind)).not.toContain("master");
    p.doc.undo();
    expect((await score(p)).rawScore).toBe(before.rawScore);
  });
});

describe("iterate and the user's clips", { timeout: 120_000 }, () => {
  it("never removes or moves an SFX clip the user placed; only auto sound design's cues are the fixes' to move", async () => {
    const p = mixProject({ transcript: true });
    // Two shots with a cut at 4 s: every click is off the hit point, so H2 wants them gone.
    p.doc.transaction("shots", (tx) => {
      for (const [position, end] of [[0, 4], [4, 4]] as const) {
        const file = addFile(tx, media(`/media/shot${position}.mp4`, videoInfo(`/media/shot${position}.mp4`, 8)), { dedupe: false }).id;
        tx.update(["files", { id: file }], { path: `/media/shot${position}-shot.mp4` });
        addClip(tx, { fileId: file, position, layer: 5_000_000, start: 0, end });
      }
      for (const id of p.hits.slice(0, 3)) tx.update(["clips", { id }], { zenvi_sfx: { recipe: "impact_punch", auto: true } });
    });
    const user = p.hits.slice(3);
    const before = new Map(user.map((id) => [id, Number(p.doc.project.clips.find((c) => c.id === id)!.position)]));
    const s = await score(p);
    expect(s.metrics.H2_untied_per_s!.status).toBe("high");
    expect(s.metrics.H2_untied_per_s!.calls!.every((c) => !user.includes(String(c.args.timeline_clip_id)))).toBe(true);
    expect(s.metrics.H2_untied_per_s!.fix).toMatch(/placed by hand/);
    await run(p, "master_audio_tool", { iterate: true, genre: "saas_ui" });
    for (const id of user) {
      const clip = p.doc.project.clips.find((c) => c.id === id);
      expect(clip, id).toBeDefined();
      expect(Number(clip!.position)).toBeCloseTo(before.get(id)!, 6);
    }
  });
});

describe("mix roles", () => {
  it("reads the stem from a text-to-speech file or the track's name when nothing says otherwise", async () => {
    const { mixEntries } = await import("../mix-roles.js");
    const p = mixProject();
    p.doc.transaction("unrole", (tx) => {
      const layer = tx.project.layers.find((l) => l.number === 3_000_000)!;
      const { zenvi_audio_role: _r, ...rest } = layer;
      tx.replace(["layers", { id: layer.id }], { ...rest, label: "Music bed" });
      const music = tx.project.layers.find((l) => l.number === 1_000_000)!;
      tx.update(["layers", { id: music.id }], { label: "Room tone" });
      const voiceFile = tx.project.files.find((f) => String(f.path).endsWith("voice.wav"))!;
      tx.update(["files", { id: voiceFile.id }], { path: "/media/zenvi_tts_abc.mp3" });
    });
    const roles = Object.fromEntries(mixEntries(p.doc.project).map((e) => [e.id, e.mixRole]));
    expect(roles[p.voice]).toBe("voice");
    expect(roles[p.music]).toBe("ambience");
    expect(roles[p.hits[0]!]).toBe("sfx");
  });
});

describe("iterate's scratch media", () => {
  it("names the files a dropped round wrote that nothing keeps", async () => {
    const { orphanedPaths } = await import("./master-loop.js");
    const project = (paths: string[]) => ({ files: paths.map((path, i) => ({ id: `F${i}`, path })) }) as unknown as import("../../model/types.js").Project;
    const before = project(["/media/a.wav", "/generated/sfx-1.wav", "/generated/pan-2.wav"]);
    expect(orphanedPaths(before, [project(["/media/a.wav"]), project(["/media/a.wav", "/generated/pan-2.wav"])])).toEqual(["/generated/sfx-1.wav"]);
  });
});
