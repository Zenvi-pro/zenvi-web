/**
 * Sound kits: one palette of effects per project (whoosh, swish, whip,
 * hit, boom, sub, riser, click, pop, glitch), so every whoosh of an edit
 * sounds like the same family. create_sound_kit_tool stores the kit on the
 * project (`project.settings.zenvi_sound_kit`, an unknown key the desktop
 * keeps); auto_sound_design_tool then plays
 * each cue through it: the planner still decides where and how long, the
 * kit decides what it sounds like.
 *
 * A slot is procedural (one recipe at the kit's pitch and brightness, a few
 * fixed seeds to rotate through) or library sounds already in the bin
 * (conditioned to the loudness of the recipe they stand in for). Pure.
 */

import { z } from "zod";
import type { Project } from "../model/types.js";
import { Rng, clamp01 } from "./dsp.js";
import { SFX_PROVIDERS, type SfxLibraryProvider } from "./library.js";
import type { SfxCue } from "./plan.js";
import { sfxRecipe } from "./recipes.js";
import type { SfxParams } from "./render.js";

/** Key of the kit in `project.settings`. */
export const SOUND_KIT_KEY = "zenvi_sound_kit";

/** What the project holds as its kit, read or not. */
export function rawSoundKit(project: Project): unknown {
  const settings = project.settings as Record<string, unknown> | null | undefined;
  return typeof settings === "object" && settings !== null ? settings[SOUND_KIT_KEY] : undefined;
}

export const KIT_SLOTS = ["whoosh", "swish", "whip", "hit", "boom", "sub", "riser", "click", "pop", "glitch"] as const;
export type KitSlot = (typeof KIT_SLOTS)[number];

export const KIT_SOURCES = ["procedural", "library", "mixed"] as const;
export type KitSource = (typeof KIT_SOURCES)[number];

export const KIT_TONES = ["dark", "neutral", "bright"] as const;
export type KitTone = (typeof KIT_TONES)[number];

interface SlotSpec {
  /** Recipes a procedural kit picks from by its seed; the first is what a library sound stands in for. */
  recipes: readonly string[];
  /** What a library search for the slot asks. */
  query: string;
  /** Lengths of library sounds that fit, seconds. */
  seconds: readonly [number, number];
  /** A mixed kit takes the slot from the library; clicks, pops, subs and glitches stay synthesised, where synthesis is cleanest. */
  mixed: boolean;
}

export const KIT_SLOT_SPECS: Readonly<Record<KitSlot, SlotSpec>> = {
  whoosh: { recipes: ["whoosh_medium", "whoosh_rise", "whoosh_fall"], query: "whoosh", seconds: [0.3, 3], mixed: true },
  swish: { recipes: ["swish_airy"], query: "swish", seconds: [0.15, 1.2], mixed: true },
  whip: { recipes: ["whip"], query: "whip swoosh", seconds: [0.1, 0.8], mixed: false },
  hit: { recipes: ["impact_punch", "impact_thud", "impact_slam"], query: "impact hit", seconds: [0.15, 2.5], mixed: true },
  boom: { recipes: ["impact_boom"], query: "cinematic boom", seconds: [0.8, 6], mixed: true },
  sub: { recipes: ["sub_drop"], query: "sub drop", seconds: [0.6, 5], mixed: false },
  riser: { recipes: ["riser_noise", "riser_tonal", "reverse_swell"], query: "riser", seconds: [1, 8], mixed: true },
  click: { recipes: ["ui_tap", "mouse_click", "toggle"], query: "click", seconds: [0.03, 0.5], mixed: false },
  pop: { recipes: ["pop", "notification_blip"], query: "pop", seconds: [0.05, 0.8], mixed: false },
  glitch: { recipes: ["glitch_burst", "static"], query: "glitch", seconds: [0.1, 1.5], mixed: false },
};

/** Which slot plays a recipe the planner picked. Recipes without one keep their sound and take the kit's tone. */
const RECIPE_SLOT: Readonly<Record<string, KitSlot>> = {
  whoosh_short: "whoosh",
  whoosh_medium: "whoosh",
  whoosh_long: "whoosh",
  whoosh_rise: "whoosh",
  whoosh_fall: "whoosh",
  swish_airy: "swish",
  whip: "whip",
  impact_punch: "hit",
  impact_thud: "hit",
  impact_slam: "hit",
  impact_boom: "boom",
  sub_drop: "sub",
  riser_noise: "riser",
  riser_tonal: "riser",
  reverse_swell: "riser",
  ui_tap: "click",
  mouse_click: "click",
  toggle: "click",
  pop: "pop",
  notification_blip: "pop",
  glitch_burst: "glitch",
  static: "glitch",
};

export function slotOfRecipe(recipe: string): KitSlot | undefined {
  return RECIPE_SLOT[recipe];
}

/** The recipe a library sound in `slot` stands in for (its loudness, mix gain and hit point). */
export function slotRecipe(slot: KitSlot): string {
  return KIT_SLOT_SPECS[slot].recipes[0]!;
}

/** Slots a kit of `source` takes from a library. */
export function librarySlots(source: KitSource, slots: readonly KitSlot[] = KIT_SLOTS): KitSlot[] {
  return source === "procedural" ? [] : slots.filter((s) => source === "library" || KIT_SLOT_SPECS[s].mixed);
}

const TONES: Record<KitTone, { pitch: number; brightness: number }> = {
  dark: { pitch: -2, brightness: 0.32 },
  neutral: { pitch: 0, brightness: 0.5 },
  bright: { pitch: 1.5, brightness: 0.7 },
};

export interface KitProceduralSound {
  source: "procedural";
  recipe: string;
  pitch: number;
  brightness: number;
  /** Variations rotated through, so repeats are the same sound, not the same samples. */
  seeds: number[];
}

/** A library sound of a kit: a bin file (made by add_sfx_tool's library path) and where it came from. */
export interface KitLibrarySound {
  file_id: string;
  provider: SfxLibraryProvider;
  id: string;
  title: string;
  license: string;
}

export interface KitLibrarySlot {
  source: "library";
  /** The recipe the sounds stand in for. */
  recipe: string;
  sounds: KitLibrarySound[];
}

export type KitEntry = KitProceduralSound | KitLibrarySlot;

export interface SoundKit {
  version: 1;
  name: string;
  seed: number;
  source: KitSource;
  tone: KitTone;
  pitch: number;
  brightness: number;
  slots: Partial<Record<KitSlot, KitEntry>>;
}

export interface KitSpec {
  name: string;
  seed: number;
  source: KitSource;
  tone: KitTone;
  /** Semitones, overrides the tone's. */
  pitch?: number;
  /** 0..1, overrides the tone's. */
  brightness?: number;
}

const round = (x: number, per: number) => Math.round(x * per) / per;

/** A kit with every slot synthesised (create_sound_kit_tool replaces library slots it fills). Deterministic for the same spec. */
export function proceduralKit(spec: KitSpec): SoundKit {
  const tone = TONES[spec.tone];
  const pitch = round(Math.max(-12, Math.min(12, spec.pitch ?? tone.pitch)), 10);
  const brightness = round(clamp01(spec.brightness ?? tone.brightness), 100);
  const slots: Partial<Record<KitSlot, KitEntry>> = {};
  KIT_SLOTS.forEach((slot, i) => {
    const rng = new Rng(Math.imul(spec.seed | 0, 2654435761) ^ Math.imul(i + 1, 0x9e3779b9));
    const recipes = KIT_SLOT_SPECS[slot].recipes;
    const recipe = recipes[Math.floor(rng.next() * recipes.length)]!;
    // A slot sits near the kit's tone, not exactly on it: a boom a little lower, a click a little brighter reads as designed.
    slots[slot] = {
      source: "procedural",
      recipe,
      pitch: round(pitch + rng.bipolar() * 0.8, 10),
      brightness: round(clamp01(brightness + rng.bipolar() * 0.06), 100),
      seeds: [0, 1, 2].map(() => Math.floor(rng.next() * 1e6)),
    };
  });
  return { version: 1, name: spec.name, seed: spec.seed | 0, source: spec.source, tone: spec.tone, pitch, brightness, slots };
}

const slotEntry = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("procedural"),
    recipe: z.string().refine((r) => sfxRecipe(r) !== undefined),
    pitch: z.number().min(-12).max(12),
    brightness: z.number().min(0).max(1),
    seeds: z.array(z.number().int()).min(1).max(8),
  }),
  z.object({
    source: z.literal("library"),
    recipe: z.string().refine((r) => sfxRecipe(r) !== undefined),
    sounds: z
      .array(z.object({ file_id: z.string().min(1).max(64), provider: z.enum(SFX_PROVIDERS).exclude(["procedural"]), id: z.string().min(1).max(64), title: z.string().max(500), license: z.string().max(40) }))
      .min(1)
      .max(8),
  }),
]);

const kitSchema = z.object({
  version: z.literal(1),
  name: z.string().max(200),
  seed: z.number().int(),
  source: z.enum(KIT_SOURCES),
  tone: z.enum(KIT_TONES),
  pitch: z.number().min(-12).max(12),
  brightness: z.number().min(0).max(1),
  slots: z.partialRecord(z.enum(KIT_SLOTS), slotEntry),
});

/** The project's kit; null when it has none or what it holds is not a kit (edited by hand, from a newer version). */
export function readSoundKit(project: Project): SoundKit | null {
  const raw = rawSoundKit(project);
  if (raw === undefined || raw === null) return null;
  const parsed = kitSchema.safeParse(raw);
  return parsed.success ? (parsed.data as SoundKit) : null;
}

/** Bin files a kit's library slots play. */
export function kitFileIds(kit: SoundKit | null): Set<string> {
  const ids = new Set<string>();
  for (const entry of Object.values(kit?.slots ?? {})) if (entry?.source === "library") for (const s of entry.sounds) ids.add(s.file_id);
  return ids;
}

/** What one cue plays through a kit. */
export type KitPick = { kind: "procedural"; recipe: string; params: SfxParams; slot?: KitSlot } | { kind: "library"; slot: KitSlot; recipe: string; sound: KitLibrarySound };

/**
 * Play `cues` through `kit`, in order: a slot's recipe at its pitch and
 * brightness (the cue's own pitch shrunk to a nuance, so repeats vary but
 * stay one family), its seeds and library sounds taken in turn. The cue's
 * length, pan and drive stay the planner's.
 */
export function applyKit(kit: SoundKit, cues: readonly SfxCue[]): KitPick[] {
  const turns = new Map<KitSlot, number>();
  return cues.map((cue) => {
    const slot = slotOfRecipe(cue.recipe);
    const entry = slot ? kit.slots[slot] : undefined;
    const nuance = (cue.params.pitch ?? 0) * 0.3;
    if (!slot || !entry) {
      return { kind: "procedural", recipe: cue.recipe, params: { ...cue.params, pitch: round(kit.pitch + nuance, 10), brightness: kit.brightness } };
    }
    const turn = turns.get(slot) ?? 0;
    turns.set(slot, turn + 1);
    if (entry.source === "library") return { kind: "library", slot, recipe: entry.recipe, sound: entry.sounds[turn % entry.sounds.length]! };
    return {
      kind: "procedural",
      slot,
      recipe: entry.recipe,
      params: { ...cue.params, pitch: round(Math.max(-12, Math.min(12, entry.pitch + nuance)), 10), brightness: entry.brightness, seed: entry.seeds[turn % entry.seeds.length]! },
    };
  });
}

/** Words in a library sound's title or tags that say which slot it plays, most specific first. */
const SLOT_WORDS: readonly [KitSlot, RegExp][] = [
  ["riser", /\b(riser|rise|rising|build ?up|swell|uplifter|tension)\b/],
  ["sub", /\b(sub|sub ?drop|bass ?drop|808)\b/],
  ["boom", /\b(boom|explosion|cinematic hit|trailer hit)\b/],
  ["whip", /\b(whip|whip ?pan)\b/],
  ["swish", /\b(swish|swipe)\b/],
  ["whoosh", /\b(whoosh|woosh|swoosh|swosh|fly ?by|pass ?by|transition)\b/],
  ["glitch", /\b(glitch|static|digital|error|distort\w*)\b/],
  ["click", /\b(click|tap|button|keyboard|key|mouse|toggle|switch)\b/],
  ["pop", /\b(pop|bubble|blip|notification|ding)\b/],
  ["hit", /\b(hit|impact|punch|thud|slam|kick|knock|bang)\b/],
];

/** The slot a library sound most likely plays (its hit point and mix level follow): the title decides first, then the tags; an impact when nothing says. */
export function guessSlot(title: string, tags: readonly string[] = []): KitSlot {
  for (const text of [title.toLowerCase(), tags.join(" ").toLowerCase()]) {
    for (const [slot, re] of SLOT_WORDS) if (re.test(text)) return slot;
  }
  return "hit";
}
