/**
 * Sound design: procedural sound effects (sfx/recipes.ts) placed on the
 * timeline so the edit snaps — a whoosh peaking on a whip cut, a punch on a
 * hard cut, clicks on UI moments, a riser into the climax and an impact on
 * it.
 *
 *   list_sfx_tool            the recipes, their parameters and where each fits
 *   add_sfx_tool             one effect at a time, a clip edge or a marker: a recipe or a
 *                            library sound (search_sfx_tool, sound-library.ts)
 *   auto_sound_design_tool   reads the edit and places a tasteful set; a rerun replaces it.
 *                            With a sound kit on the project (create_sound_kit_tool) every
 *                            cue plays through it, so the edit's whooshes are one family
 *
 * Effects are rendered here (pure DSP, the same on every surface), stored
 * through the host as WAV once per sound and placed on the "SFX" track
 * (more lanes when they overlap). No effect plays past the last frame of
 * the picture (sfx-media.ts pictureEnd): the receipt names every tail it
 * cut. Every call is one undo step.
 */

import { z } from "zod";
import { isAudioOnlyMedia } from "../../model/media.js";
import type { Clip, Project } from "../../model/types.js";
import { deleteClips } from "../../ops/clips.js";
import { designSound, type DesignedCue } from "../../sfx/design.js";
import { KINETIC_CAPTIONS_KEY, isAutoSfxClip, isSfxClip, type BeatGrid } from "../../sfx/moments.js";
import { PALETTES, PALETTE_IDS, guessPalette, traitsOf, type PaletteId } from "../../sfx/palettes.js";
import { CLIMAX_TAIL, SFX_DENSITIES, SFX_INTENSITIES, musicClimax, type SfxCue, type TimelineBeat } from "../../sfx/plan.js";
import { spotHitPoints, type HitPoint } from "../../sfx/spot.js";
import { KIT_SLOTS, KIT_SLOT_SPECS, applyKit, guessSlot, kitFileIds, proceduralKit, rawSoundKit, readSoundKit, slotOfRecipe, slotRecipe, type KitPick, type KitSlot, type SoundKit } from "../../sfx/kit.js";
import { SFX_PROVIDERS, allowsCommercialUse } from "../../sfx/library.js";
import { SFX_RECIPES, SFX_RECIPE_IDS, sfxRecipe, type SfxFamily } from "../../sfx/recipes.js";
import { SFX_KITS, pickRecordedOne, recordedGroupOf, recordedMaxSeconds, recordedSample, type SfxKit } from "../../sfx/recorded.js";
import type { SfxParams } from "../../sfx/render.js";
import { getEffectiveAiMetadata } from "../ai-metadata.js";
import { MUSIC_MIN_DURATION, classifyClipAudioRole, speechWindowsFromCues } from "../audio-mix.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged, type ReceiptClip } from "../receipt.js";
import { lookupLibrarySound, prepareLibrarySfx } from "../sfx-library.js";
import { kitRequests, prepareKitSfx, prepareRecordedSfx, recordedIdOfKey, recordedKitAvailable, resolveSfxKit } from "../sfx-recorded.js";
import { markOf, pictureEnd, placeSfx, prepareSfx, removeUnusedSfxFiles, snapToFrame, type PlacedSfx, type PreparedSfx } from "../sfx-media.js";
import { fileById } from "./common.js";
import { missingBlockEvents } from "./motion-blocks.js";
import { applyBedDips, readBedMark, restoreBed } from "../sfx-bed.js";
import { levelCues } from "../sfx-levels.js";
import { clipTitle } from "./timeline-edit-common.js";
import { fillLibrarySlots } from "./sound-library.js";

const LIST = "list_sfx_tool";
const ADD = "add_sfx_tool";
const AUTO = "auto_sound_design_tool";
const SPOT = "spot_sound_tool";

const RECIPE_IDS = SFX_RECIPE_IDS as [string, ...string[]];
const FAMILIES = [...new Set(SFX_RECIPES.map((r) => r.family))] as [SfxFamily, ...SfxFamily[]];

const PARAMS_HELP = {
  duration: "Seconds (each recipe has its own range; list_sfx_tool shows it). Default: the recipe's.",
  pitch: "Semitones, -12..12 (default 0). Lower = bigger and heavier.",
  brightness: "0 (dark, distant) .. 1 (bright, close). Default 0.5.",
  intensity: "0 (gentle) .. 1 (hard: more drive, tail and density). Default 0.7.",
  pan: "-1..1. Static sounds: the position. Moving sounds (whooshes, risers): the travel, from -pan to +pan (sign = direction). Default 0.",
  seed: "Any integer: another variation of the same recipe (default 1). Vary it between repeats.",
};

const paramShape = {
  duration: z.number().positive().max(8).optional().describe(PARAMS_HELP.duration),
  pitch: z.number().min(-12).max(12).optional().describe(PARAMS_HELP.pitch),
  brightness: z.number().min(0).max(1).optional().describe(PARAMS_HELP.brightness),
  intensity: z.number().min(0).max(1).optional().describe(PARAMS_HELP.intensity),
  pan: z.number().min(-1).max(1).optional().describe(PARAMS_HELP.pan),
  seed: z.number().int().optional().describe(PARAMS_HELP.seed),
};

const listInput = z.strictObject({
  family: z.enum(FAMILIES).optional().describe(`Only this family: ${FAMILIES.join(", ")}.`),
});

export const SFX_SOURCES = ["procedural", "kit", "library", "mixed"] as const;
type SfxSources = (typeof SFX_SOURCES)[number];

const addInput = z.strictObject({
  recipe: z.enum(RECIPE_IDS).optional().describe("A procedural sound (list_sfx_tool describes each). Or a library sound: provider + sound_id."),
  provider: z.enum(SFX_PROVIDERS).optional().describe("With sound_id: the library of a search_sfx_tool result (openverse, freesound; procedural takes a recipe id)."),
  sound_id: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("With provider: the result's id. The sound is downloaded into the project, trimmed of silence, levelled like the procedural effects, and its licence and attribution are recorded on the file (list_credits_tool)."),
  title: z.string().min(1).max(300).optional().describe("Freesound only: the result's title (a Freesound sound is found again by it)."),
  role: z
    .enum(KIT_SLOTS)
    .optional()
    .describe("Library sounds: what it plays; its hit point and level follow (whoosh, swish, whip peak on the moment; hit, boom, sub, click, pop, glitch start on it; riser ends on it). Default: from its title and tags."),
  max_seconds: z.number().positive().max(15).optional().describe("Library sounds: the longest it may run, seconds (default: the role's longest, e.g. 3 s for a whoosh)."),
  allow_noncommercial: z.boolean().optional().describe("Library sounds: accept a non-commercial licence (default false: refused)."),
  kit: z
    .enum(SFX_KITS)
    .optional()
    .describe(
      "With a recipe: recorded (default where this surface can fetch it, unless pitch, brightness, intensity or pan shape a synthesised one) plays a real CC0 recording of that sound from Zenvi's kit, a different one than the kit sounds next to it; " +
        "synth synthesises the recipe. Recipes the kit has no recording of (sub_drop, sparkle, riser_tonal...) are synthesised.",
    ),
  at_seconds: z.number().min(0).optional().describe("Timeline time of the moment, seconds."),
  clip_id: z.string().min(1).optional().describe("Or: a timeline clip whose edge is the moment."),
  edge: z.enum(["start", "end"]).optional().describe("With clip_id: the clip's start (default) or end."),
  marker_id: z.string().min(1).optional().describe("Or: a marker's id; the moment is the marker's position."),
  align: z
    .enum(["peak", "start"])
    .optional()
    .describe("peak (default): the sound's hit point lands on the moment (a whoosh's peak, an impact's transient, a riser's end). start: the sound starts there."),
  // libopenshot's clip volume runs 0..1, and files peak at -1 dBFS: 0 dB is as loud as an effect gets.
  gain_db: z.number().min(-40).max(0).optional().describe("Clip gain, dB, -40..0. Default: the recipe's mix level (peaks around -8…-14 dBFS, under music)."),
  ...paramShape,
});

const autoInput = z.strictObject({
  sources: z
    .enum(SFX_SOURCES)
    .optional()
    .describe(
      "Where the sounds come from: kit (default when the project has a sound kit: every cue plays through it), procedural (default otherwise: Zenvi's own sounds, see kit), " +
        "library (licensed library sounds for every role, CC0 or commercial-use licences, credits recorded) or mixed (library whooshes, hits and risers; synthesised clicks, pops and subs). " +
        "library and mixed use the kit's library sounds when it has them, else pick them now.",
    ),
  kit: z
    .enum(SFX_KITS)
    .optional()
    .describe(
      "Zenvi's own sounds: recorded (default where this surface can fetch it: real CC0 recordings, whooshes, punches, clicks, shutters, typing, never the same sample twice in a row; fetched once and cached) " +
        "or synth (synthesised here, works offline). Plays every cue not taken from a library; sub drops, sparkles and tonal risers stay synthesised. Not with a project sound kit (sources=kit).",
    ),
  intensity: z
    .enum(SFX_INTENSITIES)
    .optional()
    .describe("How much sound: subtle (only the big moments), normal (default: strong cuts, transitions, titles), hype (nearly every cut, tonal risers, sub drops)."),
  density: z
    .enum(SFX_DENSITIES)
    .optional()
    .describe(
      "auto (default): the intensity's own spacing. every_cut: a sound on every cut, as hype edits have it (build_reel_tool's hype receipt asks for it): light hits and short whooshes alternating on the cuts, whooshes on whips, clicks on flashes and title slams, no sound twice in a row.",
    ),
  genre: z
    .enum(["auto", ...PALETTE_IDS])
    .optional()
    .describe(
      "The genre's palette: which cues, how dense, which space, its signature moves (CRAFT.md §10). auto (default) reads it from the edit: speech with captions = talking_head, speech = video_essay or documentary, UI blocks = saas_ui, 3D scenes = product_3d, tiles = multiplicity, 3-6 frame shots = flash_montage, fast cuts on music = hype, else editorial.",
    ),
  seed: z.number().int().optional().describe("Another variation of the whole design (default 1)."),
  beats: z
    .array(z.number().min(0))
    .max(4000)
    .optional()
    .describe("Beat times on the timeline, seconds (e.g. build_reel_tool's `beats`), instead of analysing the music here. Every 4th is a downbeat."),
  climax_seconds: z
    .number()
    .min(0)
    .optional()
    .describe("Where the climax is (a riser builds into it, an impact lands on it). Default: the music's biggest jump in loudness; none without music."),
});

const spotInput = z.strictObject({
  genre: autoInput.shape.genre,
  beats: autoInput.shape.beats,
  climax_seconds: autoInput.shape.climax_seconds,
  include_dry: z.boolean().optional().describe("Also list the hit points the doctrine leaves dry (connector words, cuts inside a flash run, moves too small to whoosh), with why. Default false: counted only."),
  limit: z.number().int().min(1).max(400).optional().describe("Most points listed (default 120); the counts cover all."),
});

type AddInput = z.infer<typeof addInput>;
type AutoInput = z.infer<typeof autoInput>;
type SpotArgs = z.infer<typeof spotInput>;

function paramsOf(args: Partial<Record<keyof typeof paramShape, number>>): SfxParams {
  const out: SfxParams = {};
  for (const key of Object.keys(paramShape) as (keyof typeof paramShape)[]) if (args[key] !== undefined) out[key] = args[key];
  return out;
}

function clipRow(project: Project, clip: Clip, extra: Record<string, unknown>): ReceiptClip {
  const layer = project.layers.find((l) => l.number === clip.layer);
  return { id: clip.id, layer: clip.layer, position: clip.position, start: clip.start, end: clip.end, title: clip.title, track_name: layer?.label, ...extra };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The music bed: the longest audio-only clip that is not a sound effect. */
function musicBed(project: Project): Clip | undefined {
  return project.clips
    .filter((c) => !isSfxClip(c) && c.end - c.start >= MUSIC_MIN_DURATION)
    .filter((c) => {
      const file = fileById(project, String(c.file_id));
      return file ? isAudioOnlyMedia(file) : false;
    })
    .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
}

/** Where someone speaks, from transcripts the project already has. */
function speechWindows(project: Project): [number, number][] {
  const out: [number, number][] = [];
  for (const clip of project.clips) {
    if (isSfxClip(clip)) continue;
    const file = fileById(project, String(clip.file_id));
    const effective = getEffectiveAiMetadata(file, clip, { clipAiMetadata: (clip as { ai_metadata?: unknown }).ai_metadata });
    if (classifyClipAudioRole(clip, file, effective) !== "speech") continue;
    for (const [a, b] of speechWindowsFromCues(clip, effective)) out.push([a, b]);
  }
  return out;
}

interface MusicAnalysis {
  grid: BeatGrid | null;
  climax: number | null;
  bpm?: number;
  note?: string;
}

/** The music's beats on the timeline and its climax: given beats win for the grid; the bed still gives the climax when it can be analysed. */
async function analyseMusic(call: ToolCall, bed: Clip | undefined, args: AutoInput, duration: number): Promise<MusicAnalysis> {
  const tracked = await trackBed(call, bed, duration);
  if (args.beats && args.beats.length >= 2) {
    const beats = [...args.beats].sort((a, b) => a - b);
    // Given beats replace the grid, not the climax: still say when none was found.
    const note = tracked.note && tracked.climax === null && args.climax_seconds === undefined ? "The music could not be analysed, so no climax was found and no riser or impact is placed (pass climax_seconds)." : undefined;
    return { ...tracked, grid: { beats, downbeats: beats.filter((_, i) => i % 4 === 0) }, note };
  }
  return tracked;
}

async function trackBed(call: ToolCall, bed: Clip | undefined, duration: number): Promise<MusicAnalysis> {
  if (!bed) return { grid: null, climax: null };
  if (!canTrackBeats(call)) return { grid: null, climax: null, note: "This surface cannot analyse audio: cuts are weighed without the music's beats and no climax was found (pass beats / climax_seconds)." };
  const file = fileById(call.doc.project, String(bed.file_id))!;
  const tracked = await beatsOfFile(call, file);
  if (typeof tracked === "string") return { grid: null, climax: null, note: `${tracked} Cuts are weighed without the music's beats.` };
  const toTimeline = (t: number) => bed.position + (t - bed.start);
  const inside = (t: number) => t >= bed.start && t <= bed.end;
  const beats: TimelineBeat[] = tracked.beats
    .map((b, i) => ({ source: b.timeSec, energy: tracked.beatEnergy[i] ?? 0 }))
    .filter((b) => inside(b.source))
    .map((b) => ({ time: toTimeline(b.source), energy: b.energy }));
  const downbeats = tracked.downbeats.map((d) => d.timeSec).filter(inside).map(toTimeline);
  return {
    grid: { beats: beats.map((b) => b.time), downbeats },
    climax: musicClimax(beats, downbeats, duration),
    bpm: Math.round(tracked.bpm),
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Receipt fields of a tail cut at the picture's end (none when the sound fit). */
function trimOf(trimmed: number): { trimmed_seconds?: number } {
  return trimmed > 0 ? { trimmed_seconds: round3(trimmed) } : {};
}

function pastPicture(hitAt: number, end: number): string {
  return `Error: ${hitAt.toFixed(2)} s is at or after the end of the picture (${end.toFixed(2)} s): the sound's hit would play over black. Pick an earlier moment.`;
}

/** Receipt fields of a library sound (none for a synthesised one). */
function libraryOf(sound: PreparedSfx): { library?: string; title?: string } {
  return sound.credit ? { library: `${sound.credit.provider}:${sound.credit.id}`, title: sound.credit.title } : {};
}

/** A bin file a kit names, as a sound to place; undefined when it is gone. */
function kitFileSound(project: Project, fileId: string): PreparedSfx | undefined {
  const file = fileById(project, fileId);
  const mark = file ? markOf(file) : undefined;
  if (!file || !mark?.key || typeof mark.hit !== "number" || !mark.recipe || !sfxRecipe(mark.recipe)) return undefined;
  const credit = file.zenvi_credit as PreparedSfx["credit"];
  return { key: mark.key, recipe: mark.recipe, hit: mark.hit, duration: typeof mark.duration === "number" ? mark.duration : Number(file.duration) || 0, fileId, title: credit?.title ?? String(file.name ?? ""), credit };
}

/**
 * One sound per cue: procedural picks played through the recorded kit where
 * it has the sound (kit=recorded) or rendered (or reused), library picks
 * from the bin or this run's downloads; a kit sound no longer in the project
 * is synthesised instead. `recorded` counts the recorded kit's.
 */
async function soundsOf(
  call: ToolCall,
  picks: readonly KitPick[],
  cues: readonly SfxCue[],
  pending: ReadonlyMap<string, PreparedSfx>,
  warnings: string[],
  own: { kit: SfxKit; seed: number },
): Promise<{ sounds: PreparedSfx[]; recorded: number }> {
  const out: (PreparedSfx | undefined)[] = picks.map((pick) => (pick.kind === "library" ? (pending.get(pick.sound.file_id) ?? kitFileSound(call.doc.project, pick.sound.file_id)) : undefined));
  const missing = new Set<string>();
  const requests = picks.map((pick, i) => {
    if (out[i]) return undefined;
    if (pick.kind === "library") {
      missing.add(pick.sound.title);
      return { recipe: cues[i]!.recipe, params: cues[i]!.params };
    }
    return { recipe: pick.recipe, params: pick.params };
  });
  if (missing.size > 0) warnings.push(`The kit's ${[...missing].map((t) => `'${t}'`).join(", ")} ${missing.size === 1 ? "is" : "are"} no longer in the project: synthesised instead (create_sound_kit_tool makes the kit again).`);
  const todo = requests.flatMap((r, i) => (r ? [{ r, i }] : []));
  const made = await prepareKitSfx(call, kitRequests(todo.map((t) => t.r), own.kit, own.seed), warnings);
  todo.forEach((t, k) => (out[t.i] = made.sounds[k]));
  return { sounds: out as PreparedSfx[], recorded: made.recorded };
}

/** The recorded kit sound playing a clip, if it plays one. */
function recordedIdOfClip(project: Project, clip: Clip): number | undefined {
  const file = fileById(project, String(clip.file_id));
  return file ? recordedIdOfKey(markOf(file)?.key) : undefined;
}

/**
 * add_sfx_tool's recorded kit sound for `recipe` at `at`: the group's next
 * after the ones already on the timeline, never the kit sound right before
 * or after the moment. Undefined (synthesise) with kit=synth, for recipes
 * the kit has no recording of, or when it cannot be fetched (said in
 * `warnings`).
 */
async function recordedFor(call: ToolCall, recipe: string, args: AddInput, at: number, warnings: string[]): Promise<PreparedSfx | undefined> {
  const group = recordedGroupOf(recipe);
  if (resolveSfxKit(call.host, args.kit) !== "recorded" || !group) return undefined;
  if (!recordedKitAvailable(call.host)) {
    warnings.push("This surface cannot fetch the recorded kit, so the sound is synthesised.");
    return undefined;
  }
  const project = call.doc.project;
  const placed = project.clips
    .filter(isSfxClip)
    .map((clip) => ({ clip, id: recordedIdOfClip(project, clip) }))
    .filter((p): p is { clip: Clip; id: number } => p.id !== undefined && recordedSample(p.id)?.group === group)
    .sort((a, b) => a.clip.position - b.clip.position);
  const before = placed.filter((p) => p.clip.position <= at).at(-1);
  const after = placed.find((p) => p.clip.position > at);
  const sample = pickRecordedOne({ recipe, seconds: args.duration }, args.seed ?? 1, placed.length, [before?.id, after?.id].filter((id): id is number => id !== undefined));
  if (!sample) return undefined;
  try {
    return await prepareRecordedSfx(call, sample, recipe, recordedMaxSeconds(group, args.duration));
  } catch (error) {
    warnings.push(`The recorded kit sound could not be fetched (${errorText(error)}), so it is synthesised.`);
    return undefined;
  }
}

export const soundDesignTools: CatalogTool[] = [
  directTool({
    name: LIST,
    title: "List sound effects",
    description:
      "The procedural sound effects add_sfx_tool and auto_sound_design_tool place: whooshes, impacts, risers, clicks, UI sounds, textures. " +
      "Each with its hit point, duration range, default mix gain and where it fits.",
    input: listInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: (_call, args) => {
      const recipes = SFX_RECIPES.filter((r) => !args.family || r.family === args.family).map((r) => ({
        id: r.id,
        family: r.family,
        title: r.title,
        hit: r.hit,
        duration: r.duration,
        gain_db: r.mixDb,
        use: r.use,
      }));
      return applied(LIST, `${recipes.length} sound effects: ${recipes.map((r) => r.id).join(", ")}.`, {
        data: { recipes, parameters: PARAMS_HELP, hit_points: { peak: "a whoosh's loudest moment", onset: "the transient", end: "a riser's last instant" } },
      });
    },
  }),

  directTool({
    name: ADD,
    title: "Add a sound effect",
    description:
      "Place one sound effect on the SFX track: at a time, on a clip's start or end, or on a marker. " +
      "A procedural recipe (list_sfx_tool; vary seed and pitch between repeats) or a library sound from search_sfx_tool (provider + sound_id): " +
      "downloaded into the project, trimmed of silence, levelled like the recipes, its licence and attribution recorded (list_credits_tool); non-commercial licences are refused unless allowed. " +
      "By default its hit point lands on the moment (a whoosh peaks on the cut, an impact's transient hits it, a riser ends on it). One undo step.",
    input: addInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: AddInput) => {
      const project = call.doc.project;
      const targets = [args.at_seconds !== undefined, args.clip_id !== undefined, args.marker_id !== undefined].filter(Boolean).length;
      if (targets !== 1) return refused(ADD, "Error: give exactly one of at_seconds, clip_id or marker_id.");
      if (args.edge && !args.clip_id) return refused(ADD, "Error: edge goes with clip_id.");
      const procedural = args.recipe !== undefined || args.provider === "procedural";
      if ((args.recipe !== undefined) === (args.sound_id !== undefined)) return refused(ADD, "Error: give recipe, or provider and sound_id (a search_sfx_tool result).");
      if (args.sound_id !== undefined && !args.provider) return refused(ADD, "Error: sound_id goes with provider (openverse, freesound or procedural).");
      if (args.provider && args.sound_id === undefined) return refused(ADD, "Error: provider goes with sound_id.");
      const recipeId = args.recipe ?? (args.provider === "procedural" ? args.sound_id! : undefined);
      if (procedural && !sfxRecipe(recipeId!)) return refused(ADD, `Error: no procedural sound '${recipeId}' (list_sfx_tool lists them).`);
      const libraryOnly = (["title", "role", "max_seconds", "allow_noncommercial"] as const).filter((k) => args[k] !== undefined);
      if (procedural && libraryOnly.length > 0) return refused(ADD, `Error: ${libraryOnly.join(", ")} ${libraryOnly.length === 1 ? "goes" : "go"} with a library sound, not a recipe.`);
      const synthOnly = (Object.keys(paramShape) as (keyof typeof paramShape)[]).filter((k) => args[k] !== undefined);
      if (!procedural && synthOnly.length > 0) return refused(ADD, `Error: ${synthOnly.join(", ")} shape procedural recipes; a library sound plays as it is (role, max_seconds and gain_db apply).`);
      if (!procedural && args.kit) return refused(ADD, "Error: kit goes with a recipe; a library sound plays as it is.");
      const shaping = (["pitch", "brightness", "intensity", "pan"] as const).filter((k) => args[k] !== undefined);
      if (args.kit === "recorded" && shaping.length > 0) return refused(ADD, `Error: ${shaping.join(", ")} ${shaping.length === 1 ? "shapes" : "shape"} a synthesised sound; kit=recorded plays a recording (duration and seed apply). Pass kit=synth.`);
      if (!call.host.media?.writeGenerated) return refused(ADD, "Error: add_sfx_tool is not available in this Zenvi surface: it cannot store generated audio.");
      let at: number;
      let moment: string;
      if (args.clip_id !== undefined) {
        const clip = project.clips.find((c) => c.id === args.clip_id);
        if (!clip) return refused(ADD, `Error: no clip with id ${args.clip_id}.`);
        const edge = args.edge ?? "start";
        at = edge === "start" ? clip.position : clip.position + (clip.end - clip.start);
        moment = `the ${edge} of ${clipTitle(clip)}`;
      } else if (args.marker_id !== undefined) {
        const marker = project.markers.find((m) => m.id === args.marker_id);
        if (!marker) return refused(ADD, `Error: no marker with id ${args.marker_id}.`);
        at = Number(marker.position) || 0;
        moment = `marker ${marker.id}`;
      } else {
        at = args.at_seconds!;
        moment = `${at.toFixed(2)} s`;
      }
      at = snapToFrame(project, at);
      const align = args.align ?? "peak";
      const until = pictureEnd(project) ?? undefined;
      // Past the picture nothing fits: refused before any library is reached (the exact checks follow).
      if (until !== undefined && at > until + 1e-6) return refused(ADD, pastPicture(at, until));

      const warnings: string[] = [];
      // A library sound is looked up again (its licence is the library's word, not the caller's), then downloaded and conditioned.
      let library: Awaited<ReturnType<typeof lookupLibrarySound>> | undefined;
      let role: KitSlot | undefined;
      if (!procedural) {
        if (!call.host.media.importUrl || !call.host.audio?.decodePcm) return refused(ADD, "Error: library sounds are not available in this Zenvi surface: it cannot download and decode audio.");
        library = await lookupLibrarySound(call, args.provider as "openverse" | "freesound", args.sound_id!, args.title);
        if (typeof library === "string") return refused(ADD, library);
        if (!allowsCommercialUse(library.license) && !args.allow_noncommercial) {
          return refused(ADD, `Error: '${library.title}' is ${library.license_name}: not for commercial use. Pick another sound, or pass allow_noncommercial=true if this video is non-commercial.`);
        }
        role = args.role ?? guessSlot(library.title, library.tags);
      }
      const recipe = sfxRecipe(recipeId ?? slotRecipe(role!))!;
      const gainDb = args.gain_db ?? recipe.mixDb;

      // A riser ends on its moment: at the very start of the timeline nothing of it would play.
      if (align === "peak" && recipe.hit === "end" && at < 0.05) return refused(ADD, "Error: a riser ends on its moment, so at 0 s nothing of it would play; pick a later moment or align=start.");
      const late = (hitAt: number) => until !== undefined && (recipe.hit === "end" ? hitAt > until + 1e-6 : hitAt >= until - 1e-6);
      // Checked again once the sound is made and its hit known (align=start).
      if (align === "peak" ? late(at) : until !== undefined && at >= until - 1e-6) return refused(ADD, pastPicture(at, until!));
      let sound: PreparedSfx & { prep?: { trimmedHead: number; trimmedTail: number; gainDb: number } };
      try {
        if (library && typeof library !== "string") sound = await prepareLibrarySfx(call, library, recipe.id, args.max_seconds ?? KIT_SLOT_SPECS[role!].seconds[1]);
        else {
          const recorded = shaping.length > 0 ? undefined : await recordedFor(call, recipe.id, args, at, warnings);
          [sound] = recorded ? [recorded] : ((await prepareSfx(call, [{ recipe: recipe.id, params: paramsOf(args) }])) as [PreparedSfx]);
        }
      } catch (error) {
        return failed(ADD, `Error: failed to ${library ? "download the library sound" : "store the sound effect"}: ${errorText(error)}`);
      }
      const cached = sound.fileId !== undefined;
      const hitAt = align === "peak" ? at : at + sound.hit;
      if (late(hitAt)) return refused(ADD, pastPicture(hitAt, until!));
      const name = sound.title ? `'${sound.title}'` : recipe.title.toLowerCase();
      const placed = call.commit((tx) => placeSfx(tx, sound, { at, align, gainDb, auto: false, until }), `Add ${sound.title ? `sound '${sound.title}'` : recipe.title.toLowerCase()}`);
      if (!placed) return refused(ADD, "Error: nothing of the sound is left on the timeline at that moment.");
      const { clip, trimmed, fadeOut } = placed;
      const trim = trimmed > 0 ? { trimmed_seconds: round3(trimmed), fade_out_seconds: round3(fadeOut), ends_at: until } : {};
      const credit = sound.credit
        ? {
            role,
            library: { provider: sound.credit.provider, id: sound.credit.id, title: sound.credit.title, license: sound.credit.license_name, attribution: sound.credit.attribution, attribution_required: sound.credit.attribution_required },
            ...(sound.prep ? { trimmed_silence_seconds: round3(sound.prep.trimmedHead + sound.prep.trimmedTail), level_change_db: sound.prep.gainDb } : {}),
          }
        : {};
      return applied(
        ADD,
        `Added ${name} with its ${recipe.hit === "onset" ? "transient" : recipe.hit} on ${moment} (${gainDb} dB).` +
          (sound.credit ? ` ${library ? "" : "A recording from Zenvi's kit, "}${sound.credit.license_name}${sound.credit.attribution_required ? ": credit it (list_credits_tool)" : ", no credit needed"}.` : "") +
          (trimmed > 0 ? ` Its last ${trimmed.toFixed(2)} s would run past the picture, so it ends with it at ${until!.toFixed(2)} s, faded over ${fadeOut.toFixed(2)} s.` : ""),
        {
          warnings,
          clips: [clipRow(call.doc.project, clip, { recipe: recipe.id, ...libraryOf(sound), hit_seconds: hitAt, gain_db: gainDb, ...trim })],
          data: { clip_id: clip.id, file_id: clip.file_id, recipe: recipe.id, ...(procedural ? { kit: sound.credit ? "recorded" : "synth" } : {}), ...(sound.params ? { params: sound.params } : {}), hit_seconds: hitAt, gain_db: gainDb, cached, ...trim, ...credit },
        },
      );
    },
  }),

  directTool({
    name: SPOT,
    title: "Spot the edit for sound",
    description:
      "The cue sheet of the edit, read-only: every hit point the eye registers (cuts, transitions, title and emphasis-word entrances, flash runs, keyframed moves and landings, speed-ramp hits, " +
      "motion block events (clicks, toggles, typing, card lands, counter ticks, logo reveals) and 3D scene events (lands, bursts, spins), the music's climax), each with its time, kind, weight 0-1, " +
      "role (hero, slam, transition, impact, ui, move, micro), screen x for pan, whether someone speaks over it, and whether the doctrine gives it a sound. Also the genre it reads as. " +
      "auto_sound_design_tool designs from this sheet; use it to check the plan or to place cues by hand with add_sfx_tool.",
    input: spotInput,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    run: async (call, args: SpotArgs) => {
      const project = call.doc.project;
      const duration = pictureEnd(project) ?? 0;
      if (duration <= 0) return refused(SPOT, "Error: the timeline is empty: there is nothing to spot.");
      const sheet = await cueSheet(call, args, duration);
      const { points, palette } = sheet;
      const shown = points.filter((p) => args.include_dry || p.needsCue).slice(0, args.limit ?? 120);
      const count = (pred: (p: HitPoint) => boolean) => points.filter(pred).length;
      const byKind = Object.fromEntries([...new Set(points.map((p) => p.kind))].map((k) => [k, count((p) => p.kind === k)]));
      const wanted = count((p) => p.needsCue);
      return unchanged(
        SPOT,
        `${points.length} hit points over ${duration.toFixed(2)} s, ${wanted} that want a sound (${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", ")}); it reads as ${PALETTES[palette].title} (${palette}).`,
        {
          warnings: sheet.warnings,
          data: {
            duration,
            genre: palette,
            genre_guessed: !args.genre || args.genre === "auto",
            density_band: PALETTES[palette].density,
            points_total: points.length,
            needs_cue: wanted,
            by_kind: byKind,
            climax: sheet.climax,
            speech_windows: sheet.speech.length,
            points: shown.map(pointRow),
            ...(shown.length < (args.include_dry ? points.length : wanted) ? { points_note: `${(args.include_dry ? points.length : wanted) - shown.length} more not listed (limit)` } : {}),
          },
        },
      );
    },
  }),

  directTool({
    name: AUTO,
    title: "Automatic sound design",
    description:
      "Sound-design the whole edit in one step from its cue sheet (spot_sound_tool) in the genre's palette: layered hits (transient + body + sub with a phone harmonic + a tail in one shared space) on heroes, " +
      "whooshes peaking on cuts and moves (pre-rolled, panned with the motion), clicks, toggles, typing and counter ticks on motion block events, micro sounds on glints and lands, a riser into the climax " +
      "that stops a beat early with the bed sucked out under it, an ambience bed where the genre wants one, density held to the genre's band (cuts under speech and inside flash runs left dry), " +
      "no recipe twice in a row, levels by role (hero, sweetener, micro). Running it again replaces its previous effects and bed dips (hand-placed ones stay). Run master_audio_tool after it. One undo step.",
    input: autoInput,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: AutoInput) => {
      const project = call.doc.project;
      if (!call.host.media?.writeGenerated) return refused(AUTO, "Error: auto_sound_design_tool is not available in this Zenvi surface: it cannot store generated audio.");
      const projectKit = readSoundKit(project);
      const sources: SfxSources = args.sources ?? (projectKit ? "kit" : "procedural");
      if (sources === "kit" && !projectKit) return refused(AUTO, "Error: the project has no sound kit: make one with create_sound_kit_tool, or pass sources=procedural.");
      if (sources === "kit" && args.kit) return refused(AUTO, "Error: kit goes with Zenvi's own sounds, not the project's sound kit (sources=kit plays the kit's): pass sources=procedural to use it.");
      const pickNow = (sources === "library" || sources === "mixed") && projectKit?.source !== sources;
      if (pickNow && (!call.host.media.importUrl || !call.host.audio?.decodePcm || (!call.host.library && !call.host.stock))) {
        return refused(AUTO, `Error: sources=${sources} is not available in this Zenvi surface: it cannot search, download and decode library sounds. Use sources=procedural.`);
      }
      const previous = project.clips.filter(isAutoSfxClip);
      const locked = new Set(project.layers.filter((l) => l.lock).map((l) => l.number));
      if (previous.some((c) => locked.has(c.layer))) return refused(AUTO, "Error: the previous automatic sound effects are on a locked track; unlock it to replace them.");

      // The edit lasts as long as its picture: a long untrimmed music bed does not stretch it, and no effect plays past it.
      const duration = pictureEnd(project) ?? 0;
      if (duration <= 0) return refused(AUTO, "Error: the timeline is empty: there is nothing to sound-design.");
      const intensity = args.intensity ?? "normal";
      if (args.climax_seconds !== undefined) {
        const asked = snapToFrame(project, args.climax_seconds);
        if (asked > duration) return refused(AUTO, `Error: climax_seconds (${asked}) is after the end of the edit (${duration.toFixed(2)} s).`);
        // The planner drops a climax with no picture left for its impact: say so instead of silently placing none.
        if (asked > duration - CLIMAX_TAIL) return refused(AUTO, `Error: climax_seconds (${asked}) leaves less than ${CLIMAX_TAIL} s of picture for its impact (the edit ends at ${duration.toFixed(2)} s); pick an earlier moment.`);
      }
      const sheet = await cueSheet(call, args, duration);
      const warnings = [...sheet.warnings];
      if (sheet.points.length === 0) {
        return refused(AUTO, "Error: nothing to sound-design: the timeline has no cuts, transitions, titles, moves, block events or flashes, and no climax (pass climax_seconds).");
      }
      const palette = PALETTES[sheet.palette];
      const design = designSound({ points: sheet.points, palette, intensity, density: args.density ?? "auto", duration, climax: sheet.climax, music: sheet.bed !== undefined, seed: args.seed ?? 1 });
      const cues: DesignedCue[] = design.cues.map((cue) => ({ ...cue, at: snapToFrame(project, cue.at) }));
      const bedState = sheet.bed ? readBedMark(sheet.bed) : null;
      if (cues.length === 0 && previous.length === 0 && !bedState) {
        return unchanged(AUTO, `No sound effects at ${intensity} intensity: every hit point of this edit stays dry in the ${palette.id} palette. Try intensity=hype or another genre.`, { warnings });
      }

      if (rawSoundKit(project) !== undefined && !projectKit) warnings.push("The project's sound kit could not be read (edited by hand, or from a newer Zenvi), so it is not used.");
      let kit: SoundKit | null = sources === "procedural" ? null : projectKit;
      const pending = new Map<string, PreparedSfx>();
      if (pickNow) {
        // Library sounds for the roles this design plays, picked for this run (create_sound_kit_tool keeps a set).
        kit = proceduralKit({ name: `${sources} (this run)`, seed: args.seed ?? 1, source: sources, tone: "neutral" });
        const roles = [...new Set(cues.map((c) => slotOfRecipe(c.recipe)).filter((r): r is KitSlot => r !== undefined))];
        const filled = await fillLibrarySlots(call, kit, roles, { license: "commercial-ok", variants: 2, style: "" });
        warnings.push(...filled.warnings);
        for (const [key, sound] of filled.pending) pending.set(key, sound);
      }
      const picks: KitPick[] = kit ? applyKit(kit, cues) : cues.map((c) => ({ kind: "procedural", recipe: c.recipe, params: c.params }));
      const ownKit = sources === "kit" ? "synth" : resolveSfxKit(call.host, args.kit);
      if (args.kit === "recorded" && !recordedKitAvailable(call.host)) warnings.push("This surface cannot fetch the recorded kit, so the sounds are synthesised.");
      let sounds: PreparedSfx[];
      let recorded = 0;
      try {
        ({ sounds, recorded } = await soundsOf(call, picks, cues, pending, warnings, { kit: ownKit, seed: args.seed ?? 1 }));
      } catch (error) {
        return failed(AUTO, `Error: failed to store the sound effects: ${errorText(error)}`);
      }
      // A kit's recipe may mix louder or quieter than the one the planner staged.
      const designed = cues.map((cue, i) => Math.min(0, Math.round((cue.gainDb + sfxRecipe(sounds[i]!.recipe)!.mixDb - sfxRecipe(cue.recipe)!.mixDb) * 10) / 10));
      // The mix pass: each cue's level from what plays under it.
      const levels = await levelCues(call, cues, sounds, designed, previous);
      if (levels.note) warnings.push(levels.note);
      const gains = levels.gains;
      const reused = new Set(sounds.filter((s) => s.fileId !== undefined).map((s) => s.key)).size;
      const keep = kitFileIds(projectKit);

      const placed = call.commit((tx) => {
        if (previous.length > 0) deleteClips(tx, previous.map((c) => c.id), { ripple: false });
        const rows: (PlacedSfx & { cue: DesignedCue; hit: number; sound: PreparedSfx; gainDb: number })[] = [];
        cues.forEach((cue, i) => {
          // A moment too close to the start for the sound's lead-in starts the sound instead of cutting into it.
          const sound = sounds[i]!;
          const align = cue.at >= sound.hit ? "peak" : "start";
          const hit = align === "peak" ? cue.at : cue.at + sound.hit;
          if (hit >= duration && sfxRecipe(sound.recipe)!.hit !== "end") return;
          const placed = placeSfx(tx, sound, { at: cue.at, align, gainDb: gains[i]!, auto: true, reason: cue.reason, until: duration, mark: { role: cue.role, layer: cue.layer, cue: cue.point >= 0 ? `p${cue.point}` : `${cue.layer}${i}` } });
          if (placed) rows.push({ ...placed, cue, hit, sound, gainDb: gains[i]! });
        });
        // The bed: the last run's dips come off first, then this run's go on.
        let bed: "restored" | "edited" | "none" = "none";
        let dipPoints = 0;
        if (sheet.bed) {
          bed = restoreBed(tx, tx.project.clips.find((c) => c.id === sheet.bed!.id)!);
          if (bed !== "edited") dipPoints = applyBedDips(tx, sheet.bed.id, design.dips, tx.project.fps);
        }
        const removedFiles = removeUnusedSfxFiles(tx, keep);
        return { rows, removedFiles, bed, dipPoints };
      }, "Automatic sound design");
      if (placed.bed === "edited" && design.dips.length > 0) warnings.push("The music's volume curve was edited since the last run, so its suck-out and pre-hit dips are not written again (reset the curve, then rerun).");

      const after = call.doc.project;
      const cut = placed.rows.filter((r) => r.trimmed > 0);
      const wanted = sheet.points.filter((p) => p.needsCue).length;
      const sounded = new Set(placed.rows.map((r) => r.cue.point).filter((i) => i >= 0));
      const byRole = (role: string) => placed.rows.filter((r) => r.cue.role === role).length;
      const heroes = new Set(placed.rows.filter((r) => r.cue.role === "hero" && r.cue.point >= 0).map((r) => r.cue.point)).size;
      const summary =
        placed.rows.length === 0
          ? `Removed the ${previous.length} effects of the last run: every hit point stays dry at ${intensity} intensity in the ${palette.id} palette.`
          : `Sound-designed the edit as ${palette.title} (${palette.id}${sheet.guessed ? ", read from the edit" : ""}; ${intensity}${args.density === "every_cut" ? ", every cut" : ""}${kit ? `, ${kit === projectKit ? `sound kit '${kit.name}'` : `${sources} sounds`}` : ""}): ` +
            `${sounded.size} of ${sheet.points.length} hit points have a sound (${wanted} wanted one), ${placed.rows.length} layers — ${heroes} layered heroes, ${byRole("sweetener")} sweeteners, ${byRole("micro")} micro sounds${byRole("bed") > 0 ? ", an ambience bed" : ""}` +
            (recorded > 0 ? `; ${recorded} recorded (CC0 kit)` : "") +
            (design.climax !== null ? `; ${design.riser ? "a riser into the climax and the drop on it" : "the drop on the climax"} at ${design.climax.toFixed(2)} s` : "") +
            (placed.dipPoints > 0 ? `; ${design.dips.length} ${design.dips.length === 1 ? "dip" : "dips"} of the music (${design.dips.some((d) => d.reason.startsWith("suck")) ? "suck-out" : "pre-hit ducks"})` : "") +
            (previous.length > 0 ? `; replaced ${previous.length} from the last run` : "") +
            (cut.length > 0 ? `; ${cut.length} ${cut.length === 1 ? "tail" : "tails"} cut and faded to end with the picture at ${duration.toFixed(2)} s` : "") +
            ". Run master_audio_tool next.";
      return applied(AUTO, summary, {
        warnings,
        clips: placed.rows.slice(0, 30).map(({ clip, cue, hit, trimmed, sound, gainDb }) => clipRow(after, clip, { recipe: sound.recipe, ...libraryOf(sound), role: cue.role, layer: cue.layer, hit_seconds: hit, gain_db: gainDb, reason: cue.reason, ...trimOf(trimmed) })),
        ...(placed.rows.length > 30 ? { clipsNote: `${placed.rows.length - 30} more in data.cues` } : {}),
        data: {
          genre: palette.id,
          genre_guessed: sheet.guessed,
          intensity,
          density: args.density ?? "auto",
          density_band: palette.density,
          cues_per_second: Math.round((sounded.size / duration) * 100) / 100,
          hit_points: sheet.points.length,
          needs_cue: wanted,
          sounded: sounded.size,
          dry: design.dry.slice(0, 20).map((d) => ({ t: sheet.points[d.point]!.t, kind: sheet.points[d.point]!.kind, why: d.why })),
          // `at` is the moment; `hit_seconds` where the sound's hit plays (later when the moment is too early for its lead-in).
          sources,
          kit: kit ? { name: kit.name, source: kit.source, stored: kit === projectKit } : null,
          own_sounds: sources === "kit" ? null : { kit: ownKit, recorded },
          levelled_over_bed: levels.levelled,
          cues: placed.rows.map(({ clip, cue, hit, trimmed, sound, gainDb }) => ({ clip_id: clip.id, recipe: sound.recipe, ...libraryOf(sound), role: cue.role, layer: cue.layer, at: cue.at, hit_seconds: hit, gain_db: gainDb, reason: cue.reason, ...trimOf(trimmed) })),
          picture_end: duration,
          music: sheet.bed ? { clip_id: sheet.bed.id, bpm: sheet.bpm ?? null, beats_analysed: sheet.grid !== null } : null,
          bed_dips: placed.dipPoints > 0 ? design.dips.map((d) => ({ from: round3(d.from), to: round3(d.to), db: d.db, reason: d.reason })) : [],
          climax: design.climax,
          riser: design.riser,
          replaced_clip_ids: previous.map((c) => c.id),
          removed_file_ids: placed.removedFiles,
          files_reused: reused,
        },
      });
    },
  }),
];

interface CueSheet {
  points: HitPoint[];
  palette: PaletteId;
  guessed: boolean;
  climax: number | null;
  speech: [number, number][];
  bed: Clip | undefined;
  grid: BeatGrid | null;
  bpm?: number;
  warnings: string[];
}

/** The cue sheet both tools read: music analysed, speech found, block events filled in, the genre picked. */
async function cueSheet(call: ToolCall, args: Pick<AutoInput, "genre" | "beats" | "climax_seconds">, duration: number): Promise<CueSheet> {
  const project = call.doc.project;
  const warnings: string[] = [];
  const bed = musicBed(project);
  const music = await analyseMusic(call, bed, args as AutoInput, duration);
  if (music.note) warnings.push(music.note);
  const found = args.climax_seconds ?? music.climax;
  const climax = found === null || found > duration - CLIMAX_TAIL ? null : snapToFrame(project, found);
  const speech = [...speechWindows(project), ...captionSpeech(project), ...voiceClipSpeech(project, bed)];
  const blocks = await missingBlockEvents(call);
  if (blocks.note) warnings.push(blocks.note);
  const points = spotHitPoints(project, { grid: music.grid, climax, speech, events: blocks.events });
  const guessed = !args.genre || args.genre === "auto";
  const palette = guessed ? guessPalette(traitsOf(points, { duration, speech: speech.length > 0, tiles: hasTiles(project), matchCuts: false, music: bed !== undefined })) : (args.genre as PaletteId);
  return { points, palette, guessed, climax, speech, bed, grid: music.grid, ...(music.bpm !== undefined ? { bpm: music.bpm } : {}), warnings };
}

/** Where kinetic captions show someone speaking (their words' times), for edits whose voice has no transcript in the project. */
function captionSpeech(project: Project): [number, number][] {
  return project.clips.flatMap((c): [number, number][] => {
    const said = (c[KINETIC_CAPTIONS_KEY] as { said?: unknown } | undefined)?.said;
    return Array.isArray(said) && said.length === 2 && said.every((x) => typeof x === "number") ? [[said[0] as number, (said[1] as number) + 0.4]] : [];
  });
}

/** Voice-over clips no one has transcribed (a TTS narration, a recorded VO): audio-only clips named for a voice speak from start to end. */
function voiceClipSpeech(project: Project, bed: Clip | undefined): [number, number][] {
  return project.clips.flatMap((c): [number, number][] => {
    if (c === bed || isSfxClip(c)) return [];
    const file = fileById(project, String(c.file_id));
    if (!file || !isAudioOnlyMedia(file) || !VOICE_NAME.test(`${String(file.name ?? "")} ${String(c.title ?? "")}`)) return [];
    return [[c.position, c.position + (c.end - c.start)]];
  });
}

const VOICE_NAME = /\b(narration|narrator|voice[- ]?over|voice|vo|tts|dialog(ue)?|speech|interview)\b/i;

/** Several small pictures on screen at once (a grid, a mirror wall); titles, captions and rendered graphics are not tiles. */
function hasTiles(project: Project): boolean {
  const small = project.clips.filter((c) => {
    const file = fileById(project, String(c.file_id));
    if (!file || isSfxClip(c) || c[KINETIC_CAPTIONS_KEY] || isAudioOnlyMedia(file) || file.zenvi_link || /\.svg$/i.test(String(file.path ?? ""))) return false;
    return Math.abs(Number(c.scale_x?.Points?.[0]?.co?.Y ?? 1)) < 0.6;
  });
  return small.some((c) => small.filter((o) => o.position < c.position + (c.end - c.start) && o.position + (o.end - o.start) > c.position).length >= 4);
}

function pointRow(p: HitPoint): Record<string, unknown> {
  return {
    t: round3(p.t),
    kind: p.kind,
    ...(p.event ? { event: p.event } : {}),
    weight: p.weight,
    role: p.role,
    x: p.x,
    needs_cue: p.needsCue,
    ...(p.dry ? { dry: p.dry } : {}),
    ...(p.speech ? { speech: true } : {}),
    ...(p.lead !== undefined ? { lead: round3(p.lead) } : {}),
    ...(p.until !== undefined ? { until: round3(p.until), rate: p.rate } : {}),
    label: p.label,
  };
}
