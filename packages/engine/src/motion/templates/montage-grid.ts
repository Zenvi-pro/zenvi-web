/**
 * grid: a montage of the user's clips in tiles that fill one per beat.
 *
 *   grid        2 3 4 6 9 tiles in columns × rows
 *   strips_v    n vertical strips (DcfH_-aRlVg), strips_h n horizontal ones
 *   film_strip  small frames on sprocketed strips, the big frame arriving last
 *   mosaic      an irregular bento of 3 to 9 tiles
 *
 * `band` letterboxes the tiles into the middle of the frame (DecuXPxxDXU's
 * 16:9 band on a 9:16 frame, the rest bars). `steps` re-cuts the grid on a beat
 * (3 → 4 → 6): the tiles already on screen reappear in their new places at the
 * cut and the new ones fill one per beat. `merge` ends with the last tile
 * growing to fill the frame; `zoom_into` ends with the camera pushing into one
 * tile (De5_RqRup5w).
 *
 * Time is counted in slots of `unit` beats (a beat, or two on a fast tempo,
 * or half a beat when the template is short). A stage is its tile reveals,
 * then a slot of hold, then the cut to the next stage; the last stage holds
 * a slot, then merges or zooms, then holds.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { makeKeyframePoint } from "../../keyframe/edit.js";
import { Motion, backdrop, cropToAspect, enter, key, mediaCard, pose } from "../elements.js";
import { entranceStep } from "../grid.js";
import { keyframeThrough } from "../keyframes.js";
import type { Layout } from "../layout.js";
import { refuse, GRID_REVEALS, type GridOptions, type GridReveal, type MotionContent, type TemplateInput, type TemplateOutput, type TemplateSpec } from "../template.js";
import { DEFAULT_TILES, GRID_LAYOUTS, TILE_COUNTS, bandRect, filmStrip, parseBand, shortestSide, tileRects, type GridLayoutId, type Rect } from "../tiles.js";
import type { Drawing } from "../svg.js";
import type { Effect, Keyframe } from "../../model/types.js";
import type { Element, Key, MediaSource, MotionMedia, Pose } from "../types.js";

const MAX_STEPS = 4;
const MAX_FILES = 9;
/** No tile has a shorter side than this share of the frame's short side: smaller tiles do not read on a phone. */
export const MIN_TILE = 0.13;
/** Longest the full grid is held before it merges or zooms, in slots. */
const MAX_HOLD = 4;

interface Resolved {
  layout: GridLayoutId;
  /** Tile counts per stage, increasing. */
  counts: number[];
  band: number | null;
  /** px at this frame. */
  gutter: number;
  radius: number;
  reveal: GridReveal;
  merge: boolean;
  zoomInto: number | null;
  backdrop: boolean;
}

function countsOf(options: GridOptions | undefined): { layout: GridLayoutId; counts: number[] } {
  const layout = options?.layout ?? "grid";
  if (!GRID_LAYOUTS.includes(layout)) refuse(`grid layout must be one of ${GRID_LAYOUTS.join(", ")} (got ${String(layout)})`);
  const allowed = TILE_COUNTS[layout];
  if (options?.steps !== undefined && options.tiles !== undefined) refuse("grid takes tiles or steps, not both");
  const counts = options?.steps !== undefined ? [...options.steps] : [options?.tiles ?? DEFAULT_TILES[layout]];
  if (counts.length === 0 || counts.length > MAX_STEPS) refuse(`grid steps takes 1 to ${MAX_STEPS} tile counts`);
  for (const count of counts) {
    if (!allowed.includes(count)) refuse(`the ${layout} layout takes ${allowed.join(", ")} tiles (got ${count})`);
  }
  for (let i = 1; i < counts.length; i += 1) {
    if (!(counts[i]! > counts[i - 1]!)) refuse(`grid steps must increase (got ${counts.join(", ")})`);
  }
  return { layout, counts };
}

function resolve(content: MotionContent, layout: Layout): Resolved {
  const o = content.grid;
  const { layout: kind, counts } = countsOf(o);
  const band = parseBand(o?.band);
  if (band === undefined) refuse(`grid band must be full, a ratio like 16:9 or 21:9, or a number between 0.2 and 8 (got ${String(o?.band)})`);
  const gutter = o?.gutter ?? 6;
  if (!(gutter >= 0 && gutter <= 40)) refuse(`grid gutter must be 0 to 40 px (got ${gutter})`);
  const radius = o?.radius ?? 0;
  if (!(radius >= 0 && radius <= 120)) refuse(`grid radius must be 0 to 120 px (got ${radius})`);
  const reveal = o?.reveal ?? "pop";
  if (!GRID_REVEALS.includes(reveal)) refuse(`grid reveal must be one of ${GRID_REVEALS.join(", ")} (got ${String(reveal)})`);
  const merge = o?.merge ?? false;
  const zoom = o?.zoomInto;
  if (merge && zoom !== undefined) refuse("grid takes merge or zoom_into, not both");
  const last = counts[counts.length - 1]!;
  if (zoom !== undefined && !(Number.isInteger(zoom) && zoom >= 1 && zoom <= last)) refuse(`grid zoom_into must be a tile from 1 to ${last} (got ${zoom})`);
  return {
    layout: kind,
    counts,
    band,
    gutter: gutter * layout.u,
    radius: radius * layout.u,
    reveal,
    merge,
    zoomInto: zoom ?? null,
    backdrop: content.backdrop ?? true,
  };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

interface Slots {
  /** Slot of each stage's cut (the first is 0). */
  stage: number[];
  /** Slot of each tile's reveal, per stage: tiles already on screen appear at the stage's cut. */
  reveal: number[][];
  /** Slot where the last stage ends, or where the merge / zoom starts. */
  action: number;
  /** Slots the template needs. */
  end: number;
}

export function slotsOf(counts: readonly number[], finish: boolean): Slots {
  const stage: number[] = [];
  const reveal: number[][] = [];
  let slot = 0;
  counts.forEach((count, s) => {
    stage.push(slot);
    const kept = s > 0 ? counts[s - 1]! : 0;
    const first = slot + (s > 0 ? 1 : 0);
    reveal.push(Array.from({ length: count }, (_, i) => (i < kept ? slot : first + (i - kept))));
    slot = first + (count - kept) - 1 + 2;
  });
  return { stage, reveal, action: slot, end: finish ? slot + 2 : slot };
}

/** Beats the grid takes at `bpm` (a slot is a beat, or two on a fast tempo). */
export function gridBeats(content: MotionContent, bpm: number): number {
  let counts: number[];
  try {
    counts = countsOf(content.grid).counts;
  } catch {
    counts = [4];
  }
  const finish = Boolean(content.grid?.merge) || content.grid?.zoomInto !== undefined;
  const beats = slotsOf(counts, finish).end * entranceStep(bpm);
  return beats + (beats % 2);
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** Where a tile of `file` starts in its clip, so repeats of one clip show different moments. */
function tileStart(media: MotionMedia, seconds: number, nth: number, of: number): number | undefined {
  if (media.kind === "image") return undefined;
  const lo = media.duration > 3 ? 0.2 : 0;
  const length = (media.duration > 3 ? media.duration - 0.1 : media.duration) - lo;
  // A clip too short for the tile is slowed down to fill it (mediaCard).
  if (length < seconds) return undefined;
  return lo + (length - seconds) * (of > 1 ? nth / (of - 1) : 0.3);
}

/** Where a kept tile's clip picks up after a layout step: where its last element stopped, if the clip has `seconds` left there. */
function playOn(previous: Element, media: MotionMedia, seconds: number, fps: number): number | undefined {
  const source = previous.source as MediaSource;
  if (media.kind === "image" || source.speed < 0.999) return undefined;
  const next = (Math.round(source.start * fps) + (previous.to - previous.from)) / fps;
  return next + seconds <= media.duration ? next : undefined;
}

function centre(r: Rect): Pose {
  return pose(r.x + r.w / 2, r.y + r.h / 2);
}

/** Keys of a tile arriving at frame `at`. */
function revealKeys(kind: GridReveal, rest: Pose, rect: Rect, region: Rect, at: number, travel: number, instant: boolean): Key[] {
  if (instant) return [key(at, rest)];
  switch (kind) {
    case "pop":
      return enter(rest, at, { s: 0.55, alpha: 1, frames: travel, ease: "out_back" });
    case "fade":
      return enter(rest, at, { s: 1.08, alpha: 0, frames: travel + 4, ease: "out" });
    case "wipe":
      return [key(at, rest)];
    case "slide": {
      // From the edge of the region the tile is nearest to: a column from the side, a row from above or below.
      const dx = (rest.x - (region.x + region.w / 2)) / (region.w / 2);
      const dy = (rest.y - (region.y + region.h / 2)) / (region.h / 2);
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return enter(rest, at, { dy: rect.h * 0.6, alpha: 0, frames: travel, ease: "out_strong" });
      return Math.abs(dx) >= Math.abs(dy)
        ? enter(rest, at, { dx: Math.sign(dx) * rect.w * 0.6, alpha: 0, frames: travel, ease: "out_strong" })
        : enter(rest, at, { dy: Math.sign(dy) * rect.h * 0.6, alpha: 0, frames: travel, ease: "out_strong" });
    }
  }
}

/** A Crop (no resize) that opens from one edge over `travel` frames: the wipe. */
function wipeEffect(fromX: number, travel: number, vertical: boolean): Omit<Effect, "id"> {
  const { id: _id, ...json } = defaultEffectJson("Crop", "TEMPLATE00");
  const closing = (): Keyframe => keyframeThrough([fromX, fromX + travel], [1, 0], ["smooth", "out"]);
  const open = (): Keyframe => ({ Points: [makeKeyframePoint(1, 0)] });
  return { ...json, left: open(), top: open(), right: vertical ? open() : closing(), bottom: vertical ? closing() : open(), resize: false } as Omit<Effect, "id">;
}

function paintBackdrop(d: Drawing, r: Resolved, input: TemplateInput, stage: number): void {
  const { W, H } = input.layout;
  if (r.backdrop) d.rect(0, 0, W, H, { fill: input.palette.background });
  if (r.layout !== "film_strip") return;
  const region = bandRect(input.frame, r.band);
  const film = filmStrip(region, r.counts[stage]!, r.gutter);
  for (const band of film.bands) {
    d.rect(band.x, band.y, band.w, band.h, { fill: "#0b0b0d" });
    const hole = { w: film.margin * 0.9, h: film.margin * 0.52 };
    const pitch = film.margin * 2.1;
    for (let x = band.x + pitch / 2; x + hole.w <= band.x + band.w; x += pitch) {
      for (const y of [band.y + (film.margin - hole.h) / 2, band.y + band.h - (film.margin + hole.h) / 2]) d.rect(x, y, hole.w, hole.h, { fill: "#f4f5f8", fillOpacity: 0.85, rx: hole.h * 0.28 });
    }
  }
}

export const montageGrid: TemplateSpec = {
  id: "grid",
  summary:
    "A montage of your clips in tiles that fill one per beat: a grid of 2 to 9 tiles, vertical or horizontal strips, a film strip with the big frame last, or an irregular mosaic; optionally in a letterbox band (a 16:9 band across a 9:16 frame), stepping through layouts (3 → 4 → 6), ending with the last tile growing to fill the frame or the camera pushing into one tile.",
  reads:
    "file_ids (the clips, cycled over the tiles), and the grid options layout (grid | strips_v | strips_h | film_strip | mosaic), tiles or steps, band, gutter, radius, reveal (pop | slide | wipe | fade), merge, zoom_into",
  media: "required",
  beats: (content, bpm) => gridBeats(content, bpm),
  build(input: TemplateInput): TemplateOutput {
    const { content, layout, frames, beats, media, frame } = input;
    const { W, H } = layout;
    const r = resolve(content, layout);
    const files = content.fileIds ?? [];
    if (files.length === 0) refuse("grid needs file_ids: the clips or photos that fill the tiles");
    if (files.length > MAX_FILES) refuse(`grid shows at most ${MAX_FILES} files`);
    const finish = r.merge || r.zoomInto !== null;
    const region = bandRect(frame, r.band);
    const stages = r.counts.map((count) => tileRects(r.layout, count, region, r.gutter));
    const floor = MIN_TILE * Math.min(W, H);
    stages.forEach((rects, s) => {
      const small = shortestSide(rects);
      if (small < floor) {
        refuse(`grid tiles would be ${Math.round(small)} px on their short side (at least ${Math.round(floor)} px read on a phone); use fewer tiles, a taller band or a smaller gutter (stage ${s + 1}: ${r.counts[s]} tiles)`);
      }
    });

    // The unit of the schedule: the largest that fits the template's length.
    const need = slotsOf(r.counts, finish);
    const units = [...new Set([beats.step, 1, 0.5])];
    const unit = units.find((v) => beats.frame(need.end * v) <= frames);
    if (unit === undefined) {
      const seconds = beats.time(need.end * 0.5) - beats.time(0);
      refuse(`grid with ${r.counts.join(", ")} tiles needs at least ${seconds.toFixed(1)} s at this tempo; give a longer duration_seconds or fewer tiles`);
    }
    // Spare length goes to holding the full grid before the finish, never more than a few slots.
    let fit = need.end;
    while (beats.frame((fit + 1) * unit) <= frames) fit += 1;
    const action = finish ? Math.max(need.action, Math.min(need.action + MAX_HOLD, fit - 2)) : need.action;
    const slotFrame = (slot: number) => beats.frame(slot * unit);
    const travelOf = (slot: number) => Math.max(3, Math.min(10, slotFrame(slot + 1) - slotFrame(slot) - 1));

    // Which clip each tile shows: a tile kept through a layout step keeps its clip; new tiles take the next
    // clips in turn, a clip used again starting elsewhere.
    const cursor: number[][] = [];
    const uses = new Map<string, number>();
    let n = 0;
    r.counts.forEach((count, s) => {
      const kept = s > 0 ? r.counts[s - 1]! : 0;
      cursor.push(Array.from({ length: count }, (_, i) => (i < kept ? cursor[s - 1]![i]! : n++ % files.length)));
      cursor[s]!.slice(kept).forEach((f) => uses.set(files[f]!, (uses.get(files[f]!) ?? 0) + 1));
    });
    const seen = new Map<string, number>();
    /** The previous stage's element of each tile: a kept tile plays on from where it was. */
    let before: Element[] = [];

    const elements: Element[] = [];
    const cues = new Set<number>([0]);
    const fps = frame.fps;
    const lastStage = r.counts.length - 1;
    const stageFrom = (s: number) => slotFrame(need.stage[s]!);
    const stageTo = (s: number) => (s < lastStage ? slotFrame(need.stage[s + 1]!) : frames);

    // Backdrop: bars and gutters, and a film strip's bands (which change with the layout step).
    const drawsBackdrop = r.backdrop || r.layout === "film_strip";
    const bgStages = r.layout === "film_strip" ? r.counts.map((_, s) => s) : [0];
    if (drawsBackdrop) {
      bgStages.forEach((s, i) => {
        const to = r.layout === "film_strip" ? stageTo(s) : frames;
        const from = r.layout === "film_strip" ? stageFrom(s) : 0;
        const el = backdrop(`grid-bg${i > 0 ? `-${i + 1}` : ""}`, 0, from, to, layout, (d) => paintBackdrop(d, r, input, s));
        elements.push(i === 0 ? el : { ...el, cue: from });
        cues.add(from);
      });
    }
    const track0 = drawsBackdrop ? 1 : 0;

    const actionAt = slotFrame(action);
    const doneAt = Math.max(actionAt + 4, slotFrame(action + 1));
    const target = r.merge ? r.counts[lastStage]! - 1 : r.zoomInto !== null ? r.zoomInto - 1 : -1;

    for (let s = 0; s <= lastStage; s += 1) {
      const rects = stages[s]!;
      const kept = s > 0 ? r.counts[s - 1]! : 0;
      const zoomT = s === lastStage && r.zoomInto !== null ? rects[target]! : null;
      const current: Element[] = [];
      rects.forEach((rect, i) => {
        const slot = need.reveal[s]![i]!;
        const at = slotFrame(slot);
        cues.add(at);
        const file = files[cursor[s]![i]!]!;
        const media0 = media.get(file) as MotionMedia;
        const to = stageTo(s);
        const seconds = (to - at) / fps;
        let start: number | undefined;
        if (i < kept) {
          start = playOn(before[i]!, media0, seconds, fps);
        } else {
          const nth = seen.get(file) ?? 0;
          seen.set(file, nth + 1);
          // A new tile stays up to the end (stages only add tiles): its window covers all of that when the clip allows.
          start = tileStart(media0, (frames - at) / fps, nth, uses.get(file)!) ?? tileStart(media0, seconds, nth, uses.get(file)!);
        }
        const focus = r.layout === "strips_v" ? { x: (i + 0.5) / rects.length, y: 0.5 } : r.layout === "strips_h" ? { x: 0.5, y: (i + 0.5) / rects.length } : undefined;
        const crop = cropToAspect(media0, rect.w / rect.h, focus);
        const rest = centre(rect);
        const travel = travelOf(slot);
        let keys = revealKeys(r.reveal, rest, rect, region, at, travel, i < kept);
        // Rounded corners that change with the finish (a tile growing to the frame squares them) are keyed.
        if (s === lastStage && finish && r.radius > 0) keys = keys.map((k) => ({ ...k, pose: { ...k.pose, radius: r.radius * k.pose.s } }));
        if (s === lastStage && finish) {
          const m = new Motion(keys);
          m.stay(actionAt);
          if (r.merge && i === target) {
            const cover = Math.max(W / rect.w, H / rect.h) * 1.002;
            m.to(doneAt, { ...pose(W / 2, H / 2, { s: cover }), ...(r.radius > 0 ? { radius: 0 } : {}) }, "out");
          } else if (zoomT) {
            const z = Math.max(W / zoomT.w, H / zoomT.h) * 1.002;
            const tc = centre(zoomT);
            const zoomed: Pose = { ...pose(W / 2 + (rest.x - tc.x) * z, H / 2 + (rest.y - tc.y) * z, { s: z }), ...(r.radius > 0 ? { radius: i === target ? 0 : r.radius * z } : {}) };
            m.to(doneAt, zoomed, "in_out");
          }
          keys = m.keys;
        }
        const el = mediaCard(`tile-${s + 1}-${i + 1}`, track0 + i, at, to, media0, fps, { width: rect.w, radius: r.radius, ...(crop ? { crop } : {}), ...(start !== undefined ? { start } : {}) }, keys);
        if (r.reveal === "wipe" && i >= kept) {
          const inFrames = Math.round((el.source as MediaSource).start * fps);
          el.effects = [wipeEffect(inFrames + 1, travel, r.layout === "strips_v")];
        }
        elements.push({ ...el, cue: at });
        current.push(el);
      });
      before = current;
    }
    if (finish) cues.add(actionAt);
    return { elements, cues: [...cues] };
  },
};
