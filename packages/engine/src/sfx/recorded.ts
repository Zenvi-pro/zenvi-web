/**
 * Zenvi's recorded SFX kit: real recordings (whooshes swung past a mic,
 * punches, shutters, typing...) chosen from Freesound, CC0 only, by id.
 * The repo holds the list, the checksums and the licences
 * (recorded-kit.data.ts, made by scripts/gen-recorded-kit.ts), never the
 * audio: a host fetches a sound on first use into a cache every project
 * shares (MediaHost.kitSample) and checks its bytes against the list.
 *
 * add_sfx_tool and auto_sound_design_tool play a cue through the kit when
 * its recipe has a group here; recipes without one (sub drops, sparkles,
 * tonal risers) and hosts that cannot fetch stay synthesised. Picks vary:
 * a group's sounds are taken in a seeded order, never the same twice in a
 * row. Pure.
 */

import { Rng } from "./dsp.js";
import { attributionLine, type SfxCredit } from "./library.js";
import { RECORDED_KIT } from "./recorded-kit.data.js";

export const RECORDED_GROUPS = ["whoosh", "swish", "whip", "punch", "thud", "boom", "riser", "click", "toggle", "tap", "key", "typing", "shutter", "pop", "glitch"] as const;
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
}

interface GroupSpec {
  /** Recipes the group's sounds play (the cue's recipe sets the level and the hit point). */
  recipes: readonly string[];
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
  riser: { recipes: ["riser_noise", "reverse_swell"], maxSeconds: 8 },
  click: { recipes: ["mouse_click"], maxSeconds: 0.6 },
  toggle: { recipes: ["toggle"], maxSeconds: 0.6 },
  tap: { recipes: ["ui_tap"], maxSeconds: 0.5 },
  key: { recipes: ["keyboard_key"], maxSeconds: 0.6 },
  typing: { recipes: ["typing_burst"], maxSeconds: 6 },
  shutter: { recipes: ["camera_shutter"], maxSeconds: 1.5 },
  pop: { recipes: ["pop"], maxSeconds: 0.8 },
  glitch: { recipes: ["glitch_burst", "static"], maxSeconds: 2 },
};

const GROUP_OF: ReadonlyMap<string, RecordedGroup> = new Map(RECORDED_GROUPS.flatMap((g) => RECORDED_GROUP_SPECS[g].recipes.map((r) => [r, g] as const)));

/** The kit group that plays `recipe`; undefined when it stays synthesised. */
export function recordedGroupOf(recipe: string): RecordedGroup | undefined {
  return GROUP_OF.get(recipe);
}

export function recordedSamples(group: RecordedGroup, kit: readonly RecordedSample[] = RECORDED_KIT): RecordedSample[] {
  return kit.filter((s) => s.group === group);
}

/** Groups whose sounds sustain for as long as the cue asks (a riser into the climax, typing under a prompt): cut to the cue, not the group. */
const SUSTAINED: ReadonlySet<RecordedGroup> = new Set(["riser", "typing", "glitch"]);

/** Longest the sound for a cue of `group` may run: the cue's own length for sustained sounds, else the group's. */
export function recordedMaxSeconds(group: RecordedGroup, cueSeconds: number | undefined): number {
  const max = RECORDED_GROUP_SPECS[group].maxSeconds;
  return SUSTAINED.has(group) && cueSeconds !== undefined ? Math.max(0.1, Math.min(max, cueSeconds)) : max;
}

/** Sounds that suit a cue `wanted` seconds long: a 2 s whoosh under a 0.3 s cut drowns the next one. At least two, for variety. */
function fitting(samples: readonly RecordedSample[], wanted: number | undefined): RecordedSample[] {
  if (wanted === undefined) return [...samples];
  const fit = samples.filter((s) => s.duration <= wanted * 1.8 + 0.15);
  if (fit.length >= 2) return fit;
  return [...samples].sort((a, b) => a.duration - b.duration || a.id - b.id).slice(0, Math.min(3, samples.length));
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

export interface RecordedRequest {
  recipe: string;
  /** The cue's length, seconds, when it has one. */
  seconds?: number;
}

/**
 * The kit sound each request plays (undefined: synthesised). A group's
 * sounds are taken in turn from a seeded order; a sound never follows
 * itself, within its group or in the sequence.
 */
export function pickRecorded(requests: readonly RecordedRequest[], seed: number, kit: readonly RecordedSample[] = RECORDED_KIT): (RecordedSample | undefined)[] {
  const turns = new Map<RecordedGroup, number>();
  const last = new Map<RecordedGroup, number>();
  let previous: number | undefined;
  return requests.map((request) => {
    const group = recordedGroupOf(request.recipe);
    if (!group) return undefined;
    const order = shuffled(fitting(recordedSamples(group, kit), request.seconds), groupSeed(seed, group));
    if (order.length === 0) return undefined;
    let turn = turns.get(group) ?? 0;
    let pick = order[turn % order.length]!;
    if (order.length > 1 && (pick.id === last.get(group) || pick.id === previous)) pick = order[++turn % order.length]!;
    turns.set(group, turn + 1);
    last.set(group, pick.id);
    previous = pick.id;
    return pick;
  });
}

/**
 * One sound for a single cue (add_sfx_tool): the group's next in its seeded
 * order after the ones already placed, and never one of `neighbours` (the
 * kit sounds placed just before and after the moment).
 */
export function pickRecordedOne(request: RecordedRequest, seed: number, placed: number, neighbours: readonly number[], kit: readonly RecordedSample[] = RECORDED_KIT): RecordedSample | undefined {
  const group = recordedGroupOf(request.recipe);
  if (!group) return undefined;
  const order = shuffled(fitting(recordedSamples(group, kit), request.seconds), groupSeed(seed, group));
  for (let k = 0; k < order.length; k += 1) {
    const pick = order[(placed + k) % order.length]!;
    if (!neighbours.includes(pick.id)) return pick;
  }
  return order[placed % Math.max(1, order.length)];
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
