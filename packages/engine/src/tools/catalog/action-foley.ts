/**
 * spot_action_foley_tool: the foley cue sheet of what happens in a shot
 * (TECHNIQUES2 T078 a close-mic transient on a detail insert, T081 foley on
 * hand and product actions). spot_sound_tool spots the edit (cuts, titles,
 * moves); this spots the picture: the host decodes the clip's frames small
 * and grey (`MediaHost.decodeLuma`), analysis/action.ts finds the frames where
 * something lands, taps, swipes or steps, and each one gets a suggested sound
 * (a recipe and a library search). When the clip has sound, a hit it already
 * has within two frames is named, and the cue moves onto it. place=true puts
 * the suggested recipes on the SFX track (sfx-media.ts), one undo step.
 */

import { z } from "zod";
import { ACTION_SENSITIVITIES, detectActions, type ActionEvent, type ActionKind } from "../../analysis/action.js";
import type { Clip, ProjectFile } from "../../model/types.js";
import { sfxRecipe } from "../../sfx/recipes.js";
import type { SfxParams } from "../../sfx/render.js";
import { onsetsOfFile } from "../beats.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import { pictureEnd, placeSfx, prepareSfx, type PreparedSfx } from "../sfx-media.js";
import { isRetimed } from "../speech.js";
import { fileById } from "./common.js";
import { visualKind } from "./reels.js";
import { clipTitle, gridOf, r3 } from "./timeline-edit-common.js";

const TOOL = "spot_action_foley_tool";
/** Longest stretch of a clip analysed in one call, seconds. */
const MAX_SECONDS = 120;
/** Width the frames are analysed at: enough for a fingertip, cheap for two minutes. */
const ANALYSIS_WIDTH = 96;
/** A hit already in the clip's sound this close (frames) is the same event. */
const HEARD_FRAMES = 2;

/** The sound each kind of action gets: a recipe to place, and words to search a library with. */
const FOLEY: Record<ActionKind, { recipe: string; params: SfxParams; search: string }> = {
  impact: { recipe: "impact_thud", params: { pitch: -2, intensity: 0.8 }, search: "impact thud foley" },
  contact: { recipe: "impact_thud", params: { pitch: 3, intensity: 0.45, brightness: 0.6 }, search: "object set down on table foley" },
  tap: { recipe: "keyboard_key", params: { intensity: 0.6 }, search: "finger tap click foley" },
  swipe: { recipe: "swish_airy", params: { intensity: 0.5 }, search: "cloth swish hand movement foley" },
  step: { recipe: "impact_thud", params: { pitch: -5, intensity: 0.4, brightness: 0.3 }, search: "footstep foley" },
};

const input = z.strictObject({
  clip_id: z.string().min(1).describe("Timeline clip with picture to spot (a detail insert, a product shot, a long take)."),
  start: z.number().min(0).optional().describe("Only from this timeline second (default: the clip's start)."),
  end: z.number().min(0).optional().describe(`Only up to this timeline second (default: the clip's end; at most ${MAX_SECONDS} s per call).`),
  sensitivity: z.enum(ACTION_SENSITIVITIES).optional().describe("low: only big, clear actions; normal (default); high: small taps and touches too."),
  max_cues: z.number().int().min(1).max(200).optional().describe("Most cues kept, the strongest (default 24). T081 edits use about 5-12 a minute."),
  min_gap_seconds: z.number().min(0.03).max(5).optional().describe("Closest two cues may be (default 0.25): the stronger stays."),
  place: z.boolean().optional().describe("true: put the suggested sound on every cue (procedural recipes on the SFX track, levels by strength). Default false: only the cue sheet."),
});

type Input = z.infer<typeof input>;

interface Cue {
  event: ActionEvent;
  /** Timeline seconds, on the frame grid. */
  at: number;
  heard: boolean;
}

/** Frames analysed: the file's size scaled to ANALYSIS_WIDTH, even, at least 8 px. */
function analysisSize(file: ProjectFile): { width: number; height: number } {
  const w = Number(file.width) || 16;
  const h = Number(file.height) || 9;
  return { width: ANALYSIS_WIDTH, height: Math.max(8, 2 * Math.round((ANALYSIS_WIDTH * h) / w / 2)) };
}

function fileFps(file: ProjectFile, fallback: number): number {
  const fps = file.fps as { num?: number; den?: number } | undefined;
  const rate = Number(fps?.num) / Number(fps?.den);
  return rate > 2 && rate <= 240 ? rate : fallback;
}

export const actionFoleyTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Spot foley on picture actions",
    description:
      "The foley cue sheet of what happens in a shot (T078, T081): the frames where something lands or is set down (impact, contact), a finger or key taps (tap), a hand or object swipes past (swipe) or feet hit the ground (step), " +
      "frame-accurate (the last moving frame), with strength, screen position, a suggested recipe and library search words for each. Cuts are not actions (spot_sound_tool sounds the edit). When the clip has its own sound, a hit it already has within two frames is marked heard and the cue moves onto it. " +
      "Read-only unless place=true, which puts the suggested sounds on the SFX track in one undo step; for recorded or library sounds use add_sfx_tool or search_sound_library_tool on the cue times.",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const clip: Clip | undefined = project.clips.find((c) => String(c.id) === args.clip_id);
      if (!clip) return refused(TOOL, `Error: No timeline clip with id='${args.clip_id}'.`);
      const file = fileById(project, String(clip.file_id ?? ""));
      if (!file) return refused(TOOL, `Error: ${clipTitle(clip)} has no media file.`);
      if (visualKind(file) !== "video") return refused(TOOL, `Error: ${clipTitle(clip)} is not video: nothing moves in it.`);
      if (isRetimed(clip as unknown as Record<string, unknown>)) return refused(TOOL, `Error: ${clipTitle(clip)} is retimed (speed or time curve); spot it before retiming, or spot its file in another clip.`);
      const clipEnd = clip.position + clip.end - clip.start;
      const from = Math.max(clip.position, args.start ?? clip.position);
      const to = Math.min(clipEnd, args.end ?? clipEnd, from + MAX_SECONDS);
      if (!(to - from > 0.1)) return refused(TOOL, `Error: the range is outside ${clipTitle(clip)} (${clip.position.toFixed(2)}-${clipEnd.toFixed(2)} s) or shorter than 0.1 s.`);
      if (args.place && !call.host.media?.writeGenerated) return refused(TOOL, "Error: place=true is not available in this Zenvi surface: it cannot store generated audio. Use the cue sheet with add_sfx_tool.");
      const decode = call.host.media?.decodeLuma;
      if (!decode) return unavailable(TOOL, "this surface cannot decode video frames for motion analysis (the CLI and zenvi mcp can).");

      const g = gridOf(project);
      const fps = fileFps(file, g.fps);
      const sourceFrom = clip.start + (from - clip.position);
      let events: ActionEvent[];
      try {
        const frames = await decode(String(file.path ?? ""), { ...analysisSize(file), fps, startSeconds: sourceFrom, maxSeconds: to - from, signal: call.signal });
        events = detectActions(frames, { sensitivity: args.sensitivity ?? "normal", minGapSeconds: args.min_gap_seconds ?? 0.25 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        call.host.log?.(`decodeLuma(${String(file.path)}) failed: ${message}`);
        return failed(TOOL, /no video stream/i.test(message) ? `Error: ${file.id} has no video.` : `Error: reading the frames of ${clipTitle(clip)} failed: ${message}`);
      }

      // The clip's own sound: a hit within two frames is the same event, heard.
      const warnings: string[] = [];
      let hits: number[] = [];
      if (file.has_audio && call.host.audio?.decodePcm) {
        const onsets = await onsetsOfFile(call, file);
        if (typeof onsets === "string") warnings.push(`The clip's sound could not be read (${onsets.replace(/^Error: /, "")}): no cue is checked against it.`);
        else hits = onsets.map((o) => clip.position + o.timeSec - clip.start);
      }
      const strongest = [...events].sort((a, b) => b.strength - a.strength).slice(0, args.max_cues ?? 24);
      const cues: Cue[] = strongest
        .map((event) => {
          const t = clip.position + event.timeSec - clip.start;
          const near = hits.filter((h) => Math.abs(h - t) <= (HEARD_FRAMES + 0.5) / fps).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
          return { event, at: g.snap(near ?? t), heard: near !== undefined };
        })
        .filter((c) => c.at >= from - g.tol && c.at <= to + g.tol)
        .sort((a, b) => a.at - b.at);
      if (events.length > strongest.length) warnings.push(`${events.length} actions found: the ${strongest.length} strongest are listed (max_cues).`);

      const rows = cues.map((c) => ({
        at: r3(c.at),
        frame: Math.round(c.at * g.fps),
        kind: c.event.kind,
        strength: c.event.strength,
        x: c.event.x,
        y: c.event.y,
        area: c.event.area,
        heard: c.heard,
        recipe: FOLEY[c.event.kind].recipe,
        search: FOLEY[c.event.kind].search,
      }));
      const counts = Object.entries(rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {}))
        .map(([k, n]) => `${n} ${k}`)
        .join(", ");
      const range = `${from.toFixed(2)}-${to.toFixed(2)} s`;
      const sheet = cues.length === 0 ? `No physical actions in ${clipTitle(clip)} (${range}) at ${args.sensitivity ?? "normal"} sensitivity.` : `${cues.length} foley cue(s) in ${clipTitle(clip)} (${range}): ${counts}.`;
      const data = { timeline_clip_id: clip.id, start: r3(from), end: r3(to), cues: rows };
      if (!args.place || cues.length === 0) return applied(TOOL, sheet, { warnings, data }, 0);

      let sounds: PreparedSfx[];
      try {
        // Pan each sound where the action is on screen.
        sounds = await prepareSfx(call, cues.map((c) => ({ recipe: FOLEY[c.event.kind].recipe, params: { ...FOLEY[c.event.kind].params, pan: Math.round(c.event.x * 0.6 * 100) / 100 } })));
      } catch (error) {
        return failed(TOOL, `Error: failed to store the sound effects: ${error instanceof Error ? error.message : String(error)}`);
      }
      const until = pictureEnd(project) ?? to;
      const placed = call.commit((tx) => {
        const ids: string[] = [];
        cues.forEach((cue, i) => {
          const recipe = sfxRecipe(FOLEY[cue.event.kind].recipe)!;
          // Foley sits at or under the bed: the strongest action at the recipe's level, the weakest 9 dB under it.
          const gainDb = Math.round((recipe.mixDb - 9 * (1 - cue.event.strength)) * 10) / 10;
          // A cue too close to the start for the sound's lead-in starts the sound instead of cutting into it.
          const done = placeSfx(tx, sounds[i]!, { at: cue.at, align: cue.at >= sounds[i]!.hit ? "peak" : "start", gainDb, auto: false, until, reason: `foley: ${cue.event.kind}` });
          if (done) ids.push(done.clip.id);
        });
        return ids;
      }, "Spot foley on actions");
      return applied(TOOL, `${sheet} Placed ${placed.length} sound(s) on the SFX track.`, { warnings, data: { ...data, createdClipIds: placed } });
    },
  }),
];
