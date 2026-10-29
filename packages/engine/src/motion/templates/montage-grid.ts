/**
 * grid: a montage of the user's clips in tiles that fill one per beat.
 *
 *   grid        2 3 4 6 9 tiles in columns × rows
 *   strips_v    n vertical strips (DcfH_-aRlVg), strips_h n horizontal ones
 *   film_strip  small frames on sprocketed strips, the big frame arriving last
 *   mosaic      an irregular bento of 3 to 9 tiles
 *   repeat      one shot copied over 2 to 16 tiles, the copies in step or
 *               `phase` seconds apart, optionally mirrored (Ddt-jwsIZKW's
 *               facade repeated into a field)
 *   kaleidoscope 2 4 6 8 segments of one shot, alternate ones mirrored so the
 *               edges meet as mirrors round the shot's centre (DbeRyIvNrga,
 *               Ddt-jwsIZKW's towers folding round the sky)
 *
 * `band` letterboxes the tiles into the middle of the frame (DecuXPxxDXU's
 * 16:9 band on a 9:16 frame, the rest bars). `steps` re-cuts the grid on a beat
 * (3 → 4 → 6): the tiles already on screen reappear in their new places at the
 * cut and the new ones fill one per beat. `merge` ends with the last tile
 * growing to fill the frame; `zoom_into` ends with the camera pushing into one
 * tile (De5_RqRup5w).
 *
 * `drift` moves a camera over the whole field for the template's length: a
 * slow push in or pull out, or a pan across a field overscanned by the same
 * share so no edge shows.
 *
 * repeat and kaleidoscope are fields of one clip: every copy reads the shot
 * off one clock (in-point + template time, plus its phase), so a copy that
 * arrives later, or a kept one re-placed by a layout step, shows the same
 * moment as its neighbours. Mirrors are negative scales on centred clips;
 * the tiles of a gapless field overlap by a pixel so no seam shows while the
 * camera drifts. A kaleidoscope's segments all arrive on the stage's beat;
 * a repeat fills one copy per beat, then multiplies on each re-cut (4 → 16).
 *
 * Time is counted in slots of `unit` beats (a beat, or two on a fast tempo,
 * or half a beat when the template is short). A stage is its tile reveals,
 * then a slot of hold, then the cut to the next stage; the last stage holds
 * a slot, then merges or zooms, then holds.
 */

import { defaultEffectJson } from "../../effects/registry.js";
import { makeKeyframePoint } from "../../keyframe/edit.js";
import { Motion, backdrop, cropToAspect, enter, key, mediaCard, pose, samePose } from "../elements.js";
import { entranceStep } from "../grid.js";
import { keyframeThrough } from "../keyframes.js";
import type { Layout } from "../layout.js";
import {
  refuse,
  GRID_DRIFTS,
  GRID_PACES,
  type GridPace,
  GRID_REVEALS,
  type GridDrift,
  type GridOptions,
  type GridReveal,
  type MotionContent,
  type NormPoint,
  type TemplateInput,
  type TemplateOutput,
  type TemplateSpec,
} from "../template.js";
import {
  DEFAULT_TILES,
  FIELD_LAYOUTS,
  GRID_LAYOUTS,
  TILE_COUNTS,
  bandRect,
  filmStrip,
  kaleidoscopeWindow,
  mirrorFlips,
  parseBand,
  shortestSide,
  tileRects,
  type GridLayoutId,
  type Rect,
} from "../tiles.js";
import type { Drawing } from "../svg.js";
import type { Effect, Keyframe } from "../../model/types.js";
import type { Element, Key, MediaSource, MotionMedia, Pose } from "../types.js";

const MAX_STEPS = 4;
const MAX_FILES = 9;
/** No tile has a shorter side than this share of the frame's short side: smaller tiles do not read on a phone. */
export const MIN_TILE = 0.13;
/** Longest the full grid is held before it merges or zooms, in slots. */
const MAX_HOLD = 4;
/** Shortest slot a template squeezed into a short length fills tiles at, frames: faster stops reading as one per beat. */
const MIN_SLOT_FRAMES = 3;
/** Longest phase between copies of a repeat, seconds. */
const MAX_PHASE = 2;
/** Share of the frame a drift pushes in by (or pans across, the field overscanned by it). */
const DRIFT = 0.12;
/** Slowest a field's clip plays to fill the template. */
const MIN_FIELD_SPEED = 0.5;
/** How far each tile of a gapless field reaches under its neighbours, px at 1080. */
const OVERLAP = 1;
/**
 * Slowest a montage tile's clip plays to stay up as long as its tile (the
 * slowest set_clip_speed takes): a 0.2 s flash shot holds a tile for 3 s
 * rather than leaving a hole (bench round 7, hypereel).
 */
const TILE_MIN_SPEED = 1 / 16;


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
  /** One clip on every tile (repeat, kaleidoscope). */
  field: boolean;
  /** Per stage: its tiles all arrive on its beat (every kaleidoscope stage; a repeat's re-cuts). */
  together: boolean[];
  mirror: boolean;
  phase: number;
  drift: GridDrift | null;
  /** The kaleidoscope's mirror centre on the shot. */
  centre: NormPoint;
  pace: GridPace;
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
  const gutter = o?.gutter ?? (FIELD_LAYOUTS.includes(kind) ? 0 : 6);
  if (!(gutter >= 0 && gutter <= 40)) refuse(`grid gutter must be 0 to 40 px (got ${gutter})`);
  const radius = o?.radius ?? 0;
  if (!(radius >= 0 && radius <= 120)) refuse(`grid radius must be 0 to 120 px (got ${radius})`);
  const field = FIELD_LAYOUTS.includes(kind);
  const reveal = o?.reveal ?? (field ? "cut" : "pop");
  if (!GRID_REVEALS.includes(reveal)) refuse(`grid reveal must be one of ${GRID_REVEALS.join(", ")} (got ${String(reveal)})`);
  const merge = o?.merge ?? false;
  const zoom = o?.zoomInto;
  if (merge && zoom !== undefined) refuse("grid takes merge or zoom_into, not both");
  if (kind === "kaleidoscope" && (merge || zoom !== undefined)) refuse("a kaleidoscope takes no merge or zoom_into (its segments are pieces of one shot)");
  if (o?.phase !== undefined && kind !== "repeat") refuse("grid phase only applies to the repeat layout");
  const phase = o?.phase ?? 0;
  if (!(phase >= 0 && phase <= MAX_PHASE)) refuse(`grid phase must be 0 to ${MAX_PHASE} seconds (got ${phase})`);
  if (o?.mirror !== undefined && kind !== "repeat") refuse(kind === "kaleidoscope" ? "a kaleidoscope is always mirrored; drop mirror" : "grid mirror only applies to the repeat layout");
  const drift = o?.drift ?? null;
  if (drift !== null) {
    if (!GRID_DRIFTS.includes(drift)) refuse(`grid drift must be one of ${GRID_DRIFTS.join(", ")} (got ${String(drift)})`);
    if (merge || zoom !== undefined) refuse("grid drift takes no merge or zoom_into (they move the camera too)");
    if (band !== null) refuse("grid drift fills the frame; it takes no band");
    if (kind === "film_strip") refuse("a film strip does not drift (its strips are drawn on the backdrop)");
  }
  const pace = o?.pace ?? "fill";
  if (!GRID_PACES.includes(pace)) refuse(`grid pace must be one of ${GRID_PACES.join(", ")} (got ${String(pace)})`);
  const point = content.points?.[0];
  if (point && kind !== "kaleidoscope") refuse("grid points only apply to the kaleidoscope layout (its mirror centre)");
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
    field,
    together: togetherOf(kind, counts.length),
    mirror: kind === "kaleidoscope" || (o?.mirror ?? false),
    phase,
    drift,
    centre: point ?? { x: 0.5, y: 0.5 },
    pace,
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

/** Which stages arrive all at once: a kaleidoscope's segments always; a repeat fills one copy per beat, then multiplies on each re-cut. */
function togetherOf(layout: GridLayoutId, stages: number): boolean[] {
  return Array.from({ length: stages }, (_, s) => layout === "kaleidoscope" || (layout === "repeat" && s > 0));
}

/** `hold`: extra slots every stage holds after its reveals (`fill` spreading layout steps over a long length). */
export function slotsOf(counts: readonly number[], finish: boolean, together: readonly boolean[] = [], hold = 0): Slots {
  const stage: number[] = [];
  const reveal: number[][] = [];
  let slot = 0;
  counts.forEach((count, s) => {
    stage.push(slot);
    const kept = s > 0 ? counts[s - 1]! : 0;
    if (together[s]) {
      // Every tile of the stage on its beat, then a slot of hold.
      reveal.push(Array.from({ length: count }, () => slot));
      slot += 2 + hold;
      return;
    }
    const first = slot + (s > 0 ? 1 : 0);
    reveal.push(Array.from({ length: count }, (_, i) => (i < kept ? slot : first + (i - kept))));
    slot = first + (count - kept) - 1 + 2 + hold;
  });
  return { stage, reveal, action: slot, end: finish ? slot + 2 : slot };
}

/** A schedule that fits `frames`: the tile counts to show and the slot length in beats. */
interface Fit {
  counts: number[];
  unit: number;
}

/**
 * The tiles asked for at the longest slot that fits (the tempo's step, a beat
 * or half a beat); else the same tiles filling every quarter beat; else fewer
 * tiles: the earlier layout steps dropped, then smaller counts of the layout.
 * Null when even the fewest tiles the layout takes do not fit.
 */
export function fitSchedule(counts: readonly number[], layout: GridLayoutId, finish: boolean, beats: TemplateInput["beats"], frames: number): Fit | null {
  const fits = (c: readonly number[], unit: number) => beats.frame(slotsOf(c, finish, togetherOf(layout, c.length)).end * unit) <= frames;
  const exact = [...new Set([beats.step, 1, 0.5])].find((unit) => fits(counts, unit));
  if (exact !== undefined) return { counts: [...counts], unit: exact };
  const quick = beats.frame(0.25) - beats.frame(0) >= MIN_SLOT_FRAMES;
  if (quick && fits(counts, 0.25)) return { counts: [...counts], unit: 0.25 };
  const last = counts[counts.length - 1]!;
  const fewer = [
    ...counts.slice(1).map((_, i) => counts.slice(i + 1)),
    ...[...TILE_COUNTS[layout]].filter((n) => n < last).sort((a, b) => b - a).map((n) => [n]),
  ];
  for (const c of fewer) {
    for (const unit of quick ? [0.5, 0.25] : [0.5]) if (fits(c, unit)) return { counts: c, unit };
  }
  return null;
}

/** Beats the grid takes at `bpm` (a slot is a beat, or two on a fast tempo). */
export function gridBeats(content: MotionContent, bpm: number): number {
  let counts: number[];
  let together: boolean[] = [];
  try {
    const parsed = countsOf(content.grid);
    counts = parsed.counts;
    together = togetherOf(parsed.layout, counts.length);
  } catch {
    counts = [4];
  }
  const finish = Boolean(content.grid?.merge) || content.grid?.zoomInto !== undefined;
  const beats = slotsOf(counts, finish, together).end * entranceStep(bpm);
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

/** A field's clock: every copy shows `base + t × speed + its index × phase` at template time t (seconds). */
interface Clock {
  base: number;
  speed: number;
  phase: number;
}

/**
 * The clock of a field of `count` copies over `seconds`: the copies' spread of
 * phases is narrowed when the clip is too short for it, then dropped and the
 * clip slowed (to half speed at most) when it is shorter than the template.
 */
function fieldClock(media: MotionMedia, seconds: number, count: number, phase: number, fps: number): Clock {
  const lo = media.duration > 3 ? 0.2 : 0;
  // A frame of room at the end: in-points are rounded to the frame grid.
  const hi = media.duration > 3 ? media.duration - 0.1 : media.duration - 1 / fps;
  const length = hi - lo;
  const spread = (count - 1) * phase;
  if (length >= seconds + spread) return { base: lo + (length - seconds - spread) * 0.3, speed: 1, phase };
  if (length >= seconds) return { base: lo, speed: 1, phase: count > 1 ? (length - seconds) / (count - 1) : 0 };
  const speed = length / seconds;
  if (speed < MIN_FIELD_SPEED) {
    refuse(`the clip is ${media.duration.toFixed(1)} s and the field ${seconds.toFixed(1)} s: even at half speed it runs out; give a duration_seconds of at most ${((length / MIN_FIELD_SPEED) * 0.98).toFixed(1)} or a longer clip`);
  }
  return { base: lo, speed, phase: 0 };
}

type Camera = (frame: number, p: Pose) => Pose;

/** The drift's camera over `frames` frames: a linear push, pull or pan about the frame's centre. */
function driftCamera(drift: GridDrift, frames: number, W: number, H: number): Camera {
  return (frame, p) => {
    const t = frames > 1 ? frame / (frames - 1) : 0;
    const z = drift === "in" ? 1 + DRIFT * t : drift === "out" ? 1 + DRIFT * (1 - t) : 1 + DRIFT;
    const pan = (DRIFT / 2) * (1 - 2 * t);
    const dx = drift === "left" ? W * pan : drift === "right" ? -W * pan : 0;
    const dy = drift === "up" ? H * pan : drift === "down" ? -H * pan : 0;
    return { ...p, x: W / 2 + (p.x - W / 2) * z + dx, y: H / 2 + (p.y - H / 2) * z + dy, s: p.s * z, ...(p.radius !== undefined ? { radius: p.radius * z } : {}) };
  };
}

/**
 * `el` seen through the camera: a key at its last frame carries the drift to
 * the end, and every still stretch moves linearly, so neighbouring tiles keyed
 * on different frames stay edge to edge.
 */
function drifted(el: Element, camera: Camera): Element {
  const keys = [...el.keys].sort((a, b) => a.frame - b.frame);
  const last = el.to - 1;
  if (keys[keys.length - 1]!.frame < last) keys.push(key(last, keys[keys.length - 1]!.pose, "linear"));
  return {
    ...el,
    keys: keys.map((k, i) => ({ ...k, pose: camera(k.frame, k.pose), ease: i > 0 && samePose(k.pose, keys[i - 1]!.pose) ? "linear" : k.ease })),
  };
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
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
    case "cut":
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
    "A montage of your clips in tiles that fill one per beat: a grid of 2 to 9 tiles, vertical or horizontal strips, a film strip with the big frame last, or an irregular mosaic; or one shot repeated into a field of 2 to 16 copies (in step or out of phase, optionally mirrored) or folded into a 2/4/6/8-segment kaleidoscope; optionally in a letterbox band (a 16:9 band across a 9:16 frame), stepping through layouts (3 → 4 → 6), drifting (a slow push, pull or pan over the field), ending with the last tile growing to fill the frame or the camera pushing into one tile.",
  reads:
    "file_ids (the clips, cycled over the tiles; one clip for repeat and kaleidoscope), points (kaleidoscope: its mirror centre on the shot), and the grid options layout (grid | strips_v | strips_h | film_strip | mosaic | repeat | kaleidoscope), tiles or steps, band, gutter, radius, reveal (pop | slide | wipe | fade | cut), merge, zoom_into, phase, mirror, drift",
  media: "required",
  beats: (content, bpm) => gridBeats(content, bpm),
  build(input: TemplateInput): TemplateOutput {
    const { content, layout, frames, beats, media, frame } = input;
    const { W, H } = layout;
    const asked = resolve(content, layout);
    const files = content.fileIds ?? [];
    if (files.length === 0) refuse("grid needs file_ids: the clips or photos that fill the tiles");
    if (files.length > MAX_FILES) refuse(`grid shows at most ${MAX_FILES} files`);
    if (asked.field && files.length > 1) refuse(`the ${asked.layout} layout shows one clip on every tile (got ${files.length} file_ids); use layout grid or mosaic for several`);
    const finish = asked.merge || asked.zoomInto !== null;

    // Fit the tiles to the length given (agents pick a duration and a tile count separately): fill faster, or show fewer.
    const fitted = fitSchedule(asked.counts, asked.layout, finish, beats, frames);
    if (!fitted) {
      const seconds = beats.time(slotsOf(asked.counts, finish, asked.together).end * 0.5) - beats.time(0);
      refuse(`grid with ${asked.counts.join(", ")} tiles needs at least ${seconds.toFixed(1)} s at this tempo; give a longer duration_seconds or fewer tiles`);
    }
    const unit = fitted.unit;
    const length = `${(frames / frame.fps).toFixed(1)} s`;
    const warnings: string[] = [];
    const last = fitted.counts[fitted.counts.length - 1]!;
    const zoomInto = asked.zoomInto === null ? null : Math.min(asked.zoomInto, last);
    if (fitted.counts.join() !== asked.counts.join()) {
      warnings.push(`grid with ${asked.counts.join(", ")} tiles does not fit ${length} at this tempo; showing ${fitted.counts.join(", ")} tiles instead (give a longer duration_seconds for all of them)`);
      if (zoomInto !== asked.zoomInto) warnings.push(`zoom_into ${asked.zoomInto} is past the ${last} tiles shown; zooming into tile ${zoomInto}`);
    } else if (unit < 0.5) {
      warnings.push(`grid with ${asked.counts.join(", ")} tiles fills a tile every quarter beat to fit ${length} (give a longer duration_seconds for one per beat)`);
    }
    const r: Resolved = { ...asked, counts: fitted.counts, together: togetherOf(asked.layout, fitted.counts.length), zoomInto };
    const region = bandRect(frame, r.band);
    const stages = r.counts.map((count) => tileRects(r.layout, count, region, r.gutter));
    const floor = MIN_TILE * Math.min(W, H);
    stages.forEach((rects, s) => {
      const small = shortestSide(rects);
      if (small < floor) {
        refuse(`grid tiles would be ${Math.round(small)} px on their short side (at least ${Math.round(floor)} px read on a phone); use fewer tiles, a taller band or a smaller gutter (stage ${s + 1}: ${r.counts[s]} tiles)`);
      }
    });

    const tight = slotsOf(r.counts, finish, r.together);
    let fit = tight.end;
    while (beats.frame((fit + 1) * unit) <= frames) fit += 1;
    // fill: spare length is shared by the layout steps, each held longer before the next re-cut, so a
    // 3 → 4 → 6 build spans the length asked instead of ending at a third of it (bench round 7, gridmontage).
    const hold = r.pace === "fill" && r.counts.length > 1 ? Math.floor((fit - tight.end) / r.counts.length) : 0;
    const need = hold > 0 ? slotsOf(r.counts, finish, r.together, hold) : tight;
    // Spare length goes to holding the full grid before the finish, never more than a few slots.
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
    /** Tiles whose clip is slowed past half speed to hold its tile. */
    const held: string[] = [];
    /** The previous stage's element of each tile: a kept tile plays on from where it was. */
    let before: Element[] = [];

    const elements: Element[] = [];
    const cues = new Set<number>([0]);
    const fps = frame.fps;
    const lastStage = r.counts.length - 1;
    const shot = media.get(files[0]!) as MotionMedia;
    const clock = r.field && shot.kind === "video" ? fieldClock(shot, frames / fps, r.counts[lastStage]!, r.phase, fps) : null;
    const camera = r.drift ? driftCamera(r.drift, frames, W, H) : null;
    const overlap = r.field && r.gutter === 0 ? OVERLAP * layout.u : 0;
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
      const flips = r.mirror ? mirrorFlips(r.counts[s]!, region) : null;
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
        if (r.field) {
          start = clock ? clock.base + (at / fps) * clock.speed + i * clock.phase : undefined;
        } else if (i < kept) {
          start = playOn(before[i]!, media0, seconds, fps);
        } else {
          const nth = seen.get(file) ?? 0;
          seen.set(file, nth + 1);
          // A new tile stays up to the end (stages only add tiles): its window covers all of that when the clip allows.
          start = tileStart(media0, (frames - at) / fps, nth, uses.get(file)!) ?? tileStart(media0, seconds, nth, uses.get(file)!);
        }
        const focus = r.layout === "strips_v" ? { x: (i + 0.5) / rects.length, y: 0.5 } : r.layout === "strips_h" ? { x: 0.5, y: (i + 0.5) / rects.length } : undefined;
        const drawn = overlap > 0 ? grow(rect, overlap) : rect;
        const crop = r.layout === "kaleidoscope" ? kaleidoscopeWindow(media0, region, drawn, r.counts[s]!, r.centre) : cropToAspect(media0, drawn.w / drawn.h, focus);
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
        let el = mediaCard(
          `tile-${s + 1}-${i + 1}`,
          track0 + i,
          at,
          to,
          media0,
          fps,
          { width: drawn.w, radius: r.radius, ...(crop ? { crop } : {}), ...(start !== undefined ? { start, ...(clock ? { speed: clock.speed } : {}) } : { minSpeed: TILE_MIN_SPEED }) },
          keys,
        );
        const speed = (el.source as MediaSource).speed;
        if (media0.kind === "video" && speed < 0.5 - 1e-9 && !held.includes(file)) held.push(file);
        const flip = flips?.[i];
        if (flip && (flip.x || flip.y)) el = { ...el, source: { ...(el.source as MediaSource), flip } };
        if (camera) el = drifted(el, camera);
        if (r.reveal === "wipe" && i >= kept) {
          const inFrames = Math.round((el.source as MediaSource).start * fps);
          el.effects = [wipeEffect(inFrames + 1, travel, r.layout === "strips_v")];
        }
        elements.push({ ...el, cue: at });
        current.push(el);
        // Still short of its tile at 1/16 (a 2-frame flash shot): the clip loops, the tile at rest, so no tile goes blank.
        let loopFrom = el.to;
        for (let k = 1; media0.kind === "video" && start === undefined && loopFrom < to && k <= 8; k += 1) {
          const settled = [...keys].sort((x, y) => x.frame - y.frame);
          if (settled[settled.length - 1]!.frame > loopFrom || r.reveal === "wipe") break;
          let again = mediaCard(`tile-${s + 1}-${i + 1}-loop${k}`, track0 + i, loopFrom, to, media0, fps, { width: drawn.w, radius: r.radius, ...(crop ? { crop } : {}), minSpeed: TILE_MIN_SPEED }, [key(loopFrom, settled[settled.length - 1]!.pose)]);
          if (flip && (flip.x || flip.y)) again = { ...again, source: { ...(again.source as MediaSource), flip } };
          if (camera) again = drifted(again, camera);
          elements.push({ ...again, cue: at });
          loopFrom = again.to;
        }
      });
      before = current;
    }
    if (finish) cues.add(actionAt);
    if (held.length > 0) {
      warnings.push(`${held.length} clip(s) are shorter than their tiles (${held.join(", ")}): slowed down (to 1/16 at most, then looped) so each tile stays up; give longer clips for real motion in the tiles`);
    }
    return { elements, cues: [...cues], ...(warnings.length > 0 ? { warnings } : {}) };
  },
};
