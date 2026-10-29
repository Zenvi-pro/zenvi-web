/**
 * Looks made of an effect and a generated mask image: add_vignette_tool
 * (a Brightness effect masked by a radial falloff, looks/masks.ts) and
 * add_shape_mask_tool (a Mask effect reading a feathered rectangle or
 * ellipse drawn as a distance field, so its feather and size keyframe).
 * Native libopenshot effects and an SVG in the project: the desktop renders
 * the same. One effect of each per clip: running a tool again updates it.
 */

import { z } from "zod";
import { defaultEffectJson } from "../../effects/registry.js";
import { SHAPE_FEATHER_RANGE, shapeMaskSettings, shapeMaskSvg, vignetteSvg, type MaskShape } from "../../looks/masks.js";
import { isAudioOnlyMedia } from "../../model/media.js";
import { idFactory } from "../../model/ids.js";
import type { Clip, Effect, Keyframe, Project } from "../../model/types.js";
import { setClipEffects } from "../../ops/effects.js";
import { directTool, type CatalogTool, type ToolCall } from "../define.js";
import { ASSET_KEY, generatedSvg, maskReaderOf } from "../mattes.js";
import { applied, unchanged } from "../receipt.js";
import { constantKeyframe, guarded, isLocked, keyframeOf, projectSize, toolError } from "../titles-text.js";
import { clipExtent, clipFrameAt, fpsFloat } from "./effect-values.js";
import { fileById } from "./common.js";

/** Which look an effect is, on the effect (an unknown key the desktop keeps). */
const LOOK_KEY = "zenvi_look";

const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const clipIds = z
  .array(z.string().min(1))
  .min(1)
  .max(500)
  .optional()
  .describe("Timeline clip ids (describe_project_tool or a receipt). Default: every footage and photo clip on an unlocked track (not titles).");

function isVisual(project: Project, clip: Clip): boolean {
  const file = fileById(project, String(clip.file_id));
  return file !== undefined && !isAudioOnlyMedia(file);
}

/** Footage and photos: not titles, stickers or generated layers (SVGs), which a look would dim along with the picture. */
function isFootage(project: Project, clip: Clip): boolean {
  return isVisual(project, clip) && !/\.svg$/i.test(String(fileById(project, String(clip.file_id))?.path ?? ""));
}

/**
 * The clips a call works on: the ones named (each checked), else every footage clip on an unlocked track;
 * with `baseTrack`, only those on the lowest of those tracks (the base video track: not the grid tiles,
 * motion-block or 3D renders laid over it, which a vignette would darken edge by edge).
 */
function targets(project: Project, ids: readonly string[] | undefined, baseTrack = false): Clip[] {
  if (!ids) {
    const all = project.clips.filter((c) => isFootage(project, c) && !isLocked(project, c.layer));
    if (all.length === 0) toolError("the timeline has no footage or photo clips on unlocked tracks");
    if (!baseTrack) return all;
    const base = Math.min(...all.map((c) => c.layer));
    return all.filter((c) => c.layer === base);
  }
  return [...new Set(ids)].map((id) => {
    const clip = project.clips.find((c) => c.id === id);
    if (!clip) toolError(`no timeline clip with id=${JSON.stringify(id).replaceAll('"', "'")}`);
    if (!isVisual(project, clip)) toolError(`clip ${id} has no picture`);
    if (isLocked(project, clip.layer)) toolError(`clip ${id} is on a locked track; unlock it first`);
    return clip;
  });
}

/** The clip's effects with the `look` effect replaced by `effect` (or removed when null), in the same slot. */
function withLook(clip: Clip, look: string, effect: Effect | null): Effect[] {
  const effects = (clip.effects ?? []).map((e) => structuredClone(e));
  const at = effects.findIndex((e) => (e as Record<string, unknown>)[LOOK_KEY] === look);
  if (at < 0) return effect ? [...effects, effect] : effects;
  if (!effect) return effects.filter((_, i) => i !== at);
  effects[at] = { ...effect, id: effects[at]!.id };
  return effects;
}

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/** Commit the clips' new effects in one step; no step when nothing changes. */
function commitLooks(call: ToolCall, label: string, changes: [Clip, Effect[]][]): { changed: string[] } {
  const changed = changes.filter(([clip, effects]) => JSON.stringify(clip.effects ?? []) !== JSON.stringify(effects));
  if (changed.length > 0) call.commit((tx) => changed.forEach(([clip, effects]) => setClipEffects(tx, clip.id, effects)), label);
  return { changed: changed.map(([clip]) => clip.id) };
}

const vignetteInput = z.strictObject({
  clip_ids: clipIds.describe("Timeline clip ids (describe_project_tool or a receipt). Default: the footage and photo clips of the base video track (the lowest unlocked one with any)."),
  amount: z.number().min(0).max(1).optional().describe("How dark the corners get, 0-1 (default 0.4; 0 removes the vignette)."),
  feather: z.number().min(0).max(1).optional().describe("0 = the falloff starts late and is quick, 1 = it starts near the centre and is gentle (default 0.5)."),
});

const keyframeInput = z.strictObject({
  seconds: z.number().min(0).describe("Timeline time, seconds (times that fall before the clip starts but fit its length count from the clip's own start)."),
  grow: z.number().min(-1).max(1).optional().describe("Edge moved out (+) or in (-), fraction of the frame's short side (default 0). -0.5 closes most shapes."),
  feather: z.number().min(0).max(1).optional().describe("Edge softness at this point, fraction of the short side (default: the mask's feather)."),
});

const shapeInput = z.strictObject({
  clip_ids: clipIds,
  shape: z.enum(["rectangle", "ellipse"]).optional().describe("rectangle (default) or ellipse."),
  x: z.number().min(-0.5).max(1.5).optional().describe("Centre, 0-1 of the frame width (default 0.5)."),
  y: z.number().min(-0.5).max(1.5).optional().describe("Centre, 0-1 of the frame height (default 0.5)."),
  width: z.number().min(0.005).max(2).optional().describe("Width, 0-1 of the frame (default 0.6)."),
  height: z.number().min(0.005).max(2).optional().describe("Height, 0-1 of the frame (default 0.6)."),
  feather: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(`Edge softness, fraction of the frame's short side (default 0.04; drawn between ${SHAPE_FEATHER_RANGE[0].toFixed(3)} and ${SHAPE_FEATHER_RANGE[1].toFixed(2)}).`),
  outside: z.boolean().optional().describe("Keep the outside of the shape instead of the inside (a cut-out window). Default false."),
  keyframes: z
    .array(keyframeInput)
    .max(64)
    .optional()
    .describe("Animate the edge: [{seconds, grow, feather}], e.g. an iris open [{seconds: 2, grow: -0.5}, {seconds: 2.4, grow: 0}]. The shape's centre and size stay put (draw another mask for a move)."),
  remove: z.boolean().optional().describe("Remove the shape mask from the clips instead."),
});

type ShapeInput = z.infer<typeof shapeInput>;

/**
 * Keyframe times as timeline seconds on `clip`. Agents often count from the
 * clip's own start ("0 to 0.6 s") on an overlay placed later; read as
 * timeline times those all clamp to its first frame and the mask never
 * moves (bench round 5: a slit reveal that never opened). So when a time
 * falls outside the clip's span on the timeline and every time fits inside
 * its length, they count from the clip's start; times that fit neither are
 * refused, like set_effect_keyframes_tool's.
 */
export function maskKeyTimes(project: Project, clip: Clip, seconds: readonly number[]): { seconds: number[]; relative: boolean } {
  const [start, end, duration] = clipExtent(clip);
  const slack = 1 / fpsFloat(project);
  const inside = (t: number, lo: number, hi: number): boolean => t >= lo - slack && t <= hi + slack;
  if (seconds.every((t) => inside(t, start, end))) return { seconds: [...seconds], relative: false };
  if (seconds.every((t) => inside(t, 0, duration))) return { seconds: seconds.map((t) => Math.min(start + t, end)), relative: true };
  const off = seconds.find((t) => !inside(t, start, end))!;
  toolError(`keyframe time ${round(off)}s is outside clip ${clip.id} (it plays ${round(start)}-${round(end)}s on the timeline, ${round(duration)}s long); give timeline seconds inside it`);
}

function shapeEffect(project: Project, clip: Clip, id: string, input: ShapeInput, reader: Record<string, unknown>, hash: string): Effect {
  const feather = input.feather ?? 0.04;
  const base = shapeMaskSettings(feather, 0);
  let brightness: Keyframe = constantKeyframe(base.brightness);
  let contrast: Keyframe = constantKeyframe(base.contrast);
  if (input.keyframes && input.keyframes.length > 0) {
    const keys = [...input.keyframes].sort((a, b) => a.seconds - b.seconds);
    const times = maskKeyTimes(project, clip, keys.map((k) => k.seconds)).seconds;
    const points = keys.map((k, i) => ({ frame: clipFrameAt(project, clip, times[i]!), ...shapeMaskSettings(k.feather ?? feather, k.grow ?? 0) }));
    brightness = keyframeOf(points.map((p) => [p.frame, p.brightness] as const));
    contrast = keyframeOf(points.map((p) => [p.frame, p.contrast] as const));
  }
  return {
    ...defaultEffectJson("Mask", id),
    mask_reader: structuredClone(reader),
    // Mask hides white; the field is white inside, so invert keeps the inside.
    mask_invert: !input.outside,
    brightness,
    contrast,
    [LOOK_KEY]: "shape_mask",
    [ASSET_KEY]: hash,
  } as Effect;
}

export const lookMaskTools: CatalogTool[] = [
  directTool({
    name: "add_vignette_tool",
    title: "Vignette",
    description:
      "Darken the edges of clips, the cinematic vignette: a Brightness effect masked by a soft oval falloff the shape of the frame. amount sets how dark the corners get, feather how gradual. " +
      "Default: the footage and photo clips of the base video track (the lowest one with any; not titles, grid tiles or overlays above it). Running it again updates the vignette; amount=0 removes it. One undo step.",
    input: vignetteInput,
    annotations: EDIT,
    run: (call, input: z.infer<typeof vignetteInput>) =>
      guarded("add_vignette_tool", async () => {
        const project = call.doc.project;
        const clips = targets(project, input.clip_ids, true);
        const amount = input.amount ?? 0.4;
        const feather = input.feather ?? 0.5;
        let effect: ((id: string) => Effect) | null = null;
        if (amount > 0) {
          if (!call.host.media?.writeGenerated) toolError("this Zenvi surface cannot store the vignette's mask image");
          const [w, h] = projectSize(project);
          const asset = await generatedSvg(call, "vignette", vignetteSvg(w, h, feather));
          const reader = maskReaderOf(asset);
          effect = (id) => ({ ...defaultEffectJson("Brightness", id), brightness: constantKeyframe(round(-amount)), mask_reader: structuredClone(reader), [LOOK_KEY]: "vignette", [ASSET_KEY]: asset.hash }) as Effect;
        }
        const next = idFactory(project);
        const { changed } = commitLooks(call, amount > 0 ? "Vignette" : "Remove vignette", clips.map((clip) => [clip, withLook(clip, "vignette", effect ? effect(next()) : null)]));
        const data = { clip_ids: clips.map((c) => c.id), changed_clip_ids: changed, amount, feather };
        if (changed.length === 0) return unchanged("add_vignette_tool", amount > 0 ? "Every clip already has this vignette." : "No clip has a vignette to remove.", { data });
        return applied("add_vignette_tool", amount > 0 ? `Vignette (amount ${amount}, feather ${feather}) on ${changed.length} clip(s).` : `Removed the vignette from ${changed.length} clip(s).`, { data });
      }),
  }),

  directTool({
    name: "add_shape_mask_tool",
    title: "Shape mask",
    description:
      "Mask clips to a feathered rectangle or ellipse (the inside shows, or the outside with outside=true): a radial mask isolating a centred object on black, a frame within the frame, a soft spotlight, a split-screen strip, a window for the clip below. " +
      "keyframes animate the edge (grow it from nothing for an iris or box reveal, soften it); the feather and size keyframe on the Mask effect, no new image. Running it again replaces the clip's shape mask; remove=true takes it off. One undo step.",
    input: shapeInput,
    annotations: EDIT,
    run: (call, input: ShapeInput) =>
      guarded("add_shape_mask_tool", async () => {
        const project = call.doc.project;
        const clips = targets(project, input.clip_ids);
        const shape: MaskShape = input.shape ?? "rectangle";
        // Checked before the mask image is written: a refused time stores nothing.
        const relative = input.keyframes?.length && !input.remove ? clips.filter((c) => maskKeyTimes(project, c, input.keyframes!.map((k) => k.seconds)).relative).map((c) => c.id) : [];
        let make: ((clip: Clip, id: string) => Effect) | null = null;
        if (!input.remove) {
          if (!call.host.media?.writeGenerated) toolError("this Zenvi surface cannot store the mask image");
          const [w, h] = projectSize(project);
          const asset = await generatedSvg(call, `mask-${shape}`, shapeMaskSvg(w, h, { shape, x: input.x ?? 0.5, y: input.y ?? 0.5, width: input.width ?? 0.6, height: input.height ?? 0.6 }));
          const reader = maskReaderOf(asset);
          make = (clip, id) => shapeEffect(project, clip, id, input, reader, asset.hash);
        }
        const next = idFactory(project);
        const { changed } = commitLooks(call, input.remove ? "Remove shape mask" : `Shape mask (${shape})`, clips.map((clip) => [clip, withLook(clip, "shape_mask", make ? make(clip, next()) : null)]));
        const data = { clip_ids: clips.map((c) => c.id), changed_clip_ids: changed, shape, keyframes: input.keyframes?.length ?? 0, ...(relative.length ? { keyframes_from_clip_start: relative } : {}) };
        if (changed.length === 0) return unchanged("add_shape_mask_tool", input.remove ? "No clip has a shape mask to remove." : "Every clip already has this mask.", { data });
        return applied(
          "add_shape_mask_tool",
          input.remove ? `Removed the shape mask from ${changed.length} clip(s).` : `Masked ${changed.length} clip(s) to ${shape === "ellipse" ? "an ellipse" : "a rectangle"}${input.outside ? " (outside kept)" : ""}${input.keyframes?.length ? `, ${input.keyframes.length} keyframes` : ""}${relative.length ? ` (keyframe times read from the start of clip${relative.length === 1 ? "" : "s"} ${relative.join(", ")}: they fell before ${relative.length === 1 ? "it starts" : "they start"} on the timeline)` : ""}.`,
          { data },
        );
      }),
  }),
];
