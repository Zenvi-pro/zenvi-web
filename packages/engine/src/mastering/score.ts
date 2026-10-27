/**
 * The Zenvi Sound Score (zenvi-motion sound/METRICS.md sections 1-8): every
 * measurable rule of the mix with its genre's target band, pass/fail, and the
 * fix as tool calls. Ported from the reference implementation
 * `scripts/sound_score.py` (same metrics, bands, sub-scores, weights and
 * gates; METRICS.md section 9 is its calibration) onto ./loudness.ts and
 * ./analysis.ts. Pure: the caller renders the mix and the role stems and
 * says where the hit points and cues are.
 */

import { ENVELOPE_HOP, bandPowerDb, differenceOf, median, monoOf, onsetStrength, percentile, phoneOf, rmsEnvelopeDb, spectrumOf, sumOf } from "./analysis.js";
import { loudnessSeries, measureLoudness, SILENCE_LUFS } from "./loudness.js";

export const MIX_GENRES = ["hype", "flash_montage", "saas_ui", "talking_head", "match_cut", "3d_product", "video_essay", "editorial", "multiplicity", "general"] as const;
export type MixGenre = (typeof MIX_GENRES)[number];

export const STEM_NAMES = ["voice", "music", "sfx", "ambience"] as const;
export type StemName = (typeof STEM_NAMES)[number];

export type CueRole = "hero" | "sweetener" | "micro";

/** METRICS.md L5 bands, LU. */
const LRA_BAND: Record<MixGenre, [number, number]> = {
  hype: [3, 9], flash_montage: [2, 6], saas_ui: [2, 6], talking_head: [2, 6], match_cut: [2, 6],
  "3d_product": [1.5, 6], video_essay: [3, 10], editorial: [1.5, 6], multiplicity: [3, 9], general: [2, 8],
};
/** METRICS.md V3 bands, cues per second. */
const DENSITY: Record<MixGenre, [number, number]> = {
  hype: [1.5, 3.5], flash_montage: [1, 3], saas_ui: [1.5, 3.5], talking_head: [0.3, 1.2], match_cut: [0.8, 2],
  "3d_product": [0.8, 2], video_essay: [0.5, 1.5], editorial: [0.8, 2], multiplicity: [0.8, 2], general: [0.8, 2],
};
const COVERAGE_MIN: Partial<Record<MixGenre, number>> = { talking_head: 0.6, video_essay: 0.6 };
/** METRICS.md B5: cue prominence over the local bed, dB. */
export const ROLE_PROMINENCE: Record<CueRole, [number, number]> = { hero: [6, 12], sweetener: [0, 6], micro: [-6, 3] };

export type MetricGroup = "loudness" | "voice" | "placement" | "balance" | "translation" | "variety";
const GROUP_WEIGHT: Record<MetricGroup, number> = { loudness: 20, voice: 20, placement: 25, balance: 15, translation: 10, variety: 10 };

/** A point of the edit that wants a sound (METRICS.md section 4). */
export interface HitPoint {
  t: number;
  kind: string;
  needsCue: boolean;
}

/** A placed sound effect: `t` is its hit point on the timeline. */
export interface MixCue {
  /** The timeline clip id. */
  id: string;
  t: number;
  kind: string;
  role: CueRole;
  /** Sample identity (V1 repetition). */
  sample?: string;
  /** The clip's timeline start, seconds (to move it by a timing error). */
  position?: number;
}

/** One call of a Zenvi tool that applies a fix. */
export interface FixCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface MixFix {
  metric: string;
  text: string;
  calls: FixCall[];
  /** group weight x (1 - sub-score); gates first. */
  weight: number;
}

export type MetricStatus = "ok" | "low" | "high";

export interface MixMetric {
  value: number | null;
  target: [number, number];
  status: MetricStatus | null;
  group: MetricGroup;
  /** 1 inside the band, falling linearly to 0 at twice the half-width outside it. */
  sub: number | null;
  gate: boolean;
  gateFail?: boolean;
  fix?: string;
  calls?: FixCall[];
  [extra: string]: unknown;
}

export interface MixScore {
  /** 0-100, capped at 60 when a gate fails. */
  score: number | null;
  rawScore: number | null;
  gatesFailed: string[];
  genre: MixGenre;
  durationS: number;
  metrics: Record<string, MixMetric>;
  topFixes: MixFix[];
  /** Timeline windows where the voice speaks (voice M(t) >= voice I - 8 LU), seconds. */
  speech: [number, number][];
}

export interface ScoreInput {
  sampleRate: number;
  mix: readonly Float32Array[];
  stems?: Partial<Record<StemName, readonly Float32Array[]>>;
  genre?: MixGenre;
  fps?: number;
  hits?: readonly HitPoint[];
  cues?: readonly MixCue[];
}

function band(v: number | null, lo: number, hi: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  if (v >= lo && v <= hi) return 1;
  const half = Math.max((hi - lo) / 2, 1e-6);
  const d = v < lo ? lo - v : v - hi;
  return Math.max(0, 1 - d / (2 * half));
}

function statusOf(v: number | null, lo: number, hi: number): MetricStatus | null {
  if (v === null || !Number.isFinite(v)) return null;
  return v >= lo && v <= hi ? "ok" : v < lo ? "low" : "high";
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const signed = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
const secs = (t: number): string => `${t.toFixed(2)} s`;

/** Runs of `true` as [start, end) seconds on a hop grid. */
function runsOf(flags: readonly boolean[], hop: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  flags.forEach((on, i) => {
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      out.push([start * hop, i * hop]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start * hop, flags.length * hop]);
  return out;
}

function argMax(values: ArrayLike<number>, from = 0, to = values.length): number {
  let best = from;
  for (let i = from; i < to; i += 1) if (values[i]! > values[best]!) best = i;
  return best;
}

/** Index and magnitude of the loudest sample across channels. */
function loudestSample(channels: readonly Float32Array[]): { index: number; peak: number } {
  let index = 0;
  let peak = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const v = Math.abs(channel[i]!);
      if (v > peak) {
        peak = v;
        index = i;
      }
    }
  }
  return { index, peak };
}

/** Score a rendered mix. Stems absent: voice metrics are skipped and the bed is the whole mix. */
export function scoreMix(input: ScoreInput): MixScore {
  const sr = input.sampleRate;
  const genre = input.genre ?? "general";
  const fps = input.fps ?? 30;
  const n = input.mix.reduce((m, c) => Math.max(m, c.length), 0);
  const mix = sumOf([input.mix], n);
  const stems: Partial<Record<StemName, Float32Array[]>> = {};
  for (const name of STEM_NAMES) {
    const s = input.stems?.[name];
    if (s && s.length > 0) stems[name] = sumOf([s], n);
  }
  const dur = n / sr;
  const metrics: Record<string, MixMetric> = {};
  const fixes: MixFix[] = [];

  const put = (key: string, value: number | null, lo: number, hi: number, group: MetricGroup, fix?: { text: string; calls?: FixCall[] }, extra: Record<string, unknown> = {}, gate = false): MixMetric => {
    const sub = band(value, lo, hi);
    const m: MixMetric = { value: value === null || !Number.isFinite(value) ? null : r2(value), target: [lo, hi], status: statusOf(value, lo, hi), group, sub: sub === null ? null : r2(sub), gate, ...extra };
    metrics[key] = m;
    if (sub !== null && sub < 1 && fix) {
      m.fix = fix.text;
      if (fix.calls && fix.calls.length > 0) m.calls = fix.calls;
      fixes.push({ metric: key, text: fix.text, calls: fix.calls ?? [], weight: GROUP_WEIGHT[group] * (1 - sub) + (gate ? 100 : 0) });
    }
    return m;
  };

  const cues = [...(input.cues ?? [])].sort((a, b) => a.t - b.t);
  /** The cue nearest `t` within `within` s. */
  const cueNear = (t: number, within: number): MixCue | undefined => {
    let best: MixCue | undefined;
    for (const c of cues) if (Math.abs(c.t - t) <= within && (!best || Math.abs(c.t - t) < Math.abs(best.t - t))) best = c;
    return best;
  };
  /** The stem with the most energy around sample `index`. */
  const dominantStem = (index: number): StemName | undefined => {
    let best: StemName | undefined;
    let bestEnergy = 0;
    const half = Math.round(0.025 * sr);
    for (const name of STEM_NAMES) {
      const s = stems[name];
      if (!s) continue;
      let e = 0;
      for (const ch of s) for (let i = Math.max(0, index - half); i < Math.min(n, index + half); i += 1) e += ch[i]! * ch[i]!;
      if (e > bestEnergy) {
        bestEnergy = e;
        best = name;
      }
    }
    return best;
  };
  /** "Lower what is loudest at sample `index` by `db`": the cue there, else its stem. */
  const lowerAt = (index: number, db: number): { what: string; calls: FixCall[] } => {
    const t = index / sr;
    const stem = dominantStem(index);
    const cue = stem === "sfx" || !stem ? cueNear(t, 0.3) : undefined;
    if (cue) return { what: `cue ${cue.id} (${cue.kind}) at ${secs(cue.t)}`, calls: [{ tool: "set_audio_gain_tool", args: { clip_ids: [cue.id], gain_db: r1(-db) } }] };
    if (stem) return { what: `the ${stem} at ${secs(t)}`, calls: [{ tool: "automate_volume_tool", args: { role: stem, shape: "dip", start_seconds: r2(Math.max(0, t - 0.25)), end_seconds: r2(t + 0.25), db: r1(-db) } }] };
    return { what: `the mix at ${secs(t)}`, calls: [] };
  };

  // 1. Loudness and peaks.
  const loud = measureLoudness(mix, sr);
  const I = loud.integrated === SILENCE_LUFS ? -70 : loud.integrated;
  const TP = Number.isFinite(loud.truePeakDb) ? loud.truePeakDb : -120;
  const series = loudnessSeries(mix, sr);
  const M = series.momentary;
  const S = series.shortTerm;
  put("L1_integrated", I, -15, -13, "loudness", { text: `master gain ${signed(-14 - I)} dB to -14 LUFS`, calls: [{ tool: "master_audio_tool", args: { preset: "social" } }] });
  metrics.L1_integrated!.gateFail = Math.abs(I + 14) > 3;
  {
    const { index } = loudestSample(mix);
    const over = TP + 1;
    const where = lowerAt(index, over + 0.5);
    put("L2_true_peak", TP, -60, -1, "loudness", { text: `true peak ${TP.toFixed(1)} dBTP at ${secs(index / sr)}: lower ${where.what} ${(over + 0.5).toFixed(1)} dB (then the export limiter catches the rest)`, calls: where.calls }, {}, true);
  }
  const sMax = S.length ? S[argMax(S)]! : I;
  const sAt = argMax(S) * series.hop;
  put("L3_short_term_max_rel", sMax - I, 0, 7, "loudness", {
    text: `loudest 3 s (${secs(sAt)}-${secs(sAt + 3)}) is ${(sMax - I - 7).toFixed(1)} dB too hot: ride the music down there`,
    calls: [{ tool: "automate_volume_tool", args: { role: "music", shape: "dip", start_seconds: r2(sAt), end_seconds: r2(sAt + 3), db: r1(-(sMax - I - 7)) } }],
  });
  const mMaxIndex = argMax(M);
  const mMax = M.length ? M[mMaxIndex]! : I;
  {
    const centre = Math.round((mMaxIndex * series.hop + 0.2) * sr);
    const where = lowerAt(Math.min(n - 1, centre), mMax - I - 10);
    put("L4_momentary_max_rel", mMax - I, 0, 10, "loudness", { text: `loudest 400 ms at ${secs(mMaxIndex * series.hop + 0.2)} is ${(mMax - I - 10).toFixed(1)} dB too hot: lower ${where.what}`, calls: where.calls });
  }
  const [lraLo, lraHi] = LRA_BAND[genre];
  const climax = sAt + 1.5;
  put(
    "L5_lra",
    loud.range,
    lraLo,
    lraHi,
    "loudness",
    loud.range < lraLo
      ? {
          text: `too flat (${loud.range.toFixed(1)} LU): ambience -3 dB and one 200 ms suck-out before the climax (~${secs(climax)})`,
          calls: [
            ...(stems.ambience ? [{ tool: "set_audio_gain_tool", args: { role: "ambience", gain_db: -3 } }] : []),
            { tool: "automate_volume_tool", args: { role: "music", shape: "suck_out", at_seconds: r2(climax) } },
          ],
        }
      : { text: `too wide (${loud.range.toFixed(1)} LU): compress the voice, lift the quiet sections`, calls: stems.voice ? [{ tool: "compress_tool", args: { role: "voice", preset: "voice" } }] : [] },
  );
  put("L6_plr", TP - I, 9, 15, "loudness", TP - I < 9 ? { text: "over-limited: back off the limiter / bed compression" } : { text: `one spike sets the peak (PLR ${(TP - I).toFixed(1)} dB): trim it (see L2)`, calls: metrics.L2_true_peak?.calls });
  let clipped = 0;
  for (const ch of mix) for (let i = 0; i < ch.length; i += 1) if (Math.abs(ch[i]!) >= 0.999) clipped += 1;
  put("L7_clipped_samples", clipped, 0, 0, "loudness", { text: "the mix clips: lower the master / the hot cue (see L2), never a clipper", calls: metrics.L2_true_peak?.calls }, {}, true);
  {
    let runs = 0;
    let k = 0;
    const gaps: [number, number][] = [];
    for (let i = 3; i < Math.max(3, M.length - 5); i += 1) {
      k = M[i]! < -45 ? k + 1 : 0;
      if (k === 11) {
        runs += 1;
        gaps.push([(i - 10) * series.hop, (i + 1) * series.hop]);
      }
    }
    put("L8_dead_air_runs", runs, 0, 0, "loudness", { text: `dead air from ${gaps.slice(0, 3).map(([s]) => secs(s)).join(", ")}: extend the music bed or ambience under it at -30..-24 LUFS` });
  }

  // 2/3. Voice, balance, masking.
  const voice = stems.voice;
  const bedParts = STEM_NAMES.filter((s) => s !== "voice" && stems[s]).map((s) => stems[s]!);
  const bed = Object.keys(stems).length > 0 ? sumOf(bedParts, n) : mix;
  let speech: boolean[] = [];
  let speechWindows: [number, number][] = [];
  const beds = (["music", "ambience"] as const).filter((s) => stems[s]);
  if (voice && loudestSample(voice).peak > 1e-4) {
    const vI = measureLoudness(voice, sr).integrated;
    const vM = loudnessSeries(voice, sr).momentary;
    const bM = loudnessSeries(bed, sr).momentary;
    speech = Array.from(vM, (v) => v >= vI - 8);
    speechWindows = runsOf(speech, series.hop).map(([s, e]) => [r2(s), r2(Math.min(dur, e + 0.4))]);
    const idx = speech.flatMap((on, i) => (on ? [i] : []));
    if (idx.length > 5) {
      const d = idx.map((i) => vM[i]! - bM[i]!);
      const vbr = median(d);
      const p10 = percentile(d, 10);
      // Worst speech windows, for the fix text.
      const worst = speechWindows
        .map(([s, e]) => {
          const inside = idx.filter((i) => i * series.hop >= s && i * series.hop < e).map((i) => vM[i]! - bM[i]!);
          return { s, e, vbr: inside.length ? median(inside) : Infinity };
        })
        .filter((w) => w.vbr < 8)
        .sort((a, b) => a.vbr - b.vbr)
        .slice(0, 3);
      const fix =
        vbr < 8 || p10 < 4
          ? {
              text: `duck ${beds.join("+") || "the bed"} ${Math.round(10 - vbr + 2)} dB under the voice (target 10 dB over the bed)${worst.length ? `, worst ${worst.map((w) => `${w.s.toFixed(1)}-${w.e.toFixed(1)} s (${w.vbr.toFixed(1)} dB)`).join(", ")}` : ""}`,
              calls: [{ tool: "duck_tool", args: { bed: beds.length ? [...beds] : ["music"], under: "voice", target_vbr_db: 10 } }],
            }
          : { text: `the bed is too far under the voice: lift it ${(vbr - 12).toFixed(0)} dB`, calls: beds.map((b) => ({ tool: "set_audio_gain_tool", args: { role: b, gain_db: r1(vbr - 12) } })) };
      put("B1_vbr_median", vbr, 8, 12, "voice", fix, { p10: r1(p10) });
      metrics.B1_vbr_median!.gateFail = vbr < 6 || p10 < -6;
      put("B2_voice_anchor_rel", vI - I, -1, 0.5, "voice", { text: `voice gain ${signed(-0.25 - (vI - I))} dB before mastering`, calls: [{ tool: "set_audio_gain_tool", args: { role: "voice", gain_db: r1(-0.25 - (vI - I)) } }] });
      const vb = bandPowerDb(monoOf(voice), sr, 1000, 4000);
      const sp = Array.from(vb, (_, i) => speech[i] ?? false);
      const inSpeech = (values: Float64Array): number[] => Array.from(values).filter((_, i) => sp[i]);
      if (stems.sfx) {
        const sb = bandPowerDb(monoOf(stems.sfx), sr, 1000, 4000);
        const diffs = Array.from(sb, (v, i) => v - vb[i]!).filter((_, i) => sp[i]);
        const share = diffs.length ? diffs.filter((x) => x > -6).length / diffs.length : 0;
        const masking = cues.filter((c) => c.role !== "micro" && speechWindows.some(([s, e]) => c.t > s && c.t < e)).slice(0, 5);
        put("F2_sfx_masks_voice_share", share, 0, 0.05, "voice", {
          text: `SFX cover the voice in 1-4 kHz on ${(share * 100).toFixed(0)} % of speech: move cues into pauses or cut them 6 dB${masking.length ? ` (${masking.map((c) => `${c.id} @${c.t.toFixed(2)}`).join(", ")})` : ""}`,
          calls: masking.length
            ? [{ tool: "set_audio_gain_tool", args: { clip_ids: masking.map((c) => c.id), gain_db: -6 } }]
            : [{ tool: "eq_tool", args: { role: "sfx", bands: [{ type: "peak", freq: 2500, gain_db: -4, q: 1 }] } }],
        });
      }
      const music = stems.music ?? bed;
      const mb = bandPowerDb(monoOf(music), sr, 1000, 4000);
      const mv = inSpeech(mb.map((v, i) => v - vb[i]!));
      put("F3_music_vs_voice_1k4k", mv.length ? median(mv) : null, -80, -10, "voice", {
        text: "music fights the voice at 1-4 kHz: carve a pocket (peaking -3 dB at 3 kHz, Q 1) on the music, or duck deeper",
        calls: [{ tool: "eq_tool", args: { role: "music", preset: "voice_pocket" } }],
      });
      const pv = phoneOf(voice, sr);
      const pb = phoneOf(bed, sr);
      const pvM = loudnessSeries([pv, pv], sr).momentary;
      const pbM = loudnessSeries([pb, pb], sr).momentary;
      const pd = Array.from(pvM, (v, i) => v - pbM[i]!).filter((_, i) => speech[i]);
      put("P1_phone_vbr", pd.length ? median(pd) : null, 8, 40, "translation", {
        text: "the bed buries the voice on a phone: cut the music 2-3 dB at 200 Hz-2 kHz under the voice",
        calls: [{ tool: "eq_tool", args: { role: "music", bands: [{ type: "peak", freq: 700, gain_db: -3, q: 0.7 }] } }],
      });
    }
  }

  if (stems.sfx && stems.music) {
    const sfxRel = measureLoudness(stems.sfx, sr).integrated - I;
    const [lo, hi] = voice ? [-14, -8] : [-8, -3];
    put("B4_sfx_rel_mix", Number.isFinite(sfxRel) ? sfxRel : -120, lo, hi, "balance", { text: `scale the SFX lane ${signed((lo + hi) / 2 - sfxRel)} dB`, calls: [{ tool: "set_audio_gain_tool", args: { role: "sfx", gain_db: r1((lo + hi) / 2 - sfxRel) } }] });
  }

  const mono = monoOf(mix);
  const spectrum = spectrumOf(mono, sr);
  {
    const [lo, hi] = genre === "3d_product" ? [1000, 1800] : [1600, 3200];
    const cen = spectrum.centroidHz;
    put(
      "F1_centroid_hz",
      cen,
      lo,
      hi,
      "translation",
      cen < lo
        ? { text: `dull (centroid ${cen.toFixed(0)} Hz): high shelf +2..3 dB at 8 kHz on the SFX`, calls: [{ tool: "eq_tool", args: { role: "sfx", preset: "air" } }] }
        : { text: `bright (centroid ${cen.toFixed(0)} Hz): tame 4-8 kHz on the music`, calls: [{ tool: "eq_tool", args: { role: "music", bands: [{ type: "high_shelf", freq: 6000, gain_db: -3 }] } }] },
    );
    const [blo, bhi] = genre === "talking_head" || genre === "video_essay" ? [-20, -6] : [-12, -4];
    const b63 = spectrum.bandsDb[63];
    put(
      "F1_band_63_db",
      b63,
      blo,
      bhi,
      "translation",
      b63 > bhi
        ? { text: "low end heavy: high-pass the music at 40 Hz and the SFX at 100 Hz", calls: [{ tool: "eq_tool", args: { role: "music", preset: "clean_low" } }, { tool: "eq_tool", args: { role: "sfx", bands: [{ type: "high_pass", freq: 100 }] } }] }
        : { text: "thin: add a sub layer to the hero hits (add_sfx_tool recipe=sub_drop)" },
    );
    const monoI = measureLoudness([mono, mono], sr).integrated;
    put("P2_mono_loss_lu", Number.isFinite(monoI) ? monoI - I : null, -2, 3, "translation", { text: "folds down badly to mono: narrow wide beds, pan heroes no wider than 0.6", calls: [] });
  }

  // 4/5. Placement, timing, variety.
  const hits = input.hits ?? [];
  const sfx = stems.sfx;
  const tol = 2 / fps;
  if (hits.length > 0) {
    const need = hits.filter((h) => h.needsCue);
    const covered = (h: HitPoint): boolean => cues.some((c) => Math.abs(c.t - h.t) <= tol);
    const uncovered = need.filter((h) => !covered(h));
    const recipe = (kind: string): string => (kind === "transition" ? "whoosh_short" : kind === "title" ? "pop" : kind === "ui" ? "ui_tap" : "impact_punch");
    put("H1_coverage", need.length ? (need.length - uncovered.length) / need.length : null, COVERAGE_MIN[genre] ?? 0.9, 1, "placement", {
      text: `${uncovered.length} hit point(s) have no cue: ${uncovered.slice(0, 5).map((h) => `${h.kind} @${h.t.toFixed(2)}`).join(", ")}`,
      calls: uncovered.slice(0, 5).map((h) => ({ tool: "add_sfx_tool", args: { recipe: recipe(h.kind), at_seconds: r2(h.t) } })),
    });
    const untiedCues = cues.filter((c) => c.role !== "micro" && !hits.some((h) => Math.abs(h.t - c.t) <= tol));
    put("H2_untied_per_s", dur > 0 ? untiedCues.length / dur : null, 0, 0.3, "placement", {
      text: `${untiedCues.length} cue(s) sit on no hit point: delete them or move them onto one (${untiedCues.slice(0, 5).map((c) => `${c.id} @${c.t.toFixed(2)}`).join(", ")})`,
      calls: untiedCues.slice(0, 3).map((c) => ({ tool: "remove_clip_tool", args: { timeline_clip_id: c.id } })),
    });
  }
  if (cues.length > 0 && sfx) {
    const sm = monoOf(sfx);
    const on = onsetStrength(sm, sr);
    const eSfx = rmsEnvelopeDb(sm, sr);
    const eRest = rmsEnvelopeDb(monoOf(differenceOf(mix, sfx)), sr);
    const errs: { cue: MixCue; err: number }[] = [];
    const proms: Partial<Record<CueRole, { cue: MixCue; db: number }[]>> = {};
    const at = (t: number): number => Math.round(t / ENVELOPE_HOP);
    for (const c of cues) {
      const i0 = Math.max(0, Math.trunc((c.t - 0.1) / ENVELOPE_HOP));
      const i1 = Math.min(on.length, Math.trunc((c.t + 0.1) / ENVELOPE_HOP));
      if (i1 <= i0) continue;
      const peakAt = c.kind.startsWith("whoosh") ? argMax(eSfx, i0, Math.min(i1, eSfx.length)) : argMax(on, i0, i1);
      errs.push({ cue: c, err: (peakAt * ENVELOPE_HOP - c.t) * 1000 });
      const a = Math.max(0, at(c.t - 0.03));
      const b = Math.min(eSfx.length, at(c.t + 0.12) + 1);
      const local = Array.from(eRest.subarray(Math.max(0, at(c.t - 1)), Math.min(eRest.length, at(c.t + 1))));
      if (b > a && local.length > 5) {
        let peak = -Infinity;
        for (let i = a; i < b; i += 1) peak = Math.max(peak, eSfx[i]!);
        (proms[c.role] ??= []).push({ cue: c, db: peak - median(local) });
      }
    }
    if (errs.length > 0) {
      const frameMs = 1000 / fps + 1;
      const within = errs.filter((e) => Math.abs(e.err) <= frameMs).length / errs.length;
      const worst = [...errs].sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).filter((e) => Math.abs(e.err) > frameMs).slice(0, 5);
      put("H3_timing_within_1f", within, 0.9, 1, "placement", {
        text: `move the late/early cues by -err: ${worst.map((e) => `${e.cue.id} ${e.err >= 0 ? "+" : ""}${Math.round(e.err)} ms`).join(", ")}`,
        calls: worst.filter((e) => e.cue.position !== undefined).map((e) => ({ tool: "move_clip_tool", args: { clip_id: e.cue.id, position_seconds: r2(Math.max(0, e.cue.position! - e.err / 1000)) } })),
      }, { medianAbsMs: r1(median(errs.map((e) => Math.abs(e.err)))), worst: worst.map((e) => ({ cue: e.cue.id, errMs: Math.round(e.err) })) });
    }
    for (const role of ["hero", "sweetener", "micro"] as const) {
      const list = proms[role];
      if (!list || list.length === 0) continue;
      const [lo, hi] = ROLE_PROMINENCE[role];
      const value = median(list.map((p) => p.db));
      const delta = (lo + hi) / 2 - value;
      put(`B5_prominence_${role}`, value, lo, hi, "balance", {
        text: `${role} cues sit ${value.toFixed(1)} dB over the bed (want ${lo}..${hi}): gain ${signed(delta)} dB`,
        calls: [{ tool: "set_audio_gain_tool", args: { clip_ids: list.map((p) => p.cue.id), gain_db: r1(delta) } }],
      }, { count: list.length });
    }
    const samples = cues.filter((c) => c.sample);
    const repeats = samples.filter((c, i) => i > 0 && c.sample === samples[i - 1]!.sample);
    put("V1_back_to_back_repeats", repeats.length, 0, 0, "variety", { text: `the same sample plays twice in a row at ${repeats.slice(0, 5).map((c) => `${c.id} @${c.t.toFixed(2)}`).join(", ")}: swap to another variant (re-add with the kit) or vary pitch +-1-2 st` });
    const [dlo, dhi] = DENSITY[genre];
    const density = cues.length / dur;
    put("V3_cues_per_s", density, dlo, dhi, "variety", { text: density > dhi ? "too dense: delete the weakest sweeteners (first those under speech)" : "too sparse: add micros on UI/text events" });
    const heroes = cues.filter((c) => c.role === "hero");
    let gap: number | null = null;
    let pair: [MixCue, MixCue] | null = null;
    for (let i = 1; i < heroes.length; i += 1) {
      const g = heroes[i]!.t - heroes[i - 1]!.t;
      if (gap === null || g < gap) {
        gap = g;
        pair = [heroes[i - 1]!, heroes[i]!];
      }
    }
    put("V4_min_hero_gap_s", gap, voice ? 0.4 : 0.25, 60, "variety", pair ? { text: `heroes ${pair[0].id} and ${pair[1].id} are ${gap!.toFixed(2)} s apart: demote one to a sweetener (-6 dB)`, calls: [{ tool: "set_audio_gain_tool", args: { clip_ids: [pair[1].id], gain_db: -6 } }] } : undefined);
  }

  // 7. The score.
  const weights = { ...GROUP_WEIGHT };
  if (!Object.values(metrics).some((m) => m.group === "voice")) {
    weights.placement += 12;
    weights.balance += 8;
    weights.voice = 0;
  }
  let total = 0;
  let wsum = 0;
  for (const [group, w] of Object.entries(weights) as [MetricGroup, number][]) {
    const subs = Object.values(metrics).filter((m) => m.group === group && m.sub !== null).map((m) => m.sub!);
    if (subs.length && w) {
      total += w * (subs.reduce((a, b) => a + b, 0) / subs.length);
      wsum += w;
    }
  }
  const raw = wsum ? (100 * total) / wsum : null;
  const gatesFailed = Object.entries(metrics)
    .filter(([, m]) => (m.gate && m.status !== "ok") || m.gateFail)
    .map(([k]) => k);
  const score = raw !== null && gatesFailed.length > 0 ? Math.min(raw, 60) : raw;
  return {
    score: score === null ? null : Math.round(score),
    rawScore: raw === null ? null : Math.round(raw),
    gatesFailed,
    genre,
    durationS: r2(dur),
    metrics,
    topFixes: fixes.sort((a, b) => b.weight - a.weight).slice(0, 3),
    speech: speechWindows,
  };
}

const LABEL: Record<string, string> = {
  L1_integrated: "loudness LUFS",
  L2_true_peak: "true peak dBTP",
  L3_short_term_max_rel: "S max over I",
  L4_momentary_max_rel: "M max over I",
  L5_lra: "LRA LU",
  L6_plr: "PLR dB",
  L7_clipped_samples: "clipped samples",
  L8_dead_air_runs: "dead air runs",
  B1_vbr_median: "voice over bed dB",
  B2_voice_anchor_rel: "voice vs mix LU",
  B4_sfx_rel_mix: "SFX vs mix LU",
  F1_centroid_hz: "centroid Hz",
  F1_band_63_db: "63 Hz band dB",
  F2_sfx_masks_voice_share: "SFX masking voice",
  F3_music_vs_voice_1k4k: "music vs voice 1-4k dB",
  P1_phone_vbr: "phone voice over bed dB",
  P2_mono_loss_lu: "mono fold-down LU",
  H1_coverage: "hit coverage",
  H2_untied_per_s: "untied cues /s",
  H3_timing_within_1f: "cues within 1 frame",
  B5_prominence_hero: "hero over bed dB",
  B5_prominence_sweetener: "sweetener over bed dB",
  B5_prominence_micro: "micro over bed dB",
  V1_back_to_back_repeats: "back-to-back repeats",
  V3_cues_per_s: "cues /s",
  V4_min_hero_gap_s: "min hero gap s",
};

function fmtValue(v: number): string {
  return Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(Math.abs(v) < 1 ? 2 : 1);
}

/** The token-cheap text of a score: one line per metric, failures first, then the top fixes. */
export function formatMixScore(score: MixScore, options: { all?: boolean } = {}): string {
  const head = `Sound Score ${score.score ?? "n/a"}/100${score.rawScore !== score.score ? ` (raw ${score.rawScore}, capped: gate failed ${score.gatesFailed.join(", ")})` : ""} - genre ${score.genre}, ${score.durationS.toFixed(1)} s.`;
  const entries = Object.entries(score.metrics).filter(([, m]) => m.value !== null);
  const failing = entries.filter(([, m]) => m.status !== "ok");
  const passing = entries.filter(([, m]) => m.status === "ok");
  const line = ([key, m]: [string, MixMetric]): string =>
    `${m.status === "ok" ? "ok  " : m.gate || m.gateFail ? "GATE" : "FAIL"} ${key.split("_")[0]} ${LABEL[key] ?? key} ${fmtValue(m.value!)} (want ${fmtValue(m.target[0])}..${fmtValue(m.target[1])})${m.status !== "ok" && m.fix ? `: ${m.fix}` : ""}`;
  const lines = [head, ...failing.map(line)];
  if (options.all) lines.push(...passing.map(line));
  else if (passing.length) lines.push(`ok: ${passing.map(([k]) => k.split("_")[0]).join(" ")}`);
  if (score.topFixes.length) {
    lines.push("Top fixes:");
    score.topFixes.forEach((f, i) => lines.push(`${i + 1}. ${f.text}${f.calls.length ? ` -> ${f.calls.map((c) => `${c.tool} ${JSON.stringify(c.args)}`).join("; ")}` : ""}`));
  }
  return lines.join("\n");
}
