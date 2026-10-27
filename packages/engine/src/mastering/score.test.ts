import { describe, expect, it } from "vitest";
import { sumOf } from "./analysis.js";
import { measureLoudness } from "./loudness.js";
import { formatMixScore, scoreMix, type MixCue, type ScoreInput } from "./score.js";
import { scoreFixture, type ScoreFixtureOptions } from "./testing.js";

function input(options: ScoreFixtureOptions = {}, transform: (mix: Float32Array[]) => Float32Array[] = (m) => m): ScoreInput {
  const fx = scoreFixture(options);
  const n = fx.voice[0]!.length;
  const cues: MixCue[] = fx.hits.map((t, i) => ({ id: `c${i}`, t, kind: "impact", role: "hero", sample: `s${i}` }));
  return {
    sampleRate: fx.sampleRate,
    mix: transform(sumOf([fx.voice, fx.music, fx.sfx], n)),
    stems: { voice: fx.voice, music: fx.music, sfx: fx.sfx },
    genre: "saas_ui",
    fps: 30,
    hits: fx.hits.map((t) => ({ t, kind: "cut", needsCue: true })),
    cues,
  };
}

const gain = (db: number) => (mix: Float32Array[]) => mix.map((c) => c.map((x) => x * 10 ** (db / 20)));

/** Every stem and the mix scaled together, so the mix reads -14 LUFS. */
function atTarget(options: ScoreFixtureOptions = {}, post: (mix: Float32Array[]) => Float32Array[] = (m) => m): ScoreInput {
  // Clicks 5 dB down keep the true peak under -1 dBTP at -14 LUFS.
  const raw = input({ sfxDb: -5, ...options });
  const db = -14 - measureLoudness(raw.mix, raw.sampleRate).integrated;
  const g = gain(db);
  return { ...raw, mix: post(g(raw.mix as Float32Array[])), stems: Object.fromEntries(Object.entries(raw.stems!).map(([k, v]) => [k, g(v as Float32Array[])])) };
}

describe("scoreMix", () => {
  // scripts/sound_score.py (S1, with its K-weighting applied per channel) on the same signals, written by encodeWav.
  const PYTHON: Record<string, number> = {
    L1_integrated: -17.8,
    L2_true_peak: -1.7,
    L3_short_term_max_rel: 0.61,
    L4_momentary_max_rel: 2.78,
    L5_lra: 0.7,
    L6_plr: 16.1,
    L7_clipped_samples: 0,
    L8_dead_air_runs: 0,
    B1_vbr_median: 15.58,
    B2_voice_anchor_rel: 0.28,
    F2_sfx_masks_voice_share: 0.15,
    F3_music_vs_voice_1k4k: -51.17,
    P1_phone_vbr: 28.83,
    B4_sfx_rel_mix: -3.34,
    F1_band_63_db: -9.37,
    P2_mono_loss_lu: 0,
    H1_coverage: 1,
    H2_untied_per_s: 0,
    H3_timing_within_1f: 1,
    B5_prominence_hero: 7.29,
    V1_back_to_back_repeats: 0,
    V3_cues_per_s: 0.75,
    V4_min_hero_gap_s: 0.4,
  };

  it("matches the reference implementation metric by metric", () => {
    const out = scoreMix(input());
    for (const [key, want] of Object.entries(PYTHON)) {
      expect(out.metrics[key]?.value, key).toBeCloseTo(want, 0);
      expect(Math.abs(out.metrics[key]!.value! - want), key).toBeLessThanOrEqual(Math.max(0.3, Math.abs(want) * 0.02));
    }
    // librosa's centroid uses its own frame weighting: within 5 %.
    expect(out.metrics.F1_centroid_hz!.value!).toBeGreaterThan(6096 * 0.95);
    expect(out.metrics.F1_centroid_hz!.value!).toBeLessThan(6096 * 1.05);
    expect(out.score).toBe(60);
    expect(out.rawScore).toBe(77);
    expect(out.gatesFailed).toEqual(["L1_integrated"]);
  });

  it("ranks the good mix first and gates clipping, a quiet master and a buried voice", () => {
    const good = scoreMix(atTarget());
    const cases = {
      quiet: scoreMix(atTarget({}, gain(-10))),
      clipped: scoreMix(atTarget({}, (mix) => gain(8)(mix).map((c) => c.map((x) => Math.max(-1, Math.min(1, x)))))),
      buried: scoreMix(atTarget({ duckDb: 0, musicDb: 12 })),
      late: scoreMix(atTarget({ late: 0.25 })),
      hot: scoreMix(atTarget({ sfxDb: 7 })),
    };
    expect(good.gatesFailed).toEqual([]);
    for (const [name, s] of Object.entries(cases)) expect(s.score!, name).toBeLessThanOrEqual(good.score! - 3);
    expect(cases.quiet.gatesFailed).toContain("L1_integrated");
    expect(cases.clipped.gatesFailed).toEqual(expect.arrayContaining(["L2_true_peak", "L7_clipped_samples"]));
    expect(cases.buried.gatesFailed).toContain("B1_vbr_median");
    expect(cases.late.metrics.H3_timing_within_1f!.value).toBe(0);
  });

  it("phrases fixes as tool calls aimed at stems and cues", () => {
    const buried = scoreMix(atTarget({ duckDb: 0, musicDb: 12 }));
    const b1 = buried.metrics.B1_vbr_median!;
    expect(b1.status).toBe("low");
    expect(b1.calls).toEqual([{ tool: "duck_tool", args: { bed: ["music"], under: "voice", target_vbr_db: 10 } }]);
    expect(buried.topFixes[0]!.metric).toBe("B1_vbr_median");

    const hot = scoreMix(atTarget({ sfxDb: 7 }));
    const b5 = hot.metrics.B5_prominence_hero!;
    expect(b5.status).toBe("high");
    expect(b5.calls![0]).toMatchObject({ tool: "set_audio_gain_tool", args: { clip_ids: ["c0", "c1", "c2", "c3", "c4", "c5"] } });
    expect((b5.calls![0]!.args.gain_db as number)).toBeLessThan(-3);

    const late = scoreMix({ ...atTarget({ late: 0.08 }), cues: input().cues!.map((c) => ({ ...c, position: c.t })) });
    const h3 = late.metrics.H3_timing_within_1f!;
    const first = h3.calls!.find((c) => c.args.clip_id === "c0")!;
    expect(first.tool).toBe("move_clip_tool");
    expect(first.args.position_seconds as number).toBeCloseTo(0.5 - 0.08, 1);
  });

  it("speaks the speech windows it measured and stays compact", () => {
    const out = scoreMix(atTarget());
    expect(out.speech.length).toBe(2);
    expect(out.speech[0]![0]).toBeCloseTo(1, 0);
    const text = formatMixScore(out);
    expect(text.split("\n")[0]).toMatch(/^Sound Score \d+\/100/);
    expect(text.length).toBeLessThan(1500 * 4);
  });

  it("scores a mix without stems or cues on loudness and translation only", () => {
    const fx = input();
    const out = scoreMix({ sampleRate: fx.sampleRate, mix: fx.mix });
    expect(out.metrics.B1_vbr_median).toBeUndefined();
    expect(out.metrics.H1_coverage).toBeUndefined();
    expect(out.metrics.L1_integrated!.value).toBeCloseTo(-17.8, 0);
  });
});
