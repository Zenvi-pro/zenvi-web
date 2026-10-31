import { describe, expect, it } from "vitest";
import { evaluate } from "../../keyframe/evaluate.js";
import type { Keyframe } from "../../model/types.js";
import { buildMotionTemplate } from "../build.js";
import { tempoGrid } from "../grid.js";
import { PALETTES } from "../palettes.js";
import type { MotionContent, MotionTemplateId } from "../template.js";
import type { MotionFrame, MotionLayer, MotionMedia, MotionPlan } from "../types.js";

const WIDE: MotionFrame = { width: 1920, height: 1080, fps: 30 };
const TALL: MotionFrame = { width: 1080, height: 1920, fps: 30 };
const MEDIA: MotionMedia[] = [
  { fileId: "PLATE00001", kind: "video", width: 1920, height: 1080, duration: 12 },
  { fileId: "MATTE00001", kind: "video", width: 1920, height: 1080, duration: 6 },
  { fileId: "COMP000001", kind: "video", width: 1920, height: 1080, duration: 9 },
  { fileId: "PHONE00001", kind: "video", width: 1080, height: 1920, duration: 8 },
];
const BY_ID = new Map(MEDIA.map((m) => [m.fileId, m]));
const IDS = MEDIA.map((m) => m.fileId);

function build(template: MotionTemplateId, content: MotionContent, frame = WIDE, seconds?: number): MotionPlan {
  return buildMotionTemplate({ template, frame, start: 0, ...(seconds ? { seconds } : {}), grid: tempoGrid(120, 60), palette: PALETTES.ui_dark, media: BY_ID, content });
}

const layer = (plan: MotionPlan, name: string): MotionLayer => {
  const found = plan.layers.find((l) => l.name === name);
  if (!found) throw new Error(`no layer ${name} in ${plan.layers.map((l) => l.name).join(", ")}`);
  return found;
};
const kf = (l: MotionLayer, prop: string) => l.props[prop] as Keyframe | undefined;
const inFrames = (l: MotionLayer) => (l.source.kind === "media" ? Math.round(l.source.start * 30) : 0);

describe("card_cascade", () => {
  it("drops the cards one per half beat in a staggered grid, the newest card heard until the next lands", () => {
    const plan = build("card_cascade", { fileIds: IDS, sound: true });
    const cards = plan.layers.filter((l) => /^card-\d+$/.test(l.name));
    expect(cards.map((c) => c.start)).toEqual([0, 8, 15, 23]);
    // Each card lands over the one before (higher track), on the paper field.
    expect(new Set(cards.map((c) => c.track)).size).toBe(4);
    expect(cards.every((c, i) => i === 0 || c.track > cards[i - 1]!.track)).toBe(true);
    expect(layer(plan, "cascade-bg").source.kind).toBe("svg");
    // Odd columns sit lower: the second card's centre is below the first's.
    const y = (l: MotionLayer) => evaluate(kf(l, "location_y")!, inFrames(l) + 30);
    expect(y(cards[1]!)).toBeGreaterThan(y(cards[0]!) + 0.05);
    // Sound hands over: card 1 fades out by card 2's landing (frame 8), the last keeps its sound.
    const vol = kf(cards[0]!, "volume")!;
    expect(evaluate(vol, inFrames(cards[0]!) + 1)).toBe(1);
    expect(evaluate(vol, inFrames(cards[0]!) + 9)).toBe(0);
    expect(cards.every((c) => c.source.kind === "media" && c.source.sound)).toBe(true);
    expect(kf(cards[3]!, "volume")).toBeUndefined();
  });

  it("lays wide clips on a tall frame as an overlapping zig-zag, over a blur of the first clip", () => {
    const plan = build("card_cascade", { fileIds: IDS.slice(0, 3), variant: "blur" }, TALL);
    const bg = layer(plan, "cascade-bg");
    expect(bg.source.kind === "media" && bg.source.fileId).toBe("PLATE00001");
    expect(bg.effects.map((e) => (e as { class_name: string }).class_name)).toEqual(["Blur", "Brightness"]);
    const cards = plan.layers.filter((l) => /^card-\d+$/.test(l.name));
    const x = (l: MotionLayer) => evaluate(kf(l, "location_x")!, inFrames(l) + 40);
    expect(Math.sign(x(cards[0]!))).toBe(-1);
    expect(Math.sign(x(cards[1]!))).toBe(1);
    expect(() => build("card_cascade", { fileIds: IDS.slice(0, 1) })).toThrow(/2 to 9/);
    expect(() => build("card_cascade", { fileIds: IDS, variant: "glass" })).toThrow(/variant/);
  });
});

describe("compare", () => {
  it("frame-locks every clip to one in-point the shortest allows", () => {
    for (const variant of ["side_by_side", "stacked", "diagonal", "offset"]) {
      const files = variant === "diagonal" ? IDS.slice(0, 2) : IDS.slice(0, 3);
      const plan = build("compare", { fileIds: files, variant, labels: ["Raw", "Matte", "Comp"] });
      const panels = plan.layers.filter((l) => /^panel-\d+$/.test(l.name));
      expect(panels).toHaveLength(files.length);
      // Panels arrive half a beat apart, yet on every frame they show the same source frame.
      expect(new Set(panels.map((p) => p.start)).size, variant).toBe(files.length);
      expect(new Set(panels.map((p) => inFrames(p) - p.start)).size, variant).toBe(1);
      if (variant === "offset") {
        const bg = plan.layers.find((l) => l.name === "compare-bg")!;
        expect(inFrames(bg) - bg.start).toBe(inFrames(panels[0]!) - panels[0]!.start);
      }
      expect(plan.layers.filter((l) => l.name.startsWith("label-"))).toHaveLength(files.length);
    }
  });

  it("splits a diagonal with a polygon window carrying the rule, and replays the second clip whole", () => {
    const plan = build("compare", { fileIds: IDS.slice(0, 2), variant: "diagonal", replay: true });
    const b = layer(plan, "panel-2");
    expect(b.mask?.svg).toMatch(/<linearGradient/);
    const mask = b.mask!.effect as unknown as { class_name: string; mask_invert: boolean; brightness: Keyframe };
    expect(mask.class_name).toBe("Mask");
    expect(mask.mask_invert).toBe(true);
    // Shut on nothing, open on the whole picture by the replay's end.
    const xs = mask.brightness.Points.map((p) => p.co.Y);
    expect(xs[0]).toBe(0);
    expect(xs[xs.length - 1]).toBe(1);
    // The rule rides on the second clip's edge: the same horizontal travel.
    const rule = layer(plan, "compare-rule");
    expect(evaluate(kf(rule, "rotation")!, 1)).toBeGreaterThan(5);
    expect(() => build("compare", { fileIds: IDS.slice(0, 3), variant: "diagonal" })).toThrow(/takes 2/);
  });

  it("replays a split's last clip through its panel's window so the full frame shows the whole clip", () => {
    const plan = build("compare", { fileIds: IDS.slice(0, 2), replay: true });
    const last = layer(plan, "panel-2");
    expect(last.mask).toBeDefined();
    // No Crop: the clip is drawn whole; the first panel keeps its crop.
    expect(last.effects.some((e) => (e as { class_name: string }).class_name === "Crop")).toBe(false);
    expect(layer(plan, "panel-1").effects.some((e) => (e as { class_name: string }).class_name === "Crop")).toBe(true);
    // At the end it sits centred.
    expect(Math.abs(evaluate(kf(last, "location_x")!, inFrames(last) + last.frames))).toBeLessThan(1e-6);
  });
});

describe("window_cascade", () => {
  it("staggers the panes a few frames apart on one beat, then sends the middle pane to full bleed on top", () => {
    const plan = build("window_cascade", { fileIds: IDS.slice(0, 4) }, WIDE, 3);
    const panes = plan.layers.filter((l) => l.name.startsWith("pane-"));
    expect(panes.map((p) => p.start).sort((a, b) => a - b)).toEqual([0, 3, 6, 9]);
    expect(panes.every((p) => p.cue === 0 && p.mask)).toBe(true);
    const hero = layer(plan, "pane-2");
    expect(hero.track).toBe(Math.max(...panes.map((p) => p.track)));
    expect(hero.start + hero.frames).toBe(plan.frames);
    expect(panes.filter((p) => p !== hero).every((p) => p.start + p.frames < plan.frames)).toBe(true);
    // Every pane is a clean parallelogram: four sides in its mask.
    expect(hero.mask!.svg.match(/<linearGradient/g)).toHaveLength(4);
    expect(plan.cues).toEqual([0, 45]);
  });

  it("warns when there is no room for the full bleed, and refuses too many panes", () => {
    const short = build("window_cascade", { fileIds: IDS.slice(0, 2) }, WIDE, 1.2);
    expect(short.warnings?.[0]).toMatch(/full-bleed/);
    expect(() => build("window_cascade", { fileIds: [...IDS, ...IDS] })).toThrow(/2 to 6/);
  });
});

describe("pass_wipe", () => {
  it("wipes each pass on over the last, its hairline exactly on the crop's edge", () => {
    const plan = build("pass_wipe", { fileIds: IDS.slice(0, 3), labels: ["Plate", "Matte", "Comp"] }, WIDE, 3);
    const passes = plan.layers.filter((l) => l.name.startsWith("pass-"));
    expect(passes.map((p) => p.start)).toEqual([0, 30, 60]);
    // Frame-locked: each pass is wiped on over the same source frame of the shot as the one under it.
    expect(new Set(passes.map((p) => inFrames(p) - p.start)).size).toBe(1);
    // A covered pass ends once the next wipe has landed.
    expect(passes[0]!.start + passes[0]!.frames).toBe(30 + 14);
    const pass = passes[1]!;
    const crop = pass.effects.find((e) => (e as { class_name: string }).class_name === "Crop") as unknown as Record<string, Keyframe> & { resize: boolean };
    expect(crop.resize).toBe(false);
    const hair = layer(plan, "hairline-1");
    expect(hair.source.kind).toBe("svg");
    const width = hair.source.kind === "svg" ? hair.source.width : 0;
    for (const f of [0, 3, 7, 10, 14]) {
      const right = evaluate(crop.right!, inFrames(pass) + 1 + f);
      const edge = (1 - right) * WIDE.width;
      // The drawing's scale divides out Best Fit: its left plus half its width is its centre.
      const fit = Math.min(WIDE.width / width, WIDE.height / (hair.source.kind === "svg" ? hair.source.height : 1));
      const scale = kf(hair, "scale_x");
      const centre = evaluate(kf(hair, "location_x")!, 1 + f) * WIDE.width + (width * (scale ? evaluate(scale, 1 + f) : 1) * fit) / 2;
      expect(Math.abs(centre - edge), `frame ${f}`).toBeLessThan(1);
    }
    expect(plan.layers.filter((l) => l.name.startsWith("stage-"))).toHaveLength(3);
    expect(() => build("pass_wipe", { fileIds: IDS.slice(0, 2), variant: "diagonal" })).toThrow(/right, left, down, up/);
  });
});

describe("reflow", () => {
  /** The box a cell shows at clip frame `x`: its centre from the pose, its size from the picture less the crop. */
  function shownBox(l: MotionLayer, x: number, pictureWidth: number, aspect: number): { x: number; y: number; w: number; h: number } {
    const crop = l.effects.find((e) => (e as { class_name: string }).class_name === "Crop") as unknown as Record<string, Keyframe>;
    const cx = (0.5 + evaluate(kf(l, "location_x")!, x)) * WIDE.width;
    const cy = (0.5 + evaluate(kf(l, "location_y")!, x)) * WIDE.height;
    const w = pictureWidth * (1 - evaluate(crop.left!, x) - evaluate(crop.right!, x));
    const h = (pictureWidth / aspect) * (1 - evaluate(crop.top!, x) - evaluate(crop.bottom!, x));
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  it("moves each cell through the given states on the beat, the crop and the pose landing on each box together", () => {
    const states = [
      [
        { x: 0.3, y: 0.5, w: 0.6, h: 1 },
        { x: 0.8, y: 0.5, w: 0.4, h: 1 },
      ],
      [
        { x: 0.5, y: 0.5, w: 1, h: 1 },
        { x: 0.5, y: 0.5, w: 1, h: 1 },
      ],
    ];
    const plan = build("reflow", { fileIds: IDS.slice(0, 2), states }, WIDE, 4);
    expect(plan.cues).toEqual([0, 15, 45]);
    const cell = layer(plan, "cell-1");
    // The first cell is on top (it is the one left when the cells collapse).
    expect(cell.track).toBeGreaterThan(layer(plan, "cell-2").track);
    const x0 = inFrames(cell) + 1;
    const box = (f: number) => shownBox(cell, x0 + f, WIDE.width, 16 / 9);
    // After the first move (beat 1 + 12 frames) it shows the first given box; after the second, the whole frame.
    const near = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => {
      for (const k of ["x", "y", "w", "h"] as const) expect(a[k]).toBeCloseTo(b[k], 0);
    };
    near(box(15 + 12), { x: 0, y: 0, w: 0.6 * 1920, h: 1080 });
    near(box(45 + 12), { x: 0, y: 0, w: 1920, h: 1080 });
    // Mid-move every side is on the straight line between the two boxes (one ease on pose and crop).
    const mid = box(15 + 6);
    const start = box(15);
    const end = box(27);
    const t = (mid.w - start.w) / (end.w - start.w);
    expect(mid.x).toBeCloseTo(start.x + t * (end.x - start.x), 0);
    expect(() => build("reflow", { fileIds: IDS.slice(0, 2), states: [[{ x: 0.5, y: 0.5, w: 1, h: 1 }]] })).toThrow(/one per cell/);
  });

  it("drops states that do not fit the duration, with a warning", () => {
    const plan = build("reflow", { fileIds: IDS.slice(0, 3) }, WIDE, 1.2);
    expect(plan.warnings?.[0]).toMatch(/did not fit/);
    expect(plan.cues).toEqual([0, 15]);
  });
});
