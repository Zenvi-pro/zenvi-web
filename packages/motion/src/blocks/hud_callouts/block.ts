import { scrambledText, strokeDrawable, type BlockContext } from "../../runtime/index.js";

const SVG = "http://www.w3.org/2000/svg";

interface Callout {
  name: string;
  value: string;
  ax: number;
  ay: number;
  side: "left" | "right";
  ly: number;
}

/** Default anchors: around the centre, alternating sides. */
function spread(n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => ({ x: i % 2 === 0 ? 0.4 : 0.6, y: 0.35 + (0.3 * (i + 0.5)) / n }));
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const labels = p.labels as string[];
  const values = p.values as string[];
  const given = p.points as { x: number; y: number }[];
  const points = labels.map((_, i) => given[i] ?? spread(labels.length)[i]!);

  const bg = ctx.mediaImg("background", "hud-bg");
  if (bg) tl.fromTo(bg, { scale: 1.08 }, { scale: 1.0 }, { at: 0, duration: ctx.seconds, ease: "out" });

  const svg = ctx.doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "hud-svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  ctx.root.append(svg);
  const shape = (tag: string, attrs: Record<string, string | number>, cls: string): SVGGeometryElement => {
    const el = ctx.doc.createElementNS(SVG, tag) as SVGGeometryElement;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    el.setAttribute("class", cls);
    svg.append(el);
    return el;
  };
  const draw = (el: SVGGeometryElement, at: number, duration: number): void => {
    strokeDrawable(el);
    tl.fromTo(el, { "attr:stroke-dashoffset": 1 }, { "attr:stroke-dashoffset": 0 }, { at, duration, ease: "in-out" });
  };

  // Grid: centre cross, frame corner ticks, optional measuring rules.
  const m = Math.round(Math.min(W, H) * 0.05);
  if (p.grid !== "none") {
    const cx = W / 2;
    const cy = H / 2;
    draw(shape("line", { x1: cx, y1: m, x2: cx, y2: H - m }, "rule"), 0, 0.9);
    draw(shape("line", { x1: m, y1: cy, x2: W - m, y2: cy }, "rule"), 0.08, 0.9);
    const c = 36;
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]] as const) {
      draw(shape("polyline", { points: `${x},${y + dy * c} ${x},${y} ${x + dx * c},${y}` }, "tick"), 0.2, 0.4);
    }
    if (p.grid === "full") {
      const step = Math.min(W, H) / 6;
      let i = 0;
      for (let x = cx - step; x > m; x -= step) for (const xx of [x, W - x]) draw(shape("line", { x1: xx, y1: m, x2: xx, y2: H - m }, "rule"), 0.15 + 0.04 * i++, 0.8);
      for (let y = cy - step; y > m; y -= step) for (const yy of [y, H - y]) draw(shape("line", { x1: m, y1: yy, x2: W - m, y2: yy }, "rule"), 0.15 + 0.04 * i++, 0.8);
    }
    const coord = ctx.el("div", "hud-coord", ctx.root, `X ${W / 2} · Y ${H / 2}`);
    Object.assign(coord.style, { left: `${cx + 14}px`, top: `${cy + 10}px` });
    tl.fromTo(coord, { opacity: 0 }, { opacity: 1 }, { at: 0.6, duration: 0.3, ease: "linear" });
  }
  if (p.title) {
    const title = ctx.el("div", "hud-title", ctx.root);
    Object.assign(title.style, { left: `${safe.left}px`, top: `${safe.top - 60}px` });
    const text = String(p.title);
    const opts = { at: 0.1, duration: 0.8, seed: ctx.seed, rate: 24 };
    tl.track((t) => {
      title.textContent = scrambledText(text, t, opts);
    });
  }

  // Callouts: labels on the side of their anchor, pushed apart vertically.
  const callouts: Callout[] = points.map((pt, i) => ({
    name: labels[i]!,
    value: values[i] ?? "",
    ax: pt.x * W,
    ay: pt.y * H,
    side: pt.x < 0.5 ? "left" : "right",
    ly: pt.y * H - Math.min(W, H) * 0.19,
  }));
  const gap = 150;
  for (const side of ["left", "right"] as const) {
    const list = callouts.filter((c) => c.side === side).sort((a, b) => a.ly - b.ly);
    let floor = safe.top + 20;
    for (const c of list) {
      c.ly = Math.max(c.ly, floor);
      floor = c.ly + gap;
    }
    const ceiling = H - safe.bottom - 80;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const c = list[i]!;
      const limit = i === list.length - 1 ? ceiling : list[i + 1]!.ly - gap;
      c.ly = Math.min(c.ly, limit);
    }
  }
  callouts.forEach((c, i) => {
    const at = 0.45 + i * 0.35;
    const ring = shape("circle", { cx: c.ax, cy: c.ay, r: 18 }, "ring");
    const dot = shape("circle", { cx: c.ax, cy: c.ay, r: 6 }, "dot");
    for (const el of [ring, dot]) el.style.transformOrigin = `${c.ax}px ${c.ay}px`;
    tl.fromTo([ring, dot], { scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }, { at, duration: 0.45, ease: "back-out" });
    tl.track((t) => {
      if (t < at + 0.45) return;
      const k = ((t - at - 0.45) % 1.6) / 1.6;
      ring.style.transform = `scale(${1 + 0.35 * k})`;
      ring.style.opacity = String(1 - 0.8 * k);
    });
    // The leader runs from the anchor to an elbow, then under the label to the safe edge (the label's underline).
    const edge = c.side === "left" ? safe.left : W - safe.right;
    
    const label = ctx.el("div", "hud-label");
    const name = ctx.el("div", "hud-name", label, c.name);
    const value = ctx.el("div", "hud-value", label, c.value || " ");
    label.style.top = `${c.ly}px`;
    const lineY = c.ly + label.offsetHeight + 16;
    const elbowX = c.ax + (edge > c.ax ? 1 : -1) * Math.min(Math.abs(lineY - c.ay), Math.abs(edge - c.ax) * 0.35);
    const lead = shape("polyline", { points: `${c.ax},${c.ay} ${elbowX},${lineY} ${edge},${lineY}` }, "lead");
    draw(lead, at + 0.25, 0.55);
    if (c.side === "left") {
      label.style.left = `${safe.left}px`;
    } else {
      label.style.right = `${safe.right}px`;
      label.style.alignItems = "flex-end";
    }
    const textAt = at + 0.6;
    const o1 = { at: textAt, duration: 0.6, seed: ctx.seed + i * 13, rate: 24 };
    const o2 = { at: textAt + 0.12, duration: 0.6, seed: ctx.seed + i * 29, rate: 24 };
    tl.track((t) => {
      name.textContent = scrambledText(c.name, t, o1);
      value.textContent = scrambledText(c.value, t, o2);
    });
  });
}
