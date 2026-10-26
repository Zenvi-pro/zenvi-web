import { describe, expect, it } from "vitest";
import { evaluate } from "../../keyframe/evaluate.js";
import { ScaleMode, type Keyframe } from "../../model/types.js";
import { getAttr, parseXml, type XmlElement } from "../../titles/xml.js";
import { buildMotionTemplate } from "../build.js";
import { tempoGrid, TemplateBeats } from "../grid.js";
import { layoutOf, opticalCentre, TYPE_FLOOR, type TypeRole } from "../layout.js";
import { PALETTES } from "../palettes.js";
import { textWidth } from "../text.js";
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
  word_scroll: { content: { words: ["Plan", "Brew", "Read", "Begin"], text: "Made to" }, palette: "ui_dark" },
  crop_labels: { content: { fileIds: ["VIDEO00001"], labels: ["Rim", "Glaze", "Foot ring"] }, palette: "editorial" },
  callout: { content: { fileIds: ["PHOTO00001"], text: "Lumen Runner", labels: ["Knit upper", "Foam core", "Grip plate"], values: ["0.6 mm mesh", "212 g", "38 lugs"] }, palette: "callout" },
  kinetic_type: { content: { text: "QUIET F*RMS IN W**D AND CLAY", fileIds: ["VIDEO00001", "PHOTO00001"], tag: "No. 01", highlight: 1 }, palette: "editorial" },
  step_card: { content: { fileIds: ["VIDEO00001"], text: "Set up the shot", step: 1, tag: "Eye level", points: [{ x: 0.6, y: 0.4 }], subtitle: "Film better reels" }, palette: "tutorial" },
  grid_background: { content: { variant: "editorial", labels: ["Plate 01", "Study", "1:1", "Zenvi"] }, palette: "editorial" },
  end_card: { content: { variant: "logo", text: "Northwind", subtitle: "Brews in four minutes" }, palette: "ui_light" },
  grid: { content: { fileIds: ["VIDEO00001", "VIDEO00002", "PHOTO00001"], grid: { layout: "grid", steps: [3, 4, 6], merge: true } }, palette: "ui_dark" },
};

const ALLOWED = new Set(["svg", "rect", "line", "polyline", "path", "circle", "text", "tspan"]);
const FORBIDDEN_ATTRS = ["style", "filter", "clip-path", "mask", "href", "xlink:href", "class"];

function elements(root: XmlElement): XmlElement[] {
  return [root, ...root.children.filter((c): c is XmlElement => c.kind === "element").flatMap(elements)];
}

function keyframes(layer: MotionLayer): [string, Keyframe][] {
  return Object.entries(layer.props).filter((e): e is [string, Keyframe] => typeof e[1] === "object" && e[1] !== null && Array.isArray((e[1] as Keyframe).Points));
}

/**
 * A layer's box on the frame at clip frame `at` (rotation left out), as Best Fit places it. For a drawing, `sx` and
 * `sy` are frame pixels per SVG pixel.
 */
function boxAt(layer: MotionLayer, frame: MotionFrame, at: number): { left: number; top: number; right: number; bottom: number; sx: number; sy: number } {
  const value = (name: string, fallback: number) => {
    const kf = layer.props[name] as Keyframe | undefined;
    return kf ? evaluate(kf, at) : fallback;
  };
  const sx = value("scale_x", 1);
  const sy = value("scale_y", 1);
  if (layer.source.kind === "svg") {
    const fit = Math.min(frame.width / layer.source.width, frame.height / layer.source.height);
    const left = value("location_x", 0) * frame.width;
    const top = value("location_y", 0) * frame.height;
    return { left, top, right: left + layer.source.width * sx * fit, bottom: top + layer.source.height * sy * fit, sx: sx * fit, sy: sy * fit };
  }
  const media = MEDIA_BY_ID.get(layer.source.fileId)!;
  const crop = layer.effects.find((e) => (e as { class_name?: string }).class_name === "Crop") as Record<string, Keyframe> | undefined;
  const cut = (side: string) => (crop ? evaluate(crop[side]!, 1) : 0);
  const aspect = (media.width * (1 - cut("left") - cut("right"))) / (media.height * (1 - cut("top") - cut("bottom")));
  const fit = aspect > frame.width / frame.height ? { w: frame.width, h: frame.width / aspect } : { w: frame.height * aspect, h: frame.height };
  const cx = (0.5 + value("location_x", 0)) * frame.width;
  const cy = (0.5 + value("location_y", 0)) * frame.height;
  return { left: cx - (fit.w * sx) / 2, top: cy - (fit.h * sy) / 2, right: cx + (fit.w * sx) / 2, bottom: cy + (fit.h * sy) / 2, sx, sy };
}

/**
 * The keyframe X (clip frame, from the in-point for media) of the pose a layer holds still the longest while
 * fully visible: how it is mostly seen. Null when it is never still and visible.
 */
function heldFrame(layer: MotionLayer, fps = 30): number | null {
  const kfs = keyframes(layer).map(([, kf]) => kf);
  // Media keyframes count from the in-point (constant ones sit at 1).
  const first = 1 + (layer.source.kind === "media" ? Math.round(layer.source.start * fps) : 0);
  const end = first + layer.frames;
  const xs = [...new Set([first, ...kfs.flatMap((kf) => kf.Points.map((p) => p.co.X)).filter((x) => x > first && x < end)])].sort((a, b) => a - b);
  const same = (a: number, b: number) => kfs.every((kf) => Math.abs(evaluate(kf, a) - evaluate(kf, b)) < 1e-6);
  const alpha = layer.props.alpha as Keyframe | undefined;
  let best: { x: number; still: number } | null = null;
  for (let i = 0; i < xs.length; i += 1) {
    if (alpha && evaluate(alpha, xs[i]!) < 0.99) continue;
    // Still until the first key that moves it (the clip's end for the last).
    let j = i;
    while (j + 1 < xs.length && same(xs[i]!, xs[j + 1]!)) j += 1;
    const still = j + 1 < xs.length ? (j > i ? xs[j]! - xs[i]! : 0) : end - xs[i]!;
    if (!best || still > best.still) best = { x: xs[i]!, still };
  }
  return best === null ? null : (best as { x: number }).x;
}

interface PlacedText {
  text: string;
  /** Size on screen, px. */
  size: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Every text of a drawing as it is mostly seen: on-screen size and box (Helvetica / 0.6 em mono metrics, cap top to descender). */
function textsOf(layer: MotionLayer, frame: MotionFrame): PlacedText[] {
  if (layer.source.kind !== "svg" || !layer.source.svg.includes("<text")) return [];
  const at = heldFrame(layer);
  if (at === null) return [];
  const box = boxAt(layer, frame, at);
  const content = (el: XmlElement): string => el.children.map((c) => (c.kind === "text" ? c.data : c.kind === "element" ? content(c) : "")).join("");
  return elements(parseXml(layer.source.svg).root)
    .filter((el) => el.name === "text")
    .map((el) => {
      const size = Number(getAttr(el, "font-size"));
      const text = content(el);
      const style = { size, font: getAttr(el, "font-family").startsWith("Menlo") ? ("mono" as const) : ("sans" as const), bold: getAttr(el, "font-weight") === "bold", tracking: Number(getAttr(el, "letter-spacing") || 0) / size };
      const w = textWidth(text, style);
      const anchor = getAttr(el, "text-anchor");
      const x0 = Number(getAttr(el, "x")) - (anchor === "middle" ? w / 2 : anchor === "end" ? w : 0);
      const y = Number(getAttr(el, "y"));
      return { text, size: size * box.sy, left: box.left + x0 * box.sx, right: box.left + (x0 + w) * box.sx, top: box.top + (y - 0.72 * size) * box.sy, bottom: box.top + (y + 0.22 * size) * box.sy };
    });
}

/** The type role of a layer's biggest words. */
const ROLES: [RegExp, TypeRole][] = [
  [/^callout-heading$/, "heading"],
  [/^callout-label-/, "body"],
  [/^search-(type-|text$|caret)/, "body"],
  [/^search-(row-|brand$|button$)/, "body"],
  [/^search-prompt$/, "heading"],
  [/^step-header$/, "heading"],
  [/^step-(caption|label)$/, "body"],
  [/^end-(name|title)$/, "heading"],
  [/^end-subtitle$/, "body"],
  [/^type-words?-/, "heading"],
  [/^scroll-list$/, "heading"],
  [/^scroll-lead$/, "body"],
  [/^crops-row-labels$/, "body"],
];

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
      // Best Fit sizes the raster to the frame; the largest scale points bring it back to its own pixel size.
      const fit = Math.min(frame.width / layer.source.width, frame.height / layer.source.height);
      expect(layer.props.scale, layer.name).toBe(ScaleMode.FIT);
      for (const prop of ["scale_x", "scale_y"]) {
        const kf = layer.props[prop] as Keyframe | undefined;
        if (kf) expect(Math.max(...kf.Points.map((p) => p.co.Y)) * fit, `${layer.name}.${prop}`).toBeCloseTo(1, 4);
      }
      // At its last key a drawing with text sits inside the frame (shadows may spill a little).
      if (/<text/.test(layer.source.svg) && !layer.bleed) {
        const last = (name: string, fallback: number) => {
          const kf = layer.props[name] as Keyframe | undefined;
          return kf ? evaluate(kf, layer.frames) : fallback;
        };
        const left = last("location_x", 0) * frame.width;
        const top = last("location_y", 0) * frame.height;
        const width = layer.source.width * fit * last("scale_x", 1);
        const height = layer.source.height * fit * last("scale_y", 1);
        const slack = 0.02 * frame.width;
        expect(left, `${id} ${layer.name} left`).toBeGreaterThanOrEqual(-slack);
        expect(top, `${id} ${layer.name} top`).toBeGreaterThanOrEqual(-slack);
        expect(left + width, `${id} ${layer.name} right`).toBeLessThanOrEqual(frame.width + slack);
        expect(top + height, `${id} ${layer.name} bottom`).toBeLessThanOrEqual(frame.height + slack);
      }
    }
  });
});

describe.each(Object.entries({ ...FRAMES, square: { width: 1080, height: 1080, fps: 30 }, feed: { width: 1080, height: 1350, fps: 30 } }))("motion template type, %s", (_name, frame) => {
  it.each(MOTION_TEMPLATE_IDS)("%s: every word at its role's size or larger (label 3 %, body 4 %, heading 7.5 % of the short side)", (id) => {
    const { plan } = build(id, frame);
    const short = Math.min(frame.width, frame.height);
    for (const layer of plan.layers) {
      const texts = textsOf(layer, frame);
      if (texts.length === 0) continue;
      for (const t of texts) expect(t.size, `${id} ${layer.name} "${t.text}"`).toBeGreaterThanOrEqual(TYPE_FLOOR.label * short - 0.05);
      const role = ROLES.find(([pattern]) => pattern.test(layer.name))?.[1];
      if (role) expect(Math.max(...texts.map((t) => t.size)), `${id} ${layer.name} is ${role}`).toBeGreaterThanOrEqual(TYPE_FLOOR[role] * short - 0.05);
    }
  });
});

describe.each(Object.entries(FRAMES))("type_search with every part on, %s", (_name, frame) => {
  it("keeps its brand, prompt, two-line phrase and four suggestions inside the safe area at their sizes", () => {
    const { safe } = layoutOf(frame);
    const plan = buildMotionTemplate({
      template: "type_search",
      frame,
      start: 0,
      grid: tempoGrid(120, 40),
      palette: PALETTES.ui_light,
      media: MEDIA_BY_ID,
      content: { text: "Plan a slower morning with fewer tabs open and more light", tag: "Zenvi", subtitle: "What would make tomorrow feel lighter?", labels: ["Slow pour", "Ten pages", "Morning notes", "A walk first"] },
    });
    for (const l of plan.layers) {
      for (const t of textsOf(l, frame)) {
        const where = `${l.name} "${t.text}"`;
        expect(t.top, where).toBeGreaterThanOrEqual(safe.top - 2);
        expect(t.bottom, where).toBeLessThanOrEqual(safe.bottom + 2);
        expect(t.size, where).toBeGreaterThanOrEqual(0.04 * Math.min(frame.width, frame.height) - 0.05);
      }
    }
  });
});

describe.each(Object.entries(FRAMES))("long copy, %s", (_name, frame) => {
  /** Boxes of the last frame's words and pictures, by layer. */
  const lastFrame = (plan: MotionPlan) =>
    plan.layers
      .filter((l) => l.start + l.frames === plan.frames)
      .map((l) => ({ name: l.name, texts: textsOf(l, frame), box: l.source.kind === "media" ? boxAt(l, frame, heldFrame(l)!) : null }));
  const meets = (a: { left: number; right: number; top: number; bottom: number }, b: typeof a) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const cases: [MotionTemplateId, MotionContent, PaletteId][] = [
    ["callout", { fileIds: ["VIDEO00001"], text: "Northwind Press Cold Brew Tower", labels: ["Borosilicate glass carafe", "Steel filter", "Grip", "Locking lid"], values: ["Heat resistant to 150 °C", "4-layer mesh", "Cork band", "Keeps heat in for an hour"] }, "callout"],
    ["step_card", { fileIds: ["VIDEO00001"], text: "Mount your phone at eye level before you start", step: 2, tag: "Eye level, not lower", subtitle: "Film better reels at home tonight", points: [{ x: 0.7, y: 0.3 }] }, "tutorial"],
    ["end_card", { variant: "plain", text: "Studio Lumen spring objects", subtitle: "Out now in three colours, while they last", tag: "No. 01", align: "left" }, "editorial"],
  ];
  it.each(cases)("%s: no words meet other words or the pictures", (id, content, palette) => {
    const { safe } = layoutOf(frame);
    const plan = buildMotionTemplate({ template: id, frame, start: 0, grid: tempoGrid(120, 40), palette: PALETTES[palette], media: MEDIA_BY_ID, content });
    const parts = lastFrame(plan);
    for (const a of parts) {
      for (const t of a.texts) {
        expect(t.top, `${a.name} "${t.text}" top`).toBeGreaterThanOrEqual(safe.top - 2);
        expect(t.bottom, `${a.name} "${t.text}" bottom`).toBeLessThanOrEqual(safe.bottom + 2);
        expect(t.right, `${a.name} "${t.text}" right`).toBeLessThanOrEqual(safe.right + 2);
        for (const b of parts) {
          if (a === b || (a.name === "step-label" && b.name === "step-media")) continue;
          for (const u of b.texts) expect(meets(t, u), `${a.name} "${t.text}" meets ${b.name} "${u.text}"`).toBe(false);
          if (b.box) expect(meets(t, b.box), `${a.name} "${t.text}" on ${b.name}`).toBe(false);
        }
      }
    }
  });
});

describe("motion templates on 9:16", () => {
  const frame = FRAMES.portrait!;
  const layout = layoutOf(frame);
  const { safe } = layout;
  const layer = (plan: MotionPlan, name: string) => plan.layers.find((l) => l.name === name)!;
  const rest = (plan: MotionPlan, name: string) => boxAt(layer(plan, name), frame, heldFrame(layer(plan, name))!);

  it.each(MOTION_TEMPLATE_IDS)("%s keeps every word out of the platform bands (top 8 %, bottom 15 %, the buttons on the right)", (id) => {
    const { plan } = build(id, frame);
    for (const l of plan.layers.filter((x) => !x.bleed)) {
      for (const t of textsOf(l, frame)) {
        const where = `${id} ${l.name} "${t.text}"`;
        expect(t.left, where).toBeGreaterThanOrEqual(safe.left - 2);
        expect(t.right, where).toBeLessThanOrEqual(safe.right + 2);
        expect(t.top, where).toBeGreaterThanOrEqual(safe.top - 2);
        expect(t.bottom, where).toBeLessThanOrEqual(safe.bottom + 2);
      }
    }
  });

  it("type_search: the group is centred while it types, then glides up so the field and its suggestions are centred together", () => {
    const { plan } = build("type_search", frame);
    const brand = layer(plan, "search-brand");
    // Typing: the brand row over the field (the typed text's drawing spans the field's height).
    const brandWhileTyping = boxAt(brand, frame, heldFrame(layer(plan, "search-type-1"))! + layer(plan, "search-type-1").start - brand.start);
    const typing = rest(plan, "search-type-1");
    expect((brandWhileTyping.top + typing.bottom) / 2).toBeCloseTo(opticalCentre(layout), -1.5);
    // Open: the brand row over the last suggestion.
    const rows = plan.layers.filter((l) => /^search-row-\d$/.test(l.name));
    const open = { top: rest(plan, "search-brand").top, bottom: Math.max(...rows.map((r) => rest(plan, r.name).bottom)) };
    expect((open.top + open.bottom) / 2).toBeCloseTo(opticalCentre(layout), -1.5);
    expect(rest(plan, "search-text").top).toBeLessThan(typing.top - 50);
    // The phrase is set big, wrapping onto a second line rather than shrinking.
    const phrase = textsOf(layer(plan, "search-text"), frame);
    expect(phrase.length).toBe(2);
    expect(phrase[0]!.size).toBeGreaterThanOrEqual(0.07 * frame.width);
  });

  it("callout: the product fills a tall frame between the stacked heading and the labels above and below it", () => {
    const { plan } = build("callout", frame);
    const product = rest(plan, "callout-product");
    const w = product.right - product.left;
    const h = product.bottom - product.top;
    expect(w / h).toBeGreaterThanOrEqual(0.79);
    expect(w / h).toBeLessThanOrEqual(1.01);
    expect(h).toBeGreaterThanOrEqual(0.45 * frame.height);
    expect(w).toBeGreaterThanOrEqual(0.7 * frame.width);
    const heading = textsOf(layer(plan, "callout-heading"), frame);
    expect(heading.map((t) => t.text)).toEqual(["ANATOMY:", "LUMEN RUNNER"]);
    expect(heading[0]!.top).toBeCloseTo(safe.top, -1.5);
    // The default spread: labels on both sides of the product, above it and below it.
    const labels = plan.layers.filter((l) => l.name.startsWith("callout-label-")).map((l) => rest(plan, l.name));
    expect(labels.some((b) => b.bottom < product.top)).toBe(true);
    expect(labels.some((b) => b.top > product.bottom)).toBe(true);
    expect(labels.every((b) => b.bottom < product.top || b.top > product.bottom)).toBe(true);
  });

  it("step_card: header on the top line, the footage in a big 4:5 card, the caption on the bottom third", () => {
    const { plan } = build("step_card", frame);
    const card = rest(plan, "step-media");
    expect((card.right - card.left) / (card.bottom - card.top)).toBeCloseTo(0.8, 2);
    expect(card.bottom - card.top).toBeGreaterThanOrEqual(0.5 * frame.height);
    const header = textsOf(layer(plan, "step-header"), frame);
    expect(header[0]!.top).toBeCloseTo(safe.top, -1.5);
    const caption = textsOf(layer(plan, "step-caption"), frame);
    expect(Math.min(...caption.map((t) => t.top))).toBeGreaterThan(card.bottom);
    expect(Math.max(...caption.map((t) => t.bottom))).toBeGreaterThan(frame.height * 0.72);
    // The label box sits on the card's top edge.
    const label = rest(plan, "step-label");
    expect(label.top).toBeLessThan(card.top);
    expect(label.bottom).toBeGreaterThan(card.top);
  });

  it("step_card and callout keep points given on the footage in view: the tall crop centres on them", () => {
    const grid = tempoGrid(120, 30);
    const cropOf = (l: MotionLayer) => {
      const crop = l.effects.find((e) => (e as { class_name?: string }).class_name === "Crop") as Record<string, Keyframe>;
      return { left: evaluate(crop.left!, 1), right: evaluate(crop.right!, 1) };
    };
    const step = buildMotionTemplate({ template: "step_card", frame, start: 0, grid, palette: PALETTES.tutorial, media: MEDIA_BY_ID, content: { fileIds: ["VIDEO00001"], text: "Frame it", tag: "Here", points: [{ x: 0.85, y: 0.3 }] } });
    // 16:9 into 4:5 keeps 45 % of the width, as far right as the picture allows.
    expect(cropOf(layer(step, "step-media")).left).toBeCloseTo(0.55, 2);
    expect(cropOf(layer(step, "step-media")).right).toBeCloseTo(0, 6);
    // The arrow ends at the point: (0.85 - 0.55) / 0.45 of the card across.
    const card = rest(step, "step-media");
    const head = rest(step, "step-arrowhead");
    const target = { x: card.left + ((0.85 - 0.55) / 0.45) * (card.right - card.left), y: card.top + 0.3 * (card.bottom - card.top) };
    expect(Math.hypot((head.left + head.right) / 2 - target.x, (head.top + head.bottom) / 2 - target.y)).toBeLessThan(40);
    // Callout anchors on the product's left: the crop moves left with them, and each dot sits on its point.
    const points = [
      { x: 0.1, y: 0.3 },
      { x: 0.3, y: 0.7 },
    ];
    const product = buildMotionTemplate({ template: "callout", frame, start: 0, grid, palette: PALETTES.callout, media: MEDIA_BY_ID, content: { fileIds: ["VIDEO00001"], text: "Kettle", labels: ["Spout", "Base"], points } });
    const window = cropOf(layer(product, "callout-product"));
    expect(window.left).toBeCloseTo(0, 6);
    const shot = rest(product, "callout-product");
    points.forEach((p, i) => {
      const dot = rest(product, `callout-dot-${i + 1}`);
      const x = shot.left + ((p.x - window.left) / (1 - window.left - window.right)) * (shot.right - shot.left);
      expect((dot.left + dot.right) / 2).toBeCloseTo(x, -1);
    });
  });

  it("crop_labels: the crops lift into a column of big tiles down the safe area, labels beside them", () => {
    const { plan } = build("crop_labels", frame);
    const tiles = plan.layers.filter((l) => l.name.startsWith("crops-tile-")).map((l) => rest(plan, l.name));
    expect(tiles).toHaveLength(3);
    for (const t of tiles) expect((t.left + t.right) / 2).toBeCloseTo((tiles[0]!.left + tiles[0]!.right) / 2, 0);
    for (let i = 1; i < tiles.length; i += 1) expect(tiles[i]!.top).toBeGreaterThan(tiles[i - 1]!.bottom);
    expect(tiles[2]!.bottom - tiles[0]!.top).toBeGreaterThanOrEqual(0.7 * (safe.bottom - safe.top));
    expect(tiles[2]!.bottom).toBeLessThanOrEqual(safe.bottom);
    const labels = textsOf(layer(plan, "crops-row-labels"), frame);
    expect(Math.min(...labels.map((t) => t.left))).toBeGreaterThan(Math.max(...tiles.map((t) => t.right)));
  });

  it.each(["ui_cards", "word_scroll", "kinetic_type", "end_card"] as const)("%s centres its group on the safe area's optical centre", (id) => {
    const { plan } = build(id, frame);
    const boxes = plan.layers
      .filter((l) => !l.bleed && !l.name.includes("backdrop") && !l.name.includes("bands") && !l.name.includes("pointer") && !l.name.includes("ripple"))
      .map((l) => (l.source.kind === "svg" && l.source.svg.includes("<text") ? textsOf(l, frame) : [rest(plan, l.name)]))
      .flat();
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    expect(Math.abs((top + bottom) / 2 - opticalCentre(layout)), id).toBeLessThan(0.05 * frame.height);
  });
});

describe("motion templates", () => {
  it("set a headline in few, balanced lines", () => {
    const grid = tempoGrid(120, 30);
    const plan = buildMotionTemplate({ template: "kinetic_type", frame: FRAMES.portrait!, start: 0, grid, palette: PALETTES.tutorial, media: MEDIA_BY_ID, content: { text: "Film better reels at home" } });
    // The last cumulative drawing holds every line but the last word: two baselines ("Film better / reels at home").
    const last = plan.layers.filter((l) => l.name.startsWith("type-words-")).pop()!;
    const svg = last.source.kind === "svg" ? last.source.svg : "";
    const baselines = new Set([...svg.matchAll(/<text x="[^"]*" y="([^"]*)"/g)].map((m) => m[1]));
    expect(baselines.size).toBe(2);
  });

  it("fill in their own default copy: a bare ANATOMY heading, boxes numbered DETAIL 01…", () => {
    const grid = tempoGrid(120, 30);
    const run = (template: MotionTemplateId, content: MotionContent) =>
      buildMotionTemplate({ template, frame: FRAMES.portrait!, start: 0, grid, palette: PALETTES.callout, media: MEDIA_BY_ID, content });
    const svgOf = (plan: MotionPlan, name: string) => {
      const source = plan.layers.find((l) => l.name === name)?.source;
      return source?.kind === "svg" ? source.svg : "";
    };
    // Without a product name the heading is the prefix alone, no dangling colon.
    const heading = svgOf(run("callout", { fileIds: ["PHOTO00001"], labels: ["Knit upper"] }), "callout-heading");
    expect(heading).toContain("ANATOMY");
    expect(heading).not.toContain("ANATOMY:");
    const crops = run("crop_labels", { fileIds: ["VIDEO00001"], variant: "boxes" });
    expect(crops.layers.map((l) => (l.source.kind === "svg" ? l.source.svg : "")).join("")).toContain("DETAIL 01");
  });

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
