import { EASES, interpolate, morphRings, outlinePath, prepareMorph, ringsPath, transformOutline, type BlockContext, type Morph, type Outline } from "../../runtime/index.js";
import { glyphShape, isShapeName, namedShape } from "../shapes.js";

const HEX = /^#[0-9a-f]{6}$/i;
const SVG = "http://www.w3.org/2000/svg";
const ENTER = 0.55;

/** Degrees a shape looks the same after turning (360: only upright). */
function symmetry(name: string): number {
  switch (name) {
    case "circle": case "ring": case "square": case "plus": return 90;
    case "burst": return 30;
    case "hexagon": return 60;
    case "star": return 72;
    case "triangle": return 120;
    case "pill": return 180;
    default: return 360;
  }
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette, doc } = ctx;
  const names = (p.shapes as string[]).map((s) => s.trim()).filter(Boolean);
  const cx = W / 2;
  const cy = safe.top + (H - safe.top - safe.bottom) / 2;
  const R = (Math.min(W - safe.left - safe.right, H - safe.top - safe.bottom) / 2) * Number(p.size);
  const shapes: { name: string; outline: Outline }[] = [];
  for (const name of names) {
    const unit = isShapeName(name) ? namedShape(name, ctx.seed) : glyphShape(ctx, name);
    if (unit) shapes.push({ name: isShapeName(name) ? name : "glyph", outline: transformOutline(unit, { scale: R, x: cx, y: cy }) });
  }
  // No canvas to trace glyphs with (jsdom): fall back to circles so the block still builds.
  if (shapes.length === 0) shapes.push({ name: "circle", outline: transformOutline(namedShape("circle", 1), { scale: R, x: cx, y: cy }) });
  const given = (p.colors as string[]).filter((c) => HEX.test(c));
  const colors = given.length > 0 ? given : [palette.accent, palette.secondary, palette.ink];
  const color = (k: number): string => colors[k % colors.length]!;

  const n = shapes.length;
  const beat = Number(p.beat) > 0 ? Number(p.beat) : n > 1 ? Math.max(0.2, (ctx.seconds - ENTER - 0.7) / (n - 1)) : ctx.seconds;
  const m = Math.min(Number(p.morph), beat * 0.8);
  /** Morph k (shape k to k+1) runs from starts[k] to starts[k] + m. */
  const starts = shapes.slice(1).map((_, k) => ENTER + (k + 1) * beat - m);
  const morphs: Morph[] = shapes.slice(1).map((s, k) => prepareMorph(shapes[k]!.outline, s.outline));
  // Each shape rests at a turn it looks upright at: a quarter-ish turn per morph when spinning.
  const rest = [0];
  for (let k = 1; k < n; k += 1) {
    const sym = symmetry(shapes[k]!.name);
    const a = rest[k - 1]!;
    rest.push(p.spin && sym <= 180 ? Math.round((a - 90) / sym) * sym : Math.round(a / 360) * 360);
  }

  const style = String(p.style);
  const stage = ctx.el("div", "smx-stage");
  stage.style.transformOrigin = `${cx}px ${cy}px`;
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  stage.append(svg);
  const stroke = Math.max(8, R * 0.07);
  const echoOf = doc.createElementNS(SVG, "path");
  const shape = doc.createElementNS(SVG, "path");
  if (style === "duo") {
    echoOf.setAttribute("fill", "none");
    echoOf.setAttribute("stroke", palette.ink);
    echoOf.setAttribute("stroke-width", String(stroke * 0.5));
    echoOf.setAttribute("transform", `translate(${R * 0.09} ${R * 0.09})`);
    svg.append(echoOf);
  }
  svg.append(shape);
  if (style === "outline") {
    shape.setAttribute("fill", "none");
    shape.setAttribute("stroke-width", String(stroke));
    shape.setAttribute("stroke-linejoin", "round");
  }

  // The first shape pops in; each morph swings over and lands on the next.
  ctx.cue(0, "pop", { weight: 0.5, at: { x: cx, y: cy } });
  for (const s of starts) {
    ctx.cue(s, "whoosh", { weight: 0.35, at: { x: cx, y: cy } });
    ctx.cue(s + m, "land", { weight: 0.45, at: { x: cx, y: cy } });
  }

  // A ripple of each new shape as it lands.
  starts.forEach((s, k) => {
    const wrap = ctx.el("div", "smx-echo", stage);
    wrap.style.transformOrigin = `${cx}px ${cy}px`;
    const esvg = doc.createElementNS(SVG, "svg");
    esvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const ring = doc.createElementNS(SVG, "path");
    ring.setAttribute("d", outlinePath(shapes[k + 1]!.outline));
    Object.entries({ fill: "none", stroke: color(k + 1), "stroke-width": String(stroke * 0.35) }).forEach(([a, v]) => ring.setAttribute(a, v));
    esvg.append(ring);
    wrap.append(esvg);
    tl.set(wrap, { opacity: 0 }, 0);
    tl.fromTo(wrap, { scale: 1, opacity: 0.8 }, { scale: 1.38, opacity: 0 }, { at: s + m * 0.85, duration: 0.7, ease: "out" });
  });

  const inOut = EASES["in-out"];
  const back = EASES["back-out"];
  tl.track((t) => {
    let d: string;
    let fill: string;
    let angle = rest[0]!;
    let scale = 1;
    const k = starts.findIndex((s) => t < s + m);
    const s = k >= 0 ? starts[k]! : Infinity;
    if (k >= 0 && t >= s) {
      const q = (t - s) / m;
      const e = inOut(q);
      d = ringsPath(morphRings(morphs[k]!, e, { smooth: 6 }));
      fill = String(interpolate(color(k), color(k + 1), e));
      // Turn with a 6 % overshoot, swinging back a little mid-morph (weight), and squash.
      angle = rest[k]! + (rest[k + 1]! - rest[k]!) * back(q) - 10 * Math.sin(Math.PI * q);
      scale = 1 - 0.1 * Math.sin(Math.PI * q);
    } else {
      const i = k >= 0 ? k : n - 1;
      d = outlinePath(shapes[i]!.outline);
      fill = color(i);
      angle = rest[i]!;
      // Landing: a small settle (TASTE.md: ≤ 6 %, within 0.25 s).
      const landed = i > 0 ? t - (starts[i - 1]! + m) : Infinity;
      if (landed < 0.25) scale = 1 + 0.045 * Math.sin((Math.PI * landed) / 0.25);
    }
    if (t < ENTER) scale *= back(Math.max(0, t / ENTER));
    if (t < ENTER) angle += -40 * (1 - EASES.out(Math.max(0, t / ENTER)));
    shape.setAttribute("d", d);
    if (style === "outline") shape.setAttribute("stroke", fill);
    else shape.setAttribute("fill", fill);
    if (style === "duo") echoOf.setAttribute("d", d);
    stage.style.transform = `rotate(${angle.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
  });
}
