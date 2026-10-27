/**
 * Zenvi's recorded SFX kit: about 500 real recordings (whooshes swung
 * past a mic, punches, sub hits, reverse cymbals, chimes, clicks, paper,
 * cloth, room tones...) chosen from Freesound, CC0 only, by id, by
 * listening and by measurement (scripts/sound-library/curate-kit.ts).
 * Every sound carries its measured onset, peak, end, loudness, brightness
 * and sub share (sfx/analyse.ts); sfx/kit-search.ts searches by them.
 * The repo holds the list, the checksums and the licences
 * (recorded-kit.data.ts, made by scripts/gen-recorded-kit.ts), never the
 * audio: a host fetches a sound on first use into a cache every project
 * shares (MediaHost.kitSample) and checks its bytes against the list.
 *
 * add_sfx_tool and auto_sound_design_tool play a cue through the kit when
 * its recipe has a group here; hosts that cannot fetch stay synthesised.
 * Picks vary: a group's sounds are taken in a seeded order, never the same
 * twice in a row, at most three times in 30 s. Pure.
 */

import { Rng } from "./dsp.js";
import { kitTraits, pickVaried, soundSeconds, type KitUse } from "./kit-search.js";
import { attributionLine, type SfxCredit } from "./library.js";
import { sfxRecipe } from "./recipes.js";
import { RECORDED_KIT } from "./recorded-kit.data.js";

export const RECORDED_GROUPS = [
  "whoosh",
  "swish",
  "whip",
  "punch",
  "hit",
  "thud",
  "boom",
  "sub",
  "riser",
  "reverse",
  "click",
  "toggle",
  "tap",
  "key",
  "typing",
  "shutter",
  "pop",
  "glitch",
  "sparkle",
  "notify",
  "paper",
  "cloth",
  "scratch",
  "ambience",
] as const;
export type RecordedGroup = (typeof RECORDED_GROUPS)[number];

/** How Zenvi's own sounds are made: recorded (the kit, default where the host can fetch it) or synth (sfx/recipes.ts). */
export const SFX_KITS = ["recorded", "synth"] as const;
export type SfxKit = (typeof SFX_KITS)[number];

export interface RecordedSample {
  group: RecordedGroup;
  /** Freesound sound id. */
  id: number;
  name: string;
  username: string;
  /** Seconds, of the file as fetched (silence included). */
  duration: number;
  /** Freesound's HQ MP3 preview: fetched without a key. */
  url: string;
  sha256: string;
  bytes: number;
  /** Always CC0: the generator refuses anything else. */
  license: "CC0";
  /** The day Freesound last said CC0 for this id (YYYY-MM-DD). */
  licenseCheckedAt: string;
  /** Freesound's tags, lower case, at most a dozen. */
  tags: readonly string[];
  /** Measured on the fetched file (sfx/analyse.ts), ms from its start: first sound, loudest 50 ms, last sound. */
  onsetMs: number;
  peakMs: number;
  endMs: number;
  /** Onset to within 3 dB of the peak sample, ms (a hit's few ms, a swell's second). */
  attackMs: number;
  /** BS.1770 loudness of onset..end, LUFS, and its true peak, dBTP. */
  lufs: number;
  truePeakDb: number;
  /** Gain that brings the loudest 400 ms to the kit's reference (-18 LUFS) without passing -1 dBTP, dB. */
  gainDb: number;
  /** Peak over RMS of onset..end, dB: high for a snap, low for a bed. */
  crestDb: number;
  /** Spectral centroid, Hz, and the share of power under 150 Hz (0..1). */
  centroidHz: number;
  lowShare: number;
  /** Real stereo (side within 30 dB of mid), not two equal channels. */
  stereo: boolean;
  /** The original recording's sample rate, Hz. */
  sourceRate: number;
}

interface GroupSpec {
  /** Recipes the group's sounds play (the cue's recipe sets the level and the hit point). */
  recipes: readonly string[];
  /** Groups no recipe plays (placed from search_sound_library_tool): the recipe whose level and hit point they take. */
  placeAs?: string;
  /** Longest a sound of the group may run, seconds (a whoosh keeps its peak, a riser its end). */
  maxSeconds: number;
}

export const RECORDED_GROUP_SPECS: Readonly<Record<RecordedGroup, GroupSpec>> = {
  whoosh: { recipes: ["whoosh_medium", "whoosh_short", "whoosh_long", "whoosh_rise", "whoosh_fall"], maxSeconds: 2.5 },
  swish: { recipes: ["swish_airy"], maxSeconds: 1.2 },
  whip: { recipes: ["whip"], maxSeconds: 1 },
  punch: { recipes: ["impact_punch", "impact_slam"], maxSeconds: 1.5 },
  thud: { recipes: ["impact_thud"], maxSeconds: 2 },
  boom: { recipes: ["impact_boom"], maxSeconds: 5 },
  hit: { recipes: [], placeAs: "impact_punch", maxSeconds: 1.5 },
  sub: { recipes: ["sub_drop"], maxSeconds: 3 },
  riser: { recipes: ["riser_noise", "riser_tonal"], maxSeconds: 8 },
  reverse: { recipes: ["reverse_swell"], maxSeconds: 4 },
  click: { recipes: ["mouse_click"], maxSeconds: 0.6 },
  toggle: { recipes: ["toggle"], maxSeconds: 0.6 },
  tap: { recipes: ["ui_tap"], maxSeconds: 0.5 },
  key: { recipes: ["keyboard_key"], maxSeconds: 0.6 },
  typing: { recipes: ["typing_burst"], maxSeconds: 6 },
  shutter: { recipes: ["camera_shutter"], maxSeconds: 1.5 },
  pop: { recipes: ["pop"], maxSeconds: 0.8 },
  glitch: { recipes: ["glitch_burst", "static"], maxSeconds: 2 },
  sparkle: { recipes: ["sparkle"], maxSeconds: 3 },
  notify: { recipes: ["notification_blip"], maxSeconds: 2 },
  paper: { recipes: [], placeAs: "swish_airy", maxSeconds: 3 },
  cloth: { recipes: [], placeAs: "swish_airy", maxSeconds: 3 },
  scratch: { recipes: [], placeAs: "glitch_burst", maxSeconds: 2 },
  ambience: { recipes: [], placeAs: "static", maxSeconds: 60 },
};

const GROUP_OF: ReadonlyMap<string, RecordedGroup> = new Map(RECORDED_GROUPS.flatMap((g) => RECORDED_GROUP_SPECS[g].recipes.map((r) => [r, g] as const)));

/** The kit group that plays `recipe`; undefined when it stays synthesised. */
export function recordedGroupOf(recipe: string): RecordedGroup | undefined {
  return GROUP_OF.get(recipe);
}

/** The recipe a sound of `group` is levelled and timed as when it is placed by id. */
export function recordedPlaceRecipe(group: RecordedGroup): string {
  const spec = RECORDED_GROUP_SPECS[group];
  return spec.recipes[0] ?? spec.placeAs!;
}

export function recordedSamples(group: RecordedGroup, kit: readonly RecordedSample[] = RECORDED_KIT): RecordedSample[] {
  return kit.filter((s) => s.group === group);
}

/** Groups whose sounds sustain for as long as the cue asks (a riser into the climax, typing under a prompt): cut to the cue, not the group. */
const SUSTAINED: ReadonlySet<RecordedGroup> = new Set(["riser", "reverse", "typing", "glitch", "ambience"]);

/** Longest the sound for a cue of `group` may run: the cue's own length for sustained sounds, else the group's. */
export function recordedMaxSeconds(group: RecordedGroup, cueSeconds: number | undefined): number {
  const max = RECORDED_GROUP_SPECS[group].maxSeconds;
  return SUSTAINED.has(group) && cueSeconds !== undefined ? Math.max(0.1, Math.min(max, cueSeconds)) : max;
}

/** Groups whose sound peaks mid-file, so a long one cannot be cut to a short cue (a hit keeps its start, a riser its end). */
const PEAKING: ReadonlySet<RecordedGroup> = new Set(["whoosh", "swish", "whip", "paper", "cloth"]);

/**
 * Sounds that suit a cue `wanted` seconds long: a 2 s whoosh under a 0.3 s
 * cut drowns the next one. Hits, clicks and risers are cut to length, so
 * every one fits (the whole group rotates). At least two, for variety.
 */
function fitting(group: RecordedGroup, samples: readonly RecordedSample[], wanted: number | undefined): RecordedSample[] {
  if (wanted === undefined || !PEAKING.has(group)) return [...samples];
  const fit = samples.filter((s) => soundSeconds(s) <= wanted * 1.8 + 0.15);
  if (fit.length >= 2) return fit;
  return [...samples].sort((a, b) => soundSeconds(a) - soundSeconds(b) || a.id - b.id).slice(0, Math.min(3, samples.length));
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rng = new Rng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function groupSeed(seed: number, group: RecordedGroup): number {
  return Math.imul(seed | 0, 2654435761) ^ Math.imul(RECORDED_GROUPS.indexOf(group) + 1, 0x9e3779b9);
}

/** Longest attack of a sound whose transient goes on the moment, ms (DEPLOY S4.3: a hero's transient is <= 30 ms). */
const MAX_ATTACK_MS = 30;
/** Recipes that play a hero hit: never from the softest third of their group. */
const HERO_RECIPES: ReadonlySet<string> = new Set(["impact_punch", "impact_slam", "impact_boom", "impact_thud", "sub_drop"]);

/**
 * The sounds of `group` that suit `recipe` by their measurements: a fast
 * attack where the recipe's transient lands on the moment (a slow one
 * smears it before the cut), and a hard hit for a hero. A filter that
 * would leave fewer than four sounds is skipped, so variety holds.
 */
function suited(group: RecordedGroup, recipe: string, samples: readonly RecordedSample[], kit: readonly RecordedSample[]): readonly RecordedSample[] {
  let pool = samples;
  const keep = (test: (s: RecordedSample) => boolean) => {
    const kept = pool.filter(test);
    if (kept.length >= 4) pool = kept;
  };
  if (sfxRecipe(recipe)?.hit === "onset" && !SUSTAINED.has(group)) keep((s) => s.attackMs <= MAX_ATTACK_MS);
  if (HERO_RECIPES.has(recipe)) keep((s) => kitTraits(s, kit).energy !== "soft");
  return pool;
}

/** A group's sounds that fit `request`, in the seeded order picks prefer. */
function candidatesFor(request: RecordedRequest, seed: number, kit: readonly RecordedSample[]): RecordedSample[] {
  const group = recordedGroupOf(request.recipe);
  return group ? shuffled(fitting(group, suited(group, request.recipe, recordedSamples(group, kit), kit), request.seconds), groupSeed(seed, group)) : [];
}

export interface RecordedRequest {
  recipe: string;
  /** The cue's length, seconds, when it has one. */
  seconds?: number;
  /** Timeline seconds of the cue (variety is counted over 30 s windows); default: one second after the previous request. */
  at?: number;
}

/**
 * The kit sound each request plays (undefined: synthesised), by the variety
 * rules (sfx/kit-search.ts pickVaried): a sound never follows itself in the
 * sequence, plays at most three times in 30 s, and a group's sounds take
 * turns in a seeded order.
 */
export function pickRecorded(requests: readonly RecordedRequest[], seed: number, kit: readonly RecordedSample[] = RECORDED_KIT): (RecordedSample | undefined)[] {
  const used: KitUse[] = [];
  return requests.map((request, i) => {
    const pick = pickVaried(candidatesFor(request, seed, kit), used, request.at ?? i);
    if (pick) used.push({ id: pick.id, at: request.at ?? i });
    return pick;
  });
}

/**
 * One sound for a single cue (add_sfx_tool) at `at`, given the kit sounds
 * already on the timeline: never the one right before or after the moment,
 * the group's least used next in its seeded order.
 */
export function pickRecordedOne(request: RecordedRequest & { at: number }, seed: number, used: readonly KitUse[], kit: readonly RecordedSample[] = RECORDED_KIT): RecordedSample | undefined {
  return pickVaried(candidatesFor(request, seed, kit), used, request.at);
}

export function recordedSample(id: number, kit: readonly RecordedSample[] = RECORDED_KIT): RecordedSample | undefined {
  return kit.find((s) => s.id === id);
}

/** The credit a kit sound's file records: CC0 needs none, but where it came from stays known (list_credits_tool). */
export function recordedCredit(sample: RecordedSample): SfxCredit {
  const credit = {
    provider: "freesound" as const,
    id: String(sample.id),
    title: sample.name,
    creator: sample.username,
    license: "cc0",
    license_name: "CC0 1.0",
    license_url: "https://creativecommons.org/publicdomain/zero/1.0/",
    attribution_required: false,
    landing_url: `https://freesound.org/s/${sample.id}/`,
    source: "freesound",
  };
  return { ...credit, attribution: attributionLine(credit) };
}
