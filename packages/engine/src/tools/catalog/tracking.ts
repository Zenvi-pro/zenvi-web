/**
 * Tracking on every surface, and what tracks drive. The tracker
 * (tracking/track.ts) reads frames through `host.frames`, so it runs in
 * render-node, the browser and Zenvi Cloud; every result is written as
 * native transform keyframes (ops/track-follow.ts, ops/zoom-follow.ts), so
 * the desktop plays it without OpenCV data.
 *
 * - track_point_tool: follow a point, a box or a flat surface; reads only.
 * - pin_to_track_tool: a callout or any clip follows a tracked point (or is
 *   fitted onto a tracked surface).
 * - add_guide_overlay_tool: a golden spiral, thirds, reticle, brackets, ring
 *   or guide lines registered to a subject, optionally following it.
 * - hold_point_reframe_tool: the clip counter-moves so a tracked point holds
 *   still on screen while it punches in or the subject moves.
 * - auto_reframe_tool: 16:9 to 9:16 (4:5, 1:1) with a crop that follows the
 *   speaker and alternates medium and close framing.
 * - screen_zoom_follow_tool: eased push-ins on the active part of a screen
 *   recording.
 */

import { z } from "zod";
import type { Transaction } from "../../history/document.js";
import { sourceSecondsAt, sourceToCanvas } from "../../matchcut/fit.js";
import { profilesMatching } from "../../model/profiles.js";
import type { Clip, Layer, Project, ProjectFile } from "../../model/types.js";
import { setProfile } from "../../ops/project.js";
import { addTitleClip } from "../../ops/titles.js";
import { holdOnTrack, pinToTrack, type PinFollow } from "../../ops/track-follow.js";
import { addTrack } from "../../ops/tracks.js";
import { zoomFollow } from "../../ops/zoom-follow.js";
import { activityBetween, planZoomStops, type ActivitySample, type ZoomStop } from "../../tracking/activity.js";
import type { GrayImage } from "../../tracking/gray.js";
import { GUIDE_KINDS, calloutSvg, guideSvg, type GuideKind } from "../../tracking/guides.js";
import { findSkinHead } from "../../tracking/skin.js";
import { boxQuad, quadAngle, quadCenter, quadSize, smoothTrack, trackAt, type Quad, type Track, type TrackModel } from "../../tracking/track.js";
import { frameWindow, localFrame, timelineFrameOf } from "../../timeline/windows.js";
import { fpsOf } from "../../ops/internal.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { applied, failed, refused, unchanged, type CreatedTrack, type ToolReceipt } from "../receipt.js";
import { colourFrame, fileFps, grayFrames, trackFile } from "../track-frames.js";
import { visualKind, writeCard } from "./reels.js";

const TRACK = "track_point_tool";
const PIN = "pin_to_track_tool";
const GUIDE = "add_guide_overlay_tool";
const HOLD = "hold_point_reframe_tool";
const REFRAME = "auto_reframe_tool";
const ZOOM = "screen_zoom_follow_tool";

const HEX = /^#[0-9a-fA-F]{6}$/;
const round = (v: number, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

const pointSchema = z.strictObject({
  x: z.number().min(0).max(1).describe("0-1 of the source frame's width, from the left."),
  y: z.number().min(0).max(1).describe("0-1 of the source frame's height, from the top."),
});
const boxSchema = z.strictObject({
  x: z.number().min(-0.5).max(1.5).describe("Left edge, 0-1 of the source frame's width."),
  y: z.number().min(-0.5).max(1.5).describe("Top edge, 0-1 of the source frame's height."),
  w: z.number().gt(0).max(2).describe("Width, 0-1 of the frame's width."),
  h: z.number().gt(0).max(2).describe("Height, 0-1 of the frame's height."),
});
const canvasPointSchema = z.strictObject({ x: z.number().min(-1).max(2), y: z.number().min(-1).max(2) });

const regionShape = {
  point: pointSchema.optional().describe("A point to follow on the source frame (a face, a fingertip, a product part). Read it off a frame's 0-1 grid (inspect_media_tool, preview_frame)."),
  box: boxSchema.optional().describe("A box to follow on the source frame (a head, a product, a UI card)."),
  quad: z
    .array(pointSchema)
    .length(4)
    .optional()
    .describe("A flat surface to follow (a screen, a card, a floor patch): its corners top-left, top-right, bottom-right, bottom-left on the source frame, tracked with an affine fit."),
  time: z.number().min(0).optional().describe("Source seconds the point/box/quad is given at (default: the clip's first visible frame). Tracking runs forwards and backwards from here."),
  smoothing: z.number().min(0).max(2).optional().describe("Gaussian smoothing of the track, seconds (default per tool: removes tracker jitter and hand-held shake, keeps the subject's own motion)."),
};

type RegionArgs = z.infer<z.ZodObject<typeof regionShape>>;

/** A point is tracked as a square this tall (fraction of the frame height): enough texture to hold on to. */
const POINT_SIZE = 0.08;
const MAX_RATE = 30;

interface Footage {
  clip: Clip;
  file: ProjectFile;
  kind: "video" | "image";
  /** Visible clip frames. */
  firstFrame: number;
  lastFrame: number;
  /** Source seconds shown on those frames. */
  start: number;
  end: number;
}

function footageOf(project: Project, clipId: string): Footage | string {
  const clip = project.clips.find((c) => String(c.id) === clipId);
  if (!clip) return `Error: unknown clip_id ${clipId}.`;
  const file = project.files.find((f) => String(f.id) === String(clip.file_id));
  const kind = file ? visualKind(file) : null;
  if (!file || !kind) return `Error: clip ${clipId} has no picture to track.`;
  const w = frameWindow(clip, fpsOf(project));
  if (w.endFrame < w.startFrame) return `Error: clip ${clipId} is empty.`;
  const firstFrame = w.localStartFrame;
  const lastFrame = localFrame(w, w.endFrame);
  const a = sourceSecondsAt(project, clip, firstFrame);
  const b = sourceSecondsAt(project, clip, lastFrame);
  return { clip, file, kind, firstFrame, lastFrame, start: Math.min(a, b), end: Math.max(a, b) };
}

function aspectOfFile(file: ProjectFile): number {
  const w = Number(file.width);
  const h = Number(file.height);
  return w > 0 && h > 0 ? w / h : 16 / 9;
}

/** The region the call names, on the source frame, or an "Error: …" string. */
function regionQuad(args: RegionArgs, aspect: number): { quad: Quad; model: TrackModel } | string {
  const given = [args.point, args.box, args.quad].filter((v) => v !== undefined).length;
  if (given !== 1) return "Error: give exactly one of point, box or quad.";
  if (args.point) {
    const h = POINT_SIZE;
    const w = POINT_SIZE / aspect;
    return { quad: boxQuad(args.point.x - w / 2, args.point.y - h / 2, w, h), model: "similarity" };
  }
  if (args.box) {
    const c = { x: args.box.x + args.box.w / 2, y: args.box.y + args.box.h / 2 };
    if (c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1) return "Error: the box's centre must be on the frame (0-1).";
    return { quad: boxQuad(args.box.x, args.box.y, args.box.w, args.box.h), model: "similarity" };
  }
  const q = args.quad! as Quad;
  const size = quadSize(q, aspect);
  if (!(size.w > 0.01 && size.h > 0.01)) return "Error: the quad is too small to track (at least 1 % of the frame each way).";
  return { quad: q, model: "affine" };
}

/** Why a call got no track: its own arguments (refused) or reading the footage (failed). */
interface TrackProblem {
  status: "refused" | "error";
  message: string;
}

function isProblem(track: Track | TrackProblem): track is TrackProblem {
  return "status" in track;
}

function problemReceipt(tool: string, problem: TrackProblem, prefix = ""): ToolReceipt {
  const message = `${prefix}${problem.message}`;
  return problem.status === "refused" ? refused(tool, message) : failed(tool, message);
}

/** The track of the region the call names on `foot`, smoothed; a still image gives a constant track. */
async function trackOf(call: ToolCall, foot: Footage, args: RegionArgs, defaultSmoothing: number): Promise<Track | TrackProblem> {
  const region = regionQuad(args, aspectOfFile(foot.file));
  if (typeof region === "string") return { status: "refused", message: region };
  const time = args.time ?? foot.start;
  const aspect = aspectOfFile(foot.file);
  if (foot.kind === "image") return { model: region.model, aspect, samples: [{ time: 0, quad: region.quad, lost: false, score: 1 }] };
  if (time < foot.start - 1e-3 || time > foot.end + 1e-3) {
    return { status: "refused", message: `Error: time ${time}s is outside clip ${String(foot.clip.id)}'s source window ${round(foot.start, 3)}-${round(foot.end, 3)}s.` };
  }
  const track = await trackFile(call, foot.file, {
    quad: region.quad,
    time,
    start: foot.start,
    end: foot.end,
    rate: Math.min(MAX_RATE, fileFps(foot.file) ?? MAX_RATE),
    model: region.model,
  });
  if (typeof track === "string") return { status: "error", message: track };
  return smoothTrack(track, args.smoothing ?? defaultSmoothing);
}

/** FNV-1a of a generated graphic, so two different graphics never share a file name. */
function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The receipt row of a track this call added. */
function trackReceipt(tx: Transaction, layer: Layer): CreatedTrack {
  const index = [...tx.project.layers].sort((a, b) => Number(a.number) - Number(b.number)).findIndex((l) => l.id === layer.id);
  return { index, id: String(layer.id), layer: layer.number };
}

/** Source-second spans where the tracker lost the region. */
function lostSpans(track: Track): [number, number][] {
  const spans: [number, number][] = [];
  for (const s of track.samples) {
    if (!s.lost) continue;
    const last = spans[spans.length - 1];
    if (last && s.time - last[1] < 0.2) last[1] = s.time;
    else spans.push([s.time, s.time]);
  }
  return spans.map(([a, b]) => [round(a, 3), round(b, 3)]);
}

function trackWarnings(track: Track): string[] {
  const lost = track.samples.filter((s) => s.lost).length;
  if (lost === 0) return [];
  const share = lost / track.samples.length;
  return [
    `The tracker lost the region on ${Math.round(share * 100)} % of the samples (${lostSpans(track)
      .map(([a, b]) => `${a}-${b}s`)
      .join(", ")}): it holds there. Give a larger or more textured region, or split the clip at the occlusion.`,
  ];
}

// ---------------------------------------------------------------------------
// track_point_tool
// ---------------------------------------------------------------------------

const trackInput = z.strictObject({
  clip_id: z.string().min(1).describe("The timeline clip whose picture to track (its visible source window is tracked)."),
  ...regionShape,
  max_samples: z.number().int().min(2).max(300).optional().describe("Rows returned (default 40), evenly spaced; the full-rate track is cached for the pin/reframe tools."),
});

const trackTool = directTool({
  name: TRACK,
  title: "Track a point, box or surface",
  description:
    "Follow a point, a box or a flat surface (quad) through a clip's footage, on any Zenvi surface (pyramidal Lucas-Kanade with forward-backward checks; affine for quads). " +
    "Returns its centre, size and angle over source time (0-1 of the source frame) and where it was lost. Reads only; pin_to_track_tool, add_guide_overlay_tool and hold_point_reframe_tool reuse the track.",
  input: trackInput,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  requires: ["frames"],
  run: async (call, args: z.infer<typeof trackInput>) => {
    const foot = footageOf(call.doc.project, args.clip_id);
    if (typeof foot === "string") return refused(TRACK, foot);
    const region = regionQuad(args, aspectOfFile(foot.file));
    if (typeof region === "string") return refused(TRACK, region);
    const track = await trackOf(call, foot, args, 0);
    if (isProblem(track)) return problemReceipt(TRACK, track);
    const rows = Math.min(args.max_samples ?? 40, track.samples.length);
    const pick = Array.from({ length: rows }, (_, i) => track.samples[Math.round((i * (track.samples.length - 1)) / Math.max(1, rows - 1))]!);
    const samples = pick.map((s) => {
      const c = quadCenter(s.quad);
      const size = quadSize(s.quad, track.aspect);
      return {
        t: round(s.time, 3),
        x: round(c.x),
        y: round(c.y),
        w: round(size.w),
        h: round(size.h),
        angle: round(quadAngle(s.quad, track.aspect), 2),
        ...(track.model === "affine" ? { quad: s.quad.map((p) => ({ x: round(p.x), y: round(p.y) })) } : {}),
        ...(s.lost ? { lost: true } : {}),
      };
    });
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    return applied(
      TRACK,
      `Tracked ${args.clip_id} over ${round(foot.end - foot.start, 2)} s (${track.samples.length} samples, ${track.model}): from (${first.x}, ${first.y}) to (${last.x}, ${last.y}).`,
      { warnings: trackWarnings(track), data: { clip_id: args.clip_id, file_id: String(foot.file.id), model: track.model, samples, lost: lostSpans(track) } },
      0,
    );
  },
});

// ---------------------------------------------------------------------------
// pin_to_track_tool
// ---------------------------------------------------------------------------

const FOLLOWS = ["position", "position_scale", "position_scale_rotation", "surface"] as const;

const pinInput = z.strictObject({
  footage_clip_id: z.string().min(1).describe("The timeline clip whose picture is tracked."),
  ...regionShape,
  clip_id: z.string().min(1).optional().describe("The clip that follows (a title, a motion block, an image, a video on a higher track). Omit and give label to create a callout."),
  label: z.string().max(80).optional().describe("Create a callout that follows the point: a dot on it, a leader line and this label (empty string: dot and line only)."),
  follow: z
    .enum(FOLLOWS)
    .optional()
    .describe(
      "position (default; quad default: surface): the clip's anchor rides on the tracked point; position_scale: it also grows and shrinks with the subject; position_scale_rotation: and turns with it; " +
        "surface: the clip's whole frame is fitted onto the tracked quad with scale, rotation and shear (the affine part of a corner pin: libopenshot renders no perspective).",
    ),
  anchor: pointSchema.optional().describe("The point of the following clip's own frame that sits on the track (0-1, default its centre; a callout's anchor is its dot)."),
  offset: canvasPointSchema.optional().describe("Added to the tracked point, fractions of the canvas (x right, y down): a label beside the subject rather than on it."),
  label_offset: canvasPointSchema.optional().describe("Callout: where the leader line ends relative to the dot, fractions of the canvas (default x 0.12, y -0.12: up and right)."),
  color: z.string().max(16).optional().describe("Callout colour, #RRGGBB (default #FFFFFF)."),
  mono: z.boolean().optional().describe("Callout label in monospace (HUD look). Default false."),
  start: z.number().min(0).optional().describe("Callout: timeline seconds it appears (default the footage clip's start)."),
  duration: z.number().gt(0).optional().describe("Callout: seconds it stays (default to the footage clip's end)."),
});

const pinTool = directTool({
  name: PIN,
  title: "Pin a clip to a tracked point",
  description:
    "Make a callout, title, motion block or any clip follow a point, box or surface tracked in another clip's footage: writes location (and scale, rotation, shear) keyframes, one undo step, playable on every surface and the desktop. " +
    "label creates a callout (dot, leader line, label) on a new top track. A quad with follow=surface lays the clip onto a moving screen, card or floor (affine fit).",
  input: pinInput,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  requires: ["frames"],
  run: async (call, args: z.infer<typeof pinInput>) => {
    const project = call.doc.project;
    if (args.color !== undefined && !HEX.test(args.color)) return refused(PIN, `Error: color must be #RRGGBB (got ${args.color}).`);
    if ((args.clip_id === undefined) === (args.label === undefined)) return refused(PIN, "Error: give exactly one of clip_id (a clip to pin) or label (a new callout).");
    if (args.label !== undefined && !call.host.media?.writeGenerated) return refused(PIN, "Error: this Zenvi surface cannot write the callout graphic; pin an existing clip with clip_id.");
    const foot = footageOf(project, args.footage_clip_id);
    if (typeof foot === "string") return refused(PIN, foot);
    if (args.clip_id && !project.clips.some((c) => String(c.id) === args.clip_id)) return refused(PIN, `Error: unknown clip_id ${args.clip_id}.`);
    const follow: PinFollow = args.follow ?? (args.quad ? "surface" : "position");
    if (follow === "surface" && !args.quad) return refused(PIN, "Error: follow=surface needs a quad (the surface's four corners).");
    const track = await trackOf(call, foot, args, 0.08);
    if (isProblem(track)) return problemReceipt(PIN, track);

    const W = Number(project.width) || 1920;
    const H = Number(project.height) || 1080;
    let card: Awaited<ReturnType<typeof writeCard>> | undefined;
    if (args.label !== undefined) {
      const lo = args.label_offset ?? { x: 0.12, y: -0.12 };
      const svg = calloutSvg(W, H, args.label, lo.x * W, lo.y * H, { color: args.color ?? "#FFFFFF", stroke: Math.max(2, H * 0.003), fontSize: H * 0.035, mono: args.mono ?? false });
      card = await writeCard(call, `tracked-callout-${contentHash(svg)}.svg`, svg);
    }
    const footClip = foot.clip;
    const result = call.commit((tx: Transaction) => {
      let clipId = args.clip_id;
      let createdTrack: CreatedTrack | undefined;
      if (card) {
        const position = args.start ?? Number(footClip.position);
        const end = Number(footClip.position) + (Number(footClip.end) - Number(footClip.start));
        const duration = args.duration ?? Math.max(1 / 30, end - position);
        const layer = addTrack(tx, { label: "Callouts" });
        createdTrack = trackReceipt(tx, layer);
        clipId = String(addTitleClip(tx, { file: card, position, duration, layer: layer.number, title: args.label || "Callout" }).clip.id);
      }
      const pin = pinToTrack(tx, { clipId: clipId!, footageId: String(footClip.id), track, follow, ...(args.anchor ? { anchor: args.anchor } : {}), ...(args.offset ? { offset: args.offset } : {}) });
      return { pin, createdTrack };
    }, "Pin to track");
    const { pin } = result;
    const warnings = trackWarnings(track);
    if (pin.outside > 0) warnings.push(`${pin.outside} keyframe(s) fall outside ${args.footage_clip_id}'s window: the pinned clip holds the track's end there.`);
    return applied(
      PIN,
      `Pinned ${pin.clipId} to a ${follow} track of ${args.footage_clip_id}: ${pin.frames.length} keyframes, from (${round(pin.first.x, 3)}, ${round(pin.first.y, 3)}) to (${round(pin.last.x, 3)}, ${round(pin.last.y, 3)}) of the canvas.`,
      {
        warnings,
        ...(result.createdTrack !== undefined ? { createdTracks: [result.createdTrack] } : {}),
        data: { clip_id: pin.clipId, created: card !== undefined, follow, keyframe_frames: pin.frames.length, first: { x: round(pin.first.x), y: round(pin.first.y) }, last: { x: round(pin.last.x), y: round(pin.last.y) } },
      },
    );
  },
});

// ---------------------------------------------------------------------------
// add_guide_overlay_tool
// ---------------------------------------------------------------------------

const GUIDE_FOLLOWS = ["none", "position", "position_scale", "position_scale_rotation"] as const;

const guideInput = z.strictObject({
  kind: z
    .enum(GUIDE_KINDS)
    .describe(
      "golden_spiral: a Fibonacci spiral (with its squares) whose eye sits on the subject; thirds: the subject's box split in thirds; crosshair: a reticle; brackets: four HUD corner brackets; ring: an ellipse around it; lines: guide lines through it across the frame.",
    ),
  clip_id: z.string().min(1).describe("The timeline clip whose subject the guide registers to."),
  ...regionShape,
  angle: z.number().min(-360).max(360).optional().describe("Turn the graphic, degrees clockwise (default 0; a pose's lean, a spiral's orientation)."),
  follow: z.enum(GUIDE_FOLLOWS).optional().describe("none (default): drawn where the subject is at time; position / position_scale / position_scale_rotation: tracked and keyframed to follow it."),
  color: z.string().max(16).optional().describe("Stroke colour, #RRGGBB (default #FFFFFF)."),
  stroke_width: z.number().gt(0).max(40).optional().describe("Stroke width, canvas pixels (default 0.35 % of the canvas height)."),
  padding: z.number().min(0.5).max(4).optional().describe("The graphic's box is the subject's box times this (default 1.25; 1 hugs it)."),
  flip_x: z.boolean().optional().describe("golden_spiral: mirror left-right (where the spiral sweeps from)."),
  flip_y: z.boolean().optional().describe("golden_spiral: mirror top-bottom."),
  spiral_height: z.number().gt(0).max(3).optional().describe("golden_spiral: height of its golden rectangle, fraction of the canvas height (default 1)."),
  start: z.number().min(0).optional().describe("Timeline seconds it appears (default the clip's start)."),
  duration: z.number().gt(0).optional().describe("Seconds it stays (default to the clip's end)."),
});

const guideTool = directTool({
  name: GUIDE,
  title: "Draw a guide on a subject",
  description:
    "Register a guide graphic to a subject: golden spiral (eye on the subject), thirds grid, reticle, HUD brackets, ring or guide lines, as a transparent title on a new top track; " +
    "drawn where the subject is, or tracked so it follows (keyframes). Shape-registered match cuts, schematic and HUD inserts. One undo step.",
  input: guideInput,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  requires: ["frames"],
  run: async (call, args: z.infer<typeof guideInput>) => {
    const project = call.doc.project;
    if (args.color !== undefined && !HEX.test(args.color)) return refused(GUIDE, `Error: color must be #RRGGBB (got ${args.color}).`);
    if (!call.host.media?.writeGenerated) return refused(GUIDE, "Error: this Zenvi surface cannot write the guide graphic.");
    const foot = footageOf(project, args.clip_id);
    if (typeof foot === "string") return refused(GUIDE, foot);
    const follow = args.follow ?? "none";
    const region = regionQuad(args, aspectOfFile(foot.file));
    if (typeof region === "string") return refused(GUIDE, region);
    const W = Number(project.width) || 1920;
    const H = Number(project.height) || 1080;
    const position = args.start ?? Number(foot.clip.position);
    const clipEnd = Number(foot.clip.position) + (Number(foot.clip.end) - Number(foot.clip.start));
    const duration = args.duration ?? Math.max(1 / 30, clipEnd - position);

    let track: Track;
    if (follow === "none") {
      track = { model: region.model, aspect: aspectOfFile(foot.file), samples: [{ time: args.time ?? foot.start, quad: region.quad, lost: false, score: 1 }] };
    } else {
      const t = await trackOf(call, foot, args, 0.1);
      if (isProblem(t)) return problemReceipt(GUIDE, t);
      track = t;
    }
    // The subject on the canvas where the guide first shows: at time for a static guide, else at the guide's first frame.
    const fps = fpsOf(project);
    const fw = frameWindow(foot.clip, fps);
    const guideFrame = Math.round(position * (fps.num / fps.den)) + 1;
    const footFrame = localFrame(fw, Math.min(Math.max(guideFrame, fw.startFrame), fw.endFrame));
    const t0 = follow === "none" ? (args.time ?? sourceSecondsAt(project, foot.clip, footFrame)) : sourceSecondsAt(project, foot.clip, footFrame);
    const map = sourceToCanvas(project, foot.clip, footFrame);
    const q = trackAt(track, t0).map((p) => {
      const [x, y] = map(p.x, p.y);
      return { x, y };
    });
    const c = quadCenter(q);
    const size = quadSize(q);
    const pad = args.padding ?? 1.25;
    const angle = (args.angle ?? 0) + (follow === "position_scale_rotation" ? quadAngle(q, 1) : 0);
    const placement = { cx: follow === "none" ? c.x : W / 2, cy: follow === "none" ? c.y : H / 2, w: size.w * pad, h: size.h * pad, angle };
    const svg = guideSvg(args.kind as GuideKind, W, H, placement, {
      color: args.color ?? "#FFFFFF",
      stroke: args.stroke_width ?? Math.max(1.5, H * 0.0035),
      flipX: args.flip_x ?? false,
      flipY: args.flip_y ?? false,
      spiralHeight: (args.spiral_height ?? 1) * H,
    });
    const card = await writeCard(call, `guide-${args.kind}-${contentHash(svg)}.svg`, svg);
    const result = call.commit((tx: Transaction) => {
      const layer = addTrack(tx, { label: "Guides" });
      const clip = addTitleClip(tx, { file: card, position, duration, layer: layer.number, title: `Guide: ${args.kind}` }).clip;
      const pin = follow === "none" ? undefined : pinToTrack(tx, { clipId: String(clip.id), footageId: String(foot.clip.id), track, follow });
      return { clipId: String(clip.id), layer: layer.number, created: trackReceipt(tx, layer), pin };
    }, `Add ${args.kind} guide`);
    return applied(
      GUIDE,
      `Added a ${args.kind} guide (${result.clipId}) on ${args.clip_id}'s subject at (${round(c.x / W, 3)}, ${round(c.y / H, 3)})${result.pin ? `, following it with ${result.pin.frames.length} keyframes` : ""}.`,
      {
        warnings: follow === "none" ? [] : trackWarnings(track),
        createdTracks: [result.created],
        data: { clip_id: result.clipId, kind: args.kind, follow, center: { x: round(c.x / W), y: round(c.y / H) }, size: { w: round(placement.w / W), h: round(placement.h / H) } },
      },
    );
  },
});

// ---------------------------------------------------------------------------
// hold_point_reframe_tool
// ---------------------------------------------------------------------------

const holdInput = z.strictObject({
  clip_id: z.string().min(1).describe("The clip to reframe (its own picture is tracked)."),
  ...regionShape,
  target: z
    .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .optional()
    .describe("Where the tracked point stays, 0-1 of the canvas (default: where it is drawn on the clip's first frame)."),
  zoom: z.number().min(0.2).max(6).optional().describe("Scale relative to the clip's current scale on its first frame (default 1; 1.3 = a 130 % punch-in)."),
  zoom_end: z.number().min(0.2).max(6).optional().describe("Scale at the clip's end, ramped from zoom (a slow push about the point). Default: zoom."),
  keep_size: z.boolean().optional().describe("Scale against the subject's own size so it stays the same size on screen (it walks towards camera: the frame widens)."),
  allow_edges: z.boolean().optional().describe("Allow the canvas to show around the clip instead of zooming in to cover it. Default false."),
});

const holdTool = directTool({
  name: HOLD,
  title: "Hold a tracked point still",
  description:
    "Reframe a clip so a tracked point (a face, a pivot foot, a product) stays at one place on the canvas while the subject moves or the shot punches in: " +
    "writes scale/location keyframes from the clip's own track, zooming just enough to keep the frame covered. Digital punch-ins (zoom 1.15-1.4 on a split), anchored slow motion. One undo step.",
  input: holdInput,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  requires: ["frames"],
  run: async (call, args: z.infer<typeof holdInput>) => {
    const foot = footageOf(call.doc.project, args.clip_id);
    if (typeof foot === "string") return refused(HOLD, foot);
    const track = await trackOf(call, foot, args, 0.25);
    if (isProblem(track)) return problemReceipt(HOLD, track);
    const zoom = args.zoom ?? 1;
    const zoomEnd = args.zoom_end ?? zoom;
    const result = call.commit(
      (tx: Transaction) =>
        holdOnTrack(tx, {
          clipId: args.clip_id,
          track,
          ...(args.target ? { target: args.target } : {}),
          scaleAt: (_n, progress, base) => base * (zoom + (zoomEnd - zoom) * progress),
          keepSize: args.keep_size ?? false,
          cover: args.allow_edges ? "none" : "zoom",
        }),
      "Hold tracked point",
    );
    const warnings = trackWarnings(track);
    if (result.coverZoomed > 0) warnings.push(`Zoomed in further on ${result.coverZoomed} of ${result.frames.length} keyframes to keep the frame covered.`);
    if (result.scaleRange[1] > 3) warnings.push(`Scaled up to ${round(result.scaleRange[1], 2)}×: it may look soft.`);
    return applied(
      HOLD,
      `Held ${args.clip_id}'s tracked point at (${round(result.target.x, 3)}, ${round(result.target.y, 3)}) with ${result.frames.length} keyframes, scale ${round(result.scaleRange[0], 3)}-${round(result.scaleRange[1], 3)}.`,
      { warnings, data: { clip_id: args.clip_id, target: { x: round(result.target.x), y: round(result.target.y) }, keyframe_frames: result.frames.length, scale: result.scaleRange.map((v) => round(v)), cover_zoomed: result.coverZoomed } },
    );
  },
});

// ---------------------------------------------------------------------------
// auto_reframe_tool
// ---------------------------------------------------------------------------

const ASPECTS = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080] } as const;

const reframeInput = z.strictObject({
  aspect: z.enum(["9:16", "4:5", "1:1"]).optional().describe("The new frame (default 9:16, 1080×1920 at the project's frame rate)."),
  clip_ids: z.array(z.string().min(1)).max(200).optional().describe("Clips to reframe (default every video and image clip)."),
  subjects: z
    .array(
      z.strictObject({
        clip_id: z.string().min(1),
        point: pointSchema.optional(),
        box: boxSchema.optional().describe("The speaker's face/head box on the source frame (best)."),
        time: z.number().min(0).optional(),
      }),
    )
    .max(200)
    .optional()
    .describe("The subject per clip. Clips without one look for the largest skin-toned head high in the frame, else stay centred."),
  follow: z.boolean().optional().describe("Track the subject so the crop follows it (default true); false: a fixed crop on it."),
  close_zoom: z.number().min(1).max(2.5).optional().describe("Close framing is this much tighter than medium (default 1.3)."),
  rhythm_seconds: z.number().min(0).max(30).optional().describe("Alternate medium and close framing every this many seconds of each clip, as jump-cut punch-ins (default 4; 0 = medium only)."),
  head_y: z.number().min(0.1).max(0.9).optional().describe("Where the face sits, 0-1 of the new frame's height (default 0.38: eyes on the upper third)."),
  smoothing: z.number().min(0).max(3).optional().describe("Smoothing of the follow, seconds (default 0.6: a calm virtual camera)."),
});

const reframeTool = directTool({
  name: REFRAME,
  title: "Auto reframe to vertical",
  description:
    "Turn a 16:9 edit vertical (9:16, 4:5 or 1:1): switches the project profile and gives every clip a crop that follows the speaker's face (tracked), alternating medium and close framing on a rhythm. " +
    "Native scale/location keyframes, one undo step. Pass face boxes in subjects when you can see them; otherwise a skin-tone head finder is used and reported.",
  input: reframeInput,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  requires: ["frames"],
  run: async (call, args: z.infer<typeof reframeInput>) => {
    const project = call.doc.project;
    const [width, height] = ASPECTS[args.aspect ?? "9:16"];
    const profile = profilesMatching(width, height, project.fps)[0];
    if (!profile) return refused(REFRAME, `Error: no ${width}×${height} profile at ${project.fps.num}/${project.fps.den} fps.`);
    const ids =
      args.clip_ids ??
      project.clips
        .filter((c) => {
          const f = project.files.find((file) => String(file.id) === String(c.file_id));
          return f !== undefined && visualKind(f) !== null && !/\.svgz?$/i.test(String(f.path));
        })
        .map((c) => String(c.id));
    if (ids.length === 0) return refused(REFRAME, "Error: no video or image clips to reframe.");
    const bySubject = new Map((args.subjects ?? []).map((s) => [s.clip_id, s]));
    const follow = args.follow ?? true;
    const plans: { clipId: string; track: Track; source: "given" | "skin" | "centre" }[] = [];
    for (const id of ids) {
      const foot = footageOf(project, id);
      if (typeof foot === "string") return refused(REFRAME, foot);
      const given = bySubject.get(id);
      let region: RegionArgs;
      let source: "given" | "skin" | "centre" = "given";
      if (given) {
        region = { ...(given.point ? { point: given.point } : {}), ...(given.box ? { box: given.box } : {}), ...(given.time !== undefined ? { time: given.time } : {}) };
      } else {
        let head: ReturnType<typeof findSkinHead> = null;
        try {
          head = findSkinHead(await colourFrame(call, foot.file, foot.start, 320));
        } catch (error) {
          call.host.log?.(`skin search in ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        source = head ? "skin" : "centre";
        region = { box: head?.box ?? { x: 0.4, y: 0.25, w: 0.2, h: 0.3 }, time: foot.start };
      }
      region.smoothing = args.smoothing ?? 0.6;
      let track: Track | TrackProblem;
      if (follow && source !== "centre") track = await trackOf(call, foot, region, 0.6);
      else {
        const q = regionQuad(region, aspectOfFile(foot.file));
        track = typeof q === "string" ? { status: "refused", message: q } : { model: q.model, aspect: aspectOfFile(foot.file), samples: [{ time: foot.start, quad: q.quad, lost: false, score: 1 }] };
      }
      if (isProblem(track)) return problemReceipt(REFRAME, track, `${id}: `);
      plans.push({ clipId: id, track, source });
    }
    const close = args.close_zoom ?? 1.3;
    const rhythm = args.rhythm_seconds ?? 4;
    const headY = args.head_y ?? 0.38;
    const result = call.commit((tx: Transaction) => {
      if (tx.project.width !== width || tx.project.height !== height) setProfile(tx, profile.key);
      const fps = fpsOf(tx.project);
      const rate = fps.num / fps.den;
      return plans.map((p) => {
        const clip = tx.project.clips.find((c) => String(c.id) === p.clipId)!;
        const w = frameWindow(clip, fps);
        const beat = Math.max(1, Math.round(rhythm * rate));
        const isClose = (n: number) => rhythm > 0 && Math.floor((timelineFrameOf(w, n) - w.startFrame) / beat) % 2 === 1;
        // Key both sides of every switch so the change lands on one frame, like a cut.
        const extra: number[] = [];
        if (rhythm > 0) for (let f = w.startFrame + beat; f <= w.endFrame; f += beat) extra.push(localFrame(w, f) - 1, localFrame(w, f));
        const hold = holdOnTrack(tx, {
          clipId: p.clipId,
          track: p.track,
          target: { x: 0.5, y: headY },
          scaleAt: () => 0,
          coverZoom: (n) => (isClose(n) ? close : 1),
          cover: "zoom",
          extraFrames: extra,
        });
        return { ...hold, source: p.source, closeShare: rhythm > 0 ? 0.5 : 0 };
      });
    }, `Auto reframe ${args.aspect ?? "9:16"}`);
    const warnings = plans.flatMap((p) => trackWarnings(p.track).map((w) => `${p.clipId}: ${w}`));
    const guessed = plans.filter((p) => p.source !== "given");
    if (guessed.length > 0) warnings.push(`No subject given for ${guessed.map((p) => `${p.clipId} (${p.source === "skin" ? "skin-tone head" : "none found, centred"})`).join(", ")}: check a frame (preview_frame) and pass face boxes in subjects if the crop misses.`);
    return applied(
      REFRAME,
      `Reframed ${result.length} clip(s) to ${width}×${height}: the crop follows ${follow ? "the tracked subject" : "the subject (fixed)"}${rhythm > 0 ? `, close (${close}×) every other ${rhythm} s` : ""}.`,
      {
        warnings,
        data: { profile: profile.key, width, height, clips: result.map((r) => ({ clip_id: r.clipId, keyframe_frames: r.frames.length, scale: r.scaleRange.map((v) => round(v)), subject: r.source })) },
      },
    );
  },
});

// ---------------------------------------------------------------------------
// screen_zoom_follow_tool
// ---------------------------------------------------------------------------

/** Activity is measured on frames this wide: a UI element still spans several grid cells. */
const ACTIVITY_EDGE = 320;

const zoomInput = z.strictObject({
  clip_id: z.string().min(1).describe("The screen recording on the timeline."),
  zoom: z.number().min(1.05).max(3).optional().describe("Scale on each stop (default 1.3; references push in 120-140 %)."),
  ease: z.number().gt(0).max(2).optional().describe("Seconds each push, pan and pull takes (default 0.45)."),
  min_hold: z.number().min(0.3).max(10).optional().describe("Shortest hold on a stop, seconds (default 1.2)."),
  cursor: z
    .array(z.strictObject({ t: z.number().min(0).describe("Source seconds."), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .max(5000)
    .optional()
    .describe("Cursor or click positions over source time (0-1 of the recording), e.g. from the recorder's event log: these choose the stops instead of the picture."),
  stops: z
    .array(z.strictObject({ start: z.number().min(0), end: z.number().min(0), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .max(200)
    .optional()
    .describe("Zoom stops by hand (source seconds, 0-1 point): no analysis."),
  rate: z.number().min(1).max(15).optional().describe("Frames per second the activity analysis reads (default 6)."),
});

async function activitySamples(call: ToolCall, file: ProjectFile, start: number, end: number, rate: number): Promise<ActivitySample[]> {
  const times: number[] = [];
  for (let t = start; t <= end + 1e-6; t += 1 / rate) times.push(t);
  const out: ActivitySample[] = [];
  let prev: GrayImage | undefined;
  let i = 0;
  for await (const gray of grayFrames(call, file, times, ACTIVITY_EDGE)) {
    if (prev) out.push(activityBetween(prev, gray, times[i]!));
    prev = gray;
    i += 1;
  }
  return out;
}

const zoomTool = directTool({
  name: ZOOM,
  title: "Smart zoom a screen recording",
  description:
    "Push in on the active part of a screen recording (typing, a toggle, a number changing, the cursor) and pan or pull back between: eased scale/location keyframes at 120-140 %, holds of 1.2 s or more. " +
    "Stops come from the picture (what changes), from cursor positions, or by hand. One undo step; no drawn cursor.",
  input: zoomInput,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  requires: ["frames"],
  run: async (call, args: z.infer<typeof zoomInput>) => {
    const foot = footageOf(call.doc.project, args.clip_id);
    if (typeof foot === "string") return refused(ZOOM, foot);
    if (foot.kind !== "video" && !args.stops) return refused(ZOOM, `Error: ${args.clip_id} is a still image: give stops by hand.`);
    const bad = args.stops?.find((s) => !(s.end > s.start));
    if (bad) return refused(ZOOM, `Error: stop ${bad.start}-${bad.end}s must end after it starts.`);
    // zoomFollow keys stops in start order: an overlap would key a later stop before an earlier one ends and jump back.
    const sorted = [...(args.stops ?? [])].sort((a, b) => a.start - b.start);
    const overlap = sorted.findIndex((s, i) => i > 0 && s.start < sorted[i - 1]!.end);
    if (overlap > 0) return refused(ZOOM, `Error: stops ${sorted[overlap - 1]!.start}-${sorted[overlap - 1]!.end}s and ${sorted[overlap]!.start}-${sorted[overlap]!.end}s overlap.`);
    let stops: ZoomStop[];
    let from: "stops" | "cursor" | "picture" = "stops";
    if (args.stops) stops = args.stops;
    else {
      const cursor = args.cursor?.length ? args.cursor : undefined;
      const samples = cursor ? [] : await activitySamples(call, foot.file, foot.start, foot.end, args.rate ?? 6).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
      if (typeof samples === "string") return failed(ZOOM, `Error: could not read ${args.clip_id}'s frames: ${samples}`);
      from = cursor ? "cursor" : "picture";
      stops = planZoomStops(samples, (cursor ?? []).map((c) => ({ time: c.t, x: c.x, y: c.y })), { minHold: args.min_hold ?? 1.2 });
    }
    if (stops.length === 0) return unchanged(ZOOM, `Found nothing to zoom on in ${args.clip_id} (no focused activity); nothing changed. Give cursor positions or stops.`, { data: { clip_id: args.clip_id, stops: [] } });
    // grayFrames stops early on cancel: partial activity must not become zoom stops.
    if (call.signal?.aborted) return refused(ZOOM, "Error: cancelled; nothing changed");
    const result = call.commit((tx: Transaction) => zoomFollow(tx, { clipId: args.clip_id, stops, zoom: args.zoom ?? 1.3, ease: args.ease ?? 0.45 }), "Screen zoom follow");
    if (result.frames.length === 0) return unchanged(ZOOM, `No stop falls inside ${args.clip_id}'s window; nothing changed.`, { data: { clip_id: args.clip_id, stops: [] } });
    return applied(ZOOM, `Zoomed ${args.clip_id} onto ${result.stops.length} stop(s) from the ${from} (${args.zoom ?? 1.3}×, ${result.frames.length} keyframes).`, {
      data: { clip_id: args.clip_id, from, stops: result.stops.map((s) => ({ start: round(s.start, 3), end: round(s.end, 3), x: round(s.x), y: round(s.y) })) },
    });
  },
});

export const trackingTools: CatalogTool[] = [trackTool, pinTool, guideTool, holdTool, reframeTool, zoomTool];
