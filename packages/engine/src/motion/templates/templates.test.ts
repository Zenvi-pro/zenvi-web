import { describe, expect, it } from "vitest";
import { evaluate } from "../../keyframe/evaluate.js";
import type { Keyframe } from "../../model/types.js";
import { getAttr, parseXml, type XmlElement } from "../../titles/xml.js";
import { buildMotionTemplate } from "../build.js";
import { tempoGrid, TemplateBeats } from "../grid.js";
import { PALETTES } from "../palettes.js";
import { MOTION_TEMPLATE_IDS, MotionInputError, type MotionContent, type MotionTemplateId } from "../template.js";
import type { MotionFrame, MotionLayer, MotionMedia, MotionPlan, PaletteId } from "../types.js";
import { TEMPLATES } from "./index.js";

const FRAMES: Record<string, MotionFrame> = {
  portrait: { width: 1080, height: 1920, fps: 30 },
  landscape: { width: 1920, height: 1080, fps: 30 },
};

const MEDIA: MotionMedia[] = [
  { fileId: "VIDEO00001", kind: "video", width: 1920, height: 1080, duration: 12 },
  { fileId: "VIDEO00002", kind: "video", width: 1080, height: 1920, duration: 3 },
  { fileId: "PHOTO00001", kind: "image", width: 1600, height: 1200, duration: 0 },
];
const MEDIA_BY_ID = new Map(MEDIA.map((m) => [m.fileId, m]));

/** Content that exercises every part of each template (invented names only). */
const CONTENT: Record<MotionTemplateId, { content: MotionContent; palette: PaletteId }> = {
  ui_cards: { content: { fileIds: ["VIDEO00001", "VIDEO00002"], labels: ["Slow pour", "Ten pages", "Notes"], button: "Save", subtitle: "Three minutes a day" }, palette: "ui_light" },
  type_search: { content: { text: "Plan a slower morning", button: "Search", tag: "Zenvi", subtitle: "What's on today?", labels: ["Slow pour", "Ten pages"] }, palette: "ui_light" },
  word_scroll: { content: { words: ["Explore", "Imagine", "Create", "Share"], text: "Made to" }, palette: "ui_dark" },
  crop_labels: { content: { fileIds: ["VIDEO00001"], labels: ["Surface_01", "Surface_02", "Surface_03"] }, palette: "editorial" },
  callout: { content: { fileIds: ["PHOTO00001"], text: "Lumen Runner", labels: ["Knit upper", "Foam core", "Grip plate"], values: ["0.6 mm mesh", "212 g", "38 lugs"] }, palette: "callout" },
  kinetic_type: { content: { text: "LIVING GE*METRY IN BL**M", fileIds: ["VIDEO00001", "PHOTO00001"], tag: "Specimen_01", highlight: 1 }, palette: "editorial" },
  step_card: { content: { fileIds: ["VIDEO00001"], text: "Record yourself", step: 1, tag: "Eye level", points: [{ x: 0.6, y: 0.4 }], subtitle: "Film better reels" }, palette: "tutorial" },
  grid_background: { content: { variant: "editorial", labels: ["Plate 01", "Study", "1:1", "Zenvi"] }, palette: "editorial" },
  end_card: { content: { variant: "logo", text: "Northwind", subtitle: "Brews in four minutes" }, palette: "ui_light" },
};

const ALLOWED = new Set(["svg", "rect", "line", "polyline", "path", "circle", "text", "tspan"]);
const FORBIDDEN_ATTRS = ["style", "filter", "clip-path", "mask", "href", "xlink:href", "class"];

function elements(root: XmlElement): XmlElement[] {
  return [root, ...root.children.filter((c): c is XmlElement => c.kind === "element").flatMap(elements)];
}

function keyframes(layer: MotionLayer): [string, Keyframe][] {
  return Object.entries(layer.props).filter((e): e is [string, Keyframe] => typeof e[1] === "object" && e[1] !== null && Array.isArray((e[1] as Keyframe).Points));
}

function build(id: MotionTemplateId, frame: MotionFrame, bpm = 120, start = 2): { plan: MotionPlan; beats: TemplateBeats } {
  const grid = tempoGrid(bpm, start + 60, 0.25);
  const { content, palette } = CONTENT[id];
  const plan = buildMotionTemplate({ template: id, frame, start, grid, palette: PALETTES[palette], media: MEDIA_BY_ID, content });
  return { plan, beats: new TemplateBeats(grid, start, frame.fps) };
}

describe.each(Object.entries(FRAMES))("motion templates, %s", (_name, frame) => {
  it.each(MOTION_TEMPLATE_IDS)("%s: valid SVG, whole frames, entrances on the beat grid, text in the frame", (id) => {
    const { plan, beats } = build(id, frame);
    expect(plan.layers.length).toBeGreaterThan(0);
    expect(plan.tracks).toBe(new Set(plan.layers.map((l) => l.track)).size);
    // The template's start and the half beats of the grid within it: every cue must be one of them.
    const grid = new Set<number>([0]);
    for (let k = 0; beats.frame(k / 2) <= plan.frames; k += 1) grid.add(beats.frame(k / 2));
    for (const cue of plan.cues) expect(grid.has(cue), `cue ${cue} of ${id}`).toBe(true);

    for (const layer of plan.layers) {
      expect(Number.isInteger(layer.start) && Number.isInteger(layer.frames), layer.name).toBe(true);
      expect(layer.start).toBeGreaterThanOrEqual(0);
      expect(layer.start + layer.frames).toBeLessThanOrEqual(plan.frames);
      // Every entrance belongs to a beat: it starts on it, or follows it (a stagger, a keystroke).
      expect(grid.has(layer.cue), `${id} ${layer.name}: cue ${layer.cue} is off the grid`).toBe(true);
      expect(layer.start, `${id} ${layer.name} starts before its beat`).toBeGreaterThanOrEqual(layer.cue);
      for (const [prop, kf] of keyframes(layer)) {
        for (const p of kf.Points) expect(Number.isInteger(p.co.X) && p.co.X >= 1, `${layer.name}.${prop}`).toBe(true);
      }
      if (layer.source.kind !== "svg") continue;
      const doc = parseXml(layer.source.svg);
      expect(Number(getAttr(doc.root, "width"))).toBe(layer.source.width);
      expect(Number(getAttr(doc.root, "height"))).toBe(layer.source.height);
      for (const el of elements(doc.root)) {
        expect(ALLOWED.has(el.name), `${layer.name}: <${el.name}>`).toBe(true);
        for (const [attr] of el.attrs) expect(FORBIDDEN_ATTRS, `${layer.name}: ${attr}`).not.toContain(attr);
      }
      // Scale points never pass 1: libopenshot sizes a scale-None clip's raster by them.
      for (const prop of ["scale_x", "scale_y"]) {
        const kf = layer.props[prop] as Keyframe | undefined;
        if (kf) expect(Math.max(...kf.Points.map((p) => p.co.Y))).toBeCloseTo(1, 9);
      }
      // At its last key a drawing with text sits inside the frame (shadows may spill a little).
      if (/<text/.test(layer.source.svg) && !layer.bleed) {
        const last = (name: string, fallback: number) => {
          const kf = layer.props[name] as Keyframe | undefined;
          return kf ? evaluate(kf, layer.frames) : fallback;
        };
        const left = last("location_x", 0) * frame.width;
        const top = last("location_y", 0) * frame.height;
        const width = layer.source.width * last("scale_x", 1);
        const height = layer.source.height * last("scale_y", 1);
        const slack = 0.02 * frame.width;
        expect(left, `${id} ${layer.name} left`).toBeGreaterThanOrEqual(-slack);
        expect(top, `${id} ${layer.name} top`).toBeGreaterThanOrEqual(-slack);
        expect(left + width, `${id} ${layer.name} right`).toBeLessThanOrEqual(frame.width + slack);
        expect(top + height, `${id} ${layer.name} bottom`).toBeLessThanOrEqual(frame.height + slack);
      }
    }
  });
});

describe("motion templates", () => {
  it("follow any tempo: entrances move with the beat", () => {
    const slow = build("word_scroll", FRAMES.portrait!, 90).plan;
    const fast = build("word_scroll", FRAMES.portrait!, 140).plan;
    expect(slow.cues[1]! - slow.cues[0]!).toBeGreaterThan(fast.cues[1]! - fast.cues[0]!);
  });

  it("start entrances on the first beat after a start that is not on the beat", () => {
    const grid = tempoGrid(120, 30, 0.25);
    const plan = buildMotionTemplate({ template: "end_card", frame: FRAMES.landscape!, start: 1, grid, palette: PALETTES.ui_light, media: MEDIA_BY_ID, content: CONTENT.end_card.content });
    // Beats at 1.25, 1.75 s…: the backdrop is there from the start, the first entrance 0.25 s
    // (8 frames at 30 fps, rounded) after it.
    expect(plan.cues.slice(0, 2)).toEqual([0, 8]);
    expect(plan.layers.find((l) => l.name === "end-mark")?.start).toBe(8);
  });

  it("refuse content they cannot show, with a reason", () => {
    const grid = tempoGrid(120, 30);
    const run = (template: MotionTemplateId, content: MotionContent) => () =>
      buildMotionTemplate({ template, frame: FRAMES.portrait!, start: 0, grid, palette: PALETTES.ui_light, media: MEDIA_BY_ID, content });
    expect(run("word_scroll", { words: ["One"] })).toThrow(MotionInputError);
    expect(run("kinetic_type", { text: "A * B" })).toThrow(/file_ids/);
    expect(run("callout", { fileIds: ["PHOTO00001"] })).toThrow(/labels/);
    expect(run("type_search", { text: "x".repeat(80) })).toThrow(/one line/);
    expect(run("end_card", { variant: "logo" })).toThrow(/needs text/);
    expect(run("grid_background", { variant: "stripes" })).toThrow(/variant/);
  });

  it("describe themselves for the tool", () => {
    for (const id of MOTION_TEMPLATE_IDS) {
      expect(TEMPLATES[id].summary.length, id).toBeGreaterThan(40);
      expect(TEMPLATES[id].beats(CONTENT[id].content, 120), id).toBeGreaterThan(1);
    }
  });
});
