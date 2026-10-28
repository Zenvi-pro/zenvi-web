/**
 * build_reel_tool: a finished short-form edit in one call, from media already
 * in the project. Cuts land on the music's beats; every shot gets the style's
 * camera move and look; flashes hit the downbeats; the hook title, shot
 * labels, end card and the music bed (faded out) go on their own tracks. The
 * whole edit is ONE undo step. Hype and highlight reels also get their
 * accents (reels/accents.ts): whips on the body's downbeats, a slow-motion
 * wind-up ramping into the drop, a glitch on it, negative and glitch hits on
 * the climax's bar lines, a pull-back into the last shot, titles set in a
 * bundled condensed face that slam in.
 *
 * reels/styles.ts says how each style cuts, moves, grades and titles,
 * reels/plan.ts places every shot, reels/accents.ts picks the accents,
 * reels/typography.ts draws the titles.
 * This tool reads the media and the music's beats (tools/beats.ts), writes
 * the title images through the host, then records the edit.
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { isAudioOnlyMedia, isSingleImageMedia } from "../../model/media.js";
import { Interpolation, ScaleMode, type Clip, type Project, type ProjectFile } from "../../model/types.js";
import { addClip, deleteClips, setClipKeyframes, setClipProperty, setClipSpeed } from "../../ops/clips.js";
import { addEffect, setClipEffects, updateEffectValues } from "../../ops/effects.js";
import { isOpError } from "../../ops/errors.js";
import { rateOf } from "../../ops/internal.js";
import { applyFittedMotionTransition, type TransitionSfxCue } from "../../ops/motion-transitions.js";
import { applySpeedRamp, planSpeedRamp } from "../../ops/speed-ramp.js";
import { openshotPoint } from "../../keyframe/edit.js";
import { applyLookPreset } from "../../ops/look.js";
import { applyClipPreset } from "../../ops/presets.js";
import { addTitleClip } from "../../ops/titles.js";
import { addTrack } from "../../ops/tracks.js";
import { removeTransition } from "../../ops/transitions.js";
import { planAccents } from "../../reels/accents.js";
import { DAYLIGHT_LUMA, daylightShare, hasNightWords, lookTarget, orderByFit } from "../../reels/grade.js";
import { REUSE_GAP_SECONDS, planReel, type MusicBeats, type PlannedShot, type ReelMedia, type ReelPlan } from "../../reels/plan.js";
import { REEL_STYLE_IDS, REEL_STYLES, type ReelTypography } from "../../reels/styles.js";
import { bundledFamily } from "../../typography/families.js";
import { outlineSvgText } from "../../typography/outline.js";
import { MOTION_STYLE_IDS, MOTION_STYLES, isMotionStyleId } from "../../motion/styles.js";
import { buildMotionReel } from "./motion-reels.js";
import { placeMusicBed } from "./music-bed.js";
import { cardSvg, flashSvg, type CardRole } from "../../reels/typography.js";
import { beatOverrideProblem, beatOverrideShape, explicitBeats } from "../beat-override.js";
import { beatsOfFile, canTrackBeats, octaveNearStyle, tempoReport, weakGridWarning } from "../beats.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { loadFamilies, missingGlyphWarnings } from "../fonts.js";
import { applied, failed, refused } from "../receipt.js";
import { varietyProblem } from "../variety.js";
import { ColorValueError } from "../color-agent.js";
import { effectFactory, mergedGradeEffects } from "./color-agent.js";
import { gradeFootage, gradeReport, measureFootage, resolveReelLook, type ReelGrade } from "./reel-grade.js";
import type { ImportedMedia } from "../types.js";
import { FINISH_HINT } from "../director-card.js";

const TOOL = "build_reel_tool";
/** How long a white flash fades, seconds (three frames at 30 fps). */
const FLASH_SECONDS = 0.1;
/**
 * The wind-up into the drop as speed over the shot (share of its length,
 * speed): slow motion for the first 40 %, then an ease-in rush to 3x that
 * lands on the cut. It spends about 0.9x the shot's length of footage.
 */
const WINDUP_RAMP = [
  [0, 0.5],
  [0.4, 0.5],
  [1, 3],
] as const;
/** The wind-up's own sound under the music: half the style's clip level (-6 dB), pitch-bent by the ramp (no pitch-preserving stretch here). */
const WINDUP_VOLUME = 0.5;
/** Tracks the reel uses, bottom to top. */
const TRACKS = ["music", "video", "flash", "labels", "titles"] as const;
type TrackRole = (typeof TRACKS)[number];

const STYLE_LINES = [
  ...REEL_STYLE_IDS.map((id) => `${id}: ${REEL_STYLES[id].summary}`),
  ...MOTION_STYLE_IDS.map((id) => `${id}: ${MOTION_STYLES[id].summary}${MOTION_STYLES[id].hint ? ` ${MOTION_STYLES[id].hint}` : ""}`),
].join(" ");
/** Footage styles cut shots; motion styles lay motion templates on the beat grid (motion/styles.ts). */
const ALL_STYLE_IDS = [...REEL_STYLE_IDS, ...MOTION_STYLE_IDS] as const;

const input = z.strictObject({
  style: z.enum(ALL_STYLE_IDS).optional().describe(`How the reel is cut and looks (default hype). ${STYLE_LINES}`),
  file_ids: z
    .array(z.string().min(1))
    .min(1)
    .max(60)
    .optional()
    .describe("Media-bin videos and images to use, in story order; the last one closes the reel. Bin order is not a story order: get one from sequence_shots_tool (dry_run: true, its data.file_ids). Default: every video and image in the bin (not SVG titles), in bin order."),
  music_file_id: z.string().optional().describe("Music in the media bin to cut to. Default: the longest audio file in the bin. Without music the cuts follow the style's own tempo."),
  duration_seconds: z.number().min(4).max(120).optional().describe("Target length, seconds (default per style, 12-20). The reel ends on a bar line: the first at or after it (at most a bar longer), else the nearest; the summary says the final length and why."),
  hook: z.string().max(80).optional().describe("Opening title over the first shots: 2-6 punchy words."),
  end_card: z.string().max(80).optional().describe("Closing title over the last shot (a call to action, a name, a date)."),
  end_card_subtitle: z.string().max(80).optional().describe("A smaller line under the end card."),
  labels: z
    .array(z.string().max(40))
    .max(60)
    .optional()
    .describe("Small labels shown on each file's shots, in file_ids order (\"\" for none). Motion styles: the card captions (ui_promo), crop labels (editorial_motion), step captions (tutorial)."),
  words: z
    .array(z.string().min(1).max(48))
    .max(12)
    .optional()
    .describe("Motion styles only: the scrolling word list (ui_promo), kinetic words (editorial_motion), the features as 'Name: value' (product_callout), each step's label box (tutorial)."),
  ...beatOverrideShape,
  replace: z.boolean().optional().describe("Clear the timeline first when it already has clips (they are removed in the same undo step)."),
  strict_variety: z
    .boolean()
    .optional()
    .describe(`Refuse (nothing changes) when the files are too few for the pace and a file comes back within ${REUSE_GAP_SECONDS} s; the error says how many more to import. Default false: a warning.`),
  grade: z
    .string()
    .min(1)
    .optional()
    .describe(
      "One look over every shot: 'auto' (default for hype and highlight) measures each clip, corrects it toward one target and lays one shared LUT " +
        "(a cool night look when the titles say night or the footage is dark, else teal and orange); a LUT id from list_looks_tool uses that LUT; 'none' (default for the other styles) skips it. Needs a surface that renders frames.",
    ),
});

type Input = z.infer<typeof input>;

export function displayName(file: ProjectFile): string {
  const base = String(file.name ?? file.path ?? file.id).split(/[\\/]/).pop() ?? String(file.id);
  return base.replace(/\.[A-Za-z0-9]+$/, "").replace(/[_-]+/g, " ").trim() || String(file.id);
}

export function visualKind(file: ProjectFile): "video" | "image" | null {
  if (isAudioOnlyMedia(file)) return null;
  if (isSingleImageMedia(file)) return "image";
  return file.has_video ? "video" : null;
}

/** Display aspect of a file (width / height, with its pixel ratio), or null when unknown. */
export function aspectOf(file: ProjectFile): number | null {
  const w = Number(file.width);
  const h = Number(file.height);
  if (!(w > 0 && h > 0)) return null;
  const ratio = file.pixel_ratio as { num?: number; den?: number } | undefined;
  const par = ratio && Number(ratio.num) > 0 && Number(ratio.den) > 0 ? Number(ratio.num) / Number(ratio.den) : 1;
  return (w * par) / h;
}

/** The usable part of a video: skip the first fifth of a second (camera settling) on longer clips. */
export function usableRange(file: ProjectFile): [number, number] {
  const duration = Number(file.duration) || 0;
  return duration > 3 ? [0.2, duration - 0.1] : [0, duration];
}

/** Music from beat times given by the caller (`bpm` when they said it, else the median gap). */
export function musicFromBeats(times: number[], duration: number, bpm?: number): MusicBeats {
  const beats = [...times].sort((a, b) => a - b);
  const gaps = beats.slice(1).map((t, i) => t - beats[i]!).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0.5;
  return { bpm: bpm ?? (median > 0 ? 60 / median : 120), beats, downbeats: beats.filter((_, i) => i % 4 === 0), duration };
}

function aspectName(project: Project): string {
  const w = Number(project.width) || 1920;
  const h = Number(project.height) || 1080;
  const ratio = w / h;
  if (Math.abs(ratio - 9 / 16) < 0.02) return "vertical 9:16";
  if (Math.abs(ratio - 16 / 9) < 0.02) return "landscape 16:9";
  if (Math.abs(ratio - 1) < 0.02) return "square 1:1";
  if (Math.abs(ratio - 4 / 5) < 0.02) return "portrait 4:5";
  return `${w}×${h}`;
}

function storyLine(plan: ReelPlan, names: Map<string, string>): string {
  const order: string[] = [];
  for (const shot of plan.shots) {
    const name = names.get(shot.fileId) ?? shot.fileId;
    if (order[order.length - 1] !== name) order.push(name);
  }
  const unique = order.filter((name, i) => order.indexOf(name) === i);
  if (unique.length === 1) return unique[0]!;
  const last = order[order.length - 1]!;
  const middle = unique.filter((n) => n !== unique[0] && n !== last).slice(0, 5);
  return [unique[0], ...middle].join(", ") + `, ends on ${last}`;
}

interface Prepared {
  hook?: ImportedMedia;
  end?: ImportedMedia;
  flash?: ImportedMedia;
  labels: Map<string, ImportedMedia>;
}

export async function writeCard(call: ToolCall, name: string, svg: string): Promise<ImportedMedia> {
  const media = call.host.media!;
  const path = await media.writeGenerated!(name, new TextEncoder().encode(svg), "image/svg+xml");
  return { path, info: await media.probe(path), name };
}

/** The reel's tracks, bottom to top: the lowest five, adding tracks when the project has fewer. */
function reelTracks(tx: Transaction): Record<TrackRole, number> {
  while (tx.project.layers.length < TRACKS.length) addTrack(tx, {});
  const numbers = [...tx.project.layers].map((l) => Number(l.number)).sort((a, b) => a - b);
  return Object.fromEntries(TRACKS.map((role, i) => [role, numbers[i]!])) as Record<TrackRole, number>;
}

function fadeAlpha(tx: Transaction, clip: Clip, from: number, to: number, start: number, end: number): void {
  setClipKeyframes(
    tx,
    clip.id,
    "alpha",
    [
      { time: start, value: from, interpolation: Interpolation.LINEAR },
      { time: end, value: to, interpolation: Interpolation.LINEAR },
    ],
    { mode: "merge" },
  );
}

/**
 * The hype title hit: the card lands from 135 % to full size in five frames
 * (most of the way in two), out of a blur, opaque by the second frame.
 */
function slamIn(tx: Transaction, clip: Clip, fps: number): void {
  const at = Number(clip.position) || 0;
  const frame = (n: number) => at + n / fps;
  for (const prop of ["scale_x", "scale_y"]) {
    setClipKeyframes(
      tx,
      clip.id,
      prop,
      [
        { time: frame(0), value: 1.35, interpolation: Interpolation.LINEAR },
        { time: frame(2), value: 1.06, interpolation: Interpolation.LINEAR },
        { time: frame(5), value: 1, interpolation: Interpolation.LINEAR },
      ],
      { mode: "merge" },
    );
  }
  fadeAlpha(tx, clip, 0, 1, frame(0), frame(2));
  const blur = addEffect(tx, clip.id, "Blur", {});
  const radius = { Points: [openshotPoint(1, 24, Interpolation.LINEAR), openshotPoint(4, 0, Interpolation.LINEAR)] };
  updateEffectValues(tx, blur.id, { horizontal_radius: radius, vertical_radius: structuredClone(radius) });
}

function placeTitle(tx: Transaction, media: ImportedMedia, position: number, duration: number, layer: number, entrance: ReelTypography["hookIn"] | null, fps: number): Clip {
  const { clip } = addTitleClip(tx, { file: media, position, duration, layer, title: media.name });
  if (entrance === "slam_in") slamIn(tx, clip, fps);
  else if (entrance && entrance !== "animate.none") applyClipPreset(tx, clip.id, entrance);
  // Leave a little before the next thing happens.
  const out = Math.min(0.25, duration / 4);
  fadeAlpha(tx, clip, 1, 0, position + duration - out, position + duration);
  return clip;
}

/**
 * The wind-up into the drop: the shot's clip ramps from slow motion into a
 * rush that lands on the cut, keeping its length. Returns the clip id, or
 * null (nothing recorded) when the footage runs out before the shot ends.
 */
function windUp(tx: Transaction, clipId: string, shot: PlannedShot, volume: number): string | null {
  const length = shot.end - shot.start;
  const points = WINDUP_RAMP.map(([at, speed]) => ({ atSeconds: at * length, speed }));
  try {
    const ramp = planSpeedRamp(tx.project, clipId, { preset: "custom", points, ease: "in" });
    const frames = Math.round(length * rateOf(tx.project));
    if (Math.abs(ramp.frames - frames) > 0) return null;
    // The clip keeps its own sound, ducked: the engine's ramp bends the pitch with the speed.
    applySpeedRamp(tx, clipId, ramp, { muteAudio: false });
    if (volume > 0) setClipProperty(tx, clipId, "volume", volume * WINDUP_VOLUME);
    return clipId;
  } catch (error) {
    if (isOpError(error)) return null;
    throw error;
  }
}

export const reelTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Build a reel",
    description:
      "Cut a finished short-form video (Reels, TikTok, Shorts, ads) in one step from media already in the project: shots cut on the music's beats, " +
      "camera moves, flashes, a look, an opening hook title, shot labels, an end card and the music faded out. " +
      "hype and highlight add the accents: whips in one direction on the downbeats, a slow-motion wind-up ramping into the drop, a glitch on the drop, negative/glitch hits in the climax, a pull-back into the last shot, condensed display titles that slam in (the receipt lists them and their sfx_cues). One undo step. " +
      "Put the videos/images and one music track in the media bin first (stock, AI, uploads, URLs); give them in story order. " +
      `Its sound is the music at full level, so once any sound design is added call master_audio_tool last to set the final loudness. ${FINISH_HINT}`,
    input,
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const styleId = args.style ?? "hype";
      const files = new Map(project.files.map((f) => [String(f.id), f]));
      const names = new Map([...files].map(([id, f]) => [id, displayName(f)]));

      // Validate everything before any work (a refused call leaves history untouched).
      // By default every video and image, but not SVGs: those are titles and cards (an earlier build's own, when rebuilding).
      const ids = args.file_ids ?? project.files.filter((f) => visualKind(f) !== null && !/\.svgz?$/i.test(String(f.path ?? f.name ?? ""))).map((f) => String(f.id));
      const unknown = ids.filter((id) => !files.has(id));
      if (unknown.length > 0) return refused(TOOL, `Error: unknown file id(s): ${unknown.join(", ")}.`);
      const notVisual = ids.filter((id) => visualKind(files.get(id)!) === null);
      if (notVisual.length > 0) return refused(TOOL, `Error: these are not videos or images: ${notVisual.join(", ")}.`);
      if (ids.length === 0) return refused(TOOL, "Error: the media bin has no videos or images to cut. Import some first.");
      if (project.clips.length > 0 && !args.replace) {
        return refused(TOOL, `Error: the timeline already has ${project.clips.length} clip(s). Pass replace=true to rebuild it, or build in a new project.`);
      }
      const musicId = args.music_file_id ? String(args.music_file_id) : undefined;
      let music: ProjectFile | undefined;
      if (musicId) {
        music = files.get(musicId);
        if (!music) return refused(TOOL, `Error: unknown music_file_id ${musicId}.`);
        if (!music.has_audio) return refused(TOOL, `Error: ${musicId} has no audio.`);
      } else {
        music = project.files
          .filter((f) => isAudioOnlyMedia(f) && !ids.includes(String(f.id)))
          .sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0))[0];
      }

      const labels = new Map<string, string>();
      (args.labels ?? []).forEach((label, i) => {
        const id = ids[i];
        if (id && label.trim()) labels.set(id, label.trim());
      });
      const media: ReelMedia[] = ids.map((id) => {
        const file = files.get(id)!;
        const kind = visualKind(file)!;
        const [start, end] = kind === "video" ? usableRange(file) : [0, 0];
        return { fileId: id, kind, start, end, ...(labels.has(id) ? { label: labels.get(id)! } : {}) };
      });

      // The music's beats: given (beats, or bpm + offset_seconds), tracked here (at the given bpm, if any), or none (cut to the style's tempo).
      const warnings: string[] = [];
      const problem = beatOverrideProblem(args);
      if (problem) return refused(TOOL, problem);
      let beats: MusicBeats | null = null;
      let beatSource = "style tempo";
      let tempo: Record<string, unknown> | undefined;
      if (music) {
        const musicLength = Number(music.duration) || 0;
        const given = explicitBeats(args, musicLength);
        if (given) {
          beats = musicFromBeats(given.beats, musicLength, args.bpm);
          beatSource = given.source;
        } else if (canTrackBeats(call)) {
          let tracked = await beatsOfFile(call, music, args.bpm ? { bpm: args.bpm } : {});
          let movedFrom: number | null = null;
          // A loop read at half speed cuts a hype reel too slowly: use the octave the audio also has that is nearer the style's.
          const styleBpm = isMotionStyleId(styleId) ? MOTION_STYLES[styleId].defaultBpm : REEL_STYLES[styleId].defaultBpm;
          const nearer = typeof tracked === "string" ? null : octaveNearStyle(tracked, styleBpm, styleId === "hype" || styleId === "highlight");
          if (nearer !== null && typeof tracked !== "string") {
            const retracked = await beatsOfFile(call, music, { bpm: nearer });
            if (typeof retracked !== "string" && retracked.beats.length >= 2) {
              warnings.push(`The music reads as ${tracked.bpm} BPM and also as ${nearer}: cutting at ${nearer} to suit ${styleId} (pass bpm to choose).`);
              movedFrom = tracked.bpm;
              tracked = retracked;
            }
          }
          const instead = args.bpm ? `${args.bpm} BPM` : "the style's tempo";
          if (typeof tracked === "string") warnings.push(`${tracked} Cut to ${instead} instead.`);
          else if (tracked.beats.length >= 2) {
            beats = { ...tracked, beats: tracked.beats.map((b) => b.timeSec), downbeats: tracked.downbeats.map((d) => d.timeSec), duration: Math.max(musicLength, tracked.duration) };
            beatSource = args.bpm
              ? `the music tracked at ${args.bpm} BPM`
              : movedFrom !== null
                ? `the music, tracked at ${tracked.bpm} BPM (its ${tracked.bpm > movedFrom ? "faster" : "slower"} reading)`
                : "the music, tracked";
            // The octave move was ours, not the caller's: the receipt must not say the tempo was given.
            tempo = tempoReport(movedFrom !== null ? { ...tracked, forced: false } : tracked);
            const weak = weakGridWarning(tracked);
            if (weak) warnings.push(weak);
          } else warnings.push(`No steady beat in the music: cut to ${instead} instead.`);
        } else if (args.bpm) {
          const grid = explicitBeats({ bpm: args.bpm, offset_seconds: 0 }, musicLength)!;
          beats = musicFromBeats(grid.beats, musicLength, args.bpm);
          beatSource = grid.source;
          warnings.push(`This surface cannot analyse audio: the grid is ${args.bpm} BPM from the start of the music (pass offset_seconds if the first beat is later).`);
        } else {
          warnings.push("This surface cannot analyse audio: the cuts follow the style's tempo, not the music's beats.");
        }
      } else if (args.beats || args.offset_seconds !== undefined) {
        warnings.push("beats and offset_seconds are for music in the project: there is none, so the cuts follow the style's tempo (bpm applies).");
      }
      // No grid from the music (none, or tracking failed): the caller's bpm still sets the cut tempo.
      const fallbackBpm = beats ? undefined : args.bpm;
      if (fallbackBpm) beatSource = `${fallbackBpm} BPM`;

      if (isMotionStyleId(styleId)) {
        if (args.labels && args.labels.length > ids.length) warnings.push("More labels than files: the extra labels are not used.");
        if (args.grade) warnings.push("grade is for the cut styles (hype, highlight, ...); this style keeps the shots' own colour.");
        return buildMotionReel(call, { style: styleId, ids, music: music ?? null, beats, ...(fallbackBpm ? { fallbackBpm } : {}), beatInfo: { beat_source: beatSource, ...(tempo ? { music_tempo: tempo } : {}) }, names, warnings, args });
      }
      if (args.words) warnings.push("words are for the motion styles (ui_promo, editorial_motion, product_callout, tutorial); this style does not use them.");
      const style = REEL_STYLES[styleId];

      // One look (reels/grade.ts): every clip measured as the reel shows it, before the edit is recorded.
      const gradeMode = args.grade?.trim() || (style.oneLook ? "auto" : "none");
      const texts = [args.hook, args.end_card, args.end_card_subtitle, ...labels.values()];
      try {
        if (gradeMode !== "auto" && gradeMode !== "none") await resolveReelLook(call, gradeMode, texts, []);
      } catch (error) {
        if (error instanceof ColorValueError) return refused(TOOL, `Error: ${error.message}`);
        throw error;
      }
      const night = hasNightWords(texts);
      // Measured to grade, and whenever the titles say night: a night label over daylight footage gets a warning.
      const measured = gradeMode !== "none" || night ? await measureFootage(call, project, media, style) : null;
      if (gradeMode !== "none" && !measured) warnings.push("This surface cannot render frames: the shots keep their own colour (no one-look grade).");
      const look = measured && gradeMode !== "none" ? await resolveReelLook(call, gradeMode, texts, [...measured.profiles.values()]) : null;
      let ordered = media;
      if (measured && look && !args.file_ids) {
        // Bin order has no story: the clips that already fit the look open the reel and close it.
        const order = orderByFit(media.map((m) => m.fileId), measured.profiles, lookTarget(look.choice.look, [...measured.profiles.values()]));
        ordered = order.map((id) => media.find((m) => m.fileId === id)!);
      }

      let plan: ReelPlan;
      const rate = rateOf(project);
      try {
        plan = planReel({ style, media: ordered, music: beats, ...(fallbackBpm ? { fallbackBpm } : {}), seconds: args.duration_seconds, frameRate: Number.isFinite(rate) && rate > 0 ? rate : undefined });
      } catch (error) {
        return failed(TOOL, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }

      const grade: ReelGrade | null = measured && look ? await gradeFootage(call, measured, [...new Set(plan.shots.map((s) => s.fileId))], look) : null;
      // Cancelled while measuring or grading: a half-graded reel is not what was asked for (unify_grade_tool refuses the same way).
      if (measured && call.signal?.aborted) return refused(TOOL, "Error: cancelled; nothing changed");
      if (night && measured) {
        const share = daylightShare(plan.shots, measured.profiles);
        if (share > 0.5) {
          warnings.push(
            `The titles set this reel at night, but ${Math.round(share * 100)} % of its screen time is daylight footage (average luma ${DAYLIGHT_LUMA} or brighter)` +
              `${grade ? "; the night grade darkens and cools it, but it still reads as day" : ""}. Import night footage and rebuild with replace=true, or change the titles.`,
          );
        }
      }

      const accents = planAccents(style, plan, Number.isFinite(rate) && rate > 0 ? rate : 30);
      const flashes = new Set(accents.flashes);
      const variety = varietyProblem(plan.shots);
      if (variety && args.strict_variety) return refused(TOOL, `Error: ${variety}`);
      if (variety) warnings.push(variety);

      // Title images (written through the host before the edit is recorded).
      const prepared: Prepared = { labels: new Map() };
      const width = Number(project.width) || 1920;
      const height = Number(project.height) || 1080;
      const face = style.typography.face;
      // A bundled face is drawn as outlines; where the fonts cannot be read the text names it and falls back to the host's fonts.
      let lib: Awaited<ReturnType<typeof loadFamilies>> | null = null;
      if (face && call.host.media?.writeGenerated) {
        lib = await loadFamilies(call, [face.display, face.label]);
        if (typeof lib === "string") warnings.push(`${lib.replace(/^Error: /, "")} The titles use the system's fonts instead.`);
      }
      const missing = new Set<string>();
      const card = (text: string, role: CardRole, subtitle?: string) => {
        const svg = cardSvg({ width, height, text, role, typography: style.typography, subtitle });
        if (!lib || typeof lib === "string") return svg;
        const out = outlineSvgText(svg, lib, { family: bundledFamily, maxWidth: () => width * 0.9 });
        for (const c of out.missing) missing.add(c);
        return out.svg;
      };
      if (call.host.media?.writeGenerated) {
        try {
          if (args.hook?.trim()) prepared.hook = await writeCard(call, "reel-hook.svg", card(args.hook, "hook"));
          if (args.end_card?.trim()) prepared.end = await writeCard(call, "reel-end.svg", card(args.end_card, "end", args.end_card_subtitle));
          if (flashes.size > 0) prepared.flash = await writeCard(call, "reel-flash.svg", flashSvg(width, height));
          for (const label of new Set(plan.shots.map((s) => s.label).filter((l): l is string => Boolean(l)))) {
            prepared.labels.set(label, await writeCard(call, `reel-label-${prepared.labels.size + 1}.svg`, card(label, "label")));
          }
          warnings.push(...missingGlyphWarnings([...missing]));
        } catch (error) {
          return failed(TOOL, `Error: failed to write the reel's titles: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (args.hook || args.end_card || labels.size > 0) {
        warnings.push("This surface cannot store generated title images: the reel has no titles.");
      }

      const built = call.commit((tx) => {
        if (tx.project.clips.length > 0) {
          for (const t of [...tx.project.effects]) removeTransition(tx, String(t.id));
          deleteClips(tx, tx.project.clips.map((c) => String(c.id)), { ripple: false });
        }
        const track = reelTracks(tx);

        if (music) placeMusicBed(tx, String(music.id), plan.musicStart, plan.duration, track.music, names.get(String(music.id)));

        // The end card comes in just after the last cut.
        const last = plan.shots[plan.shots.length - 1]!;
        const endAt = prepared.end ? last.start + Math.min(0.3, (last.end - last.start) * 0.15) : plan.duration;

        const shotClips: string[] = [];
        plan.shots.forEach((shot, index) => {
          const file = files.get(shot.fileId)!;
          const length = shot.end - shot.start;
          const clip = addClip(tx, {
            fileId: shot.fileId,
            position: shot.start,
            layer: track.video,
            start: shot.kind === "video" ? shot.sourceStart : 0,
            end: shot.kind === "video" ? shot.sourceEnd : length,
          });
          shotClips.push(clip.id);
          if (shot.speed < 0.999) setClipSpeed(tx, clip.id, shot.speed);
          // Fill the frame: landscape footage in a vertical reel is cropped, not letterboxed, and a
          // near-match (1080x2048 in 1080x1920) leaves no thin bars. With the same aspect, crop is fit.
          if (aspectOf(file) !== null) setClipProperty(tx, clip.id, "scale", ScaleMode.CROP);
          const motion = shot.kind === "image" ? style.motion.image : style.motion.video;
          if (motion && motion !== "animate.none") applyClipPreset(tx, clip.id, motion);
          if (file.has_audio) setClipProperty(tx, clip.id, "volume", style.clipVolume);
          for (const preset of style.looks) applyLookPreset(tx, clip.id, preset);
          if (grade) {
            // The file's correction toward the look's target, then the shared LUT, on the shot's one ColorGrade.
            const patch = { ...(grade.files.get(shot.fileId)?.knobs ?? {}), lut: { path: grade.lutPath, strength: grade.intensity } };
            const own = tx.project.clips.find((c) => c.id === clip.id)!;
            setClipEffects(tx, clip.id, mergedGradeEffects([...(own.effects ?? [])], patch, effectFactory(tx.project)).effects);
          }
          const current = tx.project.clips.find((c) => c.id === clip.id)!;
          if (index === 0 && style.fadeIn) fadeAlpha(tx, current, 0, 1, shot.start, shot.start + Math.min(0.6, length / 2));
          if (index === plan.shots.length - 1 && style.fadeOut) fadeAlpha(tx, current, 1, 0, shot.end - Math.min(0.8, length / 2), shot.end);
          if (prepared.flash && flashes.has(index)) {
            const flash = addTitleClip(tx, { file: prepared.flash, position: shot.start, duration: FLASH_SECONDS, layer: track.flash, title: "Flash" }).clip;
            // A section's flash opens on a full white frame; a flash on every downbeat stays lighter.
            fadeAlpha(tx, flash, style.flash === "sections" ? 1 : 0.75, 0, shot.start, shot.start + FLASH_SECONDS);
          }
          // A label never shares the frame with the end card; one the card cuts down to a flicker is dropped.
          const label = shot.label ? prepared.labels.get(shot.label) : undefined;
          const labelEnd = Math.min(shot.end, endAt);
          const labelLength = labelEnd - shot.start;
          if (label && labelLength > 0 && (labelEnd === shot.end || labelLength >= 0.3)) placeTitle(tx, label, shot.start, labelLength, track.labels, null, rate);
        });

        const rampShot = accents.ramp !== null ? plan.shots[accents.ramp]! : null;
        const rampVolume = rampShot && files.get(rampShot.fileId)?.has_audio ? style.clipVolume : 0;
        const ramp = accents.ramp !== null ? windUp(tx, shotClips[accents.ramp]!, rampShot!, rampVolume) : null;
        const transitions = accents.transitions.flatMap((t) => {
          const done = applyFittedMotionTransition(tx, { outClipId: shotClips[t.shot - 1]!, inClipId: shotClips[t.shot]!, preset: t.preset, frames: t.frames, direction: "auto" });
          return done ? [done] : [];
        });

        if (prepared.hook) {
          const first = plan.shots[0]!;
          const hold = Math.min(3, Math.max(1.6, first.end - first.start));
          placeTitle(tx, prepared.hook, 0, Math.min(hold, plan.duration), track.titles, style.typography.hookIn, rate);
        }
        if (prepared.end) placeTitle(tx, prepared.end, endAt, plan.duration - endAt, track.titles, style.typography.hookIn, rate);
        return { tracks: track, ramp, transitions };
      }, `Build ${style.name.toLowerCase()} reel`);

      const brief = {
        format: `${Math.round(plan.duration * 10) / 10} seconds, ${aspectName(call.doc.project)}`,
        story: storyLine(plan, names),
        pace: `${style.pace} (${Math.round(plan.bpm)} BPM)`,
        look: style.look,
      };
      const round = (t: number) => Math.round(t * 1000) / 1000;
      const accentParts = [
        built.transitions.length > 0 ? `${built.transitions.length} motion transition(s) (${built.transitions.map((r) => `${r.preset}@${r.cut.toFixed(2)}s`).join(", ")})` : "",
        built.ramp ? `a speed ramp into the drop at ${plan.drop!.toFixed(2)}s` : "",
        flashes.size > 0 ? `${flashes.size} white flash(es)` : "",
      ].filter(Boolean);
      const gradeNote = grade ? ` One look: ${grade.lut} over ${grade.files.size} graded clip(s) (${grade.choice.why}).` : "";
      const accentNote = accentParts.length > 0 ? ` Accents: ${accentParts.join(", ")}.` : "";
      if (accents.ramp !== null && !built.ramp) warnings.push("The wind-up shot before the drop has too little footage for its speed ramp; it plays at normal speed.");
      return applied(TOOL, `Built a ${style.name.toLowerCase()} reel: ${plan.shots.length} shots cut to ${Math.round(plan.bpm)} BPM, ${brief.format}. Length ${plan.lengthNote}.${accentNote}${gradeNote}`, {
        warnings,
        notes: [
          ...(style.id === "hype" ? ["Sound design: auto_sound_design_tool with the receipt's sound_design args puts a sound on nearly every cut."] : []),
          "Finish with master_audio_tool (preset social) after the sound is in place: it sets the loudness and balance.",
        ],
        data: {
          style: style.id,
          duration: plan.duration,
          bpm: plan.bpm,
          length_note: plan.lengthNote,
          beat_source: beatSource,
          ...(tempo ? { music_tempo: tempo } : {}),
          music_file_id: music ? String(music.id) : null,
          music_start: plan.musicStart,
          // The timeline's beat grid: where to put anything else that should land on the beat.
          beats: plan.beats,
          downbeats: plan.downbeats,
          shots: plan.shots.map((s) => ({ file_id: s.fileId, start: s.start, end: s.end, source_start: s.sourceStart, source_end: s.sourceEnd })),
          tracks: built.tracks,
          // Where the edit hits: sound design puts its whooshes and hits here, and a later pass need not add more.
          drop: plan.drop,
          flashes: [...flashes].map((i) => plan.shots[i]!.start),
          transitions: built.transitions.map((r) => ({ id: r.id, preset: r.preset, direction: r.direction, cut: r.cut, frames: r.frames })),
          speed_ramp: built.ramp ? { clip_id: built.ramp, start: plan.shots[accents.ramp!]!.start, end: round(plan.drop!) } : null,
          sfx_cues: built.transitions.flatMap((r): TransitionSfxCue[] => r.sfxCues),
          grade: grade ? gradeReport(grade, names) : null,
          // The next call: a hype reel has a sound on nearly every cut (the references: 90-100 %).
          sound_design:
            style.id === "hype"
              ? { tool: "auto_sound_design_tool", args: { intensity: "hype", density: "every_cut", ...(plan.drop !== null ? { climax_seconds: round(plan.drop) } : {}) } }
              : null,
          brief,
        },
      });
    },
  }),
];
