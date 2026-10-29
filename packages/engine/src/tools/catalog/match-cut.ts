/**
 * Match cuts that line up ("full circle" edits): consecutive shots share a
 * shape or a pose and the shared subject sits at the same place and size on
 * every cut.
 *
 * - align_match_cut_tool: scale / location (/ rotation) keyframes on clips
 *   already on the timeline, from the subject's box in each (ops/match-cut.ts).
 * - detect_subject_tool: subject boxes found in a frame (circles for now:
 *   iris, moon, cup, vinyl, lens, eclipse), ready for the other two.
 * - match_cut_montage_tool: the whole edit in one call: shots of 3-8 frames
 *   on the music's hits and beats (matchcut/montage.ts), every shot aligned,
 *   white flashes on downbeats, a motion transition once a bar between them
 *   (transitions/motion/montage.ts), a small zoom drift per shot, the music bed.
 *
 * The montage is its own tool rather than a build_reel_tool style: it cuts
 * in frames on onsets (build_reel cuts in beats, 6 frames at least), takes a
 * subject box per file and aligns every shot, which no other style needs.
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { isAudioOnlyMedia } from "../../model/media.js";
import { Interpolation, ScaleMode, type Clip, type ProjectFile } from "../../model/types.js";
import { OpError } from "../../ops/errors.js";
import { SOFT_ZOOM, ZOOM_ALL_LIMIT, alignMatchCut, type AlignClipInput, type AlignResult, type CoverMode } from "../../ops/match-cut.js";
import { addClip, deleteClips, retimeClipTo, setClipKeyframes, setClipProperty } from "../../ops/clips.js";
import { applyFittedMotionTransition, type MotionTransitionResult } from "../../ops/motion-transitions.js";
import { addTitleClip } from "../../ops/titles.js";
import { addTrack } from "../../ops/tracks.js";
import { removeTransition } from "../../ops/transitions.js";
import { boxAt, subjectOnCanvas, type CanvasSubject, type FitMode, type SubjectBox } from "../../matchcut/fit.js";
import { planMontage, type MontageMusic, type MontagePlan } from "../../matchcut/montage.js";
import { loopMusic, loopNote, onLoopedClock } from "../../reels/loop.js";
import { REUSE_GAP_SECONDS } from "../../reels/plan.js";
import { flashSvg } from "../../reels/typography.js";
import { MONTAGE_TRANSITIONS, planMontageTransitions, type MontageCut, type MontageRule } from "../../transitions/motion/montage.js";
import { beatOverrideProblem, beatOverrideShape, explicitBeats } from "../beat-override.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import { varietyProblem } from "../variety.js";
import { detectSubjects, pickSubject, SUBJECT_KINDS, type DetectedSubject, type FrameSubjects } from "../subjects.js";
import type { ImportedMedia } from "../types.js";
import { placeMusicBed } from "./music-bed.js";
import { aspectOf, displayName, musicFromBeats, usableRange, visualKind, writeCard } from "./reels.js";
import { FINISH_HINT } from "../director-card.js";
import { inBinOrder, sequenceFiles } from "./sequence.js";
import { lookOrder } from "../shots.js";

const ALIGN = "align_match_cut_tool";
const DETECT = "detect_subject_tool";
const MONTAGE = "match_cut_montage_tool";

const FITS = ["position", "position_scale", "position_scale_rotation"] as const;
/** align_match_cut_tool refuses a bigger enlargement unless max_zoom allows it. */
const MAX_ZOOM = 4;
/** The montage centres a detected shot whose scale, cover zoom included, would pass this. */
const MAX_SCALE = 8;
/** A best candidate smaller than this (radius, of the frame height) is more often a detail than the subject. */
const SMALL_SUBJECT = 0.05;
const COVERS = ["zoom", "zoom_all", "none"] as const;
/** How long a flash frame lasts, frames. */
const FLASH_FRAMES = 2;
/** Flash at most once per this many seconds. */
const FLASH_SPACING_SECONDS = 1;

const boxSchema = z
  .strictObject({
    x: z.number().min(-1).max(2).describe("Left edge, 0-1 of the source frame's width."),
    y: z.number().min(-1).max(2).describe("Top edge, 0-1 of the source frame's height."),
    w: z.number().gt(0).max(3).describe("Width, 0-1 of the frame's width."),
    h: z.number().gt(0).max(3).describe("Height, 0-1 of the frame's height."),
    angle: z.number().min(-360).max(360).optional().describe("The subject's orientation, degrees clockwise (fit position_scale_rotation)."),
  })
  .describe("The subject's box on the source frame (normalised 0-1, origin top-left), e.g. from detect_subject_tool or read off a frame's 0-1 grid.");

const targetSchema = z
  .strictObject({
    x: z.number().min(0).max(1).describe("Centre, 0-1 of the canvas width."),
    y: z.number().min(0).max(1).describe("Centre, 0-1 of the canvas height."),
    size: z.number().gt(0).max(4).describe("Subject size (the geometric mean of its drawn width and height) as a fraction of the canvas height, e.g. 0.5 = a circle half the frame tall."),
    angle: z.number().min(-360).max(360).optional().describe("Degrees clockwise (fit position_scale_rotation). Default 0."),
  })
  .describe("Where every subject lands.");

const fitSchema = z.enum(FITS).optional().describe("position: move only; position_scale (default): move and resize so sizes match; position_scale_rotation: also turn each subject to the target angle (boxes need angle).");
const coverSchema = z
  .enum(COVERS)
  .optional()
  .describe("Keeping the frame covered: zoom scales a clip up just enough when moving or shrinking it would show black edges (its subject ends up larger); zoom_all raises the target size for every clip so all still match; none allows black edges.");

const alignInput = z.strictObject({
  clips: z
    .array(
      z.strictObject({
        clip_id: z.string().min(1),
        box: boxSchema.optional().describe("The subject's box on the source frame (0-1, origin top-left). Leave it out and the clip's first frame is measured (detect_subject_tool, kind), picking the candidate closest in size to the other clips' subjects; the receipt lists what was measured."),
        time: z.number().min(0).optional().describe("Source seconds the box was measured at (default: the clip's first frame)."),
        end_box: boxSchema.optional().describe("The subject again later in the source, to follow it as it drifts."),
        end_time: z.number().min(0).optional().describe("Source seconds of end_box."),
        allow_edges: z.boolean().optional().describe("This clip may show the canvas around it instead of zooming (footage whose edges are black already: a moon on a night sky)."),
      }),
    )
    .min(1)
    .max(100)
    .describe("Timeline clips in cut order, each with its subject's box."),
  target: targetSchema.optional().describe("Where every subject lands. Default: where the first clip shows its subject now, on its first frame."),
  fit: fitSchema,
  cover: coverSchema,
  zoom_drift: z.number().min(0).max(0.5).optional().describe("Zoom each clip in by this fraction over its length, about the subject (0.04 = 4 %). Default 0."),
  max_zoom: z.number().min(1).max(30).optional().describe(`Refuse (nothing changes) when matching a clip's subject to the target size would enlarge it more than this (the zoom that keeps the frame covered is not counted); the error names the clip and why. Default ${MAX_ZOOM}: a bigger zoom almost always means a box on the wrong, small object.`),
  kind: z.enum(SUBJECT_KINDS).optional().describe("What to measure in clips given without a box: circle (default) or blob (a region brighter or darker than its surroundings: a silhouette, a window, a phone)."),
});

const pointSchema = z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });

const detectInput = z.strictObject({
  kind: z
    .enum(SUBJECT_KINDS)
    .optional()
    .describe("What to look for. circle (default): round subjects (iris/pupil, moon, sun, cup rim, vinyl, lens, clock, eclipse). blob: regions brighter or darker than their surroundings (a silhouette on the sky, a window, a phone screen, a sun in haze), with their centroid and box."),
  near: pointSchema.optional().describe("Where the subject roughly is, 0-1 of the frame (e.g. read off a grid): candidates near it rank first."),
  radius: z.number().gt(0).max(1).optional().describe("Its rough radius (half its height), fraction of the frame height: candidates of about that size rank first, and circles are looked for between radius/1.8 and radius*1.8."),
  file_id: z.string().min(1).optional().describe("A media-bin video or image."),
  clip_id: z.string().min(1).optional().describe("A timeline clip (its file is read)."),
  time: z.number().min(0).optional().describe("Source seconds to look at. Default: the clip's first frame, or the middle of the file."),
  min_radius: z.number().gt(0).max(1).optional().describe("Smallest circle radius, fraction of the frame height (default 0.04)."),
  max_radius: z.number().gt(0).max(1).optional().describe("Largest circle radius, fraction of the frame height (default 0.6)."),
  limit: z.number().int().min(1).max(10).optional().describe("Candidates to return (default 3)."),
});

const montageInput = z.strictObject({
  file_ids: z.array(z.string().min(1)).min(1).max(60).describe("Media-bin videos and images in chain order: the first opens (held), the last closes (held), the others cycle in between. Bin order is not a chain: get one from sequence_shots_tool (dry_run: true, continuity: 2, its data.file_ids)."),
  subjects: z
    .array(
      z.strictObject({
        file_id: z.string().min(1),
        box: boxSchema,
        time: z.number().min(0).optional().describe("Source seconds the box was measured at: the file's shots start here (every return replays this moment unless end_box follows the subject). Default: a third into the file."),
        end_box: boxSchema.optional().describe("The subject again later in the source, to follow it as it drifts."),
        end_time: z.number().min(0).optional().describe("Source seconds of end_box (default: the end of the file)."),
      }),
    )
    .max(60)
    .optional()
    .describe("Subject boxes per file. Files without one are searched for a circle at each shot's first frame (detect_subject_tool), or kept centred when this surface cannot read frames."),
  music_file_id: z.string().optional().describe("Music in the media bin to cut to. Default: the longest audio file in the bin."),
  ...beatOverrideShape,
  duration_seconds: z.number().min(2).max(60).optional().describe("Target length, seconds (default: one pass through the files, at least 8 s). Ends on a downbeat; music shorter than this loops whole phrases on a bar line to reach it."),
  target: targetSchema.optional().describe("Where every subject lands. Default: the frame's centre, at the size the first file shows its subject."),
  fit: fitSchema,
  cover: coverSchema.describe("Default zoom_all: every subject the same size and no black edges."),
  min_frames: z.number().int().min(2).max(12).optional().describe("Shortest body shot, frames (default 3)."),
  max_frames: z.number().int().min(2).max(24).optional().describe("Longest body shot, frames (default 8)."),
  flash: z.boolean().optional().describe("A white flash frame on cuts that land on a downbeat (default true)."),
  zoom_drift: z.number().min(0).max(0.3).optional().describe("Each shot zooms in by this fraction about its subject (default 0.04)."),
  transitions: z
    .enum(MONTAGE_TRANSITIONS)
    .optional()
    .describe(
      "Motion transitions on the cuts, once a bar between the flashed downbeats, in the same undo step: auto (default) = punch: crash zoom about the subject and glitch, the last cut flying into the subject; " +
        "flash (a flash montage): inverted frames, glitches and punches; whip: whips in one direction, landing on a pull-back; none: hard cuts and flashes only.",
    ),
  strict_variety: z
    .boolean()
    .optional()
    .describe(`Refuse (nothing changes) when the files are too few for the pace and a file comes back within ${REUSE_GAP_SECONDS} s; the error says how many more to import. Default false: a warning.`),
  replace: z.boolean().optional().describe("Clear the timeline first when it already has clips (in the same undo step)."),
  keep_order: z.boolean().optional().describe("Keep file_ids as given when they are the bin's own order (by default such a list is first chained by shape continuity, like sequence_shots_tool)."),
  order: z
    .enum(["given", "look"])
    .optional()
    .describe("given (default): file_ids is the chain. look: keep the first and last file and order the others so each shot looks most like the one before (shape and pose continuity, from the shot model; embed_media_tool)."),
});

type AlignArgs = z.infer<typeof alignInput>;
type DetectArgs = z.infer<typeof detectInput>;
type MontageArgs = z.infer<typeof montageInput>;

const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;
const roundBox = (b: SubjectBox): SubjectBox => ({ x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h), ...(b.angle !== undefined ? { angle: round(b.angle, 2) } : {}) });
const toTarget = (t: { x: number; y: number; size: number; angle?: number }): CanvasSubject => ({ cx: t.x, cy: t.y, size: t.size, angle: t.angle ?? 0 });
const fromTarget = (t: CanvasSubject) => ({ x: round(t.cx), y: round(t.cy), size: round(t.size), angle: round(t.angle, 2) });

function laterBox(item: { end_box?: SubjectBox; end_time?: number }): { box: SubjectBox; time: number } | undefined {
  return item.end_box && item.end_time !== undefined ? { box: item.end_box, time: item.end_time } : undefined;
}

/** The receipt rows and warnings of an alignment. */
function alignmentReport(result: AlignResult): { rows: Record<string, unknown>[]; warnings: string[] } {
  const warnings: string[] = [];
  const rows = result.clips.map((c) => {
    if (c.scale > SOFT_ZOOM) warnings.push(`${c.clipId} is enlarged ${round(c.scale, 1)}×: it may look soft.`);
    if (c.uncovered) warnings.push(`${c.clipId} leaves black edges (cover=none).`);
    if (result.coveredAlone.includes(c.clipId)) warnings.push(`${c.clipId} needed more than ${ZOOM_ALL_LIMIT}x to stay covered: it is zoomed on its own (its subject is larger than the others').`);
    return {
      clip_id: c.clipId,
      scale: round(c.scale),
      cover_zoom: round(c.coverZoom, 3),
      rotation: round(c.rotation, 2),
      keyframe_frames: c.frames,
      subject: fromTarget(c.subject),
    };
  });
  return { rows, warnings };
}

// ---------------------------------------------------------------------------
// align_match_cut_tool
// ---------------------------------------------------------------------------

const alignTool = directTool({
  name: ALIGN,
  title: "Align match cuts",
  description:
    "Line up the shared subject of consecutive clips (an iris, the moon, a cup rim, a pose) so it sits at the same place and size on every cut: " +
    "writes scale/location (and rotation) keyframes from each clip's subject box, keeps the frame covered (zooming when needed, reported) and is one undo step. " +
    "Boxes come from detect_subject_tool or from reading a frame's 0-1 grid (inspect_media_tool, preview_frame); a clip given without a box is measured here. " +
    `Refuses with the reason when matching a subject's size would enlarge its clip more than max_zoom (default ${MAX_ZOOM}x): that is a box on the wrong, small object.`,
  input: alignInput,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  run: async (call, args: AlignArgs) => {
    const bad = args.clips.find((c) => (c.end_box === undefined) !== (c.end_time === undefined));
    if (bad) return refused(ALIGN, `Error: ${bad.clip_id}: give end_box and end_time together.`);
    const measured = await measureMissingBoxes(call, args);
    if (typeof measured === "string") return refused(ALIGN, measured);
    const inputs: AlignClipInput[] = args.clips.map((c) => {
      const later = laterBox(c);
      const box = c.box ?? measured.get(c.clip_id)!.box;
      return { clipId: c.clip_id, box, ...(c.time !== undefined ? { time: c.time } : {}), ...(later ? { later } : {}), ...(c.allow_edges ? { cover: "none" as const } : {}) };
    });
    const result = call.commit(
      (tx) =>
        alignMatchCut(tx, inputs, {
          fit: args.fit ?? "position_scale",
          cover: args.cover ?? "zoom",
          zoomDrift: args.zoom_drift ?? 0,
          maxZoom: args.max_zoom ?? MAX_ZOOM,
          ...(args.target ? { target: toTarget(args.target) } : {}),
        }),
      "Align match cuts",
    );
    const { rows, warnings } = alignmentReport(result);
    for (const row of rows) {
      const m = measured.get(String(row.clip_id));
      if (m) Object.assign(row, { measured: { box: roundBox(m.box), confidence: m.score } });
    }
    const zoomed = result.clips.filter((c) => c.coverZoom > 1.001).length;
    const auto = measured.size > 0 ? `; measured ${measured.size} subject(s) (see measured)` : "";
    return applied(ALIGN, `Aligned ${result.clips.length} clip(s) on a subject at (${round(result.target.cx, 3)}, ${round(result.target.cy, 3)}), ${round(result.target.size, 3)} of the frame tall${zoomed ? `; ${zoomed} zoomed in to keep the frame covered` : ""}${auto}.`, {
      warnings,
      data: { target: fromTarget(result.target), clips: rows },
    });
  },
});

/**
 * Boxes for the clips given without one: each clip's frame at its box time is
 * measured and the candidate kept is the one closest in size to the given
 * boxes, or with none given the strongest weighed by size (`pickSubject`).
 */
async function measureMissingBoxes(call: ToolCall, args: AlignArgs): Promise<Map<string, DetectedSubject> | string> {
  const out = new Map<string, DetectedSubject>();
  const missing = args.clips.filter((c) => !c.box);
  if (missing.length === 0) return out;
  if (!call.host.frames) return `Error: ${missing.map((c) => c.clip_id).join(", ")} ha${missing.length === 1 ? "s" : "ve"} no box and this surface cannot read frames to measure one: give each clip its box.`;
  const project = call.doc.project;
  const given = args.clips.flatMap((c) => (c.box ? [c.box.h / 2] : [])).sort((a, b) => a - b);
  const reference: number | undefined = given.length > 0 ? given[Math.floor(given.length / 2)] : undefined;
  const kind = args.kind ?? "circle";
  for (const c of missing) {
    const clip = project.clips.find((k) => String(k.id) === c.clip_id);
    if (!clip) return `Error: unknown clip_id ${c.clip_id}.`;
    const file = project.files.find((f) => String(f.id) === String(clip.file_id));
    if (!file || visualKind(file) === null) return `Error: ${c.clip_id} has no picture to measure: give its box.`;
    const time = c.time ?? (visualKind(file) === "image" ? 0 : Number(clip.start) || 0);
    const found = await detectSubjects(call, file, time, kind, { limit: 10 });
    if (typeof found === "string") return found;
    const best = pickSubject(found.subjects, reference);
    if (!best) return `Error: no ${kind} found in ${c.clip_id} at ${round(time, 3)} s: give its box (read it off a frame's grid, inspect_media_tool) or try kind=${kind === "circle" ? "blob" : "circle"}.`;
    out.set(c.clip_id, best);
  }
  return out;
}

// ---------------------------------------------------------------------------
// detect_subject_tool
// ---------------------------------------------------------------------------

function subjectRow(s: DetectedSubject) {
  return {
    box: roundBox(s.box),
    center: { x: round(s.box.x + s.box.w / 2), y: round(s.box.y + s.box.h / 2) },
    radius: round(s.radius),
    score: s.score,
    confidence: s.confidence,
    ...(s.tone ? { tone: s.tone } : {}),
  };
}

const detectTool = directTool({
  name: DETECT,
  title: "Find the subject in a frame",
  description:
    "Measure the subject in a frame of a media-bin file or a timeline clip: round subjects (kind circle: iris/pupil, moon, sun, cup rim, vinyl, lens, clock, eclipse) or regions brighter or darker than their surroundings (kind blob: a silhouette, a window, a phone), " +
    "best first, each with its centre, radius, 0-1 box on the source frame and confidence, ready for align_match_cut_tool and match_cut_montage_tool. Pass near and radius (read off a frame's grid) when the subject is not the frame's most circle-like edge: candidates near that place and size rank first. " +
    "Concentric rings (iris and pupil) come back as separate candidates; dark_edges says the frame's edges are black (allow_edges). Reads only.",
  input: detectInput,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  requires: ["frames"],
  run: async (call, args: DetectArgs) => {
    const project = call.doc.project;
    if ((args.file_id === undefined) === (args.clip_id === undefined)) return refused(DETECT, "Error: give exactly one of file_id or clip_id.");
    let file: ProjectFile | undefined;
    let time = args.time;
    if (args.clip_id) {
      const clip = project.clips.find((c) => String(c.id) === args.clip_id);
      if (!clip) return refused(DETECT, `Error: unknown clip_id ${args.clip_id}.`);
      file = project.files.find((f) => String(f.id) === String(clip.file_id));
      time ??= Number(clip.start) || 0;
    } else {
      file = project.files.find((f) => String(f.id) === args.file_id);
      if (!file) return refused(DETECT, `Error: unknown file_id ${args.file_id}.`);
    }
    if (!file || visualKind(file) === null) return refused(DETECT, `Error: ${args.clip_id ?? args.file_id} has no picture to look at.`);
    time ??= visualKind(file) === "video" ? (Number(file.duration) || 0) / 2 : 0;
    const kind = args.kind ?? "circle";
    const found = await detectSubjects(call, file, time, kind, {
      // A rough radius also narrows the search, unless the bounds are given.
      ...(args.min_radius !== undefined ? { minRadius: args.min_radius } : args.radius !== undefined ? { minRadius: Math.max(0.01, args.radius / 1.8) } : {}),
      ...(args.max_radius !== undefined ? { maxRadius: args.max_radius } : args.radius !== undefined ? { maxRadius: Math.min(1, args.radius * 1.8) } : {}),
      ...(args.near ? { near: args.near } : {}),
      ...(args.radius !== undefined ? { radius: args.radius } : {}),
      limit: args.limit ?? 3,
    });
    if (typeof found === "string") return failed(DETECT, found);
    const where = `${String(file.id)} at ${round(time, 3)}s`;
    const rows = found.subjects.map(subjectRow);
    const summary =
      rows.length === 0
        ? `No ${kind} found in ${where}. Read the box off a frame with a grid (inspect_media_tool) instead.`
        : `Found ${rows.length} ${kind}(s) in ${where}; best at (${rows[0]!.center.x}, ${rows[0]!.center.y}), radius ${rows[0]!.radius} of the frame height, confidence ${rows[0]!.confidence}.`;
    const warnings: string[] = [];
    if (rows[0] && rows[0].radius < SMALL_SUBJECT && args.radius === undefined)
      warnings.push(`The best ${kind} is small (radius ${rows[0].radius}): it may be a highlight or a detail, not the subject. Pass near and radius (read off a grid) to rank the one you mean first.`);
    if (rows[0] && rows[0].confidence < 0.3) warnings.push(`Low confidence (${rows[0].confidence}): check the box on a frame before aligning on it.`);
    return applied(DETECT, summary, { warnings, data: { file_id: String(file.id), time: round(time, 3), kind, subjects: rows, dark_edges: found.darkEdges } }, 0);
  },
});

// ---------------------------------------------------------------------------
// match_cut_montage_tool
// ---------------------------------------------------------------------------

const TRACKS = ["music", "video", "flash"] as const;
type TrackRole = (typeof TRACKS)[number];

/** The montage's tracks, bottom to top, adding tracks when the project has fewer. */
function montageTracks(tx: Transaction): Record<TrackRole, number> {
  while (tx.project.layers.length < TRACKS.length) addTrack(tx, {});
  const numbers = [...tx.project.layers].map((l) => Number(l.number)).sort((a, b) => a - b);
  return Object.fromEntries(TRACKS.map((role, i) => [role, numbers[i]!])) as Record<TrackRole, number>;
}

interface ShotSource {
  fileId: string;
  kind: "video" | "image";
  /** Source window, seconds. */
  start: number;
  end: number;
  /** A file shorter than its shot plays its whole window slowed to fill it, at this speed (< 1). */
  slow?: number;
  box: SubjectBox;
  later?: { box: SubjectBox; time: number };
  /** Where the box came from. */
  from: "given" | "detected" | "centred";
  /** The footage's edges are black: it may show the (black) canvas around it instead of zooming. */
  darkEdges: boolean;
}

/** A centred box for footage whose subject could not be found: the shot stays framed as it is, centred. */
const CENTRED: SubjectBox = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

/**
 * Source in-points per shot. A file's shots start where its box was measured
 * (or a third in): footage moves (a push-in on the moon), so a box only
 * holds at the moment it describes and every return of the file replays that
 * moment. Files with an end box are followed instead: each return shows a
 * later moment and the box is interpolated there.
 */
function sourceWindows(plan: MontagePlan, ids: readonly string[], files: Map<string, ProjectFile>, times: Map<string, number>, followed: ReadonlySet<string>, fps: number): Array<{ start: number; end: number; slow?: number }> {
  const cursor = new Map<string, number>();
  return plan.shots.map((shot) => {
    const id = ids[shot.clip]!;
    const file = files.get(id)!;
    const length = shot.frames / fps;
    if (visualKind(file) === "image") return { start: 0, end: length };
    const [a, b] = usableRange(file);
    // Shorter than the shot (a held opening on a slow tempo): the whole file, slowed to fill it, rather than black after its last frame.
    const first = Math.ceil(a * fps - 1e-6) / fps;
    const last = Math.floor(b * fps + 1e-6) / fps;
    if (last - first < length - 1e-6 && last > first) return { start: first, end: last, slow: (last - first) / length };
    const room = Math.max(0, b - a - length);
    let start = cursor.get(id) ?? times.get(id) ?? a + room * 0.3;
    if (start + length > b + 1e-6) start = a;
    start = Math.max(0, Math.min(start, Math.max(a, b - length)));
    // On the frame grid: a window between frames rounds to one frame more or less than the shot (a black frame or an overlap on the cut).
    start = Math.max(0, Math.floor(start * fps + 0.5) / fps);
    cursor.set(id, followed.has(id) ? start + length + 0.25 : start);
    return { start, end: start + length };
  });
}

function fadeAlpha(tx: Transaction, clip: Clip, from: number, to: number, start: number, end: number): void {
  setClipKeyframes(tx, clip.id, "alpha", [
    { time: start, value: from, interpolation: Interpolation.LINEAR },
    { time: end, value: to, interpolation: Interpolation.LINEAR },
  ]);
}

const montageTool = directTool({
  name: MONTAGE,
  title: "Match-cut montage",
  description:
    "Cut a full-circle match-cut montage in one step from media-bin files that share a shape or pose (eye, moon, cup, vinyl, lens): " +
    "shots of 3-8 frames on the music's hits and beats with a held first and last shot, every shot aligned so the subject sits at the same place and size, " +
    "white flashes on downbeats, a motion transition once a bar between them (transitions: punch by default, flash for a flash montage, whip, none), a small zoom per shot and the music bed. " +
    "One undo step; data.sfx_cues lists the cut times for sound design, data.transitions the moves (auto_sound_design_tool hears both). " +
    "Give subject boxes per file (detect_subject_tool) or let it find circles; for a flash montage of unrelated images give each a full-frame box {x:0,y:0,w:1,h:1}. " +
    `Warns (strict_variety: refuses) when the files are too few for the pace and says how many more to import. ${FINISH_HINT}`,
  input: montageInput,
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  requires: ["media"],
  run: async (call, args: MontageArgs) => {
    const project = call.doc.project;
    const files = new Map(project.files.map((f) => [String(f.id), f]));
    let ids = args.file_ids;
    const unknown = ids.filter((id) => !files.has(id));
    if (unknown.length > 0) return refused(MONTAGE, `Error: unknown file id(s): ${unknown.join(", ")}.`);
    const notVisual = ids.filter((id) => visualKind(files.get(id)!) === null);
    if (notVisual.length > 0) return refused(MONTAGE, `Error: these are not videos or images: ${notVisual.join(", ")}.`);
    if (project.clips.length > 0 && !args.replace) {
      return refused(MONTAGE, `Error: the timeline already has ${project.clips.length} clip(s). Pass replace=true to rebuild it, or build in a new project.`);
    }
    const given = new Map<string, NonNullable<MontageArgs["subjects"]>[number]>();
    for (const s of args.subjects ?? []) {
      if (!ids.includes(s.file_id)) return refused(MONTAGE, `Error: subjects names ${s.file_id}, which is not in file_ids.`);
      if (s.end_time !== undefined && !s.end_box) return refused(MONTAGE, `Error: ${s.file_id}: end_time is where end_box was measured; give end_box with it.`);
      given.set(s.file_id, s);
    }
    const problem = beatOverrideProblem(args);
    if (problem) return refused(MONTAGE, problem);
    const minFrames = args.min_frames ?? 3;
    const maxFrames = args.max_frames ?? 8;
    if (maxFrames < minFrames) return refused(MONTAGE, "Error: max_frames must be at least min_frames.");
    let music: ProjectFile | undefined;
    if (args.music_file_id) {
      music = files.get(args.music_file_id);
      if (!music) return refused(MONTAGE, `Error: unknown music_file_id ${args.music_file_id}.`);
      if (!music.has_audio) return refused(MONTAGE, `Error: ${args.music_file_id} has no audio.`);
    } else {
      music = project.files.filter((f) => isAudioOnlyMedia(f) && !ids.includes(String(f.id))).sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0))[0];
    }

    // The music's beats and hits: given (beats, or bpm + offset_seconds), tracked here (at the given bpm, if any), or none (cut to bpm, else 120 BPM).
    const warnings: string[] = [];
    let beats: MontageMusic | null = null;
    const instead = `${args.bpm ?? 120} BPM`;
    if (music) {
      const length = Number(music.duration) || 0;
      const explicit = explicitBeats(args, length);
      if (explicit) {
        beats = { ...musicFromBeats(explicit.beats, length, args.bpm), onsets: [] };
      } else if (canTrackBeats(call)) {
        const tracked = await beatsOfFile(call, music, args.bpm ? { bpm: args.bpm } : {});
        if (typeof tracked === "string") warnings.push(`${tracked} Cut to ${instead} instead.`);
        else if (tracked.beats.length >= 2) {
          beats = {
            bpm: tracked.bpm,
            beats: tracked.beats.map((b) => b.timeSec),
            downbeats: tracked.downbeats.map((d) => d.timeSec),
            beatEnergy: tracked.beatEnergy,
            onsets: tracked.onsets,
            duration: Math.max(length, tracked.duration),
          };
        } else warnings.push(`No steady beat in the music: cut to ${instead} instead.`);
      } else if (args.bpm) {
        beats = { ...musicFromBeats(explicitBeats({ bpm: args.bpm, offset_seconds: 0 }, length)!.beats, length, args.bpm), onsets: [] };
        warnings.push(`This surface cannot analyse audio: the grid is ${args.bpm} BPM from the start of the music (pass offset_seconds if the first beat is later).`);
      } else warnings.push("This surface cannot analyse audio: the cuts follow 120 BPM, not the music (pass bpm and offset_seconds).");
    } else if (args.beats || args.offset_seconds !== undefined) {
      warnings.push("beats and offset_seconds are for music in the project: there is none, so the cuts follow bpm (default 120).");
    }

    // An asked length the music cannot fill: whole phrases loop on a bar line (reels/loop.ts).
    const loop = beats && args.duration_seconds !== undefined ? loopMusic(beats, args.duration_seconds) : null;
    if (loop && beats) {
      warnings.push(loopNote(beats, loop, args.duration_seconds!));
      beats = { ...loop.music, onsets: onLoopedClock(loop.segments, beats.onsets) };
    }

    // order=look chains the files by the shot model. Otherwise a list in the bin's own order is no chain:
    // shapes are chained first (re-edit bench, 2026-10-28).
    const notes: string[] = [];
    if (args.order === "look" && ids.length > 3) {
      const order = await lookOrder(call, ids.map((id) => files.get(id)!), ids.map((id) => given.get(id)?.time));
      if (typeof order === "string") warnings.push(`order=look kept the given order: ${order}.`);
      else ids = order.map((i) => ids[i]!);
    } else if (!args.keep_order && inBinOrder(project, ids)) {
      const ordered = await sequenceFiles(call, ids, { arc: "flat", continuity: 2 }, "keep_order", true);
      if (ordered && "ids" in ordered) {
        ids = ordered.ids;
        notes.push(ordered.note);
      } else if (ordered) warnings.push(ordered.warning);
    }

    const fps = Number(project.fps?.num) / Number(project.fps?.den || 1);
    const frameRate = Number.isFinite(fps) && fps > 0 ? fps : 30;
    let plan: MontagePlan;
    try {
      plan = planMontage({
        clips: ids.length,
        fps: frameRate,
        music: beats,
        minFrames,
        maxFrames,
        ...(args.duration_seconds !== undefined ? { seconds: args.duration_seconds } : {}),
        ...(!beats && args.bpm ? { fallbackBpm: args.bpm } : {}),
      });
    } catch (error) {
      return failed(MONTAGE, `Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Every shot's source window and subject box, before anything is recorded.
    const boxTimes = new Map([...given].filter(([, s]) => s.time !== undefined).map(([id, s]) => [id, s.time!]));
    const followed = new Set([...given].filter(([, g]) => g.end_box !== undefined).map(([id]) => id));
    const windows = sourceWindows(plan, ids, files, boxTimes, followed, frameRate);
    const firstStart = new Map<string, number>();
    for (const [i, shot] of plan.shots.entries()) if (!firstStart.has(ids[shot.clip]!)) firstStart.set(ids[shot.clip]!, windows[i]!.start);
    const unused = ids.filter((id) => !firstStart.has(id));
    if (unused.length > 0) warnings.push(`${unused.length} file(s) did not fit in ${round(plan.duration, 2)} s: ${unused.join(", ")}. Give a longer duration_seconds.`);
    const variety = varietyProblem(plan.shots.map((shot) => ({ fileId: ids[shot.clip]!, start: shot.start, end: shot.end })));
    if (variety && args.strict_variety) return refused(MONTAGE, `Error: ${variety}`);
    if (variety) warnings.push(variety);
    const slowed = new Map<string, number>();
    windows.forEach((w, i) => {
      if (w.slow) slowed.set(ids[plan.shots[i]!.clip]!, Math.min(slowed.get(ids[plan.shots[i]!.clip]!) ?? 1, w.slow));
    });
    for (const [id, speed] of slowed) warnings.push(`${displayName(files.get(id)!)} is shorter than its shot: it plays slowed to ${Math.round(speed * 100)} % to fill it.`);
    // Each file is looked at once, at its first shot: its circle (unless given) and whether its edges are black.
    const looked = new Map<string, FrameSubjects | null>();
    let cannotLook = false;
    // With boxes given, each file's candidate closest in size to them; else the strongest weighed by size (pickSubject).
    const reference = [...given.values()].map((g) => g.box.h / 2).sort((a, b) => a - b)[Math.floor(given.size / 2)];
    const sources: ShotSource[] = [];
    for (const [i, shot] of plan.shots.entries()) {
      const id = ids[shot.clip]!;
      const file = files.get(id)!;
      const w = windows[i]!;
      const kind = visualKind(file)!;
      if (!looked.has(id) && call.host.frames && !cannotLook) {
        const found = await detectSubjects(call, file, kind === "image" ? 0 : w.start, "circle", { limit: 10 });
        if (typeof found === "string") {
          cannotLook = true;
          warnings.push(`${found} Shots without a subject box are kept centred.`);
        } else looked.set(id, found);
      }
      const darkEdges = looked.get(id)?.darkEdges ?? false;
      const s = given.get(id);
      if (s) {
        // end_box alone: the subject as the file ends.
        const later = laterBox(s.end_box && s.end_time === undefined ? { ...s, end_time: usableRange(file)[1] } : s);
        // A box without a time was measured where the file's first shot starts; it is followed from there.
        const box = boxAt(s.box, s.time ?? firstStart.get(id)!, later, w.start);
        sources.push({ fileId: id, kind, ...w, box, ...(later ? { later } : {}), from: "given", darkEdges });
        continue;
      }
      const subjects = looked.get(id)?.subjects ?? [];
      const box = pickSubject(subjects, reference)?.box;
      if (box) sources.push({ fileId: id, kind, ...w, box, from: "detected", darkEdges });
      else {
        if (looked.has(id) && shot.use === 0) warnings.push(`No circle found in ${displayName(file)}: its shots are centred, not aligned.`);
        sources.push({ fileId: id, kind, ...w, box: CENTRED, from: "centred", darkEdges });
      }
    }
    if (!call.host.frames && sources.some((s) => s.from === "centred")) warnings.push("This surface cannot read frames to find subjects: give subjects boxes to align every shot.");

    const flashShots = new Set<number>();
    if (args.flash ?? true) {
      let last = -Infinity;
      plan.shots.forEach((shot, i) => {
        if (i === 0 || !shot.onDownbeat || shot.start - last < FLASH_SPACING_SECONDS) return;
        flashShots.add(i);
        last = shot.start;
      });
    }
    let flashCard: ImportedMedia | undefined;
    if (flashShots.size > 0) {
      if (call.host.media?.writeGenerated) {
        try {
          flashCard = await writeCard(call, "match-cut-flash.svg", flashSvg(Number(project.width) || 1920, Number(project.height) || 1080));
        } catch (error) {
          return failed(MONTAGE, `Error: failed to write the flash frame: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else warnings.push("This surface cannot store generated images: no flash frames.");
    }

    const fit: FitMode = args.fit ?? "position_scale";
    const cover: CoverMode = args.cover ?? "zoom_all";
    const rule: MontageRule | null = args.transitions === "none" ? null : args.transitions === undefined || args.transitions === "auto" ? "punch" : args.transitions;
    const halfFrame = 0.5 / frameRate;
    const cuts: MontageCut[] = plan.shots.slice(1).map((shot, i) => ({
      time: shot.start,
      onDownbeat: shot.onDownbeat,
      onBeat: plan.beats.some((b) => Math.abs(b - shot.start) <= halfFrame),
      flashed: flashShots.has(i + 1),
      outFrames: plan.shots[i]!.frames,
      inFrames: shot.frames,
    }));
    const planned = rule ? planMontageTransitions(rule, cuts, 60 / plan.bpm, frameRate) : [];
    const built = call.commit((tx) => {
      if (tx.project.clips.length > 0) {
        for (const t of [...tx.project.effects]) removeTransition(tx, String(t.id));
        deleteClips(tx, tx.project.clips.map((c) => String(c.id)), { ripple: false });
      }
      const track = montageTracks(tx);
      if (music) placeMusicBed(tx, String(music.id), plan.musicStart, plan.duration, track.music, displayName(music), loop?.segments);
      const clips = plan.shots.map((shot, i) => {
        const src = sources[i]!;
        const file = files.get(src.fileId)!;
        const added = addClip(tx, { fileId: src.fileId, position: shot.start, layer: track.video, start: src.start, end: src.end });
        const clip = src.slow ? retimeClipTo(tx, added.id, { duration: shot.frames / frameRate }) : added;
        // Fill the frame like build_reel: a different aspect is cropped, not letterboxed.
        if (aspectOf(file) !== null) setClipProperty(tx, clip.id, "scale", ScaleMode.CROP);
        if (file.has_audio) setClipProperty(tx, clip.id, "volume", 0);
        if (flashCard && flashShots.has(i)) {
          const flash = addTitleClip(tx, { file: flashCard, position: shot.start, duration: FLASH_FRAMES / frameRate, layer: track.flash, title: "Flash" }).clip;
          fadeAlpha(tx, flash, 1, 0, shot.start, shot.start + FLASH_FRAMES / frameRate);
        }
        return tx.project.clips.find((c) => c.id === clip.id)!;
      });
      // Default target: the frame's centre, at the size the first shot shows its subject.
      const first = clips[0]!;
      const opening = subjectOnCanvas(tx.project, first, Math.round(sources[0]!.start * frameRate) + 1, sources[0]!.box);
      const target = args.target ? toTarget(args.target) : { cx: 0.5, cy: 0.5, size: opening.size, angle: opening.angle };
      const alignInputs = () =>
        clips.map((clip, i) => {
          const src = sources[i]!;
          return { clipId: String(clip.id), box: src.box, time: src.start, ...(src.later ? { later: src.later } : {}), ...(src.darkEdges ? { cover: "none" as const } : {}) };
        });
      const options = { target, fit, cover, zoomDrift: args.zoom_drift ?? 0.04 };
      // A detected box that needs a huge zoom (to match the size, or to stay covered) is on the wrong object or at
      // the frame's edge: those shots are centred instead and the alignment runs again (nothing is written until it passes).
      let alignment: AlignResult | null = null;
      const centred = new Set<number>();
      for (let attempt = 0; !alignment && attempt < 4; attempt += 1) {
        try {
          alignment = alignMatchCut(tx, alignInputs(), { ...options, maxZoom: MAX_ZOOM, maxScale: MAX_SCALE });
        } catch (error) {
          const over = new Set(error instanceof OpError && Array.isArray(error.details?.clipIds) ? (error.details.clipIds as string[]) : []);
          const wrong = clips.flatMap((clip, i) => (over.has(String(clip.id)) && sources[i]!.from === "detected" ? [i] : []));
          if (wrong.length === 0) break;
          for (const i of wrong) {
            sources[i] = { ...sources[i]!, box: CENTRED, from: "centred" };
            centred.add(i);
          }
        }
      }
      alignment ??= alignMatchCut(tx, alignInputs(), options);
      if (centred.size > 0) {
        const names = [...new Set([...centred].map((i) => displayName(files.get(sources[i]!.fileId)!)))];
        warnings.push(`The circle found in ${names.join(", ")} needed more than ${MAX_ZOOM}x to match the others or ${MAX_SCALE}x to stay covered: probably the wrong object or at the frame's edge, so those shots are centred. Give their boxes (detect_subject_tool with near and radius) to align them.`);
      }
      // After the alignment: a transition's frames ride on the aligned curves; a zoom-through flies into the subject.
      const focus = { x: alignment.target.cx, y: alignment.target.cy };
      const transitions = planned.flatMap((t): MotionTransitionResult[] => {
        const done = applyFittedMotionTransition(tx, {
          outClipId: String(clips[t.cut]!.id),
          inClipId: String(clips[t.cut + 1]!.id),
          preset: t.preset,
          frames: t.frames,
          direction: "auto",
          ...(t.preset === "zoom_through" ? { focus } : {}),
        });
        return done ? [done] : [];
      });
      return { clips, alignment, tracks: track, requested: target, transitions };
    }, "Match-cut montage");

    const { rows, warnings: alignWarnings } = alignmentReport(built.alignment);
    warnings.push(...alignWarnings);
    if (built.alignment.target.size > built.requested.size * 1.05) {
      warnings.push(`Subjects were made ${round(built.alignment.target.size / built.requested.size, 2)}× larger than asked so every shot covers the frame.`);
    }
    const shots = plan.shots.map((shot, i) => ({
      clip_id: String(built.clips[i]!.id),
      file_id: sources[i]!.fileId,
      start: round(shot.start),
      end: round(shot.end),
      frames: shot.frames,
      source_start: round(sources[i]!.start),
      subject_from: sources[i]!.from,
      box: roundBox(sources[i]!.box),
      scale: rows[i]!.scale,
      cover_zoom: rows[i]!.cover_zoom,
    }));
    const flashes = [...flashShots].map((i) => round(plan.shots[i]!.start));
    const sfx = plan.shots.slice(1).map((shot, i) => ({
      time: round(shot.start),
      kind: shot.role === "close" ? "hold" : "cut",
      accent: shot.onDownbeat || flashShots.has(i + 1) || built.transitions.some((r) => Math.abs(r.cut - shot.start) <= halfFrame),
    }));
    const body = plan.shots.filter((s) => s.role === "body");
    return applied(
      MONTAGE,
      `Cut a match-cut montage: ${plan.shots.length} shots (${body.length} of ${minFrames}-${maxFrames} frames) at ${Math.round(plan.bpm)} BPM, ${round(plan.duration, 2)} s, every subject at (${round(built.alignment.target.cx, 3)}, ${round(built.alignment.target.cy, 3)}), ${round(built.alignment.target.size, 3)} of the frame tall${flashes.length ? `, ${flashes.length} flash frame(s)` : ""}${
        built.transitions.length ? `, ${built.transitions.length} motion transition(s) (${built.transitions.map((r) => `${r.preset}@${r.cut.toFixed(2)}s`).join(", ")})` : ""
      }.`,
      {
        warnings: [...new Set(warnings)],
        notes,
        data: {
          duration: round(plan.duration),
          bpm: round(plan.bpm, 2),
          music_file_id: music ? String(music.id) : null,
          music_start: plan.musicStart,
          ...(args.order === "look" ? { file_order: ids } : {}),
          target: fromTarget(built.alignment.target),
          shots,
          flashes,
          transitions: built.transitions.map((r) => ({ id: r.id, preset: r.preset, direction: r.direction, cut: r.cut, frames: r.frames })),
          // Where a whoosh/hit/click belongs: every cut (accent = on a downbeat or a flash) and the end hold.
          sfx_cues: sfx,
          beats: plan.beats,
          downbeats: plan.downbeats,
          tracks: built.tracks,
        },
      },
    );
  },
});

export const matchCutTools: CatalogTool[] = [alignTool, detectTool, montageTool];
