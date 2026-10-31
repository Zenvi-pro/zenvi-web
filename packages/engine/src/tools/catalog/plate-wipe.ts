/**
 * add_plate_wipe_tool: the occluder plate wipe (ops/plate-wipe.ts) on one
 * cut. Direct tool (not in the desktop contract). The plate is a drawn shape
 * (an original SVG written to the project's assets) or a media-bin sprite;
 * the receipt carries sfx_cues (a whoosh as it grows, a hit as it covers).
 */

import { z } from "zod";
import { isAudioOnlyMedia } from "../../model/media.js";
import type { Project, ProjectFile } from "../../model/types.js";
import { addFile } from "../../ops/files.js";
import { isOpError } from "../../ops/errors.js";
import { rateOf } from "../../ops/internal.js";
import { cutNear, sceneCuts, trackCuts, type MotionCut } from "../../ops/motion-transitions.js";
import { PLATE_EXITS, applyPlateWipe, coverScaleFor, planPlateWipe, type PlateWipeInput } from "../../ops/plate-wipe.js";
import { PLATE_SHAPES, plateSvg } from "../../transitions/plates.js";
import { directTool, unavailable, type CatalogTool } from "../define.js";
import { generatedSvg } from "../mattes.js";
import { applied, refused } from "../receipt.js";
import { colorHexAlpha, planOverlayTrack, projectSize, trackInfo } from "../titles-text.js";
import { ToolError, resolveLayer, trackName } from "./timeline-edit-common.js";

const TOOL = "add_plate_wipe_tool";
/** A sprite's cover scale when none is given: its opaque core is unknown, so it grows well past the frame. */
const SPRITE_COVER = 3;
/** Largest drawing side, px: past that the plate's raster is scaled up (its edge is a soft blob anyway). */
const MAX_SIDE = 4096;

const input = z.strictObject({
  clip1_id: z.string().max(64).optional().describe("Outgoing clip (the cut is at its end). With clip2_id omitted, the clip right after it on its track (or the next scene)."),
  clip2_id: z.string().max(64).optional().describe("Incoming clip, starting the frame after clip1_id ends."),
  track: z.string().max(64).optional().describe("Instead of clip ids: the track of the cut (UI track number, 1 = bottom; name; or layer number) ..."),
  time: z.number().min(0).optional().describe("... and the cut's timeline time in seconds (the nearest cut within 0.5 s)."),
  plate_file_id: z.string().max(64).optional().describe("A media-bin picture or video to use as the plate (a splat, petals, a flag; PNG with alpha, or a clip to screen). Default: a drawn shape."),
  shape: z.enum(PLATE_SHAPES).optional().describe("Drawn plate: blob (default, an organic splat), burst (a spiky star) or circle."),
  color: z.string().max(40).optional().describe("Drawn plate's colour: #rrggbb, #rgb, rgb(r,g,b) or a name (default #ff5a36)."),
  x: z.number().min(0).max(1).optional().describe("Where the plate grows from, 0 = left edge, 1 = right (default 0.5)."),
  y: z.number().min(0).max(1).optional().describe("0 = top, 1 = bottom (default 0.5)."),
  cover_seconds: z.number().min(0.03).max(2).optional().describe("Time from a speck to covering the frame, ending on the cut (default 0.2 s: 6 frames at 30 fps; a fluttering flag 1.5 s)."),
  hold_seconds: z.number().min(0).max(1).optional().describe("Time the frame stays covered after the cut (default 2 frames)."),
  exit_seconds: z.number().min(0.03).max(2).optional().describe("Time the plate takes to leave (default 0.3 s)."),
  exit: z.enum(PLATE_EXITS).optional().describe("How it leaves: through (default: keeps growing past the lens and fades), shrink (back to its point), fly (off a side, see direction)."),
  direction: z.enum(["left", "right", "up", "down"]).optional().describe("exit=fly: the side it flies off (default down)."),
  blend: z.enum(["normal", "screen"]).optional().describe("normal (default) or screen (a bright sprite on black: only its light covers)."),
  cover_scale: z.number().min(1).max(30).optional().describe(`plate_file_id: the scale at which the sprite covers the frame (default ${SPRITE_COVER}). Drawn plates work it out.`),
  pull_back: z.boolean().optional().describe("The incoming clip arrives zoomed in and settles behind the plate (the zoom_out motion transition on the cut; default true)."),
});

type Input = z.infer<typeof input>;

const round = (t: number): number => Math.round(t * 1000) / 1000;

/** The cut a call names. */
function cutOf(project: Project, args: Input): MotionCut {
  if (args.clip1_id) {
    const clip = project.clips.find((c) => c.id === args.clip1_id);
    if (!clip) throw new ToolError(`no clip with id ${args.clip1_id}`);
    const fits = (c: MotionCut) => c.outClip.id === clip.id && (!args.clip2_id || c.inClip.id === args.clip2_id);
    const found = trackCuts(project, clip.layer).find(fits) ?? sceneCuts(project).find(fits);
    if (found) return found;
    if (args.clip2_id && !project.clips.some((c) => c.id === args.clip2_id)) throw new ToolError(`no clip with id ${args.clip2_id}`);
    throw new ToolError(args.clip2_id ? `${args.clip2_id} does not start the frame after ${clip.id} ends` : `no clip is cut back to back after ${clip.id}; give clip2_id`);
  }
  if (args.track === undefined || args.time === undefined) throw new ToolError("give clip1_id (and optionally clip2_id), or track and time");
  return cutNear(project, resolveLayer(project, args.track), args.time);
}

function pictureOf(project: Project, id: string): ProjectFile {
  const file = project.files.find((f) => String(f.id) === id);
  if (!file) throw new ToolError(`unknown file id ${id}`);
  if (isAudioOnlyMedia(file) || !(Number(file.width) > 0 && Number(file.height) > 0)) throw new ToolError(`${id} has no picture; give an image or a video`);
  return file;
}

export const plateWipeTools: CatalogTool[] = [
  directTool({
    name: TOOL,
    title: "Plate wipe",
    description:
      "Hide a cut behind an occluder plate: a blob, a burst, a disc or a sprite from the bin (splat, petals, a flag) grows from a point until it covers the whole frame exactly on the cut, holds a frame or two, then passes through the lens, shrinks back or flies off while the incoming clip pulls back behind it. " +
      "A plate clip with keyframes on a track above the cut (blend Screen optional) plus the zoom_out motion transition, so it plays on the desktop and stays editable. One undo step; the receipt lists the plate clip, its frames and sfx_cues (whoosh while it grows, a hit as it covers).",
    input,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    requires: ["media"],
    run: async (call, args: Input) => {
      const project = call.doc.project;
      const fps = rateOf(project);
      const frames = (seconds: number | undefined, fallback: number, least: number) => Math.max(least, Math.round((seconds ?? fallback) * fps));
      let cut: MotionCut;
      let color = "#ff5a36";
      let sprite: ProjectFile | undefined;
      try {
        cut = cutOf(project, args);
        if (args.plate_file_id) {
          if (args.shape || args.color) throw new ToolError("shape and color are for drawn plates; leave them out with plate_file_id");
          sprite = pictureOf(project, args.plate_file_id);
        } else {
          if (args.cover_scale !== undefined) throw new ToolError("cover_scale is for a plate_file_id sprite; a drawn plate works out its own");
          if (args.color) color = colorHexAlpha(args.color, "color")[0];
        }
        if (args.direction && args.exit !== "fly") throw new ToolError("direction goes with exit=fly");
      } catch (error) {
        if (error instanceof ToolError || isOpError(error)) return refused(TOOL, `Error: ${error.message.replace(/\.$/, "")}.`);
        throw error;
      }
      const x = args.x ?? 0.5;
      const y = args.y ?? 0.5;
      const shape = args.shape ?? "blob";
      const [W, H] = projectSize(project);
      // Measured at a unit size first: the scale it needs decides the drawing's pixel size.
      const unit = plateSvg(shape, color, 100);
      const aspect = sprite ? Number(sprite.width) / Number(sprite.height) : 1;
      const coverScale = sprite ? (args.cover_scale ?? SPRITE_COVER) : coverScaleFor(project, 1, unit.inscribed, x, y);
      const base = {
        cut,
        aspect,
        coverScale,
        x,
        y,
        cover: frames(args.cover_seconds, 0.2, 2),
        hold: frames(args.hold_seconds, 2 / 30, 0),
        exit: frames(args.exit_seconds, 0.3, 2),
        leave: args.exit ?? "through",
        direction: args.direction ?? "down",
        screen: args.blend === "screen",
        spin: !sprite,
        pullBack: args.pull_back ?? true,
      } satisfies Omit<PlateWipeInput, "fileId" | "layer" | "title">;
      let span: { start: number; duration: number };
      try {
        span = planPlateWipe(project, base);
      } catch (error) {
        if (isOpError(error)) return refused(TOOL, `Error: ${error.message.replace(/\.$/, "")}.`);
        throw error;
      }
      const track = planOverlayTrack(project, span.start, span.start + span.duration, undefined);
      let drawn: Awaited<ReturnType<typeof generatedSvg>> | undefined;
      if (!sprite) {
        if (!call.host.media?.writeGenerated) return unavailable(TOOL, "it cannot store the plate's drawing.");
        // Drawn at the size it shows when it covers the frame (Best Fit sizes it to the short side, the keyframes scale it).
        const side = Math.min(MAX_SIDE, Math.ceil(Math.min(W, H) * coverScale));
        drawn = await generatedSvg(call, `plate-${shape}`, plateSvg(shape, color, side).svg);
      }
      const label = sprite ? String(sprite.name ?? sprite.id) : `${shape} plate`;
      const { r, fileId } = call.commit((tx) => {
        const fileId = drawn ? String(addFile(tx, drawn.media, { mediaType: "image" }).id) : String(sprite!.id);
        return { r: applyPlateWipe(tx, { ...base, fileId, layer: track.layer, title: `Plate wipe ${label}` }), fileId };
      }, `Plate wipe at ${cut.cut.toFixed(2)}s`);
      const after = call.doc.project;
      return applied(TOOL, `Added a ${label} wipe on the cut at ${r.cut.toFixed(2)}s (${trackName(after, cut.layer)}): covers in ${r.frames.cover} frames, holds ${r.frames.hold}, leaves (${base.leave}) in ${r.frames.exit}${r.pullBack ? ", the next clip pulling back behind it" : ""}.`, {
        warnings: r.warnings,
        data: {
          plate_clip_id: r.plateClipId,
          plate_file_id: fileId,
          track: trackInfo(after, track.layer),
          cut: r.cut,
          start: r.start,
          duration: round((r.frames.cover + r.frames.hold + r.frames.exit) / fps),
          frames: r.frames,
          cover_scale: r.coverScale,
          exit: base.leave,
          clip1_id: cut.outClip.id,
          clip2_id: cut.inClip.id,
          ...(r.pullBack ? { pull_back_transition_id: r.pullBack.id } : {}),
          sfx_cues: r.sfxCues,
        },
      });
    },
  }),
];
