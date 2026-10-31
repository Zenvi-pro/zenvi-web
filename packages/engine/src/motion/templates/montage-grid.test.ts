import { describe, expect, it } from "vitest";
import { evaluate } from "../../keyframe/evaluate.js";
import type { Keyframe } from "../../model/types.js";
import { buildMotionTemplate } from "../build.js";
import { TemplateBeats, tempoGrid } from "../grid.js";
import { PALETTES } from "../palettes.js";
import { MotionInputError, type GridOptions, type MotionContent } from "../template.js";
import { FIELD_LAYOUTS, GRID_LAYOUTS, TILE_COUNTS, bandRect, kaleidoscopeWindow, mirrorFlips, parseBand, shortestSide, tileRects, type Rect } from "../tiles.js";
import type { MotionFrame, MotionLayer, MotionMedia, MotionPlan } from "../types.js";
import { MIN_TILE, gridBeats, slotsOf } from "./montage-grid.js";

const FRAMES: Record<string, MotionFrame> = {
  portrait: { width: 1080, height: 1920, fps: 30 },
  landscape: { width: 1920, height: 1080, fps: 30 },
};

const MEDIA: MotionMedia[] = [
  { fileId: "VIDEO00001", kind: "video", width: 1920, height: 1080, duration: 12 },
  { fileId: "VIDEO00002", kind: "video", width: 1080, height: 1920, duration: 9 },
  { fileId: "PHOTO00001", kind: "image", width: 1600, height: 1200, duration: 0 },
  { fileId: "SHORT00001", kind: "video", width: 1080, height: 1920, duration: 2.5 },
];
const MEDIA_BY_ID = new Map(MEDIA.map((m) => [m.fileId, m]));
const FILES = MEDIA.slice(0, 3).map((m) => m.fileId);

function build(frame: MotionFrame, grid: GridOptions, extra: Partial<MotionContent> = {}, o: { seconds?: number; start?: number; bpm?: number } = {}): { plan: MotionPlan; beats: TemplateBeats } {
  const start = o.start ?? 2;
  const tempo = tempoGrid(o.bpm ?? 120, start + 60, 0.25);
  const plan = buildMotionTemplate({
    template: "grid",
    frame,
    start,
    ...(o.seconds !== undefined ? { seconds: o.seconds } : {}),
    grid: tempo,
    palette: PALETTES.ui_dark,
    media: MEDIA_BY_ID,
    // A field (repeat, kaleidoscope) shows one clip: the portrait video.
    content: { fileIds: grid.layout && FIELD_LAYOUTS.includes(grid.layout) ? ["VIDEO00002"] : FILES, grid, ...extra },
  });
  return { plan, beats: new TemplateBeats(tempo, start, frame.fps) };
}

/** A media layer's box on the frame at clip frame `at`, as Best Fit places it. */
function boxAt(layer: MotionLayer, frame: MotionFrame, at: number): Rect {
  const value = (name: string, fallback: number) => {
    const kf = layer.props[name] as Keyframe | undefined;
    return kf ? evaluate(kf, at) : fallback;
  };
  if (layer.source.kind !== "media") throw new Error(`${layer.name} is not a picture`);
  const media = MEDIA_BY_ID.get(layer.source.fileId)!;
  const crop = layer.effects.find((e) => (e as { class_name?: string }).class_name === "Crop" && (e as { resize?: boolean }).resize === true) as Record<string, Keyframe> | undefined;
  const cut = (side: string) => (crop ? evaluate(crop[side]!, 1) : 0);
  const aspect = (media.width * (1 - cut("left") - cut("right"))) / (media.height * (1 - cut("top") - cut("bottom")));
  const fit = aspect > frame.width / frame.height ? { w: frame.width, h: frame.width / aspect } : { w: frame.height * aspect, h: frame.height };
  const w = fit.w * value("scale_x", 1);
  const h = fit.h * value("scale_y", 1);
  const cx = (0.5 + value("location_x", 0)) * frame.width;
  const cy = (0.5 + value("location_y", 0)) * frame.height;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** The key X of clip frame `n` of a layer (media keys count from the in-point). */
function keyX(layer: MotionLayer, frame: MotionFrame, n: number): number {
  return n + (layer.source.kind === "media" ? Math.round(layer.source.start * frame.fps) : 0);
}

const tiles = (plan: MotionPlan) => plan.layers.filter((l) => l.name.startsWith("tile-"));
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

describe.each(Object.entries(FRAMES))("montage grid geometry, %s", (_name, frame) => {
  for (const band of [null, 16 / 9, 21 / 9]) {
    for (const layout of GRID_LAYOUTS) {
      it(`${layout}${band ? ` in a ${band.toFixed(2)} band` : ""}: every count keeps its tiles inside the region, apart, and readable`, () => {
        const region = bandRect(frame, band);
        for (const count of TILE_COUNTS[layout]) {
          const rects = tileRects(layout, count, region, 6);
          expect(rects, `${layout} ${count}`).toHaveLength(count);
          for (const r of rects) {
            expect(r.x).toBeGreaterThanOrEqual(region.x - 0.5);
            expect(r.y).toBeGreaterThanOrEqual(region.y - 0.5);
            expect(r.x + r.w).toBeLessThanOrEqual(region.x + region.w + 0.5);
            expect(r.y + r.h).toBeLessThanOrEqual(region.y + region.h + 0.5);
            expect(r.w).toBeGreaterThan(0);
            expect(r.h).toBeGreaterThan(0);
          }
          rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => expect(overlap(a, b), `${layout} ${count}`).toBe(false)));
          // The tiles cover the region apart from gutters and, for a film strip, its sprocket margins.
          if (layout !== "film_strip") {
            const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
            expect(area / (region.w * region.h)).toBeGreaterThan(0.9);
          }
        }
      });
    }
  }

  it("the default layouts are readable on a phone: no tile under 13 % of the short side (full frame and a 16:9 band)", () => {
    const floor = MIN_TILE * Math.min(frame.width, frame.height);
    for (const band of [null, 16 / 9]) {
      for (const layout of GRID_LAYOUTS) {
        if (band !== null && (layout === "strips_h" || layout === "film_strip") && frame.height > frame.width) continue;
        for (const count of TILE_COUNTS[layout]) {
          const small = shortestSide(tileRects(layout, count, bandRect(frame, band), 6));
          expect(small, `${layout} ${count} ${band}`).toBeGreaterThanOrEqual(floor - 1);
        }
      }
    }
  });
});

describe("parseBand", () => {
  it("reads ratios, numbers and 'full'", () => {
    expect(parseBand(undefined)).toBeNull();
    expect(parseBand("full")).toBeNull();
    expect(parseBand("16:9")).toBeCloseTo(16 / 9, 9);
    expect(parseBand("21/9")).toBeCloseTo(21 / 9, 9);
    expect(parseBand("2.39:1")).toBeCloseTo(2.39, 9);
    expect(parseBand(1.5)).toBe(1.5);
    expect(parseBand("wide")).toBeUndefined();
    expect(parseBand("0:9")).toBeUndefined();
  });
});

describe.each(Object.entries(FRAMES))("montage grid template, %s", (_name, frame) => {
  it("fills one tile per beat: 3 → 4 → 6 steps, each stage's new tiles on successive beats", () => {
    const { plan, beats } = build(frame, { steps: [3, 4, 6], band: frame.height > frame.width ? "16:9" : undefined });
    const by = (name: string) => plan.layers.find((l) => l.name === name)!;
    // Stage 1: tiles 1-3 on beats 0, 1, 2 (120 BPM, one slot a beat).
    expect([1, 2, 3].map((i) => by(`tile-1-${i}`).start)).toEqual([0, 1, 2].map((k) => beats.frame(k)));
    // Stage 2 cuts one slot after the last reveal's hold: its three kept tiles appear together, the new one a beat later.
    const cut = by("tile-2-1").start;
    expect(cut).toBe(beats.frame(4));
    expect([2, 3].map((i) => by(`tile-2-${i}`).start)).toEqual([cut, cut]);
    expect(by("tile-2-4").start).toBe(beats.frame(5));
    // Stage 3 likewise: four kept, then two new tiles on successive beats.
    expect(by("tile-3-1").start).toBe(beats.frame(7));
    expect(by("tile-3-4").start).toBe(beats.frame(7));
    expect([5, 6].map((i) => by(`tile-3-${i}`).start)).toEqual([beats.frame(8), beats.frame(9)]);
    // A stage ends where the next begins; the last runs to the end.
    expect(by("tile-1-1").start + by("tile-1-1").frames).toBeLessThanOrEqual(cut);
    expect(by("tile-3-6").start + by("tile-3-6").frames).toBeLessThanOrEqual(plan.frames);
    for (const l of tiles(plan)) {
      expect(l.cue, l.name).toBe(l.start);
      expect(plan.cues).toContain(l.cue);
    }
  });

  it("keeps a tile's clip through a layout step, playing on from where it was; new tiles take the next clips", () => {
    const { plan } = build(frame, { steps: [2, 3] }, { fileIds: ["VIDEO00001", "VIDEO00002", "VIDEO00001"] });
    const by = (name: string) => plan.layers.find((l) => l.name === name)!;
    const source = (name: string) => {
      const s = by(name).source;
      if (s.kind !== "media") throw new Error(`${name} is not a picture`);
      return s;
    };
    for (const i of [1, 2]) {
      const [a, b] = [source(`tile-1-${i}`), source(`tile-2-${i}`)];
      expect(b.fileId, `tile ${i}`).toBe(a.fileId);
      expect(b.start, `tile ${i}`).toBeCloseTo(a.end, 6);
    }
    // The third tile is the third file; VIDEO00001 used again starts at another moment.
    expect(source("tile-2-3").fileId).toBe("VIDEO00001");
    expect(Math.abs(source("tile-2-3").start - source("tile-1-1").start)).toBeGreaterThan(1);
  });

  it("keeps every tile of every stage inside the band and apart at rest", () => {
    const band = frame.height > frame.width ? "16:9" : "21:9";
    const { plan } = build(frame, { steps: [3, 4, 6], band, gutter: 6 });
    const region = bandRect(frame, parseBand(band) ?? null);
    const byStage = new Map<string, Rect[]>();
    for (const l of tiles(plan)) {
      // At rest: the last clip frame.
      const box = boxAt(l, frame, keyX(l, frame, l.frames));
      expect(box.x, l.name).toBeGreaterThanOrEqual(region.x - 1);
      expect(box.x + box.w, l.name).toBeLessThanOrEqual(region.x + region.w + 1);
      expect(box.y, l.name).toBeGreaterThanOrEqual(region.y - 1);
      expect(box.y + box.h, l.name).toBeLessThanOrEqual(region.y + region.h + 1);
      const stage = l.name.split("-")[1]!;
      byStage.set(stage, [...(byStage.get(stage) ?? []), box]);
    }
    for (const boxes of byStage.values()) boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
    // Bars: the backdrop is one still full-frame drawing under the tiles.
    const bg = plan.layers.find((l) => l.name === "grid-bg")!;
    expect(bg.track).toBe(0);
    expect(tiles(plan).every((l) => l.track > bg.track)).toBe(true);
  });

  it("merge: the last tile to arrive grows until it covers the frame, on the beat after a held slot", () => {
    const { plan, beats } = build(frame, { tiles: 4, merge: true, radius: 24 });
    const last = plan.layers.find((l) => l.name === "tile-1-4")!;
    const end = boxAt(last, frame, keyX(last, frame, last.frames));
    expect(end.x).toBeLessThanOrEqual(0.5);
    expect(end.y).toBeLessThanOrEqual(0.5);
    expect(end.x + end.w).toBeGreaterThanOrEqual(frame.width - 0.5);
    expect(end.y + end.h).toBeGreaterThanOrEqual(frame.height - 0.5);
    // Rounded corners square off as it grows.
    const radius = last.props.corner_radius as Keyframe;
    expect(evaluate(radius, keyX(last, frame, 1) + 8)).toBeGreaterThan(0);
    expect(evaluate(radius, keyX(last, frame, last.frames))).toBe(0);
    // The others stay where they were; the growth starts on a beat.
    const grew = (last.props.scale_x as Keyframe).Points;
    const growsAt = last.start + (grew[grew.length - 2]!.co.X - keyX(last, frame, 1));
    expect(plan.cues).toContain(growsAt);
    expect(growsAt).toBeGreaterThanOrEqual(beats.frame(slotsOf([4], true).action));
    expect([...Array(12).keys()].map((k) => beats.frame(k))).toContain(growsAt);
  });

  it("zoom_into: the camera pushes into the chosen tile until it fills the frame and the rest leave", () => {
    const { plan } = build(frame, { tiles: 6, zoomInto: 5 });
    const at = (name: string) => {
      const l = plan.layers.find((x) => x.name === name)!;
      return boxAt(l, frame, keyX(l, frame, l.frames));
    };
    const target = at("tile-1-5");
    expect(target.w).toBeGreaterThanOrEqual(frame.width - 0.5);
    expect(target.h).toBeGreaterThanOrEqual(frame.height - 0.5);
    expect(Math.abs(target.x + target.w / 2 - frame.width / 2)).toBeLessThan(1);
    expect(Math.abs(target.y + target.h / 2 - frame.height / 2)).toBeLessThan(1);
    // The tile beside it is mostly off the frame.
    const beside = at("tile-1-4");
    expect(beside.x + beside.w <= 0 || beside.x >= frame.width || beside.y + beside.h <= 0 || beside.y >= frame.height).toBe(true);
  });

  it.each(["pop", "slide", "wipe", "fade"] as const)("%s: tiles arrive on their beat and rest where the layout puts them", (reveal) => {
    const { plan } = build(frame, { tiles: 4, reveal });
    const region = bandRect(frame, null);
    const rects = tileRects("grid", 4, region, 6 * (Math.min(frame.width, frame.height) / 1080));
    tiles(plan).forEach((l, i) => {
      const box = boxAt(l, frame, keyX(l, frame, l.frames));
      // A picture within 1 % of the tile's shape is not cropped to it: its other side may differ a little.
      expect(Math.abs(box.x - rects[i]!.x)).toBeLessThan(6);
      expect(Math.abs(box.y - rects[i]!.y)).toBeLessThan(6);
      expect(Math.abs(box.w - rects[i]!.w)).toBeLessThan(6);
      expect(Math.abs(box.h - rects[i]!.h)).toBeLessThan(6);
      // Arriving: the first pose differs from rest (except a wipe, which opens a crop instead).
      const start = boxAt(l, frame, keyX(l, frame, 1));
      const alpha = l.props.alpha as Keyframe | undefined;
      if (reveal === "wipe") {
        // The wipe is a Crop that does not resize (a tile already in the tile's shape has no other).
        const wipes = l.effects.filter((e) => (e as { class_name?: string }).class_name === "Crop" && (e as { resize?: boolean }).resize === false);
        expect(wipes).toHaveLength(1);
      } else if (reveal === "pop") {
        expect(start.w).toBeLessThan(box.w * 0.7);
      } else {
        expect(alpha && evaluate(alpha, keyX(l, frame, 1))).toBe(0);
      }
    });
  });

  it("every layout builds with its default tiles, whole frames, entrances on the beat grid", () => {
    for (const layout of GRID_LAYOUTS) {
      const { plan, beats } = build(frame, { layout });
      const onGrid = new Set<number>([0]);
      for (let k = 0; beats.frame(k / 2) <= plan.frames; k += 1) onGrid.add(beats.frame(k / 2));
      for (const l of plan.layers) {
        expect(Number.isInteger(l.start) && Number.isInteger(l.frames), `${layout} ${l.name}`).toBe(true);
        expect(onGrid.has(l.cue), `${layout} ${l.name}`).toBe(true);
        expect(l.start).toBeGreaterThanOrEqual(l.cue);
        expect(l.start + l.frames).toBeLessThanOrEqual(plan.frames);
      }
      expect(tiles(plan).length).toBeGreaterThan(0);
    }
  });

  it("film_strip: sprocketed bands under the small frames, the big frame last", () => {
    const { plan } = build(frame, { layout: "film_strip", tiles: 5 });
    const bg = plan.layers.find((l) => l.name === "grid-bg")!;
    expect(bg.source.kind === "svg" && (bg.source.svg.match(/<rect/g) ?? []).length).toBeGreaterThan(20);
    const starts = tiles(plan).map((l) => l.start);
    expect(starts[starts.length - 1]).toBe(Math.max(...starts));
    expect(new Set(starts).size).toBe(starts.length);
  });
});

describe("montage grid length and refusals", () => {
  const frame = FRAMES.portrait!;
  const refusal = (grid: GridOptions, extra: Partial<MotionContent> = {}, o: { seconds?: number } = {}) => {
    try {
      build(frame, grid, extra, o);
    } catch (error) {
      expect(error).toBeInstanceOf(MotionInputError);
      return (error as Error).message;
    }
    throw new Error("expected a refusal");
  };

  it("takes its natural length from the layout: slots of a beat, two on a fast tempo", () => {
    expect(gridBeats({ grid: { tiles: 4 } }, 120)).toBe(6);
    expect(gridBeats({ grid: { steps: [3, 4, 6], merge: true } }, 120)).toBeGreaterThan(gridBeats({ grid: { steps: [3, 4, 6] } }, 120));
    // Beats come every 0.33 s at 180 BPM: one entrance every other beat.
    expect(gridBeats({ grid: { tiles: 4 } }, 180)).toBe(10);
    const { plan } = build(frame, { tiles: 4 });
    expect(plan.frames).toBe(new TemplateBeats(tempoGrid(120, 70, 0.25), 2, 30).frame(6));
  });

  it("falls back to half-beat slots when the template is short", () => {
    const { plan, beats } = build(frame, { tiles: 6 }, {}, { seconds: 3 });
    const starts = tiles(plan).map((l) => l.start);
    expect(starts).toEqual([0, 0.5, 1, 1.5, 2, 2.5].map((k) => beats.frame(k)));
  });

  it("refuses what it cannot lay out", () => {
    expect(refusal({}, { fileIds: [] })).toMatch(/needs file_ids/);
    expect(refusal({ layout: "grid", tiles: 5 })).toMatch(/grid layout takes 2, 3, 4, 6, 9 tiles|takes 2, 3, 4, 6, 9 tiles/);
    expect(refusal({ steps: [6, 4] })).toMatch(/must increase/);
    expect(refusal({ steps: [3, 4], tiles: 4 })).toMatch(/tiles or steps, not both/);
    expect(refusal({ merge: true, zoomInto: 1 })).toMatch(/merge or zoom_into/);
    expect(refusal({ tiles: 4, zoomInto: 5 })).toMatch(/zoom_into must be a tile from 1 to 4/);
    expect(refusal({ band: "wide" })).toMatch(/band/);
    expect(refusal({ reveal: "spin" as never })).toMatch(/reveal must be one of/);
    expect(refusal({ gutter: 90 })).toMatch(/gutter/);
    expect(refusal({}, { fileIds: [...FILES, ...FILES, ...FILES, ...FILES] })).toMatch(/at most 9 files/);
  });

  it("refuses tiles too small to read on a phone, and a template too short for even the fewest tiles", () => {
    expect(refusal({ layout: "strips_h", tiles: 6, band: "21:9" })).toMatch(/px on their short side/);
    expect(refusal({ steps: [3, 4, 6, 9], merge: true }, {}, { seconds: 0.3 })).toMatch(/needs at least [\d.]+ s/);
  });
});

describe("grid fitted to a short duration", () => {
  const frame = FRAMES.portrait!;
  const tiles = (plan: MotionPlan) => new Set(plan.layers.filter((l) => l.source.kind === "media").map((l) => l.name.replace(/-\d+$/, ""))).size;

  it("keeps the tiles asked for and fills one every quarter beat when that fits", () => {
    const { plan } = build(frame, { tiles: 9 }, {}, { seconds: 2 });
    expect(plan.warnings).toEqual(["grid with 9 tiles fills a tile every quarter beat to fit 2.0 s (give a longer duration_seconds for one per beat)"]);
    expect(plan.frames).toBe(60);
  });

  it("drops the earlier layout steps, then tiles, when even a quarter beat is too slow", () => {
    const { plan } = build(frame, { steps: [3, 4, 6, 9], merge: true }, {}, { seconds: 1.2 });
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings![0]).toMatch(/^grid with 3, 4, 6, 9 tiles does not fit 1\.2 s at this tempo; showing [\d, ]+ tiles instead/);
    expect(plan.layers.every((l) => l.start >= 0 && l.start + l.frames <= plan.frames)).toBe(true);
  });

  it("zooms into the last tile shown when the one asked for was dropped", () => {
    const { plan } = build(frame, { tiles: 9, zoomInto: 9 }, {}, { seconds: 0.9 });
    expect(plan.warnings!.join(" ")).toMatch(/zoom_into 9 is past the \d tiles shown; zooming into tile \d/);
  });

  it("fits a repeat's and a kaleidoscope's tiles that arrive together at their own length", () => {
    const one = { fileIds: [FILES[0]!] };
    expect(build(frame, { layout: "repeat", steps: [4, 16] }, one, { seconds: 2 }).plan.warnings).toBeUndefined();
    expect(build(frame, { layout: "kaleidoscope", tiles: 8 }, one, { seconds: 1.2 }).plan.warnings).toBeUndefined();
  });

  it("warns about nothing when the asked tiles fit at a beat or half beat", () => {
    expect(build(frame, { tiles: 4 }).plan.warnings).toBeUndefined();
    expect(tiles(build(frame, { tiles: 4 }).plan)).toBeGreaterThan(0);
  });
});

describe.each(Object.entries(FRAMES))("repeat and kaleidoscope fields, %s", (_name, frame) => {
  const inFrame = (l: MotionLayer) => (l.source.kind === "media" ? Math.round(l.source.start * frame.fps) : 0);
  const sign = (l: MotionLayer, prop: string) => Math.sign(evaluate(l.props[prop] as Keyframe, keyX(l, frame, 1)));
  /** A tile's box at clip frame `n`, whatever the sign of its scale. */
  const abs = (l: MotionLayer, n: number): Rect => {
    const b = boxAt(l, frame, keyX(l, frame, n));
    return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
  };
  /** Boxes of every tile on screen at template frame `f`. */
  const boxesAt = (plan: MotionPlan, f: number) => tiles(plan).filter((l) => l.start <= f && f < l.start + l.frames).map((l) => abs(l, f - l.start + 1));

  it("repeat: copies of one clip, one per beat, every copy on one clock so they stay in step", () => {
    const { plan } = build(frame, { layout: "repeat", tiles: 9 });
    const t = tiles(plan);
    expect(t).toHaveLength(9);
    expect(new Set(t.map((l) => l.source.kind === "media" && l.source.fileId))).toEqual(new Set(["VIDEO00002"]));
    expect(new Set(t.map((l) => l.start)).size).toBe(9);
    // The source frame at a template frame is the same on every copy: in-point minus the tile's start.
    expect(new Set(t.map((l) => inFrame(l) - l.start)).size).toBe(1);
    // Gapless and cut on (no entrance motion): one key per property, every copy full size.
    expect(t.every((l) => !l.props.scale_x || (l.props.scale_x as Keyframe).Points.length === 1)).toBe(true);
    expect(t.every((l) => sign(l, "scale_x") > 0 && sign(l, "scale_y") > 0)).toBe(true);
  });

  it("repeat with a phase: each copy runs `phase` seconds ahead of the one before", () => {
    const { plan } = build(frame, { layout: "repeat", tiles: 4, phase: 0.2 });
    const t = tiles(plan);
    const offsets = t.map((l) => inFrame(l) - l.start);
    offsets.forEach((o, i) => expect(o - offsets[0]!).toBe(i * 6));
  });

  it("repeat narrows the phase a short clip cannot hold, and slows a clip shorter than the field (all copies alike)", () => {
    const { plan } = build(frame, { layout: "repeat", tiles: 4, phase: 1 }, { fileIds: ["VIDEO00002"] }, { seconds: 6 });
    const t = tiles(plan);
    for (const l of t) expect(l.source.kind === "media" && l.source.end).toBeLessThanOrEqual(9 + 1e-6);
    const short = tiles(build(frame, { layout: "repeat", tiles: 4 }, { fileIds: ["SHORT00001"] }, { seconds: 4 }).plan);
    const speeds = new Set(short.map((l) => l.source.kind === "media" && l.source.speed));
    expect(speeds.size).toBe(1);
    const [speed] = [...speeds] as number[];
    expect(speed).toBeLessThan(1);
    expect(speed).toBeGreaterThanOrEqual(0.5);
    // Every copy lasts to the end of the template.
    for (const l of short) expect(l.start + l.frames).toBe(Math.round(4 * frame.fps));
  });

  it("mirror flips alternate copies; a kaleidoscope always does, all segments on one beat", () => {
    const mirrored = tiles(build(frame, { layout: "repeat", tiles: 4, mirror: true }).plan);
    expect(mirrored.map((l) => [sign(l, "scale_x"), sign(l, "scale_y")])).toEqual([
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]);
    for (const count of TILE_COUNTS.kaleidoscope) {
      const { plan, beats } = build(frame, { layout: "kaleidoscope", tiles: count });
      const t = tiles(plan);
      expect(new Set(t.map((l) => l.start))).toEqual(new Set([beats.frame(0)]));
      const flips = mirrorFlips(count, bandRect(frame, null));
      expect(t.map((l) => [sign(l, "scale_x") < 0, sign(l, "scale_y") < 0])).toEqual(flips.map((f) => [f.x, f.y]));
      // Every segment shows the same window of the shot.
      const crops = t.map((l) => JSON.stringify(l.effects.find((e) => (e as { class_name?: string }).class_name === "Crop")));
      expect(new Set(crops).size).toBe(1);
    }
  });

  it("gapless fields cover the frame with neighbours overlapping by a hair", () => {
    for (const layout of FIELD_LAYOUTS) {
      for (const count of TILE_COUNTS[layout]) {
        const { plan } = build(frame, { layout, tiles: count }, {}, { seconds: 12 });
        const boxes = boxesAt(plan, plan.frames - 1);
        expect(boxes, `${layout} ${count}`).toHaveLength(count);
        // Sample points across the frame (including every tile edge) all land inside some tile.
        for (let y = 0.5; y < frame.height; y += frame.height / 37) {
          for (let x = 0.5; x < frame.width; x += frame.width / 41) {
            expect(boxes.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h), `${layout} ${count} ${x},${y}`).toBe(true);
          }
        }
        for (const b of boxes) {
          expect(b.x).toBeGreaterThanOrEqual(-1.5);
          expect(b.x + b.w).toBeLessThanOrEqual(frame.width + 1.5);
        }
      }
    }
  });

  it("the kaleidoscope's mirror lines meet at the shot's centre (or the given point)", () => {
    const region = bandRect(frame, null);
    const picture = { width: 1080, height: 1920 };
    const tile = tileRects("kaleidoscope", 4, region, 0)[0]!;
    const w = kaleidoscopeWindow(picture, region, tile, 4, { x: 0.5, y: 0.5 });
    // 2 × 2: the unflipped top-left segment ends at the centre on both axes.
    expect(w.right).toBeCloseTo(0.5, 6);
    expect(w.bottom).toBeCloseTo(0.5, 6);
    // The picture covers the region on one axis exactly (a half-picture window there); on the other the centre can move.
    const square = { width: 3000, height: 3000 };
    const moved = kaleidoscopeWindow(square, region, tile, 4, { x: 0.6, y: 0.4 });
    if (frame.height > frame.width) expect(moved.right).toBeCloseTo(0.4, 6);
    else expect(moved.bottom).toBeCloseTo(0.6, 6);
    // A window keeps the tile's shape on the picture as it covers the region.
    const cover = Math.max(region.w / picture.width, region.h / picture.height);
    const ww = (1 - w.left - w.right) * picture.width * cover;
    const wh = (1 - w.top - w.bottom) * picture.height * cover;
    expect(ww / wh).toBeCloseTo(tile.w / tile.h, 6);
    // Eight segments: the tile left of the middle is mirrored, so the window starts at the centre.
    const eight = tileRects("kaleidoscope", 8, region, 0);
    const across = frame.width > frame.height ? 4 : 2;
    const w8 = kaleidoscopeWindow(picture, region, eight[0]!, 8, { x: 0.5, y: 0.5 });
    if (across === 4) expect(w8.left).toBeCloseTo(0.5, 6);
    else expect(w8.right).toBeCloseTo(0.5, 6);
  });

  it("drift: the field moves as one, edge to edge on every frame, and never shows an edge", () => {
    for (const drift of ["in", "out", "left", "right", "up", "down"] as const) {
      const { plan } = build(frame, { layout: "repeat", tiles: 4, drift }, {}, { seconds: 6 });
      for (const f of [plan.frames - 1, Math.round(plan.frames * 0.7), Math.round(plan.frames * 0.85)]) {
        const boxes = boxesAt(plan, f);
        expect(boxes).toHaveLength(4);
        const x0 = Math.min(...boxes.map((b) => b.x));
        const x1 = Math.max(...boxes.map((b) => b.x + b.w));
        const y0 = Math.min(...boxes.map((b) => b.y));
        const y1 = Math.max(...boxes.map((b) => b.y + b.h));
        expect(x0, `${drift} ${f}`).toBeLessThanOrEqual(0.5);
        expect(x1, `${drift} ${f}`).toBeGreaterThanOrEqual(frame.width - 0.5);
        expect(y0, `${drift} ${f}`).toBeLessThanOrEqual(0.5);
        expect(y1, `${drift} ${f}`).toBeGreaterThanOrEqual(frame.height - 0.5);
        // Neighbours still overlap: the left column's right edge is past the right column's left edge.
        const [a, b] = [...boxes].sort((p, q) => p.x - q.x || p.y - q.y);
        const right = [...boxes].sort((p, q) => q.x - p.x)[0]!;
        expect(Math.max(a!.x + a!.w, b!.x + b!.w), `${drift} ${f}`).toBeGreaterThanOrEqual(right.x);
      }
      const end = boxesAt(plan, plan.frames - 1);
      const start = boxesAt(plan, Math.round(plan.frames * 0.7));
      const width = (bs: Rect[]) => Math.max(...bs.map((b) => b.x + b.w)) - Math.min(...bs.map((b) => b.x));
      if (drift === "in") expect(width(end)).toBeGreaterThan(width(start));
      if (drift === "out") expect(width(end)).toBeLessThan(width(start));
      if (drift === "left") expect(Math.min(...end.map((b) => b.x))).toBeLessThan(Math.min(...start.map((b) => b.x)));
    }
  });

  it("drift on a montage of several clips: the popped tiles and their gutters scale as one", () => {
    const { plan } = build(frame, { layout: "grid", tiles: 4, drift: "in" }, {}, { seconds: 6 });
    // Gutter 6 at 1080 on a frame whose short side is 1080: the gaps grow with the push-in, the lattice stays square.
    for (const [f, z] of [
      [Math.round(plan.frames * 0.7), 1 + 0.12 * (Math.round(plan.frames * 0.7) / (plan.frames - 1))],
      [plan.frames - 1, 1.12],
    ] as const) {
      const boxes = boxesAt(plan, f).sort((p, q) => p.y - q.y || p.x - q.x);
      expect(boxes).toHaveLength(4);
      const [a, b, c] = boxes;
      const wide = frame.width > frame.height;
      const [p, q] = wide ? [a!, b!] : [a!, c!];
      expect(wide ? q.x - (p.x + p.w) : q.y - (p.y + p.h), `${f}`).toBeCloseTo(6 * z, 0);
      for (const box of boxes) expect(box.w, `${f}`).toBeCloseTo(boxes[0]!.w, 1);
    }
  });

  it("kaleidoscope steps re-cut all segments on the beat", () => {
    const { plan, beats } = build(frame, { layout: "kaleidoscope", steps: [2, 4, 8] }, {}, { seconds: 8 });
    const starts = [...new Set(tiles(plan).map((l) => l.start))].sort((a, b) => a - b);
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBe(beats.frame(0));
    // Spread over the 8 s (pace fill), every re-cut still on a beat.
    for (const at of starts) expect(Array.from({ length: 17 }, (_, k) => beats.frame(k))).toContain(at);
  });

  it("repeat fills one copy per beat, then multiplies on a re-cut: the new copies all on its beat", () => {
    const { plan } = build(frame, { layout: "repeat", steps: [4, 16] }, {}, { seconds: 5 });
    const second = tiles(plan).filter((l) => l.name.startsWith("tile-2-"));
    expect(second).toHaveLength(16);
    expect(new Set(second.map((l) => l.start)).size).toBe(1);
    expect(new Set(tiles(plan).filter((l) => l.name.startsWith("tile-1-")).map((l) => l.start)).size).toBe(4);
  });

  it("works on photos", () => {
    const { plan } = build(frame, { layout: "kaleidoscope", tiles: 6, drift: "in" }, { fileIds: ["PHOTO00001"] });
    expect(tiles(plan)).toHaveLength(6);
  });
});

describe("repeat and kaleidoscope refusals", () => {
  const frame = FRAMES.portrait!;
  const refusal = (grid: GridOptions, extra: Partial<MotionContent> = {}, o: { seconds?: number } = {}) => {
    try {
      build(frame, grid, extra, o);
    } catch (error) {
      expect(error).toBeInstanceOf(MotionInputError);
      return (error as Error).message;
    }
    throw new Error("expected a refusal");
  };

  it("refuses options a layout cannot use", () => {
    expect(refusal({ layout: "repeat" }, { fileIds: FILES })).toMatch(/one clip on every tile/);
    expect(refusal({ layout: "kaleidoscope", tiles: 3 })).toMatch(/takes 2, 4, 6, 8 tiles/);
    expect(refusal({ layout: "grid", phase: 0.2 })).toMatch(/phase only applies to the repeat/);
    expect(refusal({ layout: "kaleidoscope", mirror: true })).toMatch(/always mirrored/);
    expect(refusal({ layout: "mosaic", mirror: true })).toMatch(/mirror only applies to the repeat/);
    expect(refusal({ layout: "kaleidoscope", merge: true })).toMatch(/kaleidoscope takes no merge/);
    expect(refusal({ layout: "repeat", drift: "in", merge: true })).toMatch(/drift takes no merge/);
    expect(refusal({ layout: "repeat", drift: "in", band: "16:9" })).toMatch(/takes no band/);
    expect(refusal({ layout: "film_strip", drift: "in" })).toMatch(/film strip does not drift/);
    expect(refusal({ layout: "repeat", phase: 3 })).toMatch(/phase must be 0 to 2/);
    expect(refusal({ layout: "grid" }, { points: [{ x: 0.5, y: 0.5 }] })).toMatch(/points only apply to the kaleidoscope/);
    expect(refusal({ layout: "repeat", tiles: 4 }, { fileIds: ["SHORT00001"] }, { seconds: 8 })).toMatch(/even at half speed/);
  });
});

describe("grid filling the asked length", () => {
  const lastReveal = (plan: MotionPlan) => Math.max(...plan.layers.filter((l) => l.name.startsWith("tile-")).map((l) => l.start));

  it("spreads a 3 → 4 → 6 build over 15 s (fill, the default) instead of finishing at half of it", () => {
    const fill = build(FRAMES.portrait!, { steps: [3, 4, 6] }, {}, { seconds: 15, bpm: 143 });
    const beat = build(FRAMES.portrait!, { steps: [3, 4, 6], pace: "beat" }, {}, { seconds: 15, bpm: 143 });
    const fps = FRAMES.portrait!.fps;
    expect(lastReveal(beat.plan) / fps).toBeLessThan(7);
    expect(lastReveal(fill.plan) / fps).toBeGreaterThan(9.5);
    // Each layout reads as a layout: the 4-tile stage holds over 3 s, not 1.3.
    const stageStart = (plan: MotionPlan, s: number) => Math.min(...plan.layers.filter((l) => l.name.startsWith(`tile-${s}-`)).map((l) => l.start));
    expect((stageStart(fill.plan, 3) - stageStart(fill.plan, 2)) / fps).toBeGreaterThan(3);
    expect(fill.plan.frames).toBe(beat.plan.frames);
    // Still on the beat grid: every tile arrives on a beat.
    const onBeat = new Set(Array.from({ length: 80 }, (_, k) => fill.beats.frame(k)));
    for (const l of fill.plan.layers.filter((l) => l.name.startsWith("tile-"))) expect(onBeat.has(l.start), l.name).toBe(true);
  });

  it("refuses an unknown pace", () => {
    expect(() => build(FRAMES.portrait!, { pace: "slow" as never })).toThrow(MotionInputError);
  });
});

describe("grid tiles from clips shorter than their tile", () => {
  it("slows a 0.2 s shot (to 1/16 at most) so its tile stays up, and says so", () => {
    const tiny: MotionMedia = { fileId: "FLASH00001", kind: "video", width: 1920, height: 1080, duration: 0.2 };
    const tempo = tempoGrid(120, 70, 0.25);
    const plan = buildMotionTemplate({
      template: "grid",
      frame: FRAMES.landscape!,
      start: 2,
      seconds: 4,
      grid: tempo,
      palette: PALETTES.ui_dark,
      media: new Map([...MEDIA_BY_ID, [tiny.fileId, tiny]]),
      content: { fileIds: ["FLASH00001", "VIDEO00001"], grid: { layout: "mosaic", tiles: 3, pace: "beat" } },
    });
    const tile = plan.layers.find((l) => l.name === "tile-1-1")!;
    expect(tile.source.kind === "media" && tile.source.speed).toBeGreaterThanOrEqual(1 / 16);
    // 0.2 s at 1/16 is 3.2 s: the tile stays up to the end of the 4 s grid less the frames before it arrives.
    expect(tile.frames / 30).toBeGreaterThan(3);
    expect(plan.warnings?.join(" ")).toMatch(/FLASH00001\): slowed down/);
    // Longer than 16 × the clip: it loops on the tile's track, the tile never empty.
    const long = buildMotionTemplate({
      template: "grid",
      frame: FRAMES.landscape!,
      start: 2,
      seconds: 8,
      grid: tempo,
      palette: PALETTES.ui_dark,
      media: new Map([...MEDIA_BY_ID, [tiny.fileId, tiny]]),
      content: { fileIds: ["FLASH00001", "VIDEO00001"], grid: { layout: "mosaic", tiles: 3, pace: "beat" } },
    });
    const pieces = long.layers.filter((l) => l.name.startsWith("tile-1-1")).sort((a, b) => a.start - b.start);
    expect(pieces.length).toBeGreaterThan(1);
    for (let k = 1; k < pieces.length; k += 1) expect(pieces[k]!.start).toBe(pieces[k - 1]!.start + pieces[k - 1]!.frames);
    expect(pieces.at(-1)!.start + pieces.at(-1)!.frames).toBe(long.frames);
  });
});
