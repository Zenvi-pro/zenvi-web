import { describe, expect, it } from "vitest";
import { MASTER_PRESETS, MAX_SHAVE_DB, ROLE_OFFSET_LU, BED_UNDER_SPEECH_LU, duckEnvelope, planGainStage, type GainStagePlan, type StemAudio, type SpeechWindow } from "./gain-stage.js";
import { measureLoudness, sliceWindows } from "./loudness.js";
import { stereoSine } from "./testing.js";

const RATE = 48000;
const SECONDS = 12;
const SPEECH: SpeechWindow[] = [
  [1, 4],
  [6, 9],
];

/** `tone` silent outside `windows`. */
function gated(tone: Float32Array[], windows: readonly SpeechWindow[]): Float32Array[] {
  return tone.map((channel) => {
    const out = new Float32Array(channel.length);
    for (const [s, e] of windows) out.set(channel.subarray(Math.round(s * RATE), Math.round(e * RATE)), Math.round(s * RATE));
    return out;
  });
}

function stems(speechDb: number, musicDb: number, sfxDb?: number): StemAudio[] {
  const out: StemAudio[] = [
    { role: "speech", channels: gated(stereoSine(220, speechDb, SECONDS, RATE), SPEECH) },
    { role: "music", channels: stereoSine(110, musicDb, SECONDS, RATE) },
  ];
  if (sfxDb !== undefined) out.push({ role: "sfx", channels: gated(stereoSine(3000, sfxDb, SECONDS, RATE), [[0.5, 1], [5, 5.5], [10, 10.5]]) });
  return out;
}

/** The stems after the plan, with the duck: what the mix sounds like once the plan is applied. */
function apply(input: readonly StemAudio[], plan: GainStagePlan, windows: readonly SpeechWindow[]): StemAudio[] {
  const env = duckEnvelope(SECONDS * RATE, RATE, windows, 10 ** (plan.duckDb / 20));
  return input.map((stem) => {
    const gain = 10 ** ((plan.roleGainDb[stem.role] ?? 0) / 20);
    const bed = stem.role === "music" || stem.role === "ambient";
    return { role: stem.role, channels: stem.channels.map((c) => c.map((v, i) => v * gain * (bed ? env[i]! : 1))) };
  });
}

function mix(input: readonly StemAudio[]): Float32Array[] {
  const out = input[0]!.channels.map((c) => new Float32Array(c.length));
  for (const stem of input) stem.channels.forEach((c, k) => c.forEach((v, i) => (out[k]![i]! += v)));
  return out;
}

const base = { sampleRate: RATE, target: MASTER_PRESETS.social, balance: "auto" as const, speechWindows: SPEECH, duck: true };

describe("planGainStage", () => {
  it("brings a quiet mix to the target loudness", () => {
    const input = stems(-40, -34);
    const plan = planGainStage({ ...base, stems: input })!;
    const after = measureLoudness(mix(apply(input, plan, SPEECH)), RATE);
    expect(plan.lead).toBe("speech");
    expect(plan.limitedBy).toBe("target");
    expect(after.integrated).toBeCloseTo(-14, 0);
    expect(plan.predicted.integrated).toBeCloseTo(-14, 5);
  });

  it("takes a loud mix down to the target too", () => {
    const input = stems(-8, -6);
    const plan = planGainStage({ ...base, stems: input, target: MASTER_PRESETS.broadcast })!;
    expect(plan.globalDb).toBeLessThan(0);
    expect(measureLoudness(mix(apply(input, plan, SPEECH)), RATE).integrated).toBeCloseTo(-23, 0);
  });

  it("anchors on the dialogue and puts the bed under it, ducked while it talks", () => {
    const input = stems(-30, -22, -26);
    const plan = planGainStage({ ...base, stems: input })!;
    const done = apply(input, plan, SPEECH);
    const loudness = (role: string) => measureLoudness(done.find((s) => s.role === role)!.channels, RATE).integrated;
    const speech = loudness("speech");
    // Between lines the music is ROLE_OFFSET under the speech; the duck pulls it BED_UNDER_SPEECH under while talking.
    const inside = (role: string) => measureLoudness(sliceWindows(done.find((s) => s.role === role)!.channels, RATE, [[1.5, 3.5], [6.5, 8.5]]), RATE).integrated;
    expect(plan.duckDb).toBeLessThan(0);
    expect(speech - inside("music")).toBeCloseTo(BED_UNDER_SPEECH_LU, 0);
    expect(loudness("sfx") - speech).toBeCloseTo(ROLE_OFFSET_LU.withSpeech.sfx, 0);
  });

  it("leads with the music when nobody talks and keeps SFX under it", () => {
    const input: StemAudio[] = [stems(-30, -25, -22)[1]!, stems(-30, -25, -22)[2]!];
    const plan = planGainStage({ ...base, stems: input, speechWindows: [] })!;
    expect(plan.lead).toBe("music");
    expect(plan.duckDb).toBe(0);
    const done = apply(input, plan, []);
    const music = measureLoudness(done[0]!.channels, RATE).integrated;
    const sfx = measureLoudness(done[1]!.channels, RATE).integrated;
    expect(sfx - music).toBeCloseTo(ROLE_OFFSET_LU.withoutSpeech.sfx, 0);
  });

  it("keeps the balance and only scales the mix with balance: keep", () => {
    const plan = planGainStage({ ...base, stems: stems(-40, -30, -35), balance: "keep", duck: false })!;
    expect(new Set(Object.values(plan.roleGainDb).map((g) => g!.toFixed(6))).size).toBe(1);
    expect(plan.duckDb).toBe(0);
  });

  it("does not duck when the bed is already far enough under the speech", () => {
    const plan = planGainStage({ ...base, stems: stems(-20, -60) })!;
    // Auto balance lifts the music to -8 LU under the speech, then it needs the duck; with duck off it never does.
    expect(plan.duckDb).toBeLessThan(0);
    expect(planGainStage({ ...base, stems: stems(-20, -60), duck: false })!.duckDb).toBe(0);
  });

  it("stops at the true-peak ceiling and reports the shortfall", () => {
    // Sparse full-level clicks: very low loudness, very high peak.
    const clicks = new Float32Array(SECONDS * RATE);
    for (let t = 0; t < SECONDS; t += 0.5) clicks[Math.round(t * RATE)] = 0.9;
    const input: StemAudio[] = [{ role: "sfx", channels: [clicks, Float32Array.from(clicks)] }];
    const plan = planGainStage({ ...base, stems: input, speechWindows: [] })!;
    expect(plan.limitedBy).toBe("peak");
    expect(plan.predicted.truePeakDb).toBeCloseTo(-1, 3);
    expect(plan.predicted.integrated).toBeLessThan(-14);
    expect(plan.shortfallLu).toBeGreaterThan(0.5);
  });

  it("turns down the role that sets the peak (never the dialogue) so the mix can come up, within MAX_SHAVE_DB", () => {
    const clicks = new Float32Array(SECONDS * RATE);
    for (let t = 0.25; t < SECONDS; t += 0.5) for (let i = 0; i < 480; i += 1) clicks[Math.round(t * RATE) + i] = 0.9 * Math.sin((2 * Math.PI * 1000 * i) / RATE);
    const music = stems(-40, -22)[1]!;
    const input: StemAudio[] = [music, { role: "sfx", channels: [clicks, Float32Array.from(clicks)] }];
    const shaved = planGainStage({ ...base, stems: input, speechWindows: [] })!;
    const kept = planGainStage({ ...base, stems: input, speechWindows: [], balance: "keep" })!;
    // Nominal: the SFX stem sits ROLE_OFFSET under the music; the shave takes up to MAX_SHAVE_DB more.
    const nominal = measureLoudness(music.channels, RATE).integrated + ROLE_OFFSET_LU.withoutSpeech.sfx - measureLoudness(input[1]!.channels, RATE).integrated;
    const gap = shaved.roleGainDb.sfx! - shaved.roleGainDb.music!;
    expect(gap).toBeLessThan(nominal - 1);
    expect(gap).toBeGreaterThanOrEqual(nominal - MAX_SHAVE_DB - 1e-6);
    expect(shaved.predicted.integrated).toBeGreaterThan(kept.predicted.integrated + 1);
    expect(shaved.predicted.truePeakDb).toBeLessThanOrEqual(-0.99);
    // The dialogue is never the one turned down for its peak.
    const withSpeech = planGainStage({ ...base, stems: [...stems(-40, -22), input[1]!] })!;
    expect(withSpeech.lead).toBe("speech");
  });

  it("is idempotent: planning the result again changes nothing", () => {
    for (const input of [stems(-40, -34), stems(-30, -22, -26), stems(-12, -9, -8)]) {
      const first = planGainStage({ ...base, stems: input })!;
      const again = planGainStage({ ...base, stems: apply(input, first, SPEECH) })!;
      expect(Math.abs(again.globalDb)).toBeLessThan(0.15);
      expect(again.duckDb).toBe(0);
      for (const gain of Object.values(again.roleGainDb)) expect(Math.abs(gain!)).toBeLessThan(0.2);
    }
  });

  it("refuses a silent mix", () => {
    const silent: StemAudio[] = [{ role: "music", channels: [new Float32Array(RATE * 3), new Float32Array(RATE * 3)] }];
    expect(planGainStage({ ...base, stems: silent })).toBeNull();
    expect(planGainStage({ ...base, stems: stems(-90, -90) })).toBeNull();
  });
});

describe("duckEnvelope", () => {
  it("is unity outside, the duck gain inside, and ramps between", () => {
    const env = duckEnvelope(10 * 1000, 1000, [[4, 6]], 0.25, 1, 2);
    expect(env[0]).toBe(1);
    expect(env[3500]).toBeCloseTo(0.625, 3);
    expect(env[4000]).toBe(0.25);
    expect(env[5999]).toBe(0.25);
    expect(env[7000]).toBeCloseTo(0.625, 3);
    expect(env[9000]).toBe(1);
  });
});
