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
import { isAutoSfxClip, isSfxClip, soundMoments, type BeatGrid } from "../../sfx/moments.js";
import { CLIMAX_TAIL, SFX_DENSITIES, SFX_INTENSITIES, musicClimax, planSoundDesign, type SfxCue, type TimelineBeat } from "../../sfx/plan.js";
import { KIT_SLOTS, KIT_SLOT_SPECS, applyKit, guessSlot, kitFileIds, proceduralKit, rawSoundKit, readSoundKit, slotOfRecipe, slotRecipe, type KitPick, type KitSlot, type SoundKit } from "../../sfx/kit.js";
import { SFX_PROVIDERS, allowsCommercialUse } from "../../sfx/library.js";
import { SFX_RECIPES, SFX_RECIPE_IDS, sfxRecipe, type SfxFamily } from "../../sfx/recipes.js";
import type { SfxParams } from "../../sfx/render.js";
import { fpsFloat } from "../../timeline/time.js";
import { getEffectiveAiMetadata } from "../ai-metadata.js";
import { MUSIC_MIN_DURATION, classifyClipAudioRole, speechWindowsFromCues } from "../audio-mix.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged, type ReceiptClip } from "../receipt.js";
import { lookupLibrarySound, prepareLibrarySfx } from "../sfx-library.js";
import { markOf, pictureEnd, placeSfx, prepareSfx, removeUnusedSfxFiles, snapToFrame, type PlacedSfx, type PreparedSfx } from "../sfx-media.js";
import { fileById } from "./common.js";
import { clipTitle } from "./timeline-edit-common.js";
import { fillLibrarySlots } from "./sound-library.js";

const LIST = "list_sfx_tool";
const ADD = "add_sfx_tool";
const AUTO = "auto_sound_design_tool";

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
      "Where the sounds come from: kit (default when the project has a sound kit: every cue plays through it), procedural (default otherwise: synthesised here, no kit), " +
        "library (licensed library sounds for every role, CC0 or commercial-use licences, credits recorded) or mixed (library whooshes, hits and risers; synthesised clicks, pops and subs). " +
        "library and mixed use the kit's library sounds when it has them, else pick them now.",
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

type AddInput = z.infer<typeof addInput>;
type AutoInput = z.infer<typeof autoInput>;

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

const FAMILY_WORDS: Record<SfxFamily, [string, string]> = {
  whoosh: ["whoosh", "whooshes"],
  impact: ["hit", "hits"],
  riser: ["riser", "risers"],
  transition: ["swoosh-hit", "swoosh-hits"],
  click: ["click", "clicks"],
  ui: ["UI sound", "UI sounds"],
  texture: ["texture", "textures"],
};

function familyCounts(cues: readonly SfxCue[]): string {
  const counts = new Map<SfxFamily, number>();
  for (const cue of cues) {
    const family = sfxRecipe(cue.recipe)!.family;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return [...counts].map(([family, n]) => `${n} ${FAMILY_WORDS[family][n === 1 ? 0 : 1]}`).join(", ");
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

/** One sound per cue: procedural picks rendered (or reused), library picks from the bin or this run's downloads; a kit sound no longer in the project is synthesised instead. */
async function soundsOf(call: ToolCall, picks: readonly KitPick[], cues: readonly SfxCue[], pending: ReadonlyMap<string, PreparedSfx>, warnings: string[]): Promise<PreparedSfx[]> {
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
  const rendered = await prepareSfx(call, todo.map((t) => t.r));
  todo.forEach((t, k) => (out[t.i] = rendered[k]));
  return out as PreparedSfx[];
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
        else [sound] = (await prepareSfx(call, [{ recipe: recipe.id, params: paramsOf(args) }])) as [PreparedSfx];
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
          (sound.credit ? ` ${sound.credit.license_name}${sound.credit.attribution_required ? ": credit it (list_credits_tool)" : ", no credit needed"}.` : "") +
          (trimmed > 0 ? ` Its last ${trimmed.toFixed(2)} s would run past the picture, so it ends with it at ${until!.toFixed(2)} s, faded over ${fadeOut.toFixed(2)} s.` : ""),
        {
          clips: [clipRow(call.doc.project, clip, { recipe: recipe.id, hit_seconds: hitAt, gain_db: gainDb, ...trim })],
          data: { clip_id: clip.id, file_id: clip.file_id, recipe: recipe.id, ...(sound.params ? { params: sound.params } : {}), hit_seconds: hitAt, gain_db: gainDb, cached, ...trim, ...credit },
        },
      );
    },
  }),

  directTool({
    name: AUTO,
    title: "Automatic sound design",
    description:
      "Sound-design the whole edit in one step: whooshes on cuts and transitions (peaking on the cut, sized to the move), hits on strong cuts, downbeats and flash frames, " +
      "clicks and swishes on title entrances, a riser into the climax and an impact on it, all varied and gain-staged under the music and dialogue. " +
      "Tasteful by default (not every cut); intensity sets the density, density=every_cut puts a sound on every cut (hype). Running it again replaces its previous effects (hand-placed ones stay). One undo step.",
    input: autoInput,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: AutoInput) => {
      const project = call.doc.project;
      if (!call.host.media?.writeGenerated) return refused(AUTO, "Error: auto_sound_design_tool is not available in this Zenvi surface: it cannot store generated audio.");
      const projectKit = readSoundKit(project);
      const sources: SfxSources = args.sources ?? (projectKit ? "kit" : "procedural");
      if (sources === "kit" && !projectKit) return refused(AUTO, "Error: the project has no sound kit: make one with create_sound_kit_tool, or pass sources=procedural.");
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
      const warnings: string[] = [];

      const bed = musicBed(project);
      const music = await analyseMusic(call, bed, args, duration);
      if (music.note) warnings.push(music.note);
      const found = args.climax_seconds ?? music.climax;
      const climax = found === null ? null : snapToFrame(project, found);
      if (climax !== null && climax > duration) return refused(AUTO, `Error: climax_seconds (${climax}) is after the end of the edit (${duration.toFixed(2)} s).`);
      // The planner drops a climax with no picture left for its impact: say so instead of silently placing none.
      if (args.climax_seconds !== undefined && climax !== null && climax > duration - CLIMAX_TAIL) {
        return refused(AUTO, `Error: climax_seconds (${climax}) leaves less than ${CLIMAX_TAIL} s of picture for its impact (the edit ends at ${duration.toFixed(2)} s); pick an earlier moment.`);
      }
      const moments = soundMoments(project, music.grid);
      if (moments.length === 0 && climax === null) {
        return refused(AUTO, "Error: nothing to sound-design: the timeline has no cuts, transitions, titles or flashes, and no climax (pass climax_seconds).");
      }
      const plan = planSoundDesign({ moments, duration, climax, music: bed !== undefined, speech: speechWindows(project), intensity, density: args.density ?? "auto", seed: args.seed ?? 1 });
      const cues = plan.cues.map((cue) => ({ ...cue, at: snapToFrame(project, cue.at) }));
      if (cues.length === 0 && previous.length === 0) {
        return unchanged(AUTO, `No sound effects at ${intensity} intensity: no moment of this edit is strong enough. Try intensity=hype.`, { warnings });
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
      let sounds: PreparedSfx[];
      try {
        sounds = await soundsOf(call, picks, cues, pending, warnings);
      } catch (error) {
        return failed(AUTO, `Error: failed to store the sound effects: ${errorText(error)}`);
      }
      // A kit's recipe may mix louder or quieter than the one the planner staged.
      const gains = cues.map((cue, i) => Math.round((cue.gainDb + sfxRecipe(sounds[i]!.recipe)!.mixDb - sfxRecipe(cue.recipe)!.mixDb) * 10) / 10);
      const reused = new Set(sounds.filter((s) => s.fileId !== undefined).map((s) => s.key)).size;
      const keep = kitFileIds(projectKit);

      const placed = call.commit((tx) => {
        if (previous.length > 0) deleteClips(tx, previous.map((c) => c.id), { ripple: false });
        const rows: (PlacedSfx & { cue: SfxCue; hit: number; sound: PreparedSfx; gainDb: number })[] = [];
        cues.forEach((cue, i) => {
          // A moment too close to the start for the sound's lead-in starts the sound instead of cutting into it.
          const sound = sounds[i]!;
          const align = cue.at >= sound.hit ? "peak" : "start";
          const hit = align === "peak" ? cue.at : cue.at + sound.hit;
          if (hit >= duration && sfxRecipe(sound.recipe)!.hit !== "end") return;
          const placed = placeSfx(tx, sound, { at: cue.at, align, gainDb: gains[i]!, auto: true, reason: cue.reason, until: duration });
          if (placed) rows.push({ ...placed, cue, hit, sound, gainDb: gains[i]! });
        });
        const removedFiles = removeUnusedSfxFiles(tx, keep);
        return { rows, removedFiles };
      }, "Automatic sound design");

      const after = call.doc.project;
      const cut = placed.rows.filter((r) => r.trimmed > 0);
      // Cuts whose moment got a sound (a cue within a frame of it).
      const frame = 1 / (fpsFloat(project.fps) || 30);
      const cutTimes = moments.filter((m) => m.kind === "cut").map((m) => m.time);
      const sounded = cutTimes.filter((t) => placed.rows.some((r) => Math.abs(r.cue.at - t) <= frame)).length;
      const summary =
        placed.rows.length === 0
          ? `Removed the ${previous.length} effects of the last run: no moment of this edit is strong enough at ${intensity} intensity.`
          : `Sound-designed the edit (${intensity}${args.density === "every_cut" ? ", every cut" : ""}${kit ? `, ${kit === projectKit ? `sound kit '${kit.name}'` : `${sources} sounds`}` : ""}): ${placed.rows.length} effects — ${familyCounts(placed.rows.map((r) => r.cue))}` +
            (cutTimes.length > 0 ? `; ${sounded} of ${cutTimes.length} cuts have a sound` : "") +
            (plan.climax !== null ? `, ${plan.riser ? "a build into the climax and an impact on it" : "an impact on the climax"} at ${plan.climax.toFixed(2)} s` : "") +
            (previous.length > 0 ? `; replaced ${previous.length} from the last run` : "") +
            (cut.length > 0 ? `; ${cut.length} ${cut.length === 1 ? "tail" : "tails"} cut and faded to end with the picture at ${duration.toFixed(2)} s` : "") +
            ".";
      return applied(AUTO, summary, {
        warnings,
        clips: placed.rows.slice(0, 30).map(({ clip, cue, hit, trimmed, sound, gainDb }) => clipRow(after, clip, { recipe: sound.recipe, ...libraryOf(sound), hit_seconds: hit, gain_db: gainDb, reason: cue.reason, ...trimOf(trimmed) })),
        ...(placed.rows.length > 30 ? { clipsNote: `${placed.rows.length - 30} more in data.cues` } : {}),
        data: {
          intensity,
          density: args.density ?? "auto",
          cuts: cutTimes.length,
          cuts_with_sound: sounded,
          // `at` is the moment; `hit_seconds` where the sound's hit plays (later when the moment is too early for its lead-in).
          sources,
          kit: kit ? { name: kit.name, source: kit.source, stored: kit === projectKit } : null,
          cues: placed.rows.map(({ clip, cue, hit, trimmed, sound, gainDb }) => ({ clip_id: clip.id, recipe: sound.recipe, ...libraryOf(sound), at: cue.at, hit_seconds: hit, gain_db: gainDb, reason: cue.reason, ...trimOf(trimmed) })),
          picture_end: duration,
          music: bed ? { clip_id: bed.id, bpm: music.bpm ?? null, beats_analysed: music.grid !== null } : null,
          climax: plan.climax,
          riser: plan.riser,
          moments: moments.length,
          replaced_clip_ids: previous.map((c) => c.id),
          removed_file_ids: placed.removedFiles,
          files_reused: reused,
        },
      });
    },
  }),
];
