/**
 * Which frames go on the review sheet and how big the sheet is. The host
 * renders and pastes the tiles (`FrameHost.renderSheet`); this decides what
 * a person judging the cut needs to see: each cut's last and first frame,
 * and a frame from the middle of the longer shots.
 */

import type { ReviewCut, ReviewShot, TimelineReview } from "./types.js";

export interface SheetTile {
  seconds: number;
  /** Printed on the tile. */
  label: string;
  kind: "start" | "out" | "in" | "mid" | "end";
  /** `ReviewShot.index` of the shot the frame belongs to. */
  shot: number;
}

export interface SheetLayout {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  gap: number;
  width: number;
  height: number;
}

/** About 1,450 image tokens (a Claude image costs roughly width x height / 750). */
export const DEFAULT_SHEET_PIXELS = 1_100_000;
/** Detail views may spend more. */
export const MAX_SHEET_PIXELS = 2_800_000;
/** Longest edge models take without shrinking the image. */
const MAX_EDGE = 1568;
const GAP = 3;
const MIN_TILE_WIDTH = 56;
/** Shots at least this long get a mid-shot tile when there is room. */
const MID_SHOT_MIN = 0.75;

const label = (seconds: number, kind: SheetTile["kind"]): string => (kind === "out" || kind === "in" ? `${seconds.toFixed(2)} ${kind}` : seconds.toFixed(2));

/** Pick `count` of `items` spread evenly, keeping the first and last. */
function spread<T>(items: readonly T[], count: number): T[] {
  if (count >= items.length) return [...items];
  if (count <= 0) return [];
  if (count === 1) return [items[0]!];
  return Array.from({ length: count }, (_, i) => items[Math.round((i * (items.length - 1)) / (count - 1))]!);
}

export interface SheetPlan {
  tiles: SheetTile[];
  /** Cuts shown with both frames, of all cuts in the range. */
  cutsShown: number;
  cutsTotal: number;
}

/** Tiles for `review`: first and last frame of the range, a pair around each cut, and mid-shot frames with the room left. */
export function planSheet(review: TimelineReview, maxTiles: number): SheetPlan {
  const frame = 1 / review.fps;
  const shots = review.shots;
  if (shots.length === 0) return { tiles: [], cutsShown: 0, cutsTotal: 0 };
  const byIndex = new Map<number, ReviewShot>(shots.map((s) => [s.index, s]));
  const budget = Math.max(2, Math.trunc(maxTiles));
  const first = shots[0]!;
  const last = shots[shots.length - 1]!;
  const from = Math.max(first.start, review.range.start);
  const to = Math.min(last.end, review.range.end);
  const tiles: SheetTile[] = [{ seconds: from + frame / 2, label: label(from, "start"), kind: "start", shot: first.index }];

  const pairRoom = Math.max(0, Math.floor((budget - 2) / 2));
  const cuts: ReviewCut[] = spread(review.cuts, pairRoom);
  for (const cut of cuts) {
    tiles.push({ seconds: cut.time - frame / 2, label: label(cut.time, "out"), kind: "out", shot: cut.from });
    tiles.push({ seconds: cut.time + frame / 2, label: label(cut.time, "in"), kind: "in", shot: cut.to });
  }
  tiles.push({ seconds: Math.max(from, to - frame / 2), label: label(to, "end"), kind: "end", shot: last.index });

  // Mid-shot frames of the longest shots, with whatever room is left.
  const room = budget - tiles.length;
  if (room > 0) {
    const longer = shots
      .filter((s) => s.duration >= MID_SHOT_MIN && byIndex.has(s.index))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, room);
    for (const shot of longer) {
      const middle = (Math.max(shot.start, from) + Math.min(shot.end, to)) / 2;
      tiles.push({ seconds: middle, label: label(middle, "mid"), kind: "mid", shot: shot.index });
    }
  }
  tiles.sort((a, b) => a.seconds - b.seconds || (a.kind === "out" ? -1 : 1));
  return { tiles, cutsShown: cuts.length, cutsTotal: review.cuts.length };
}

/** Columns and tile size that fit `count` tiles of the frame's aspect into `maxPixels`, as large as possible. */
export function sheetLayout(count: number, aspect: number, maxPixels = DEFAULT_SHEET_PIXELS, tileWidth?: number): SheetLayout {
  const n = Math.max(1, count);
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9;
  const size = (columns: number, width: number): SheetLayout => {
    const rows = Math.ceil(n / columns);
    const height = Math.max(1, Math.round(width / ratio));
    return { columns, rows, tileWidth: width, tileHeight: height, gap: GAP, width: columns * width + (columns + 1) * GAP, height: rows * height + (rows + 1) * GAP };
  };
  const fits = (layout: SheetLayout): boolean => layout.width * layout.height <= maxPixels && Math.max(layout.width, layout.height) <= MAX_EDGE;
  let best: SheetLayout | undefined;
  for (let columns = 1; columns <= n; columns += 1) {
    let width = tileWidth ?? MAX_EDGE;
    let layout = size(columns, width);
    while (!fits(layout) && width > MIN_TILE_WIDTH) {
      width -= 2;
      layout = size(columns, width);
    }
    // Largest tiles win; among equals the squarer sheet.
    if (!best || layout.tileWidth > best.tileWidth || (layout.tileWidth === best.tileWidth && Math.abs(layout.width - layout.height) < Math.abs(best.width - best.height))) best = layout;
  }
  return best!;
}
