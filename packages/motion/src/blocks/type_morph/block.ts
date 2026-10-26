import { bounds, EASES, morphRings, outlinePath, prepareMorph, ringsPath, textOutline, transformOutline, type BlockContext, type Morph, type Outline, type Point } from "../../runtime/index.js";
import { canvasFont } from "../shapes.js";

const SVG = "http://www.w3.org/2000/svg";
/** Traced at this size, then scaled. */
const TRACE_PX = 360;
const ENTER = 0.7;
/** Mid-morph smoothing passes (see morphRings). */
const SMOOTH = 14;

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette, doc } = ctx;
  const words = (p.words as string[]).map((w) => w.trim()).filter(Boolean);
  // Only blank words: nothing to set (the block stays transparent).
  if (words.length === 0) return;
  const cx = W / 2;
  const cy = safe.top + (H - safe.top - safe.bottom) / 2;
  const fill = p.color === "accent" ? palette.accent : palette.ink;
  const traced = words.map((w) => textOutline(doc, w, canvasFont(ctx, TRACE_PX, Number(p.weight))));
  const n = words.length;
  const beat = Number(p.beat) > 0 ? Number(p.beat) : n > 1 ? Math.max(0.3, (ctx.seconds - ENTER - 0.8) / (n - 1)) : ctx.seconds;
  const m = Math.min(Number(p.morph), beat * 0.8);
  const starts = words.slice(1).map((_, k) => ENTER + (k + 1) * beat - m);

  if (traced.some((t) => t === null)) {
    // No canvas to trace with (jsdom): the words crossfade as text.
    words.forEach((w, k) => {
      const el = ctx.el("div", "tmx-fallback", ctx.root, w);
      Object.assign(el.style, { top: `${cy}px`, fontSize: `${Number(p.max_size)}px`, color: fill });
      tl.set(el, { opacity: 0, yPercent: -50 }, 0);
      tl.to(el, { opacity: 1 }, { at: k === 0 ? 0 : starts[k - 1]!, duration: k === 0 ? ENTER : m, ease: "linear" });
      if (k < n - 1) tl.to(el, { opacity: 0 }, { at: starts[k]!, duration: m, ease: "linear" });
    });
    return;
  }

  // One size for every word (the morph is about the letters), fit to the safe width.
  const widest = Math.max(1, ...traced.map((t) => t!.width));
  const scale = Math.min(Number(p.max_size) / TRACE_PX, (W - safe.left - safe.right) / widest);
  // One baseline for every word: centre the words' average ink box vertically.
  const boxes = traced.map((t) => bounds(t!.outline));
  const midY = boxes.reduce((s, b) => s + b.y + b.height / 2, 0) / boxes.length;
  const outlines: Outline[] = traced.map((t) => transformOutline(transformOutline(t!.outline, { x: -t!.width / 2, y: -midY }), { scale, x: cx, y: cy }));
  const empty: Outline = { solids: [], holes: [] };
  const intro = prepareMorph(empty, outlines[0]!);
  const morphs: Morph[] = outlines.slice(1).map((o, k) => prepareMorph(outlines[k]!, o));

  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "tmx-svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const path = doc.createElementNS(SVG, "path");
  if (p.style === "outline") {
    Object.entries({ fill: "none", stroke: fill, "stroke-width": String(Math.max(3, 8 * scale)), "stroke-linejoin": "round" }).forEach(([a, v]) => path.setAttribute(a, v));
  } else {
    path.setAttribute("fill", fill);
  }
  svg.append(path);
  ctx.root.append(svg);

  const sweep = Number(p.sweep);
  /** A sweep across the union of both words: letters on the left change first. */
  const sweeper = (morph: Morph): ((i: number, c: Point) => number) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const [a, b] of morph.pairs) {
      for (const q of [...a, ...b]) {
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
      }
    }
    return (_, c) => (x1 > x0 ? (sweep * (c.x - x0)) / (x1 - x0) : 0);
  };
  const introDelay = sweeper(intro);
  const delays = morphs.map(sweeper);
  const inOut = EASES["in-out"];
  const out = EASES.out;
  tl.track((t) => {
    let d: string;
    let stretch = 1;
    const k = starts.findIndex((s) => t < s + m);
    if (t < ENTER) {
      d = ringsPath(morphRings(intro, Math.max(0, t / ENTER), { delay: introDelay, ease: out }));
    } else if (k >= 0 && t >= starts[k]!) {
      const q = (t - starts[k]!) / m;
      d = ringsPath(morphRings(morphs[k]!, q, { delay: delays[k], ease: inOut, smooth: SMOOTH }));
      // The letters stretch a touch as they flow (weight), settling as they land.
      stretch = 1 + 0.05 * Math.sin(Math.PI * q);
    } else {
      d = outlinePath(outlines[k >= 0 ? k : n - 1]!);
    }
    path.setAttribute("d", d);
    path.setAttribute("transform", stretch === 1 ? "" : `translate(${cx} ${cy}) scale(${(1 / Math.sqrt(stretch)).toFixed(4)} ${stretch.toFixed(4)}) translate(${-cx} ${-cy})`);
  });
}
