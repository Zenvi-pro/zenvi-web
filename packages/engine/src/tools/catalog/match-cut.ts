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
 *   white flashes on downbeats, a small zoom drift per shot, the music bed.
 *
 * The montage is its own tool rather than a build_reel_tool style: it cuts
 * in frames on onsets (build_reel cuts in beats, 6 frames at least), takes a
 * subject box per file and aligns every shot, which no other style needs.
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { isAudioOnlyMedia } from "../../model/media.js";
import { Interpolation, ScaleMode, type Clip, type ProjectFile } from "../../model/types.js";
import { SOFT_ZOOM, alignMatchCut, type AlignClipInput, type AlignResult, type CoverMode } from "../../ops/match-cut.js";
import { addClip, deleteClips, setClipKeyframes, setClipProperty } from "../../ops/clips.js";
import { addTitleClip } from "../../ops/titles.js";
import { addTrack } from "../../ops/tracks.js";
import { removeTransition } from "../../ops/transitions.js";
import { boxAt, subjectOnCanvas, type CanvasSubject, type FitMode, type SubjectBox } from "../../matchcut/fit.js";
import { planMontage, type MontageMusic, type MontagePlan } from "../../matchcut/montage.js";
import { flashSvg } from "../../reels/typography.js";
import { beatsOfFile, canTrackBeats } from "../beats.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused } from "../receipt.js";
import { detectSubjects, SUBJECT_KINDS, type DetectedSubject } from "../subjects.js";
import type { ImportedMedia } from "../types.js";
import { placeMusicBed } from "./music-bed.js";
import { aspectOf, displayName, musicFromBeats, usableRange, visualKind, writeCard } from "./reels.js";

const ALIGN = "align_match_cut_tool";
const DETECT = "detect_subject_tool";
const MONTAGE = "match_cut_montage_tool";

const FITS = ["position", "position_scale", "position_scale_rotation"] as const;
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
        box: boxSchema,
        time: z.number().min(0).optional().describe("Source seconds the box was measured at (default: the clip's first frame)."),
        end_box: boxSchema.optional().describe("The subject again later in the source, to follow it as it drifts."),
        end_time: z.number().min(0).optional().describe("Source seconds of end_box."),
      }),
    )
    .min(1)
    .max(100)
    .describe("Timeline clips in cut order, each with its subject's box."),
  target: targetSchema.optional().describe("Where every subject lands. Default: where the first clip shows its subject now, on its first frame."),
  fit: fitSchema,
  cover: coverSchema,
  zoom_drift: z.number().min(0).max(0.5).optional().describe("Zoom each clip in by this fraction over its length, about the subject (0.04 = 4 %). Default 0."),
});

const detectInput = z.strictObject({
  kind: z.enum(SUBJECT_KINDS).optional().describe("What to look for. circle (default): round subjects (iris/pupil, moon, sun, cup rim, vinyl, lens, clock, eclipse)."),
  file_id: z.string().min(1).optional().describe("A media-bin video or image."),
  clip_id: z.string().min(1).optional().describe("A timeline clip (its file is read)."),
  time: z.number().min(0).optional().describe("Source seconds to look at. Default: the clip's first frame, or the middle of the file."),
  min_radius: z.number().gt(0).max(1).optional().describe("Smallest circle radius, fraction of the frame height (default 0.04)."),
  max_radius: z.number().gt(0).max(1).optional().describe("Largest circle radius, fraction of the frame height (default 0.6)."),
  limit: z.number().int().min(1).max(10).optional().describe("Candidates to return (default 3)."),
});

const montageInput = z.strictObject({
  file_ids: z.array(z.string().min(1)).min(1).max(60).describe("Media-bin videos and images in chain order: the first opens (held), the last closes (held), the others cycle in between."),
  subjects: z
    .array(
      z.strictObject({
        file_id: z.string().min(1),
        box: boxSchema,
        time: z.number().min(0).optional().describe("Source seconds of the box: the file's first shot starts here. Without it the subject is taken to stay put."),
        end_box: boxSchema.optional(),
        end_time: z.number().min(0).optional(),
      }),
    )
    .max(60)
    .optional()
    .describe("Subject boxes per file. Files without one are searched for a circle at each shot's first frame (detect_subject_tool), or kept centred when this surface cannot read frames."),
  music_file_id: z.string().optional().describe("Music in the media bin to cut to. Default: the longest audio file in the bin."),
  beats: z.array(z.number().min(0)).max(4000).optional().describe("Beat times of the music, seconds, instead of analysing it here."),
  duration_seconds: z.number().min(2).max(60).optional().describe("Target length, seconds (default: one pass through the files, at least 8 s). Ends on a downbeat."),
  target: targetSchema.optional().describe("Where every subject lands. Default: the frame's centre, at the size the first file shows its subject."),
  fit: fitSchema,
  cover: coverSchema.describe("Default zoom_all: every subject the same size and no black edges."),
  min_frames: z.number().int().min(2).max(12).optional().describe("Shortest body shot, frames (default 3)."),
  max_frames: z.number().int().min(2).max(24).optional().describe("Longest body shot, frames (default 8)."),
  flash: z.boolean().optional().describe("A white flash frame on cuts that land on a downbeat (default true)."),
  zoom_drift: z.number().min(0).max(0.3).optional().describe("Each shot zooms in by this fraction about its subject (default 0.04)."),
  replace: z.boolean().optional().describe("Clear the timeline first when it already has clips (in the same undo step)."),
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
    "Boxes come from detect_subject_tool or from reading a frame's 0-1 grid (inspect_media_tool, preview_frame).",
  input: alignInput,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  run: (call, args: AlignArgs) => {
    const inputs: AlignClipInput[] = args.clips.map((c) => {
      const later = laterBox(c);
      return { clipId: c.clip_id, box: c.box, ...(c.time !== undefined ? { time: c.time } : {}), ...(later ? { later } : {}) };
    });
    const bad = args.clips.find((c) => (c.end_box === undefined) !== (c.end_time === undefined));
    if (bad) return refused(ALIGN, `Error: ${bad.clip_id}: give end_box and end_time together.`);
    const result = call.commit(
      (tx) =>
        alignMatchCut(tx, inputs, {
          fit: args.fit ?? "position_scale",
          cover: args.cover ?? "zoom",
          zoomDrift: args.zoom_drift ?? 0,
          ...(args.target ? { target: toTarget(args.target) } : {}),
        }),
      "Align match cuts",
    );
    const { rows, warnings } = alignmentReport(result);
    const zoomed = result.clips.filter((c) => c.coverZoom > 1.001).length;
    return applied(ALIGN, `Aligned ${result.clips.length} clip(s) on a subject at (${round(result.target.cx, 3)}, ${round(result.target.cy, 3)}), ${round(result.target.size, 3)} of the frame tall${zoomed ? `; ${zoomed} zoomed in to keep the frame covered` : ""}.`, {
      warnings,
      data: { target: fromTarget(result.target), clips: rows },
    });
  },
});

// ---------------------------------------------------------------------------
// detect_subject_tool
// ---------------------------------------------------------------------------

function subjectRow(s: DetectedSubject) {
  return {
    box: roundBox(s.box),
    center: { x: round(s.box.x + s.box.w / 2), y: round(s.box.y + s.box.h / 2) },
    radius: round(s.box.h / 2),
    score: s.score,
  };
}

const detectTool = directTool({
  name: DETECT,
  title: "Find the subject in a frame",
  description:
    "Find round subjects (iris/pupil, moon, sun, cup rim, vinyl, lens, clock, eclipse) in a frame of a media-bin file or a timeline clip, " +
    "best first, as 0-1 boxes on the source frame ready for align_match_cut_tool and match_cut_montage_tool. Concentric rings (iris and pupil) come back as separate candidates. Reads only.",
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
      ...(args.min_radius !== undefined ? { minRadius: args.min_radius } : {}),
      ...(args.max_radius !== undefined ? { maxRadius: args.max_radius } : {}),
      limit: args.limit ?? 3,
    });
    if (typeof found === "string") return failed(DETECT, found);
    const where = `${String(file.id)} at ${round(time, 3)}s`;
    const rows = found.map(subjectRow);
    const summary =
      rows.length === 0
        ? `No ${kind} found in ${where}. Read the box off a frame with a grid (inspect_media_tool) instead.`
        : `Found ${rows.length} ${kind}(s) in ${where}; best at (${rows[0]!.center.x}, ${rows[0]!.center.y}), radius ${rows[0]!.radius} of the frame height.`;
    return applied(DETECT, summary, { data: { file_id: String(file.id), time: round(time, 3), kind, subjects: rows } }, 0);
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
  box: SubjectBox;
  later?: { box: SubjectBox; time: number };
  /** Where the box came from. */
  from: "given" | "detected" | "centred";
}

/** A centred box for footage whose subject could not be found: the shot stays framed as it is, centred. */
const CENTRED: SubjectBox = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };

/** Source in-points per shot: a file's first shot starts at its box time (or a third in), each return a little later. */
function sourceWindows(plan: MontagePlan, ids: readonly string[], files: Map<string, ProjectFile>, times: Map<string, number>): Array<{ start: number; end: number }> {
  const cursor = new Map<string, number>();
  return plan.shots.map((shot) => {
    const id = ids[shot.clip]!;
    const file = files.get(id)!;
    const length = shot.end - shot.start;
    if (visualKind(file) === "image") return { start: 0, end: length };
    const [a, b] = usableRange(file);
    const room = Math.max(0, b - a - length);
    let start = cursor.get(id) ?? times.get(id) ?? a + room * 0.3;
    if (start + length > b + 1e-6) start = a;
    start = Math.max(0, Math.min(start, Math.max(a, b - length)));
    cursor.set(id, start + length + 0.25);
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
    "white flashes on downbeats, a small zoom per shot and the music bed. One undo step; data.sfx_cues lists the cut times for sound design. " +
    "Give subject boxes per file (detect_subject_tool) or let it find circles.",
  input: montageInput,
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  requires: ["media"],
  run: async (call, args: MontageArgs) => {
    const project = call.doc.project;
    const files = new Map(project.files.map((f) => [String(f.id), f]));
    const ids = args.file_ids;
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
      if ((s.end_box === undefined) !== (s.end_time === undefined)) return refused(MONTAGE, `Error: ${s.file_id}: give end_box and end_time together.`);
      given.set(s.file_id, s);
    }
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

    // The music's beats and hits: given, tracked here, or none (cut to 120 BPM).
    const warnings: string[] = [];
    let beats: MontageMusic | null = null;
    if (music) {
      const length = Number(music.duration) || 0;
      if (args.beats && args.beats.length >= 2) {
        beats = { ...musicFromBeats(args.beats, length), onsets: [] };
      } else if (canTrackBeats(call)) {
        const tracked = await beatsOfFile(call, music);
        if (typeof tracked === "string") warnings.push(`${tracked} Cut to 120 BPM instead.`);
        else if (tracked.beats.length >= 2) {
          beats = {
            bpm: tracked.bpm,
            beats: tracked.beats.map((b) => b.timeSec),
            downbeats: tracked.downbeats.map((d) => d.timeSec),
            beatEnergy: tracked.beatEnergy,
            onsets: tracked.onsets,
            duration: Math.max(length, tracked.duration),
          };
        } else warnings.push("No steady beat in the music: cut to 120 BPM instead.");
      } else warnings.push("This surface cannot analyse audio: the cuts follow 120 BPM, not the music.");
    }

    const fps = Number(project.fps?.num) / Number(project.fps?.den || 1);
    const frameRate = Number.isFinite(fps) && fps > 0 ? fps : 30;
    let plan: MontagePlan;
    try {
      plan = planMontage({ clips: ids.length, fps: frameRate, music: beats, minFrames, maxFrames, ...(args.duration_seconds !== undefined ? { seconds: args.duration_seconds } : {}) });
    } catch (error) {
      return failed(MONTAGE, `Error: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Every shot's source window and subject box, before anything is recorded.
    const boxTimes = new Map([...given].filter(([, s]) => s.time !== undefined).map(([id, s]) => [id, s.time!]));
    const windows = sourceWindows(plan, ids, files, boxTimes);
    const detected = new Map<string, SubjectBox | null>();
    let cannotDetect = false;
    const sources: ShotSource[] = [];
    for (const [i, shot] of plan.shots.entries()) {
      const id = ids[shot.clip]!;
      const file = files.get(id)!;
      const w = windows[i]!;
      const kind = visualKind(file)!;
      const s = given.get(id);
      if (s) {
        const later = laterBox(s);
        // A box without a time stays put; with one, it is followed from where it was measured.
        const box = s.time === undefined ? s.box : boxAt(s.box, s.time, later, w.start);
        sources.push({ fileId: id, kind, ...w, box, ...(later ? { later } : {}), from: "given" });
        continue;
      }
      const key = `${id}@${kind === "image" ? 0 : round(w.start, 3)}`;
      if (!detected.has(key) && call.host.frames && !cannotDetect) {
        const found = await detectSubjects(call, file, kind === "image" ? 0 : w.start, "circle", { limit: 1 });
        if (typeof found === "string") {
          cannotDetect = true;
          warnings.push(`${found} Shots without a subject box are kept centred.`);
        } else detected.set(key, found[0]?.box ?? null);
      }
      const box = detected.get(key);
      if (box) sources.push({ fileId: id, kind, ...w, box, from: "detected" });
      else {
        if (detected.has(key)) warnings.push(`No circle found in ${displayName(file)} at ${round(w.start, 2)}s: that shot is centred, not aligned.`);
        sources.push({ fileId: id, kind, ...w, box: CENTRED, from: "centred" });
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
    const built = call.commit((tx) => {
      if (tx.project.clips.length > 0) {
        for (const t of [...tx.project.effects]) removeTransition(tx, String(t.id));
        deleteClips(tx, tx.project.clips.map((c) => String(c.id)), { ripple: false });
      }
      const track = montageTracks(tx);
      if (music) placeMusicBed(tx, String(music.id), plan.musicStart, plan.duration, track.music, displayName(music));
      const clips = plan.shots.map((shot, i) => {
        const src = sources[i]!;
        const file = files.get(src.fileId)!;
        const clip = addClip(tx, { fileId: src.fileId, position: shot.start, layer: track.video, start: src.start, end: src.end });
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
      const alignment = alignMatchCut(
        tx,
        clips.map((clip, i) => ({ clipId: String(clip.id), box: sources[i]!.box, time: sources[i]!.start, ...(sources[i]!.later ? { later: sources[i]!.later } : {}) })),
        { target, fit, cover, zoomDrift: args.zoom_drift ?? 0.04 },
      );
      return { clips, alignment, tracks: track, requested: target };
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
    const sfx = plan.shots.slice(1).map((shot) => ({ time: round(shot.start), kind: shot.role === "close" ? "hold" : "cut", accent: shot.onDownbeat || flashShots.has(plan.shots.indexOf(shot)) }));
    const body = plan.shots.filter((s) => s.role === "body");
    return applied(
      MONTAGE,
      `Cut a match-cut montage: ${plan.shots.length} shots (${body.length} of ${minFrames}-${maxFrames} frames) at ${Math.round(plan.bpm)} BPM, ${round(plan.duration, 2)} s, every subject at (${round(built.alignment.target.cx, 3)}, ${round(built.alignment.target.cy, 3)}), ${round(built.alignment.target.size, 3)} of the frame tall${flashes.length ? `, ${flashes.length} flash frame(s)` : ""}.`,
      {
        warnings: [...new Set(warnings)],
        data: {
          duration: round(plan.duration),
          bpm: round(plan.bpm, 2),
          music_file_id: music ? String(music.id) : null,
          music_start: plan.musicStart,
          target: fromTarget(built.alignment.target),
          shots,
          flashes,
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
