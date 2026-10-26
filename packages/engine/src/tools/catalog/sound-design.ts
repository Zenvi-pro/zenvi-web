/**
 * Sound design: procedural sound effects (sfx/recipes.ts) placed on the
 * timeline so the edit snaps — a whoosh peaking on a whip cut, a punch on a
 * hard cut, clicks on UI moments, a riser into the climax and an impact on
 * it.
 *
 *   list_sfx_tool            the recipes, their parameters and where each fits
 *   add_sfx_tool             one effect at a time, a clip edge or a marker
 *   auto_sound_design_tool   reads the edit and places a tasteful set; a rerun replaces it
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
import { CLIMAX_TAIL, SFX_INTENSITIES, musicClimax, planSoundDesign, type SfxCue, type TimelineBeat } from "../../sfx/plan.js";
import { SFX_RECIPES, SFX_RECIPE_IDS, sfxRecipe, type SfxFamily } from "../../sfx/recipes.js";
import type { SfxParams } from "../../sfx/render.js";
import { getEffectiveAiMetadata } from "../ai-metadata.js";
import { MUSIC_MIN_DURATION, classifyClipAudioRole, speechWindowsFromCues } from "../audio-mix.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged, type ReceiptClip } from "../receipt.js";
import { pictureEnd, placeSfx, prepareSfx, removeUnusedSfxFiles, snapToFrame, type PlacedSfx, type PreparedSfx } from "../sfx-media.js";
import { fileById } from "./common.js";

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

const addInput = z.strictObject({
  recipe: z.enum(RECIPE_IDS).describe("Which sound (list_sfx_tool describes each)."),
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
  intensity: z
    .enum(SFX_INTENSITIES)
    .optional()
    .describe("How much sound: subtle (only the big moments), normal (default: strong cuts, transitions, titles), hype (nearly every cut, tonal risers, sub drops)."),
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
      "Place one procedural sound effect on the SFX track: at a time, on a clip's start or end, or on a marker. " +
      "By default its hit point lands on the moment (a whoosh peaks on the cut, an impact's transient hits it, a riser ends on it). One undo step. " +
      "See list_sfx_tool for the recipes; vary seed and pitch between repeats.",
    input: addInput,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: AddInput) => {
      const project = call.doc.project;
      const targets = [args.at_seconds !== undefined, args.clip_id !== undefined, args.marker_id !== undefined].filter(Boolean).length;
      if (targets !== 1) return refused(ADD, "Error: give exactly one of at_seconds, clip_id or marker_id.");
      if (args.edge && !args.clip_id) return refused(ADD, "Error: edge goes with clip_id.");
      if (!call.host.media?.writeGenerated) return refused(ADD, "Error: add_sfx_tool is not available in this Zenvi surface: it cannot store generated audio.");
      let at: number;
      let moment: string;
      if (args.clip_id !== undefined) {
        const clip = project.clips.find((c) => c.id === args.clip_id);
        if (!clip) return refused(ADD, `Error: no clip with id ${args.clip_id}.`);
        const edge = args.edge ?? "start";
        at = edge === "start" ? clip.position : clip.position + (clip.end - clip.start);
        moment = `the ${edge} of clip ${clip.id}`;
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
      const recipe = sfxRecipe(args.recipe)!;
      const gainDb = args.gain_db ?? recipe.mixDb;
      const align = args.align ?? "peak";

      // A riser ends on its moment: at the very start of the timeline nothing of it would play.
      if (align === "peak" && recipe.hit === "end" && at < 0.05) return refused(ADD, "Error: a riser ends on its moment, so at 0 s nothing of it would play; pick a later moment or align=start.");
      const until = pictureEnd(project) ?? undefined;
      const late = (hitAt: number) => until !== undefined && (recipe.hit === "end" ? hitAt > until + 1e-6 : hitAt >= until - 1e-6);
      // Checked again once the sound is rendered and its hit known (align=start).
      if (align === "peak" ? late(at) : until !== undefined && at >= until - 1e-6) return refused(ADD, pastPicture(at, until!));
      let sound: PreparedSfx;
      try {
        [sound] = (await prepareSfx(call, [{ recipe: recipe.id, params: paramsOf(args) }])) as [PreparedSfx];
      } catch (error) {
        return failed(ADD, `Error: failed to store the sound effect: ${errorText(error)}`);
      }
      const cached = sound.fileId !== undefined;
      const hitAt = align === "peak" ? at : at + sound.hit;
      if (late(hitAt)) return refused(ADD, pastPicture(hitAt, until!));
      const placed = call.commit((tx) => placeSfx(tx, sound, { at, align, gainDb, auto: false, until }), `Add ${recipe.title.toLowerCase()}`);
      if (!placed) return refused(ADD, "Error: nothing of the sound is left on the timeline at that moment.");
      const { clip, trimmed, fadeOut } = placed;
      const trim = trimmed > 0 ? { trimmed_seconds: round3(trimmed), fade_out_seconds: round3(fadeOut), ends_at: until } : {};
      return applied(
        ADD,
        `Added ${recipe.title.toLowerCase()} with its ${recipe.hit === "onset" ? "transient" : recipe.hit} on ${moment} (${gainDb} dB).` +
          (trimmed > 0 ? ` Its last ${trimmed.toFixed(2)} s would run past the picture, so it ends with it at ${until!.toFixed(2)} s, faded over ${fadeOut.toFixed(2)} s.` : ""),
        {
          clips: [clipRow(call.doc.project, clip, { recipe: recipe.id, hit_seconds: hitAt, gain_db: gainDb, ...trim })],
          data: { clip_id: clip.id, file_id: clip.file_id, recipe: recipe.id, params: sound.params, hit_seconds: hitAt, gain_db: gainDb, cached, ...trim },
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
      "Tasteful by default (not every cut); intensity sets the density. Running it again replaces its previous effects (hand-placed ones stay). One undo step.",
    input: autoInput,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: AutoInput) => {
      const project = call.doc.project;
      if (!call.host.media?.writeGenerated) return refused(AUTO, "Error: auto_sound_design_tool is not available in this Zenvi surface: it cannot store generated audio.");
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
      const plan = planSoundDesign({ moments, duration, climax, music: bed !== undefined, speech: speechWindows(project), intensity, seed: args.seed ?? 1 });
      const cues = plan.cues.map((cue) => ({ ...cue, at: snapToFrame(project, cue.at) }));
      if (cues.length === 0 && previous.length === 0) {
        return unchanged(AUTO, `No sound effects at ${intensity} intensity: no moment of this edit is strong enough. Try intensity=hype.`, { warnings });
      }

      let sounds: PreparedSfx[];
      try {
        sounds = await prepareSfx(call, cues.map((c) => ({ recipe: c.recipe, params: c.params })));
      } catch (error) {
        return failed(AUTO, `Error: failed to store the sound effects: ${errorText(error)}`);
      }
      const reused = new Set(sounds.filter((s) => s.fileId !== undefined).map((s) => s.key)).size;

      const placed = call.commit((tx) => {
        if (previous.length > 0) deleteClips(tx, previous.map((c) => c.id), { ripple: false });
        const rows: (PlacedSfx & { cue: SfxCue; hit: number })[] = [];
        cues.forEach((cue, i) => {
          // A moment too close to the start for the sound's lead-in starts the sound instead of cutting into it.
          const sound = sounds[i]!;
          const align = cue.at >= sound.hit ? "peak" : "start";
          const hit = align === "peak" ? cue.at : cue.at + sound.hit;
          if (hit >= duration && sfxRecipe(cue.recipe)!.hit !== "end") return;
          const placed = placeSfx(tx, sound, { at: cue.at, align, gainDb: cue.gainDb, auto: true, reason: cue.reason, until: duration });
          if (placed) rows.push({ ...placed, cue, hit });
        });
        const removedFiles = removeUnusedSfxFiles(tx);
        return { rows, removedFiles };
      }, "Automatic sound design");

      const after = call.doc.project;
      const cut = placed.rows.filter((r) => r.trimmed > 0);
      const summary =
        placed.rows.length === 0
          ? `Removed the ${previous.length} effects of the last run: no moment of this edit is strong enough at ${intensity} intensity.`
          : `Sound-designed the edit (${intensity}): ${placed.rows.length} effects — ${familyCounts(placed.rows.map((r) => r.cue))}` +
            (plan.climax !== null ? `, ${plan.riser ? "a build into the climax and an impact on it" : "an impact on the climax"} at ${plan.climax.toFixed(2)} s` : "") +
            (previous.length > 0 ? `; replaced ${previous.length} from the last run` : "") +
            (cut.length > 0 ? `; ${cut.length} ${cut.length === 1 ? "tail" : "tails"} cut and faded to end with the picture at ${duration.toFixed(2)} s` : "") +
            ".";
      return applied(AUTO, summary, {
        warnings,
        clips: placed.rows.slice(0, 30).map(({ clip, cue, hit, trimmed }) => clipRow(after, clip, { recipe: cue.recipe, hit_seconds: hit, gain_db: cue.gainDb, reason: cue.reason, ...trimOf(trimmed) })),
        ...(placed.rows.length > 30 ? { clipsNote: `${placed.rows.length - 30} more in data.cues` } : {}),
        data: {
          intensity,
          // `at` is the moment; `hit_seconds` where the sound's hit plays (later when the moment is too early for its lead-in).
          cues: placed.rows.map(({ clip, cue, hit, trimmed }) => ({ clip_id: clip.id, recipe: cue.recipe, at: cue.at, hit_seconds: hit, gain_db: cue.gainDb, reason: cue.reason, ...trimOf(trimmed) })),
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
