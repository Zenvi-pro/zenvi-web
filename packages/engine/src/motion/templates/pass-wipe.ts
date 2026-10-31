/**
 * pass_wipe: a layer-pass breakdown (T099, the VFX reel's plate → matte →
 * CG → comp): two to six frame-locked clips stacked full frame, each wiped
 * on over the one before by a hard edge that carries a travelling hairline,
 * one wipe per section of beats, a stage label for each pass.
 *
 *   wipe      a Crop on the incoming pass (no resize) keyed from closed to
 *             open over 14 frames (in_out), its edge mapped from the frame to
 *             the source (the pass is drawn to cover the frame); the hairline
 *             is a drawing keyed through the same frames with the same ease,
 *             so it rides the edge exactly
 *   lock      every pass plays from one in-point: the same frame of the shot
 *   variant   the way the edge travels: right (default), left, down, up
 *   labels    a chip per pass on the lower left, in when its wipe lands, out
 *             when the next wipe starts
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { makeKeyframePoint } from "../../keyframe/edit.js";
import type { Effect, Keyframe } from "../../model/types.js";
import { drawing, key, Motion, pose } from "../elements.js";
import { keyframeThrough } from "../keyframes.js";
import { refuse, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import type { Element, MediaSource, MotionMedia } from "../types.js";
import { chipElement, chipSize, lockedFill, lockedStart } from "./layout-parts.js";

const MAX_PASSES = 6;
/** Frames of one wipe (T099: 8-18). */
const WIPE = 14;
export const WIPE_DIRECTIONS = ["right", "left", "down", "up"] as const;
type Direction = (typeof WIPE_DIRECTIONS)[number];

/**
 * The Crop that opens a pass behind an edge travelling `direction`: the
 * side ahead of the edge (right for a rightward edge) is cropped, less and
 * less. `share` maps a frame position (0..1 along
 * the wipe's axis) to the source: the pass covers the frame, so only its
 * middle `share` of the source is on screen.
 */
function wipeCrop(direction: Direction, from: number, share: number, overscan: number): Omit<Effect, "id"> {
  const { id: _id, ...json } = defaultEffectJson("Crop", "TEMPLATE00");
  // Source fraction cropped off the far side when the edge is at frame position p (0 = where it starts).
  const cropAt = (p: number) => Math.min(1, Math.max(0, 0.5 - (p - 0.5) * share));
  const closing: Keyframe = keyframeThrough([from, from + WIPE], [cropAt(-overscan), cropAt(1 + overscan)], ["smooth", "in_out"]);
  // A fresh keyframe per side: project data is a tree, never one object in two places.
  const open = (): Keyframe => ({ Points: [makeKeyframePoint(1, 0)] });
  const side = { right: "right", left: "left", down: "bottom", up: "top" }[direction];
  return { ...json, left: open(), top: open(), right: open(), bottom: open(), [side]: closing, resize: false } as Omit<Effect, "id">;
}

export const passWipe: TemplateSpec = {
  id: "pass_wipe",
  summary:
    "A layer-pass breakdown: two to six frame-locked clips (plate, matte, CG, comp) stacked full frame, each wiped on over the last by a hard edge with a travelling hairline, one wipe per section, a stage label per pass.",
  reads: "file_ids (the passes, in order, frame-locked), labels (the stage names), variant (the edge travels right | left | down | up)",
  media: "required",
  beats: (content) => 2 * Math.max(2, Math.min(MAX_PASSES, content.fileIds?.length ?? 2)),
  build(input: TemplateInput): TemplateOutput {
    const { content, layout, frames, beats, media, frame } = input;
    const { W, H, u, safe } = layout;
    const files = (content.fileIds ?? []).map((id) => media.get(id) as MotionMedia);
    if (files.length < 2 || files.length > MAX_PASSES) refuse(`pass_wipe takes 2 to ${MAX_PASSES} file_ids, the passes in order (got ${files.length})`);
    const direction = (content.variant ?? "right") as Direction;
    if (!(WIPE_DIRECTIONS as readonly string[]).includes(direction)) refuse(`pass_wipe variant is the way the edge travels: ${WIPE_DIRECTIONS.join(", ")} (got ${content.variant})`);
    const count = files.length;
    const fps = frame.fps;
    // An even share of the template's beats per pass; every wipe starts on a beat.
    const per = Math.max(1, Math.floor(beats.countIn(frames) / count));
    const wipes = [0, ...Array.from({ length: count - 1 }, (_, i) => beats.frame((i + 1) * per))];
    if (wipes[count - 1]! + WIPE + 4 > frames) refuse(`pass_wipe needs at least ${((wipes[count - 1]! + WIPE + 4) / fps).toFixed(1)} s for ${count} passes`);
    const start = lockedStart(files, frames / fps);
    const vertical = direction === "down" || direction === "up";
    const reverse = direction === "left" || direction === "up";
    const length = vertical ? H : W;
    const hair = Math.max(2, Math.round(3 * u));
    const glow = Math.round(16 * u);
    // The edge runs from one side of the frame to the other: past them the crop would clamp and fall out of step with the line.
    const overscan = 0;

    const elements: Element[] = [];
    const cues = [...wipes];
    const labels = (content.labels ?? []).map((l) => l.trim());
    for (let i = 0; i < count; i += 1) {
      const at = wipes[i]!;
      const coveredAt = i + 1 < count ? wipes[i + 1]! + WIPE : frames;
      let el = lockedFill(`pass-${i + 1}`, 1 + i, at, coveredAt, files[i]!, fps, layout, start);
      if (i > 0) {
        const source = el.source as MediaSource;
        const m = source.media;
        const drawn = Math.max(W, H * (m.width / m.height));
        const drawnLong = vertical ? drawn * (m.height / m.width) : drawn;
        const inFrames = Math.round(source.start * fps);
        const crop = wipeCrop(direction, inFrames + 1, length / drawnLong, overscan);
        el = { ...el, effects: [crop] };
      }
      elements.push({ ...el, cue: at });
      if (i > 0) {
        // The hairline: a bright core in a soft glow, keyed along the same frames and ease as the crop.
        const along = (p: number) => (reverse ? 1 - p : p) * length;
        const at0 = along(-overscan);
        const at1 = along(1 + overscan);
        const keys = [key(at, vertical ? pose(W / 2, at0) : pose(at0, H / 2)), key(at + WIPE, vertical ? pose(W / 2, at1) : pose(at1, H / 2), "in_out")];
        const box = vertical ? { width: W, height: 2 * glow } : { width: 2 * glow, height: H };
        elements.push({
          ...drawing(`hairline-${i}`, 10 + i, at, at + WIPE + 1, box, (d) => {
            if (vertical) {
              d.rect(0, glow - glow / 2, W, glow, { fill: "#ffffff", fillOpacity: 0.18 });
              d.rect(0, glow - hair / 2, W, hair, { fill: "#ffffff" });
            } else {
              d.rect(glow - glow / 2, 0, glow, H, { fill: "#ffffff", fillOpacity: 0.18 });
              d.rect(glow - hair / 2, 0, hair, H, { fill: "#ffffff" });
            }
          }, keys),
          cue: at,
        });
      }
      const label = labels[i];
      if (label) {
        const shownAt = i === 0 ? 0 : at + WIPE;
        const goneAt = i + 1 < count ? wipes[i + 1]! : frames;
        if (goneAt - shownAt < 10) continue;
        const c = chipSize(layout, label, W * 0.5);
        const inset = 28 * u;
        const chip = chipElement(`stage-${i + 1}`, 20 + i, shownAt, Math.min(frames, goneAt + 5), layout, label, safe.left + inset + c.w / 2, safe.bottom - inset - c.h / 2, W * 0.5, { dark: true });
        const out = i + 1 < count ? new Motion(chip.keys).stay(goneAt).to(goneAt + 4, { ...chip.keys[chip.keys.length - 1]!.pose, alpha: 0 }, "out").keys : chip.keys;
        elements.push({ ...chip, keys: out, cue: at });
      }
    }
    return { elements, cues };
  },
};
