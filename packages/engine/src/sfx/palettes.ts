/**
 * Genre palettes: how each kind of edit is sound-designed (CRAFT.md §10,
 * with the reference-reel measurements of §12 where they override it, and
 * DEPLOY.md S4.6). Data only; sfx/design.ts plays them. `guessPalette`
 * picks one from the edit when the caller does not name it.
 */

import type { HitPoint } from "./spot.js";

export const PALETTE_IDS = ["hype", "flash_montage", "saas_ui", "talking_head", "match_cut", "product_3d", "video_essay", "documentary", "editorial", "multiplicity"] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export interface Palette {
  id: PaletteId;
  title: string;
  /** Designed cues per second, music excluded (DEPLOY.md S4.6 bands). */
  density: readonly [number, number];
  /** Hero cues per 10 s (CRAFT.md §8). */
  heroesPer10s: readonly [number, number];
  /** Recipes per job, in turn (the recorded kit plays them where it has the sound). */
  hit: readonly string[];
  whoosh: { short: readonly string[]; long: readonly string[] };
  ui: readonly string[];
  micro: readonly string[];
  /** Heroes get a sub layer (with its phone harmonic). */
  sub: boolean;
  /** A riser into the climax (risers follow the music's structure, CRAFT.md §12). */
  riser: "noise" | "tonal" | "reverse" | null;
  /** Near-silence before the climax's hit, seconds (refs 230 ms median, §12), or 0. */
  suckOut: number;
  /** Duck the bed this many dB for 120 ms before every hero hit (hype's sidechain feel, §12 `DcfH_-aRlVg`), or 0. */
  preHitDuckDb: number;
  /** The one shared space: reverb time of hero tails, seconds (CRAFT.md §6). */
  rt60: number;
  /** A room tone or air bed under the edit, LUFS (CRAFT.md §4: -30…-38), or null for none. */
  ambienceLufs: number | null;
  /** Hard cuts that get a sound: every one, the strong ones, or none (the music carries them). */
  cuts: "every" | "strong" | "none";
  /** Whooshes on cuts (else hits), when the cut has room for one. */
  cutWhoosh: boolean;
  /** Under speech: nothing but micro cues (CRAFT.md §1). */
  voiceLed: boolean;
}

const HITS = ["impact_punch", "impact_thud", "impact_punch"] as const;
const UI = ["ui_tap", "mouse_click", "pop", "toggle"] as const;

export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  hype: {
    id: "hype",
    title: "Hype (sports, cars, fashion)",
    density: [1.5, 3.5],
    heroesPer10s: [4, 8],
    hit: HITS,
    whoosh: { short: ["whip", "whoosh_short"], long: ["whoosh_medium", "whoosh_rise"] },
    ui: ["camera_shutter", "glitch_burst"],
    micro: ["camera_shutter", "ui_tap", "sparkle"],
    sub: true,
    riser: "noise",
    suckOut: 0.2,
    preHitDuckDb: 10,
    rt60: 1.2,
    ambienceLufs: null,
    cuts: "every",
    cutWhoosh: true,
    voiceLed: false,
  },
  flash_montage: {
    id: "flash_montage",
    title: "Flash montage (3-6 frame cuts)",
    density: [1, 3],
    heroesPer10s: [3, 6],
    hit: ["impact_punch", "impact_thud"],
    whoosh: { short: ["whip", "whoosh_short"], long: ["whoosh_medium"] },
    ui: ["camera_shutter", "glitch_burst", "ui_tap"],
    micro: ["camera_shutter", "ui_tap"],
    sub: true,
    riser: "noise",
    suckOut: 0.2,
    preHitDuckDb: 0,
    rt60: 1.2,
    ambienceLufs: null,
    cuts: "every",
    cutWhoosh: false,
    voiceLed: false,
  },
  saas_ui: {
    id: "saas_ui",
    title: "SaaS / UI promo",
    density: [1.5, 3.5],
    heroesPer10s: [2, 4],
    hit: ["impact_thud", "pop"],
    whoosh: { short: ["swish_airy", "whoosh_short"], long: ["whoosh_medium", "swish_airy"] },
    ui: UI,
    micro: ["ui_tap", "sparkle", "keyboard_key"],
    sub: false,
    riser: "reverse",
    suckOut: 0,
    preHitDuckDb: 0,
    rt60: 0.3,
    ambienceLufs: null,
    cuts: "every",
    cutWhoosh: true,
    voiceLed: false,
  },
  talking_head: {
    id: "talking_head",
    title: "Kinetic captions / talking head",
    density: [0.3, 1.2],
    heroesPer10s: [1, 3],
    hit: ["impact_thud", "pop"],
    whoosh: { short: ["swish_airy"], long: ["whoosh_medium"] },
    ui: ["pop", "ui_tap"],
    micro: ["ui_tap", "paper"],
    sub: false,
    riser: null,
    suckOut: 0,
    preHitDuckDb: 0,
    rt60: 0.6,
    ambienceLufs: -36,
    cuts: "strong",
    cutWhoosh: true,
    voiceLed: true,
  },
  match_cut: {
    id: "match_cut",
    title: "Match cut",
    density: [0.8, 2],
    heroesPer10s: [2, 5],
    hit: ["impact_thud", "impact_punch"],
    whoosh: { short: ["whoosh_short", "swish_airy"], long: ["whoosh_medium", "whoosh_long"] },
    ui: ["ui_tap", "pop"],
    micro: ["sparkle"],
    sub: true,
    riser: "reverse",
    suckOut: 0,
    preHitDuckDb: 0,
    rt60: 1.2,
    ambienceLufs: null,
    cuts: "every",
    cutWhoosh: true,
    voiceLed: false,
  },
  product_3d: {
    id: "product_3d",
    title: "3D product",
    density: [0.8, 2],
    heroesPer10s: [2, 3],
    hit: ["impact_thud", "impact_punch"],
    whoosh: { short: ["swish_airy", "whoosh_short"], long: ["whoosh_long", "whoosh_medium"] },
    ui: ["ui_tap", "mouse_click", "toggle"],
    micro: ["sparkle", "cloth"],
    sub: true,
    riser: "reverse",
    suckOut: 0.2,
    preHitDuckDb: 0,
    rt60: 1.6,
    ambienceLufs: -36,
    cuts: "every",
    cutWhoosh: true,
    voiceLed: false,
  },
  video_essay: {
    id: "video_essay",
    title: "Video essay",
    density: [0.5, 1.5],
    heroesPer10s: [1, 2],
    hit: ["impact_thud"],
    whoosh: { short: ["swish_airy", "whoosh_short"], long: ["whoosh_medium"] },
    ui: ["camera_shutter", "ui_tap"],
    micro: ["paper", "cloth"],
    sub: true,
    riser: "reverse",
    suckOut: 0.23,
    preHitDuckDb: 0,
    rt60: 1,
    ambienceLufs: -34,
    cuts: "strong",
    cutWhoosh: true,
    voiceLed: true,
  },
  documentary: {
    id: "documentary",
    title: "Documentary",
    density: [0.2, 0.8],
    heroesPer10s: [1, 2],
    hit: ["impact_thud"],
    whoosh: { short: ["swish_airy"], long: ["whoosh_medium", "whoosh_long"] },
    ui: ["camera_shutter"],
    micro: ["paper", "cloth"],
    sub: true,
    riser: "reverse",
    suckOut: 0.23,
    preHitDuckDb: 0,
    rt60: 1,
    ambienceLufs: -34,
    cuts: "strong",
    cutWhoosh: true,
    voiceLed: true,
  },
  editorial: {
    id: "editorial",
    title: "Editorial motion",
    density: [0.8, 2],
    heroesPer10s: [1, 3],
    hit: ["impact_thud", "impact_punch"],
    whoosh: { short: ["whoosh_short", "swish_airy"], long: ["whoosh_medium"] },
    ui: ["keyboard_key", "ui_tap", "glitch_burst"],
    micro: ["ui_tap", "keyboard_key"],
    sub: false,
    riser: null,
    suckOut: 0,
    preHitDuckDb: 0,
    rt60: 0.4,
    ambienceLufs: null,
    cuts: "every",
    cutWhoosh: false,
    voiceLed: false,
  },
  multiplicity: {
    id: "multiplicity",
    title: "Multiplicity / beat grid",
    density: [1.5, 3.5],
    heroesPer10s: [2, 4],
    hit: ["impact_punch", "impact_thud"],
    whoosh: { short: ["whoosh_short", "whip"], long: ["whoosh_medium"] },
    ui: ["ui_tap", "pop", "mouse_click"],
    micro: ["ui_tap", "sparkle"],
    sub: true,
    riser: "noise",
    suckOut: 0.2,
    preHitDuckDb: 0,
    rt60: 0.8,
    ambienceLufs: null,
    cuts: "every",
    cutWhoosh: true,
    voiceLed: false,
  },
};

/** What the edit looks like, for guessing its genre. */
export interface EditTraits {
  duration: number;
  /** Median seconds between cuts (Infinity with none). */
  medianShot: number;
  speech: boolean;
  /** Kinetic caption words on the timeline. */
  captions: boolean;
  /** Motion block UI events (clicks, toggles, typing, pops). */
  uiEvents: number;
  /** 3D scene clips. */
  scenes3d: number;
  /** Clips arranged as tiles (several pictures on screen at once). */
  tiles: boolean;
  /** Match-cut chains on the timeline. */
  matchCuts: boolean;
  music: boolean;
}

/** The genre the edit most looks like (CRAFT.md §10's genres). */
export function guessPalette(t: EditTraits): PaletteId {
  if (t.speech) {
    if (t.captions) return "talking_head";
    return t.medianShot >= 3 ? "documentary" : "video_essay";
  }
  if (t.scenes3d > 0) return "product_3d";
  if (t.uiEvents >= 3) return "saas_ui";
  if (t.matchCuts) return "match_cut";
  if (t.tiles) return "multiplicity";
  if (t.medianShot < 0.25) return "flash_montage";
  if (t.medianShot < 0.7 && t.music) return "hype";
  return "editorial";
}

/** Traits from the cue sheet and what the caller knows of the project. */
export function traitsOf(points: readonly HitPoint[], rest: Omit<EditTraits, "medianShot" | "uiEvents" | "scenes3d" | "captions">): EditTraits {
  const cuts = points.filter((p) => p.kind === "cut" || p.kind === "transition").map((p) => p.t);
  const gaps = cuts.slice(1).map((t, i) => t - cuts[i]!).sort((a, b) => a - b);
  return {
    ...rest,
    medianShot: gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : Infinity,
    uiEvents: points.filter((p) => p.kind === "block" && p.role === "ui").length,
    scenes3d: points.filter((p) => p.kind === "scene3d").length,
    captions: points.some((p) => p.kind === "word"),
  };
}
