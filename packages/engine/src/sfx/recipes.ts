/**
 * The procedural sound-effect recipes: whooshes, impacts, risers, clicks
 * and UI sounds, textures and a transition combo, each built from layered
 * DSP (sfx/layers.ts): a transient, a body and a tail.
 *
 * Every recipe says where it fits (`use`, shown by list_sfx_tool) and
 * returns its hit point: the moment that belongs on the cut (a whoosh's
 * peak, an impact's transient, a riser's end).
 */

import { Rng, StereoBuffer, SineOsc, SawOsc, Svf, OnePole, PinkNoise, Wander, addReverb, attackDecay, clamp01, expCurve, expLerp, lerp, panGains, saturate } from "./dsp.js";
import { kick, modal, noiseBurst, whoosh, type Voice } from "./layers.js";

export type SfxFamily = "whoosh" | "impact" | "riser" | "click" | "ui" | "texture" | "transition";

/** What a recipe's hit point is. */
export type SfxHitKind = "peak" | "onset" | "end";

export interface SfxRecipe {
  id: string;
  family: SfxFamily;
  title: string;
  /** Where it fits, and where it does not (taste). */
  use: string;
  hit: SfxHitKind;
  duration: { default: number; min: number; max: number };
  /** Suggested clip gain, dB: the file peaks at -1 dBFS, so this puts its peak around -8…-14 dBFS in a mix. */
  mixDb: number;
  /** Renders into `v.out`; returns the hit point in seconds. */
  render(v: Voice): number;
}

function sr(v: Voice): number {
  return v.out.sampleRate;
}

// ---------------------------------------------------------------------------
// Whooshes
// ---------------------------------------------------------------------------

interface WhooshPreset {
  peak: number;
  riseK: number;
  fall: number;
  low: number;
  high: number;
  q: number;
  air: number;
  roar: number;
  flutter: number;
}

function whooshRecipe(v: Voice, w: WhooshPreset): number {
  const d = v.duration;
  const peak = d * w.peak;
  whoosh(v, {
    peak,
    end: d,
    riseK: w.riseK,
    fallTau: Math.max(0.02, d * w.fall),
    low: w.low,
    high: w.high * (0.8 + 0.4 * v.intensity),
    q: w.q,
    air: w.air,
    roar: w.roar * (0.5 + v.intensity),
    flutter: w.flutter,
    travel: v.pan,
    width: 0.55,
    level: 1,
  });
  return peak;
}

/** Whip crack at the peak: the snap that sells a whip pan. */
function crack(v: Voice, at: number, level: number): void {
  noiseBurst(v, { at, mode: "band", freq: 5200, freqEnd: 2600, q: 1.1, attack: 0.0004, decay: 0.009, level, width: 0.4, pan: v.pan * 0.3 });
  noiseBurst(v, { at, mode: "high", freq: 3000, attack: 0.0002, decay: 0.004, level: level * 0.6, width: 0.6 });
}

// ---------------------------------------------------------------------------
// Impacts
// ---------------------------------------------------------------------------

function punch(v: Voice, at: number, scale: number, level = 1): void {
  const i = v.intensity;
  kick(v, { at, from: 240, to: 55, pitchTau: 0.022, decay: 0.11 * scale, level: 0.9 * level, drive: 1.8 + 2 * i });
  // The beater: a bright transient that reads on a phone speaker.
  noiseBurst(v, { at, mode: "band", freq: 3400, q: 1.2, attack: 0.0003, decay: 0.012, level: 2.2 * level, width: 0.2 });
  // The slap: mid noise with a short decay, what makes a hit "snap" rather than thump.
  noiseBurst(v, { at, mode: "band", freq: 1900, freqEnd: 800, q: 0.8, attack: 0.0005, decay: 0.06 * scale, level: 1.6 * level * (0.6 + i), width: 0.5, pink: true });
}

// ---------------------------------------------------------------------------
// Clicks
// ---------------------------------------------------------------------------

/** One key of a mechanical keyboard: the top click, then the bottom-out thock. */
function key(v: Voice, at: number, rng: Rng, level: number, pan: number, space = false): void {
  const vary = rng.range(0.92, 1.08);
  const body = space ? 0.6 : 1;
  noiseBurst(v, { at, mode: "band", freq: 4300 * vary, q: 2.2, attack: 0.0002, decay: 0.0011, level: 0.6 * level, pan });
  const bottom = at + rng.range(0.006, 0.011);
  modal(v, {
    at: bottom,
    freqs: [520 * vary * body, 1250 * vary * body, 2380 * vary],
    decays: [0.012 * (space ? 1.8 : 1), 0.008, 0.004],
    amps: [0.6, 0.35, 0.2],
    level: 0.5 * level,
    pan,
  });
  noiseBurst(v, { at: bottom, mode: "low", freq: 900 * body, attack: 0.0003, decay: 0.006 * (space ? 1.6 : 1), level: 0.7 * level, pan, pink: true, tracksBrightness: false });
}

function tap(v: Voice, at: number, freq: number, level: number, pan: number): void {
  const s = sr(v);
  const osc = new SineOsc();
  const [gl, gr] = panGains(pan);
  const end = Math.min(v.out.length, Math.round((at + 0.09) * s));
  for (let i = Math.round(at * s); i < end; i += 1) {
    const t = i / s - at;
    const f = freq * v.tune * v.bright ** 0.4 * (1 + 0.5 * Math.exp(-t / 0.004));
    const x = osc.next(f) * attackDecay(t, 0.0008, 0.014) * level;
    v.out.addStereo(i, x * gl * Math.SQRT2, x * gr * Math.SQRT2);
  }
  noiseBurst(v, { at, mode: "band", freq: 6000, q: 1.5, attack: 0.0001, decay: 0.0007, level: level * 0.35, pan });
}

/** Noise through a band-pass sweeping up with rising resonance, accelerating flutter, widening; cut dead at the end. */
function noiseRiser(v: Voice, level: number): void {
  const d = v.duration;
  const s = sr(v);
  const rng = v.rng.fork(0x21);
  const pinks = [new PinkNoise(rng.fork(1)), new PinkNoise(rng.fork(2))];
  const whites = [rng.fork(3), rng.fork(4)];
  const bp = [new Svf(s), new Svf(s)];
  const hp = [new Svf(s), new Svf(s)];
  let tremPhase = 0;
  const ch = [0, 0];
  for (let i = 0; i < v.out.length; i += 1) {
    const t = i / s;
    const x = t / d;
    const env = expCurve(x, 2.4) * clamp01((d - t) / 0.004);
    const fc = expLerp(260, 9000, Math.pow(x, 1.3)) * v.tune * v.bright;
    const q = lerp(0.9, 3.2, x);
    tremPhase += (4 + 22 * x * x) / s;
    const trem = 1 - 0.35 * v.intensity * x * (0.5 + 0.5 * Math.sin(2 * Math.PI * tremPhase));
    for (let c = 0; c < 2; c += 1) {
      const n = pinks[c]!.next() * 0.7 + whites[c]!.bipolar() * 0.3;
      ch[c] = bp[c]!.bandpass(n, fc, q) + 0.35 * hp[c]!.highpass(n, fc * 1.5) * x;
    }
    // Narrow at the start, fully wide at the hit; the pan drifts across with `pan`.
    const width = lerp(0.2, 1, x);
    const [gl, gr] = panGains(v.pan * (x - 0.5) * 2);
    const g = env * trem * level * Math.SQRT2;
    v.out.addStereo(i, ch[0]! * g * gl, (ch[1]! * width + ch[0]! * (1 - width)) * g * gr);
  }
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export const SFX_RECIPES: readonly SfxRecipe[] = [
  {
    id: "whoosh_short",
    family: "whoosh",
    title: "Whoosh, short",
    use: "Fast cuts and quick slides (0.2-0.5 s moves): peak on the cut. The everyday transition sound; vary pitch and seed so a run of them does not machine-gun.",
    hit: "peak",
    duration: { default: 0.45, min: 0.2, max: 1 },
    mixDb: -9,
    render: (v) => whooshRecipe(v, { peak: 0.58, riseK: 3, fall: 0.18, low: 260, high: 2600, q: 1.5, air: 0.4, roar: 0.15, flutter: 0.2 }),
  },
  {
    id: "whoosh_medium",
    family: "whoosh",
    title: "Whoosh, medium",
    use: "Push-ins, slides and transitions of about half a second to a second; the default for a cut between two moving shots.",
    hit: "peak",
    duration: { default: 0.85, min: 0.4, max: 1.6 },
    mixDb: -10,
    render: (v) => whooshRecipe(v, { peak: 0.6, riseK: 3.2, fall: 0.16, low: 170, high: 2200, q: 1.3, air: 0.35, roar: 0.35, flutter: 0.3 }),
  },
  {
    id: "whoosh_long",
    family: "whoosh",
    title: "Whoosh, long",
    use: "Slow zoom-throughs, camera fly-bys, a title sweeping across a held shot (1-3 s). Too long for fast cutting: it smears the rhythm.",
    hit: "peak",
    duration: { default: 1.7, min: 0.9, max: 3.5 },
    mixDb: -11,
    render: (v) => whooshRecipe(v, { peak: 0.62, riseK: 3.6, fall: 0.15, low: 110, high: 1900, q: 1.1, air: 0.3, roar: 0.6, flutter: 0.45 }),
  },
  {
    id: "whoosh_rise",
    family: "whoosh",
    title: "Whoosh, rising",
    use: "Something arriving: a card flying in, a zoom that lands on the cut. Builds to the end; put its end on the moment of arrival.",
    hit: "peak",
    duration: { default: 0.9, min: 0.3, max: 2.5 },
    mixDb: -10,
    render: (v) => whooshRecipe(v, { peak: 0.9, riseK: 3.8, fall: 0.05, low: 150, high: 3200, q: 1.4, air: 0.45, roar: 0.25, flutter: 0.25 }),
  },
  {
    id: "whoosh_fall",
    family: "whoosh",
    title: "Whoosh, falling",
    use: "Something leaving: an element flying out, a zoom-out after a hit. Loudest at the start, trails away; put its start on the exit.",
    hit: "peak",
    duration: { default: 0.9, min: 0.3, max: 2.5 },
    mixDb: -10,
    render: (v) => whooshRecipe(v, { peak: 0.07, riseK: 1, fall: 0.25, low: 140, high: 2800, q: 1.3, air: 0.35, roar: 0.3, flutter: 0.3 }),
  },
  {
    id: "swish_airy",
    family: "whoosh",
    title: "Swish, airy",
    use: "Light motion: text sliding, UI panels, a card flip, a cloth-like swipe. Thin and bright, it sits above music without muddying it.",
    hit: "peak",
    duration: { default: 0.35, min: 0.15, max: 0.8 },
    mixDb: -12,
    render: (v) => whooshRecipe(v, { peak: 0.5, riseK: 2.5, fall: 0.14, low: 1400, high: 6500, q: 2.2, air: 0.9, roar: 0, flutter: 0.35 }),
  },
  {
    id: "whip",
    family: "whoosh",
    title: "Whip pan",
    use: "Whip pans and smash cuts between shots: a very fast sweep that snaps at the peak. Peak exactly on the cut; one per whip, not on ordinary cuts.",
    hit: "peak",
    duration: { default: 0.32, min: 0.15, max: 0.7 },
    mixDb: -9,
    render: (v) => {
      const peak = whooshRecipe(v, { peak: 0.55, riseK: 5, fall: 0.09, low: 300, high: 3600, q: 1.6, air: 0.7, roar: 0.25, flutter: 0.15 });
      crack(v, peak, 0.35 + 0.35 * v.intensity);
      return peak;
    },
  },
  {
    id: "impact_punch",
    family: "impact",
    title: "Impact, punch",
    use: "Hard cuts on downbeats, a title slamming in, a flash frame: tight, bright, short. The workhorse hit; space them (one every bar at most) or they lose weight.",
    hit: "onset",
    duration: { default: 0.6, min: 0.25, max: 1.5 },
    mixDb: -8,
    render: (v) => {
      punch(v, 0, v.duration / 0.6);
      addReverb(v.out, { room: 0.35, damp: 0.5, wet: 0.25 + 0.2 * v.intensity });
      return 0;
    },
  },
  {
    id: "impact_thud",
    family: "impact",
    title: "Impact, thud",
    use: "Soft weight under a cut or a product landing on a table: low and round, no click. For calm edits where a punch would be too aggressive.",
    hit: "onset",
    duration: { default: 0.7, min: 0.3, max: 1.5 },
    mixDb: -8,
    render: (v) => {
      const scale = v.duration / 0.7;
      kick(v, { at: 0, from: 130, to: 44, pitchTau: 0.045, decay: 0.2 * scale, level: 1, attack: 0.003, drive: 1 + v.intensity });
      noiseBurst(v, { at: 0, mode: "low", freq: 320, attack: 0.002, decay: 0.05 * scale, level: 0.9, width: 0.3, pink: true });
      noiseBurst(v, { at: 0, mode: "band", freq: 900, q: 0.8, attack: 0.001, decay: 0.012, level: 0.25, width: 0.3 });
      return 0;
    },
  },
  {
    id: "impact_boom",
    family: "impact",
    title: "Impact, boom",
    use: "The drop, a logo reveal, the climax after a riser: a cinematic sub boom with a long tail. Once or twice per video; it needs silence or a big moment around it.",
    hit: "onset",
    duration: { default: 2.6, min: 1, max: 5 },
    mixDb: -8,
    render: (v) => {
      const scale = v.duration / 2.6;
      const tail = new StereoBuffer(v.out.length, sr(v));
      const t: Voice = { ...v, out: tail };
      noiseBurst(t, { at: 0, mode: "low", freq: 1600, freqEnd: 260, attack: 0.002, decay: 0.32 * scale, level: 0.8, width: 0.8, pink: true });
      noiseBurst(t, { at: 0, mode: "band", freq: 2800, q: 1.2, attack: 0.0004, decay: 0.012, level: 0.5, width: 0.5 });
      addReverb(tail, { room: 0.92, damp: 0.55, wet: 0.9 + 0.6 * v.intensity, predelay: 0.012 });
      kick(v, { at: 0, from: 95, to: 31, pitchTau: 0.13, decay: 0.75 * scale, level: 1, attack: 0.002, drive: 1.6 + 1.6 * v.intensity });
      kick(v, { at: 0, from: 240, to: 60, pitchTau: 0.02, decay: 0.08, level: 0.45, drive: 2 });
      v.out.mix(tail, 0.85);
      return 0;
    },
  },
  {
    id: "impact_slam",
    family: "impact",
    title: "Impact, slam",
    use: "Trailer-style metallic slam for a bold title card or a dramatic smash cut. Very loud character: once per piece, never on UI promos.",
    hit: "onset",
    duration: { default: 1.8, min: 0.8, max: 3.5 },
    mixDb: -9,
    render: (v) => {
      const scale = v.duration / 1.8;
      punch(v, 0, 1.2 * scale, 0.9);
      const metal = new StereoBuffer(v.out.length, sr(v));
      const m: Voice = { ...v, out: metal };
      const f0 = 150 * v.rng.range(0.95, 1.05);
      modal(m, {
        at: 0,
        freqs: [f0, f0 * 2.32, f0 * 4.25, f0 * 6.63, f0 * 9.38, f0 * 13.1],
        decays: [0.5 * scale, 0.38 * scale, 0.26 * scale, 0.17 * scale, 0.1 * scale, 0.06 * scale],
        amps: [0.5, 0.45, 0.35, 0.3, 0.22, 0.15],
        level: 0.5 + 0.2 * v.intensity,
        attack: 0.0004,
      });
      noiseBurst(m, { at: 0, mode: "band", freq: 4200, freqEnd: 1500, q: 0.9, attack: 0.0003, decay: 0.05, level: 0.6, width: 0.7 });
      addReverb(metal, { room: 0.85, damp: 0.4, wet: 0.7 + 0.4 * v.intensity, predelay: 0.008 });
      v.out.mix(metal, 0.8);
      return 0;
    },
  },
  {
    id: "sub_drop",
    family: "impact",
    title: "Sub drop",
    use: "Under a drop or a reveal, layered with a boom or alone on minimal edits: a falling sub sweep felt more than heard (saturated so phones still play it).",
    hit: "onset",
    duration: { default: 1.6, min: 0.6, max: 4 },
    mixDb: -9,
    render: (v) => {
      const d = v.duration;
      const osc = new SineOsc();
      const s = sr(v);
      for (let i = 0; i < v.out.length; i += 1) {
        const t = i / s;
        const f = (26 + 74 * Math.exp(-t / (0.28 * d))) * v.tune;
        const env = attackDecay(t, 0.004, 0.42 * d) * clamp01((d - t) / (0.25 * d));
        const x = saturate(osc.next(f) * env, 1.8 + 1.5 * v.intensity);
        v.out.addStereo(i, x, x);
      }
      noiseBurst(v, { at: 0, mode: "low", freq: 240, attack: 0.002, decay: 0.03, level: 0.35, pink: true, tracksBrightness: false });
      return 0;
    },
  },
  {
    id: "riser_noise",
    family: "riser",
    title: "Riser, noise",
    use: "Tension into a drop, a reveal or the climax: filtered noise sweeping up, accelerating flutter, ends abruptly on the hit. Put its end on the moment and an impact right after it.",
    hit: "end",
    duration: { default: 2.5, min: 1, max: 8 },
    mixDb: -10,
    render: (v) => {
      noiseRiser(v, 1);
      return v.duration;
    },
  },
  {
    id: "riser_tonal",
    family: "riser",
    title: "Riser, tonal",
    use: "Hype builds: a detuned saw stack gliding up an octave or more with an opening filter. Musical, so keep it for edits whose music has no build of its own.",
    hit: "end",
    duration: { default: 2.5, min: 1, max: 8 },
    mixDb: -12,
    render: (v) => {
      const d = v.duration;
      const s = sr(v);
      const detune = [-0.11, 0, 0.13];
      const saws = [0, 1].map((c) => detune.map((_, k) => new SawOsc(v.rng.next() + c * 0.13 + k * 0.29)));
      const lps = [new Svf(s), new Svf(s)];
      const subs = [new SineOsc(), new SineOsc()];
      const semis = 12 + 12 * v.intensity;
      for (let i = 0; i < v.out.length; i += 1) {
        const t = i / s;
        const x = t / d;
        const env = expCurve(x, 2.4) * clamp01((d - t) / 0.004);
        const base = 110 * v.tune * Math.pow(2, (semis * expCurve(x, 1.6)) / 12);
        const cutoff = expLerp(300, 7000, x) * v.bright;
        const ch: number[] = [];
        for (let c = 0; c < 2; c += 1) {
          let saw = 0;
          for (let k = 0; k < detune.length; k += 1) saw += saws[c]![k]!.next(base * Math.pow(2, (detune[k]! + (c ? 0.04 : -0.04)) / 12));
          ch.push(lps[c]!.lowpass(saw / detune.length, cutoff, lerp(0.9, 2.6, x)) + subs[c]!.next(base * 2) * 0.12 * x);
        }
        v.out.addStereo(i, ch[0]! * env, ch[1]! * env);
      }
      noiseRiser(v, 0.25);
      return d;
    },
  },
  {
    id: "reverse_swell",
    family: "riser",
    title: "Reverse swell",
    use: "A breath before the hit: a reversed reverb tail that swells into the cut. Softer than a riser; good into a title reveal or a slow-motion moment.",
    hit: "end",
    duration: { default: 1.6, min: 0.6, max: 4 },
    mixDb: -11,
    render: (v) => {
      const d = v.duration;
      noiseBurst(v, { at: 0.002, mode: "band", freq: 1400, freqEnd: 600, q: 0.7, attack: 0.001, decay: 0.05, level: 0.9, width: 0.6, pink: true });
      kick(v, { at: 0.002, from: 160, to: 70, pitchTau: 0.03, decay: 0.06, level: 0.25, drive: 1.5 });
      modal(v, { at: 0.002, freqs: [220, 440 * 1.01, 660, 1320], decays: [0.4, 0.25, 0.15, 0.08], amps: [0.3, 0.2, 0.15, 0.1], level: 0.4 * v.intensity });
      addReverb(v.out, { room: 0.95, damp: 0.35, wet: 3.5 });
      // The tail is what swells once reversed; a sliver of the dry hit stays so the swell ends with a snap on the cut.
      const s = sr(v);
      for (let i = 0; i < v.out.length; i += 1) {
        const t = i / s;
        const g = clamp01((t - 0.002) / 0.012) * clamp01((d - t) / (0.3 * d));
        v.out.left[i] = v.out.left[i]! * g;
        v.out.right[i] = v.out.right[i]! * g;
      }
      v.out.reverse();
      return d;
    },
  },
  {
    id: "ui_tap",
    family: "click",
    title: "UI tap",
    use: "A cursor tapping a button, a card appearing, a menu item highlighting: a soft rounded tick. The default for UI promos; quiet, under everything.",
    hit: "onset",
    duration: { default: 0.12, min: 0.06, max: 0.3 },
    mixDb: -14,
    render: (v) => {
      tap(v, 0, 1500, 1, v.pan);
      return 0;
    },
  },
  {
    id: "mouse_click",
    family: "click",
    title: "Mouse click",
    use: "A visible cursor clicking (press and release). Use where the click is on screen; for abstract UI motion a UI tap is cleaner.",
    hit: "onset",
    duration: { default: 0.18, min: 0.1, max: 0.4 },
    mixDb: -13,
    render: (v) => {
      const release = v.rng.range(0.065, 0.095);
      for (const [at, level, tune] of [
        [0, 1, 1],
        [release, 0.55, 1.12],
      ] as const) {
        noiseBurst(v, { at, mode: "band", freq: 3300 * tune, q: 3.5, attack: 0.0001, decay: 0.0012, level, pan: v.pan });
        modal(v, { at, freqs: [950 * tune, 2100 * tune, 4700 * tune], decays: [0.006, 0.004, 0.002], amps: [0.6, 0.4, 0.25], level: 0.5 * level, pan: v.pan });
      }
      return 0;
    },
  },
  {
    id: "keyboard_key",
    family: "click",
    title: "Keyboard key",
    use: "A single key press: a prompt being submitted, one letter appearing. For a run of letters use typing_burst.",
    hit: "onset",
    duration: { default: 0.12, min: 0.06, max: 0.3 },
    mixDb: -13,
    render: (v) => {
      key(v, 0, v.rng.fork(9), 1, v.pan);
      return 0;
    },
  },
  {
    id: "toggle",
    family: "click",
    title: "Toggle switch",
    use: "A switch flipping on, a checkbox, a mode change: two quick clicks rising in pitch (pitch below 0 for off).",
    hit: "onset",
    duration: { default: 0.15, min: 0.08, max: 0.4 },
    mixDb: -13,
    render: (v) => {
      tap(v, 0, 1100, 0.8, v.pan);
      noiseBurst(v, { at: 0, mode: "band", freq: 2600, q: 2.5, attack: 0.0001, decay: 0.0015, level: 0.5, pan: v.pan });
      const second = Math.min(0.045, v.duration * 0.4);
      tap(v, second, 1750, 1, v.pan);
      noiseBurst(v, { at: second, mode: "band", freq: 3800, q: 2.5, attack: 0.0001, decay: 0.0012, level: 0.45, pan: v.pan });
      return 0;
    },
  },
  {
    id: "pop",
    family: "ui",
    title: "Pop",
    use: "Icons and stickers popping in, bubbles, a playful title entrance with overshoot. Cute: keep it off serious or cinematic edits.",
    hit: "onset",
    duration: { default: 0.15, min: 0.08, max: 0.4 },
    mixDb: -12,
    render: (v) => {
      const s = sr(v);
      const osc = new SineOsc();
      const [gl, gr] = panGains(v.pan);
      for (let i = 0; i < v.out.length; i += 1) {
        const t = i / s;
        const f = expLerp(320, 980, clamp01(t / 0.03)) * v.tune;
        const x = saturate(osc.next(f) * attackDecay(t, 0.001, 0.022), 1.2);
        v.out.addStereo(i, x * gl * Math.SQRT2, x * gr * Math.SQRT2);
      }
      noiseBurst(v, { at: 0, mode: "low", freq: 1800, attack: 0.0004, decay: 0.004, level: 0.5, pan: v.pan, pink: true });
      return 0;
    },
  },
  {
    id: "notification_blip",
    family: "ui",
    title: "Notification blip",
    use: "A message or notification card arriving, a success state: a soft two-note chime (a fifth up). One per notification; it is melodic, so not on every beat.",
    hit: "onset",
    duration: { default: 0.7, min: 0.3, max: 1.5 },
    mixDb: -14,
    render: (v) => {
      const notes: [number, number][] = [
        [0, 880],
        [Math.min(0.09, v.duration * 0.2), 1318.5],
      ];
      for (const [at, f] of notes) {
        // A little inharmonicity per seed, like two slightly different bells.
        const stretch = v.rng.range(0.995, 1.012);
        modal(v, { at, freqs: [f, f * 2 * stretch, f * 3.01 * stretch, f * 4.2 * stretch], decays: [0.32, 0.16, 0.09, 0.05].map((d) => d * v.rng.range(0.85, 1.15)), amps: [1, 0.3, 0.12, 0.05], level: 0.5, attack: 0.002, pan: v.pan });
      }
      addReverb(v.out, { room: 0.5, damp: 0.6, wet: 0.35 });
      return 0;
    },
  },
  {
    id: "typing_burst",
    family: "click",
    title: "Typing burst",
    use: "Text typing on screen (a prompt bar, a terminal, a search box): a run of humanised key presses for the duration of the typing. Start it with the first letter.",
    hit: "onset",
    duration: { default: 1.2, min: 0.3, max: 6 },
    mixDb: -14,
    render: (v) => {
      const rng = v.rng.fork(0x3b);
      const rate = 9 + 7 * v.intensity;
      let t = 0.002;
      let count = 0;
      while (t < v.duration - 0.06) {
        const space = count > 2 && rng.next() < 0.14;
        key(v, t, rng.fork(count), rng.range(0.55, 1), v.pan + rng.range(-0.12, 0.12), space);
        count += 1;
        t += (1 / rate) * rng.range(0.55, 1.45) + (rng.next() < 0.08 ? 0.12 : 0);
      }
      return 0.002;
    },
  },
  {
    id: "camera_shutter",
    family: "ui",
    title: "Camera shutter",
    use: "A photo being taken, a freeze frame, a screenshot, a still popping onto the screen: two mechanical clacks with a short whirr.",
    hit: "onset",
    duration: { default: 0.3, min: 0.15, max: 0.6 },
    mixDb: -12,
    render: (v) => {
      const second = v.rng.range(0.06, 0.08);
      noiseBurst(v, { at: 0, mode: "band", freq: 2500, q: 1.6, attack: 0.0002, decay: 0.003, level: 0.8, pan: v.pan });
      modal(v, { at: 0, freqs: [1800, 3100, 5200], decays: [0.012, 0.008, 0.005], amps: [0.5, 0.4, 0.3], level: 0.5, pan: v.pan });
      // The mechanism between the curtains.
      const s = sr(v);
      const rng = v.rng.fork(5);
      const bp = new Svf(s);
      const [gl, gr] = panGains(v.pan);
      for (let i = Math.round(0.004 * s); i < Math.round(second * s); i += 1) {
        const t = i / s;
        const am = 0.6 + 0.4 * Math.sin(2 * Math.PI * 180 * t);
        const x = bp.bandpass(rng.bipolar(), 1300 * v.bright, 1.5) * am * 0.12 * clamp01((second - t) / 0.01);
        v.out.addStereo(i, x * gl * Math.SQRT2, x * gr * Math.SQRT2);
      }
      noiseBurst(v, { at: second, mode: "band", freq: 2100, q: 1.3, attack: 0.0002, decay: 0.004, level: 1, pan: v.pan });
      modal(v, { at: second, freqs: [260, 1500, 2700, 4400], decays: [0.014, 0.01, 0.007, 0.004], amps: [0.7, 0.45, 0.35, 0.25], level: 0.55, pan: v.pan });
      return 0;
    },
  },
  {
    id: "glitch_burst",
    family: "texture",
    title: "Glitch burst",
    use: "Glitch transitions, RGB-split or datamosh frames, a digital UI breaking: stuttered bit-crushed fragments jumping across the stereo field. Short, and only where the picture glitches too.",
    hit: "onset",
    duration: { default: 0.45, min: 0.15, max: 1.5 },
    mixDb: -14,
    render: (v) => {
      const s = sr(v);
      const rng = v.rng.fork(0x61);
      let t = 0;
      let first = true;
      while (t < v.duration - 0.01) {
        const len = Math.min(v.duration - t, rng.range(0.012, 0.06));
        const kind = first ? 0 : Math.floor(rng.next() * 5);
        first = false;
        const [gl, gr] = panGains(rng.range(-0.9, 0.9));
        const freq = expLerp(180, 3200, rng.next()) * v.tune;
        const hold = Math.max(1, Math.round(rng.range(2, 24 - 16 * v.intensity)));
        const bits = Math.round(lerp(8, 3, v.intensity * rng.next()));
        const steps = 2 ** bits;
        const osc = new SineOsc();
        let held = 0;
        const a = Math.round(t * s);
        const b = Math.min(v.out.length, Math.round((t + len) * s));
        for (let i = a; i < b; i += 1) {
          const local = (i - a) / s;
          let x: number;
          if (kind === 4) x = 0; // a gap is part of the stutter
          else if (kind === 0 || kind === 1) x = Math.sign(osc.next(freq * (kind === 1 ? 1 + local * 30 : 1))) * 0.5;
          else if (kind === 2) x = rng.bipolar();
          else x = osc.next(freq) * 0.8 + rng.bipolar() * 0.2;
          // Sample-rate reduction and bit-crush.
          if ((i - a) % hold === 0) held = Math.round(x * steps) / steps;
          const edge = clamp01(Math.min(i - a, b - i) / 16);
          const y = held * edge * 0.8;
          v.out.addStereo(i, y * gl * Math.SQRT2, y * gr * Math.SQRT2);
        }
        t += len;
      }
      return 0;
    },
  },
  {
    id: "static",
    family: "texture",
    title: "Static burst",
    use: "TV static, a channel change, a VHS or signal-loss look, a cut to a found-footage shot: band-limited hiss with crackle and flutter.",
    hit: "onset",
    duration: { default: 0.6, min: 0.15, max: 3 },
    mixDb: -16,
    render: (v) => {
      const s = sr(v);
      const rng = v.rng.fork(0x71);
      const bp = [new Svf(s), new Svf(s)];
      const hp = [new OnePole(s), new OnePole(s)];
      const flutter = new Wander(rng.fork(1), s);
      const crackleRate = 120 + 300 * v.intensity;
      for (let i = 0; i < v.out.length; i += 1) {
        const t = i / s;
        const env = clamp01(t / 0.006) * clamp01((v.duration - t) / 0.06);
        const am = 0.75 + 0.25 * flutter.next(12);
        const ch: number[] = [];
        for (let c = 0; c < 2; c += 1) {
          const hiss = bp[c]!.bandpass(rng.bipolar(), 2800 * v.bright, 0.6);
          const crackle = rng.next() < crackleRate / s ? rng.bipolar() : 0;
          ch.push(hiss * am + hp[c]!.high(crackle, 1500) * 0.4);
        }
        v.out.addStereo(i, ch[0]! * env, ch[1]! * env);
      }
      return 0;
    },
  },
  {
    id: "sparkle",
    family: "texture",
    title: "Sparkle shimmer",
    use: "Magic and polish: a logo shining, a product glinting, particles, a 'new' badge. A cluster of bright pings in a soft reverb; keep it quiet.",
    hit: "onset",
    duration: { default: 1.4, min: 0.4, max: 4 },
    mixDb: -15,
    render: (v) => {
      const rng = v.rng.fork(0x5a);
      const scale = [0, 2, 4, 7, 9]; // major pentatonic: the pings never clash
      const count = Math.round(lerp(10, 28, v.intensity) * Math.min(2, v.duration / 1.4));
      const spread = v.duration * 0.6;
      for (let k = 0; k < count; k += 1) {
        const at = k === 0 ? 0 : spread * Math.pow(rng.next(), 1.6);
        const octave = Math.floor(rng.range(0, 2.2 + v.bright));
        const f = 1760 * Math.pow(2, (scale[Math.floor(rng.next() * scale.length)]! + 12 * octave) / 12);
        modal(v, { at, freqs: [f, f * 2.76], decays: [rng.range(0.04, 0.12), 0.02], amps: [1, 0.25], level: rng.range(0.15, 0.4) * (k === 0 ? 1.6 : 1), attack: 0.0008, pan: rng.range(-0.8, 0.8) });
      }
      addReverb(v.out, { room: 0.82, damp: 0.3, wet: 1.2, predelay: 0.01 });
      return 0;
    },
  },
  {
    id: "swoosh_hit",
    family: "transition",
    title: "Swoosh into hit",
    use: "One-shot transition for a big cut: a rising whoosh that lands on a punchy hit. Its hit point is the impact; use it where a whoosh and an impact would otherwise be stacked by hand.",
    hit: "peak",
    duration: { default: 1.3, min: 0.6, max: 3 },
    mixDb: -9,
    render: (v) => {
      const hit = Math.min(0.65, v.duration * 0.45);
      whoosh(v, { peak: hit, end: hit + 0.12, riseK: 4, fallTau: 0.03, low: 180, high: 3000, q: 1.4, air: 0.5, roar: 0.4, flutter: 0.25, travel: v.pan, width: 0.55, level: 0.8 });
      const hitBuffer = new StereoBuffer(v.out.length, sr(v));
      const h: Voice = { ...v, out: hitBuffer };
      punch(h, hit, (v.duration - hit) / 0.7);
      addReverb(hitBuffer, { room: 0.6, damp: 0.5, wet: 0.35 + 0.3 * v.intensity });
      v.out.mix(hitBuffer, 1);
      return hit;
    },
  },
];

const SFX_RECIPES_BY_ID: ReadonlyMap<string, SfxRecipe> = new Map(SFX_RECIPES.map((r) => [r.id, r]));

export const SFX_RECIPE_IDS: readonly string[] = SFX_RECIPES.map((r) => r.id);

export function sfxRecipe(id: string): SfxRecipe | undefined {
  return SFX_RECIPES_BY_ID.get(id);
}
