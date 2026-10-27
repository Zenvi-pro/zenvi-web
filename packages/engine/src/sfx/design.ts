/**
 * Sound design v2: the cues for a cue sheet (sfx/spot.ts) in a genre's
 * palette (sfx/palettes.ts), by the doctrine (CRAFT.md):
 *   - layered heroes: transient + body + sub (with its phone harmonic) +
 *     a tail in the edit's one shared space; at most 4 layers (§2);
 *   - whooshes peak on the cut, sized to the move, travelling with it (§3, §7);
 *   - a riser into the climax that stops a beat early, the bed sucked out
 *     under that beat, then the drop (§3, §12);
 *   - UI clicks, toggles, typing and counter ticks on every block event,
 *     micro sounds (glints, paper, cloth) at their levels (§9);
 *   - an ambience bed where the genre wants one (§4);
 *   - pan from screen position: objects × 0.5, UI within ±20 %, heroes centred (§7);
 *   - density held to the genre's band: weak points stay dry first, and
 *     dry points come back when the edit is too sparse (§8);
 *   - never the same recipe twice in a row in a lane, pitch ±1 st, gain ±1.5 dB (§8);
 *   - levels by role: hero, sweetener, micro (§4, DEPLOY.md S4.4).
 * Pure and deterministic for the same input.
 */

import { Rng } from "./dsp.js";
import type { Palette } from "./palettes.js";
import type { SfxCue, SfxDensity, SfxIntensity } from "./plan.js";
import { sfxRecipe } from "./recipes.js";
import type { HitPoint, HitRole } from "./spot.js";

export type CueRole = "hero" | "sweetener" | "micro" | "bed";
export type CueLayer = "transient" | "body" | "sub" | "tail" | "whoosh" | "riser" | "ui" | "micro" | "ambience";

/** One sound to place, with its job in the mix. */
export interface DesignedCue extends SfxCue {
  role: CueRole;
  layer: CueLayer;
  /** Index of the hit point it answers in the sheet (-1: the ambience bed, the riser). */
  point: number;
}

/** A dip of the music bed: the suck-out before the drop, the pre-hit duck of hype edits. Volume keyframes. */
export interface BedDip {
  from: number;
  to: number;
  db: number;
  reason: string;
}

export interface DesignInput {
  points: readonly HitPoint[];
  palette: Palette;
  intensity: SfxIntensity;
  density?: SfxDensity;
  /** Length of the picture, seconds. */
  duration: number;
  /** The music's climax, or null. */
  climax: number | null;
  music: boolean;
  seed: number;
}

export interface SoundDesign {
  cues: DesignedCue[];
  dips: BedDip[];
  /** The moment the riser and the biggest hero land on (the music's climax, else the hero reveal), or null. */
  climax: number | null;
  riser: boolean;
  /** Hit points that got a sound, and the ones left dry with why. */
  sounded: number[];
  dry: { point: number; why: string }[];
}

/** Gain of each layer over its recipe's mix level, dB (CRAFT.md §2 layer levels, §4 role levels). */
const LAYER_DB: Readonly<Record<CueRole, Partial<Record<CueLayer, number>>>> = {
  hero: { body: 5, transient: 2, sub: 1, tail: -2, whoosh: 3, ui: 0 },
  sweetener: { body: 0, transient: -2, whoosh: -1, riser: 0, ui: 0, tail: -6, micro: 0 },
  micro: { micro: -4, ui: -4, body: -6, whoosh: -6 },
  bed: { ambience: 0 },
};
/** Extra cut under speech: cues sit at least 6 dB under the voice (CRAFT.md §9). */
const SPEECH_DB = -6;
/** Ambience: room_tone's level at 0 dB gain (pink noise at -1 dBFS peak), LUFS; measured in design.test.ts. */
export const ROOM_TONE_LUFS = -11.8;
/** The bed gives way under a hero this much, for this long (the climax has its suck-out instead). */
const HERO_DUCK_DB = 4;
const HERO_DUCK_SECONDS = 0.25;
/** No two cues in the same band closer than this (CRAFT.md §1). */
const SAME_BAND_GAP = 0.08;
/** Counter ticks: fast enough to read as a roll, slow enough that each lands on its own (CRAFT.md §1 caps at 15-20 /s). */
const MAX_TICKS_PER_SECOND = 10;
const MAX_TICKS_PER_RUN = 16;

/** subtle: points weaker than this stay dry (a downbeat cut to a new shot is 0.9, a cut on a beat 0.7); transitions the editor placed always sound. */
const SUBTLE_FLOOR = 0.75;
/** Where each intensity sits in the genre's density band. */
const INTENSITY_SPAN: Readonly<Record<SfxIntensity, number>> = { subtle: 0, normal: 0.5, hype: 1 };

const ROLE_RANK: Readonly<Record<HitRole, number>> = { hero: 0, slam: 1, transition: 2, impact: 3, ui: 4, move: 5, micro: 6 };

/** Turn-taking over a pool, never the same pick twice in a row. */
class Pool {
  private last = new Map<string, string>();
  private turn = new Map<string, number>();
  constructor(private readonly rng: Rng) {}
  pick(lane: string, pool: readonly string[]): string {
    const options = pool.filter((r) => r !== this.last.get(lane));
    const list = options.length > 0 ? options : pool;
    const n = this.turn.get(lane) ?? Math.floor(this.rng.next() * list.length);
    const pick = list[n % list.length]!;
    this.turn.set(lane, n + 1);
    this.last.set(lane, pick);
    return pick;
  }
}

function weightOf(p: HitPoint): number {
  return (6 - ROLE_RANK[p.role]) / 6 + p.weight;
}

/** The genre's rules on which points get a sound (CRAFT.md §1 under speech, §8 density). */
function choose(input: DesignInput): { keep: Set<number>; dry: Map<number, string> } {
  const { points, palette, duration } = input;
  const keep = new Set<number>();
  const dry = new Map<number, string>();
  const everyCut = input.density === "every_cut";
  points.forEach((p, i) => {
    if (!p.needsCue) return dry.set(i, p.dry ?? "left dry");
    if (input.intensity === "subtle" && p.role !== "hero" && p.role !== "slam" && p.kind !== "transition" && p.weight < SUBTLE_FLOOR) return dry.set(i, "subtle: only the big moments");
    if (p.kind === "cut" && p.role === "transition" && !everyCut) {
      if (palette.cuts === "none") return dry.set(i, "the music carries cuts in this genre");
      if (palette.cuts === "strong" && p.weight < 0.6) return dry.set(i, "an ordinary cut: this genre sounds only the strong ones");
    }
    keep.add(i);
  });
  // Same band, too close: the lower priority goes (runs keep their own spacing).
  const ordered = [...keep].sort((a, b) => weightOf(points[b]!) - weightOf(points[a]!));
  const taken: number[] = [];
  for (const i of ordered) {
    const p = points[i]!;
    const clash = taken.find((j) => Math.abs(points[j]!.t - p.t) < SAME_BAND_GAP && points[j]!.until === undefined && p.until === undefined);
    if (clash !== undefined) {
      keep.delete(i);
      dry.set(i, "another cue plays within 80 ms");
    } else taken.push(i);
  }
  const [lo, hi] = palette.density;
  const target = lo + (hi - lo) * INTENSITY_SPAN[input.intensity];
  // Intensity picks the place in the band: subtle its floor (only the big moments), normal its middle, hype its top.
  const cap = everyCut ? Infinity : Math.max(1, Math.round(target * duration));
  const floor = Math.round(Math.min(target, lo + (hi - lo) * 0.25) * duration);
  // Too dense: the weakest go first (heroes and the climax never).
  if (keep.size > cap) {
    const weakest = [...keep].filter((i) => points[i]!.role !== "hero").sort((a, b) => weightOf(points[a]!) - weightOf(points[b]!));
    for (const i of weakest) {
      if (keep.size <= cap) break;
      keep.delete(i);
      dry.set(i, `kept under the genre's ${hi} cues/s`);
    }
  }
  // Too sparse: small moves and flash-run cuts the sheet left dry come back, strongest first (never under speech, never against the genre's rules).
  if (keep.size < floor) {
    const back = [...dry.keys()]
      .filter((i) => !points[i]!.needsCue && !points[i]!.speech && (points[i]!.kind === "move" || points[i]!.kind === "cut") && !taken.some((j) => Math.abs(points[j]!.t - points[i]!.t) < SAME_BAND_GAP))
      .sort((a, b) => weightOf(points[b]!) - weightOf(points[a]!));
    for (const i of back) {
      if (keep.size >= floor) break;
      keep.add(i);
      dry.delete(i);
    }
  }
  return { keep, dry };
}

/** The design for a cue sheet. */
export function designSound(given: DesignInput): SoundDesign {
  // every_cut asks for a sound on every cut: a flash run's inner cuts get ticks pitch-walking up the run, locked to the cut rate (CRAFT.md §10 flash montage).
  const input: DesignInput =
    given.density === "every_cut"
      ? { ...given, points: given.points.map((p) => (p.dry === "inside a flash run" ? { ...p, needsCue: true, dry: undefined, role: "micro" as const, label: `${p.label} (flash run tick)` } : p)) }
      : given;
  const { points, palette, duration } = input;
  const rng = new Rng(Math.imul(input.seed | 0, 2654435761) ^ 0x5d2);
  const pool = new Pool(rng.fork(1));
  const cues: DesignedCue[] = [];
  const dips: BedDip[] = [];
  const { keep, dry } = choose(input);

  // The climax: the music's, else the edit's biggest late reveal (a logo, an end card).
  let climax = points.find((p) => p.climax)?.t ?? input.climax;
  if (climax === null) {
    const reveal = points.filter((p) => p.role === "hero" && p.event === "reveal" && p.t >= duration * 0.4).sort((a, b) => b.weight - a.weight || b.t - a.t)[0];
    if (reveal && reveal.weight >= 0.7) climax = reveal.t;
  }
  let riser = false;
  if (climax !== null && palette.riser && input.intensity !== "subtle" && climax >= 1.2) {
    const gap = palette.suckOut;
    const ends = climax - gap;
    const length = Math.min(2, ends - 0.2);
    if (length >= 0.8) {
      const recipe = palette.riser === "tonal" ? "riser_tonal" : palette.riser === "reverse" ? "reverse_swell" : "riser_noise";
      cues.push({ recipe, at: ends, params: { duration: length, intensity: 0.7, seed: Math.floor(rng.next() * 1e6), pan: 0.2 }, gainDb: 0, reason: `builds into the climax at ${climax.toFixed(2)} s${gap > 0 ? `, stopping ${Math.round(gap * 1000)} ms early` : ""}`, role: "sweetener", layer: "riser", point: -1 });
      riser = true;
      if (gap > 0) {
        dips.push({ from: climax - gap, to: climax, db: -18, reason: "suck-out before the drop" });
        // The beat of silence is silent: nothing else plays in it.
        for (const i of [...keep]) {
          if (points[i]!.t > climax - gap + 1e-6 && points[i]!.t < climax - 1e-6) {
            keep.delete(i);
            dry.set(i, "inside the suck-out before the drop");
          }
        }
      }
    }
  }

  const jitter = () => Math.round((rng.next() * 3 - 1.5) * 10) / 10;
  const pitch = () => Math.round((rng.next() * 2 - 1) * 10) / 10;
  const add = (point: number, recipe: string, layer: CueLayer, role: CueRole, at: number, params: SfxCue["params"], reason: string) => {
    cues.push({ recipe, at, params: { intensity: 0.7, seed: Math.floor(rng.next() * 1e6), ...params }, gainDb: jitter(), reason, role, layer, point });
  };
  const heroLayers = (i: number, p: HitPoint, reason: string) => {
    add(i, "hit_transient", "transient", "hero", p.t, { pitch: pitch() }, `${reason} (transient)`);
    add(i, pool.pick("hit", palette.hit), "body", "hero", p.t, { pitch: Math.min(0.5, pitch()) }, `${reason} (body)`);
    if (palette.sub) add(i, "sub_drop", "sub", "hero", p.t, { duration: 0.9 }, `${reason} (sub + phone harmonic)`);
    if (!p.speech) add(i, "tail_bloom", "tail", "hero", p.t, { duration: palette.rt60 + 0.3 }, `${reason} (tail: the edit's space)`);
  };
  const whooshFor = (p: HitPoint, seconds: number) => {
    const d = Math.min(1.6, Math.max(0.18, seconds));
    return { recipe: pool.pick("whoosh", d < 0.45 ? palette.whoosh.short : palette.whoosh.long), duration: d };
  };

  const sorted = [...keep].sort((a, b) => points[a]!.t - points[b]!.t);
  // Under speech a voice-led genre keeps only micro cues: a cut or a move gets a muffled cloth swish, a hero waits for a gap (CRAFT.md §1).
  const underVoice = (p: HitPoint) => p.speech && palette.voiceLed && (p.role === "hero" || p.role === "transition" || p.role === "move" || p.role === "impact");
  let runPitch = 0;
  for (const i of sorted) {
    const p = points[i]!;
    const objectPan = Math.max(-0.5, Math.min(0.5, p.x * 0.5));
    const uiPan = Math.max(-0.2, Math.min(0.2, p.x * 0.2));
    if (underVoice(p)) {
      add(i, "cloth", "micro", "micro", p.t, { pan: uiPan, duration: 0.25 }, `${p.label} (under speech: a cloth swish only)`);
      continue;
    }
    if (p.role === "hero") {
      heroLayers(i, p, p.label);
      if (p.event === "reveal" && palette.micro.includes("sparkle")) add(i, "sparkle", "micro", "sweetener", p.t, { pan: uiPan }, `${p.label} (glint)`);
      if (input.music && palette.preHitDuckDb > 0 && p.t >= 0.15) dips.push({ from: p.t - 0.12, to: p.t, db: -palette.preHitDuckDb, reason: `pre-hit duck before ${p.label}` });
      // Room for the hit: the bed gives way under it instead of the hit spiking over it (a sidechain, CRAFT.md §12 prominence).
      if (input.music && !p.climax) dips.push({ from: p.t, to: p.t + HERO_DUCK_SECONDS, db: -HERO_DUCK_DB, reason: `room under ${p.label}` });
      continue;
    }
    // UI ticks, taps, toggles and typing are micro sounds (CRAFT.md §9); everything else sweetens.
    const role: CueRole = p.speech || p.role === "micro" || p.role === "ui" ? "micro" : "sweetener";
    switch (p.role) {
      case "slam": {
        add(i, pool.pick("slam", palette.hit), "body", role, p.t, { pitch: pitch(), pan: objectPan * 0.4, duration: 0.6 }, p.label);
        if (!p.speech) add(i, "hit_transient", "transient", role, p.t, { pitch: pitch() }, `${p.label} (transient)`);
        break;
      }
      case "transition": {
        const roomy = (p.lead ?? 0.3) >= 0.15 && palette.cutWhoosh;
        if (roomy) {
          const w = whooshFor(p, p.kind === "transition" ? (p.lead ?? 0.25) * 2 * 1.2 : Math.min(0.9, (p.lead ?? 0.3) * 1.6));
          add(i, w.recipe, "whoosh", role, p.t, { duration: w.duration, pan: (rng.next() < 0.5 ? -1 : 1) * 0.6, pitch: pitch() }, p.label);
          if (p.weight >= 0.6) add(i, "hit_transient", "transient", role, p.t, { pitch: pitch() }, `${p.label} (transient on the cut)`);
        } else add(i, pool.pick("cut", palette.hit), "body", role, p.t, { duration: 0.3, pitch: pitch(), pan: objectPan * 0.4 }, `${p.label} (light hit)`);
        break;
      }
      case "impact": {
        add(i, pool.pick("hit", palette.hit), "body", role, p.t, { pitch: pitch(), pan: objectPan * 0.4, duration: p.kind === "flash" ? 0.3 : 0.6 }, p.label);
        if (p.weight >= 0.6 && !p.speech) add(i, "hit_transient", "transient", role, p.t, { pitch: pitch() }, `${p.label} (transient)`);
        if (p.event === "burst" && palette.micro.includes("sparkle")) add(i, "sparkle", "micro", "micro", p.t, { pan: objectPan }, `${p.label} (sparkle)`);
        break;
      }
      case "move": {
        const w = whooshFor(p, (p.lead ?? 0.3) * 1.25);
        add(i, w.recipe, "whoosh", role, p.t, { duration: w.duration, pan: p.x >= 0 ? 0.6 : -0.6, pitch: pitch() }, p.label);
        break;
      }
      case "ui": {
        if (p.event === "type") {
          const seconds = Math.max(0.2, (p.until ?? p.t + 0.6) - p.t);
          add(i, "typing_burst", "ui", role, p.t, { duration: Math.min(6, seconds), pan: uiPan }, p.label);
        } else if (p.event === "tick") {
          const until = Math.min(p.until ?? p.t + 0.5, duration - 0.05);
          const rate = Math.min(MAX_TICKS_PER_SECOND, p.rate ?? 10);
          const count = Math.min(MAX_TICKS_PER_RUN, Math.max(1, Math.floor((until - p.t) * rate)));
          // Ticks pitch-walk upward across the run (CRAFT.md §10 flash montage, counters).
          for (let k = 0; k < count; k += 1) add(i, "ui_tap", "ui", role, p.t + k / rate, { pitch: Math.min(6, k * 0.25), pan: uiPan, duration: 0.06 }, `${p.label} (tick ${k + 1}/${count})`);
        } else {
          const recipe = p.event === "toggle" ? "toggle" : p.event === "pop" ? "pop" : p.event === "swap" ? "keyboard_key" : p.event === "click" ? "mouse_click" : pool.pick("ui", palette.ui);
          add(i, recipe, "ui", role, p.t, { pan: uiPan, pitch: pitch() }, p.label);
        }
        break;
      }
      case "micro": {
        const inRun = p.label.includes("flash run");
        const recipe = p.event === "glint" ? "sparkle" : inRun ? palette.micro[0]! : pool.pick("micro", palette.micro);
        add(i, recipe, "micro", "micro", p.t, { pan: uiPan, pitch: inRun ? Math.min(6, (runPitch += 0.5)) : pitch(), ...(recipe === "sparkle" ? { duration: 0.6 } : {}) }, p.label);
        break;
      }
    }
  }

  if (palette.ambienceLufs !== null && duration >= 2) {
    // A bed under everything: room tone at the genre's level (CRAFT.md §4), one sound for the whole edit.
    cues.push({ recipe: "room_tone", at: 0, params: { duration: Math.min(120, duration), seed: Math.floor(rng.next() * 1e6) }, gainDb: 0, reason: `ambience bed at ${palette.ambienceLufs} LUFS`, role: "bed", layer: "ambience", point: -1 });
  }

  for (const cue of cues) {
    const recipe = sfxRecipe(cue.recipe)!;
    const p = cue.point >= 0 ? points[cue.point] : undefined;
    if (cue.layer === "ambience") {
      cue.gainDb = Math.round((palette.ambienceLufs! - ROOM_TONE_LUFS) * 10) / 10;
      continue;
    }
    const layerDb = LAYER_DB[cue.role][cue.layer] ?? 0;
    const speech = p?.speech ? SPEECH_DB : 0;
    const intensity = input.intensity === "subtle" ? -2 : input.intensity === "hype" ? 1 : 0;
    // libopenshot's volume tops out at 1: 0 dB is as loud as an effect gets.
    cue.gainDb = Math.min(0, Math.round((recipe.mixDb + layerDb + intensity + speech + cue.gainDb) * 10) / 10);
    // A sound that starts on its hit and would ring past the picture: the shortest version that fits.
    const length = cue.params.duration ?? recipe.duration.default;
    const room = Math.floor((duration - cue.at) * 100) / 100;
    if (recipe.hit === "onset" && length > room) {
      cue.params.duration = Math.max(recipe.duration.min, room);
      cue.reason += ", shortened to end with the picture";
    }
  }
  cues.sort((a, b) => a.at - b.at || a.layer.localeCompare(b.layer));
  const sounded = [...new Set(cues.map((c) => c.point).filter((i) => i >= 0))].sort((a, b) => a - b);
  return { cues, dips, climax: climax ?? null, riser, sounded, dry: [...dry].map(([point, why]) => ({ point, why })).sort((a, b) => a.point - b.point) };
}
