import { counter, formatNumber, resolveEase, splitText, type BlockContext } from "../../runtime/index.js";
import { fitWidth, onColor } from "../ui.js";
import { highlightIndex, niceMax, parseValue, percentChange } from "./scale.js";

const SVG = "http://www.w3.org/2000/svg";

interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Progress at which `ease` reaches `y` (the eases are monotone): when a draw passes a point. */
function easeInverse(ease: (t: number) => number, y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const kind = String(p.kind) as "bar" | "line" | "donut";
  const values = (p.values as string[]).slice(0, kind === "donut" ? 6 : 8).map((v) => Math.max(0, parseValue(v)));
  const labels = p.labels as string[];
  const hi = highlightIndex(values, Number(p.highlight), kind === "line");
  const fmt = { prefix: String(p.prefix ?? ""), suffix: String(p.suffix ?? ""), decimals: Number(p.decimals) };
  const rest = typeof p.rest === "string" ? p.rest : palette.ink;
  const accent = palette.accent;
  // Short blocks run the same build faster; long ones hold longer.
  const k = Math.min(1, ctx.seconds / 5);
  const growAt = 0.5 * k;
  const growFor = 0.9 * k;
  const climax = 2.2 * k;

  const side = W > H * 1.3;
  const contentW = W - safe.left - safe.right;

  // Head: title, then the big number (a donut keeps its number in the ring).
  const head = ctx.el("div", "cb-head");
  Object.assign(head.style, { left: `${safe.left}px`, top: `${safe.top}px`, width: `${side ? contentW * 0.38 : contentW}px` });
  // Landscape: the title holds the top of the column, the number sits on the chart's floor.
  if (side) Object.assign(head.style, { height: `${H - safe.top - safe.bottom - 40}px`, justifyContent: "space-between" });
  const title = p.title ? ctx.el("div", "cb-title", head, String(p.title)) : null;
  const bigHost = kind === "donut" ? null : ctx.el("div", "cb-big", head);
  const big = bigHost ? numberParts(ctx, bigHost, fmt) : null;
  if (big && bigHost) {
    big.num.textContent = formatNumber(values[hi]!, { decimals: fmt.decimals });
    fitWidth(bigHost, [bigHost], side ? contentW * 0.38 : contentW, side ? 330 : 280, 80);
    bigHost.style.fontWeight = ctx.display === "sans" ? "300" : "400";
    tl.track(counter(big.num, { from: 0, to: values[hi]!, at: growAt, duration: growFor + 0.5 * k, ease: "out", decimals: fmt.decimals }));
    cueCount(ctx, big.num, values[hi]!, fmt.decimals, growAt, growFor + 0.5 * k);
    tl.fromTo(bigHost, { y: 40, opacity: 0, blur: 10 }, { y: 0, opacity: 1, blur: 0 }, { at: 0.15, duration: 0.7, ease: "out" });
  }
  if (title) {
    const split = splitText(title, { lines: true });
    tl.fromTo(split.lineInners, { yPercent: 105 }, { yPercent: 0 }, { at: 0, duration: 0.7, ease: "out", stagger: 0.12 });
  }
  const headBottom = safe.top + (side ? 0 : head.getBoundingClientRect().height);
  const region: Region = side
    ? { x: safe.left + contentW * 0.45, y: safe.top, w: contentW * 0.55, h: H - safe.top - safe.bottom }
    : { x: safe.left, y: headBottom + 70, w: contentW, h: H - safe.bottom - headBottom - 70 };

  // The change badge compares the highlight with the first item; the first item has nothing to compare with.
  const badgeText = String(p.caption ?? "") || (kind === "donut" || hi === 0 ? "" : [percentChange(values[0]!, values[hi]!), labels[0] ? `vs ${labels[0]}` : ""].filter(Boolean).join(" "));
  const badge = badgeText ? ctx.el("div", "cb-badge", ctx.root, badgeText) : null;
  if (badge) badge.style.color = onColor(accent);

  const at = { growAt, growFor, climax };
  if (kind === "bar") bars(ctx, region, values, labels, hi, fmt, rest, badge, at);
  else if (kind === "line") line(ctx, region, values, labels, hi, fmt, rest, badge, at);
  else donut(ctx, region, side, values, labels, hi, fmt, rest, badge, at, headBottom);
}

interface Format {
  prefix: string;
  suffix: string;
  decimals: number;
}

interface Times {
  growAt: number;
  growFor: number;
  climax: number;
}

/** A number with its prefix and suffix set smaller, so the digits carry the size. */
function numberParts(ctx: BlockContext, host: HTMLElement, fmt: Format): { num: HTMLElement } {
  if (fmt.prefix) ctx.el("span", "cb-affix", host, fmt.prefix);
  const num = ctx.el("span", "cb-num", host);
  if (fmt.suffix) ctx.el("span", "cb-affix", host, fmt.suffix);
  return { num };
}

/** A tick per change of a counter's last digit, from 0 to `to` over `duration` (at most 20 a second). */
function cueCount(ctx: BlockContext, el: Element, to: number, decimals: number, at: number, duration: number): void {
  const changes = to * 10 ** decimals;
  if (changes >= 1 && duration > 0) ctx.cue(at, "tick", { weight: 0.25, at: el, until: at + duration, rate: Math.min(20, changes / duration) });
}

/** The badge lands above (x, y) (its notch points down at it), kept inside the region. */
function landBadge(ctx: BlockContext, badge: HTMLElement | null, x: number, y: number, region: Region, at: number): void {
  if (!badge) return;
  const w = badge.getBoundingClientRect().width;
  const h = badge.getBoundingClientRect().height;
  const left = Math.max(region.x, Math.min(region.x + region.w - w, x - w / 2));
  Object.assign(badge.style, { left: `${left}px`, top: `${y - h - 18}px` });
  badge.style.setProperty("--notch", `${x - left}px`);
  ctx.tl.fromTo(badge, { y: 18, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1 }, { at, duration: 0.5, ease: "out" });
  ctx.cue(at, "pop", { weight: 0.4, at: badge });
}

function valueSize(values: readonly number[], fmt: Format, room: number): number {
  const longest = Math.max(...values.map((v) => formatNumber(v, fmt).length));
  return Math.max(18, Math.min(34, (room * 1.7) / Math.max(1, longest)));
}

function bars(ctx: BlockContext, region: Region, values: number[], labels: string[], hi: number, fmt: Format, rest: string, badge: HTMLElement | null, at: Times): void {
  const { tl, palette } = ctx;
  const n = values.length;
  const badgeRoom = badge ? 90 : 0;
  const valueRoom = 52;
  const labelRoom = 58;
  const plotH = Math.max(1, region.h - badgeRoom - valueRoom - labelRoom);
  const top = niceMax(Math.max(...values));
  const gap = 0.38;
  const bw = Math.min(region.w / (n + (n - 1) * gap), region.w * 0.24);
  const groupW = bw * (n + (n - 1) * gap);
  const x0 = region.x + (region.w - groupW) / 2;
  const baseY = region.y + badgeRoom + valueRoom + plotH;
  const size = valueSize(values, fmt, bw);

  const base = ctx.el("div", "cb-base");
  Object.assign(base.style, { left: `${x0 - 12}px`, top: `${baseY}px`, width: `${groupW + 24}px` });
  tl.fromTo(base, { scaleX: 0 }, { scaleX: 1 }, { at: 0.25, duration: 0.6, ease: "in-out" });

  const each = n > 1 ? Math.min(0.08, 0.45 / (n - 1)) : 0;
  const barEls: HTMLElement[] = [];
  values.forEach((v, i) => {
    const x = x0 + i * bw * (1 + gap);
    const h = Math.max(4, (v / top) * plotH);
    const bar = ctx.el("div", "cb-bar");
    Object.assign(bar.style, { left: `${x}px`, top: `${baseY - h}px`, width: `${bw}px`, height: `${h}px`, background: rest });
    barEls.push(bar);
    const val = ctx.el("div", "cb-val");
    Object.assign(val.style, { left: `${x - bw}px`, width: `${bw * 3}px`, top: `${baseY - h - valueRoom + 4}px`, fontSize: `${size}px` });
    const start = at.growAt + i * each;
    tl.fromTo(bar, { scaleY: 0 }, { scaleY: 1 }, { at: start, duration: at.growFor, ease: "out" });
    ctx.cue(start, "pop", { weight: 0.3, at: { x: x + bw / 2, y: baseY - h / 2 } });
    // The label rides the bar's top while both count up.
    tl.fromTo(val, { y: h, opacity: 0 }, { y: 0, opacity: 1 }, { at: start, duration: at.growFor, ease: "out" });
    tl.track(counter(val, { from: 0, to: v, at: start, duration: at.growFor, ease: "out", ...fmt }));
    if (labels[i]) {
      const cat = ctx.el("div", "cb-cat", ctx.root, labels[i]);
      Object.assign(cat.style, { left: `${x - bw}px`, width: `${bw * 3}px`, top: `${baseY + 16}px` });
      tl.fromTo(cat, { y: -10, opacity: 0 }, { y: 0, opacity: 1 }, { at: start + 0.1, duration: 0.5, ease: "out" });
    }
    if (i === hi) {
      tl.fromTo(val, { color: palette.ink }, { color: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
      landBadge(ctx, badge, x + bw / 2, baseY - h - valueRoom + 6, region, at.climax + 0.12);
    }
  });
  // The climax, after a beat of stillness: the highlight takes the accent, the rest step back.
  tl.fromTo(barEls[hi]!, { backgroundColor: rest }, { backgroundColor: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
  ctx.cue(at.climax, "land", { weight: 0.5, at: barEls[hi]! });
  tl.to(barEls.filter((_, i) => i !== hi), { opacity: 0.32 }, { at: at.climax, duration: 0.45, ease: "smooth" });
}

function svgIn(ctx: BlockContext): SVGSVGElement {
  const svg = ctx.doc.createElementNS(SVG, "svg");
  svg.setAttribute("class", "cb-svg");
  svg.setAttribute("viewBox", `0 0 ${ctx.width} ${ctx.height}`);
  svg.setAttribute("width", String(ctx.width));
  svg.setAttribute("height", String(ctx.height));
  ctx.root.append(svg);
  return svg;
}

function node<K extends keyof SVGElementTagNameMap>(ctx: BlockContext, parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = ctx.doc.createElementNS(SVG, tag);
  for (const [key, v] of Object.entries(attrs)) el.setAttribute(key, String(v));
  parent.append(el);
  return el;
}

function line(ctx: BlockContext, region: Region, values: number[], labels: string[], hi: number, fmt: Format, rest: string, badge: HTMLElement | null, at: Times): void {
  const { tl, palette } = ctx;
  const n = values.length;
  const badgeRoom = badge ? 150 : 70;
  const labelRoom = 58;
  const pad = 24;
  const top = niceMax(Math.max(...values));
  const y0 = region.y + badgeRoom;
  const baseY = region.y + region.h - labelRoom;
  const plotH = Math.max(1, baseY - y0);
  const xs = values.map((_, i) => region.x + pad + ((region.w - pad * 2) * i) / Math.max(1, n - 1));
  const ys = values.map((v) => baseY - (v / top) * plotH);
  const svg = svgIn(ctx);

  // Hairlines at 0, half and the top, labelled at the right.
  [0, 0.5, 1].forEach((f, i) => {
    const y = baseY - f * plotH;
    const rule = node(ctx, svg, "line", { x1: region.x, y1: y, x2: region.x + region.w, y2: y, class: f === 0 ? "cb-axis" : "cb-rule" });
    rule.style.transformOrigin = `${region.x}px ${y}px`;
    tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1 }, { at: 0.2 + i * 0.06, duration: 0.7, ease: "in-out" });
    if (f > 0) {
      const tick = ctx.el("div", "cb-tick", ctx.root, formatNumber(top * f, { ...fmt, decimals: top * f < 10 ? fmt.decimals : 0 }));
      Object.assign(tick.style, { left: `${region.x}px`, width: "200px", top: `${y - 36}px` });
      tl.fromTo(tick, { opacity: 0 }, { opacity: 1 }, { at: 0.5 + i * 0.06, duration: 0.4, ease: "linear" });
    }
  });

  // Area + line, revealed left to right by one clip so the fill, the stroke and the pen stay together.
  const draw = node(ctx, svg, "g", {});
  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const area = node(ctx, draw, "polygon", { points: `${xs[0]},${baseY} ${pts} ${xs[n - 1]},${baseY}`, class: "cb-area" });
  area.style.fill = rest;
  const stroke = node(ctx, draw, "polyline", { points: pts, class: "cb-line" });
  stroke.style.stroke = rest;
  const ease = resolveEase("in-out");
  const span = xs[n - 1]! - xs[0]!;
  const drawFor = at.growFor + 0.4;
  const clipAt = (t: number): number => ease(Math.min(1, Math.max(0, (t - at.growAt) / drawFor)));
  const pen = node(ctx, svg, "circle", { r: 11, class: "cb-pen" });
  pen.style.fill = rest;
  tl.track((t) => {
    const q = clipAt(t);
    // A 6 px margin either side keeps the round caps and joins inside the clip.
    draw.style.clipPath = q >= 1 ? "" : `inset(-20px ${(1 - q) * (span + 12) - 6}px -20px -20px)`;
    const x = xs[0]! + q * span;
    let j = 0;
    while (j < n - 2 && xs[j + 1]! < x) j += 1;
    const f = (x - xs[j]!) / Math.max(1, xs[j + 1]! - xs[j]!);
    pen.setAttribute("cx", String(x));
    pen.setAttribute("cy", String(ys[j]! + (ys[j + 1]! - ys[j]!) * Math.min(1, Math.max(0, f))));
    pen.style.opacity = t < at.growAt || q >= 1 ? "0" : "1";
  });

  // Dots pop as the pen passes them.
  const dots = xs.map((x, i) => {
    const dot = node(ctx, svg, "circle", { cx: x, cy: ys[i]!, r: 9, class: "cb-dot" });
    dot.style.fill = palette.paper;
    dot.style.stroke = rest;
    dot.style.transformOrigin = `${x}px ${ys[i]}px`;
    const when = at.growAt + drawFor * easeInverse(ease, (x - xs[0]!) / Math.max(1, span));
    tl.fromTo(dot, { scale: 0 }, { scale: 1 }, { at: when, duration: 0.3, ease: "out" });
    ctx.cue(when, "pop", { weight: 0.3, at: { x, y: ys[i]! } });
    return dot;
  });
  labels.slice(0, n).forEach((label, i) => {
    if (!label) return;
    const cat = ctx.el("div", "cb-cat", ctx.root, label);
    Object.assign(cat.style, { left: `${xs[i]! - 100}px`, width: "200px", top: `${baseY + 16}px` });
    tl.fromTo(cat, { opacity: 0 }, { opacity: 1 }, { at: at.growAt + i * 0.05, duration: 0.4, ease: "linear" });
  });

  // The climax: a guide drops from the highlighted point, which takes the accent and its value.
  const hx = xs[hi]!;
  const hy = ys[hi]!;
  const guide = node(ctx, svg, "line", { x1: hx, y1: hy, x2: hx, y2: baseY, class: "cb-guide" });
  guide.style.transformOrigin = `${hx}px ${hy}px`;
  guide.style.stroke = palette.accent;
  tl.fromTo(guide, { scaleY: 0 }, { scaleY: 1 }, { at: at.climax, duration: 0.5, ease: "in-out" });
  const halo = node(ctx, svg, "circle", { cx: hx, cy: hy, r: 26, class: "cb-halo" });
  halo.style.fill = palette.accent;
  halo.style.transformOrigin = `${hx}px ${hy}px`;
  tl.fromTo(halo, { scale: 0, opacity: 0 }, { scale: 1, opacity: 0.22 }, { at: at.climax, duration: 0.5, ease: "out" });
  ctx.cue(at.climax, "land", { weight: 0.5, at: { x: hx, y: hy } });
  tl.fromTo(dots[hi]!, { scale: 1, fill: palette.paper, stroke: rest }, { scale: 1.5, fill: palette.accent, stroke: palette.accent }, { at: at.climax, duration: 0.35, ease: "out" });
  tl.to([stroke, area], { opacity: 0.7 }, { at: at.climax, duration: 0.45, ease: "smooth" });
  const val = ctx.el("div", "cb-val", ctx.root, formatNumber(values[hi]!, fmt));
  const size = 34;
  Object.assign(val.style, { left: `${hx - 150}px`, width: "300px", top: `${hy - 74}px`, fontSize: `${size}px`, color: palette.accent });
  tl.fromTo(val, { y: 12, opacity: 0 }, { y: 0, opacity: 1 }, { at: at.climax + 0.05, duration: 0.45, ease: "out" });
  landBadge(ctx, badge, hx, hy - 84, region, at.climax + 0.15);
}

function donut(ctx: BlockContext, region: Region, side: boolean, values: number[], labels: string[], hi: number, fmt: Format, rest: string, badge: HTMLElement | null, at: Times, headBottom: number): void {
  const { tl, palette } = ctx;
  const n = values.length;
  const total = Math.max(1e-9, values.reduce((a, b) => a + b, 0));
  const legendRows = n * 64;
  const d = side ? Math.min(region.h * 0.86, region.w * 0.56) : Math.min(region.w * 0.78, region.h - legendRows - 90);
  const sw = d * 0.15;
  const r = (d - sw) / 2;
  const cx = side ? region.x + d / 2 : region.x + region.w / 2;
  const cy = side ? region.y + region.h / 2 : region.y + d / 2;
  const C = 2 * Math.PI * r;
  const svg = svgIn(ctx);
  const ring = node(ctx, svg, "g", { transform: `rotate(-90 ${cx} ${cy})` });
  const trackRing = node(ctx, ring, "circle", { cx, cy, r, class: "cb-ring" });
  trackRing.style.strokeWidth = String(sw);
  tl.fromTo(trackRing, { opacity: 0 }, { opacity: 1 }, { at: 0.2, duration: 0.5, ease: "linear" });

  const fractions = values.map((v) => v / total);
  const starts = fractions.map((_, i) => fractions.slice(0, i).reduce((a, b) => a + b, 0));
  const gap = n > 1 ? 0.006 : 0;
  // The others step down in tone so the one accent reads first.
  const tones = [1, 0.62, 0.42, 0.28, 0.18, 0.12];
  let toneIndex = 0;
  const sweepFor = at.growFor + 0.5;
  const ease = resolveEase("in-out");
  const arcs = values.map((_, i) => {
    const arc = node(ctx, ring, "circle", { cx, cy, r, class: "cb-arc" });
    arc.style.strokeWidth = String(sw);
    arc.style.stroke = rest;
    arc.style.opacity = String(i === hi ? 1 : tones[Math.min(tones.length - 1, toneIndex++)]);
    arc.setAttribute("stroke-dashoffset", String(-starts[i]! * C));
    return arc;
  });
  tl.track((t) => {
    const q = ease(Math.min(1, Math.max(0, (t - at.growAt) / sweepFor)));
    arcs.forEach((arc, i) => {
      const len = Math.max(0, Math.min(fractions[i]! - gap, q - starts[i]!)) * C;
      arc.setAttribute("stroke-dasharray", `${len.toFixed(2)} ${C.toFixed(2)}`);
    });
  });
  values.forEach((_, i) => ctx.cue(at.growAt + starts[i]! * sweepFor, "pop", { weight: 0.25, at: { x: cx, y: cy } }));
  tl.fromTo(arcs[hi]!, { stroke: rest, strokeWidth: sw }, { stroke: palette.accent, strokeWidth: sw * 1.22 }, { at: at.climax, duration: 0.4, ease: "out" });
  ctx.cue(at.climax, "land", { weight: 0.5, at: { x: cx, y: cy } });
  arcs.forEach((arc, i) => {
    if (i !== hi) tl.fromTo(arc, { opacity: Number(arc.style.opacity) }, { opacity: 0.16 }, { at: at.climax, duration: 0.45, ease: "smooth" });
  });

  // The number in the ring counts to the highlighted part.
  const centre = ctx.el("div", "cb-centre");
  const numHost = ctx.el("div", "cb-big", centre);
  const parts = numberParts(ctx, numHost, fmt);
  parts.num.textContent = formatNumber(values[hi]!, { decimals: fmt.decimals });
  fitWidth(numHost, [numHost], r * 1.25, r * 0.62, 40);
  numHost.style.fontWeight = ctx.display === "sans" ? "300" : "400";
  const sub = labels[hi] ? ctx.el("div", "cb-sub", centre, labels[hi]) : null;
  Object.assign(centre.style, { left: `${cx}px`, top: `${cy}px` });
  tl.set(centre, { xPercent: -50, yPercent: -50 }, 0);
  tl.track(counter(parts.num, { from: 0, to: values[hi]!, at: at.growAt, duration: sweepFor, ease: "out", decimals: fmt.decimals }));
  cueCount(ctx, parts.num, values[hi]!, fmt.decimals, at.growAt, sweepFor);
  tl.fromTo(numHost, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1 }, { at: at.growAt, duration: 0.6, ease: "out" });
  if (sub) {
    tl.fromTo(sub, { opacity: 0 }, { opacity: 1 }, { at: at.growAt + 0.3, duration: 0.4, ease: "linear" });
    tl.fromTo(sub, { color: palette.muted }, { color: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
  }

  // Legend: beside the ring on landscape, under it on vertical frames.
  const legend = ctx.el("div", "cb-legend");
  const lx = side ? cx + d / 2 + 80 : region.x + region.w * 0.12;
  const ly = side ? cy - legendRows / 2 : cy + d / 2 + 70;
  Object.assign(legend.style, { left: `${lx}px`, top: `${ly}px`, width: `${side ? region.x + region.w - lx : region.w * 0.76}px` });
  toneIndex = 0;
  const rows = values.map((v, i) => {
    const row = ctx.el("div", "cb-row", legend);
    const sw0 = ctx.el("span", "cb-swatch", row);
    sw0.style.background = rest;
    sw0.style.opacity = String(i === hi ? 1 : tones[Math.min(tones.length - 1, toneIndex++)]);
    ctx.el("span", "cb-name", row, labels[i] ?? "");
    const val = ctx.el("span", "cb-amount", row);
    tl.track(counter(val, { from: 0, to: v, at: at.growAt + starts[i]! * sweepFor, duration: sweepFor * 0.7, ease: "out", ...fmt }));
    if (i === hi) {
      tl.fromTo(sw0, { backgroundColor: rest }, { backgroundColor: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
      tl.fromTo(row, { color: palette.ink }, { color: palette.accent }, { at: at.climax, duration: 0.3, ease: "smooth" });
    }
    return row;
  });
  tl.fromTo(rows, { y: 16, opacity: 0 }, { y: 0, opacity: 1 }, { at: at.growAt + 0.2, duration: 0.6, ease: "out", stagger: Math.min(0.08, 0.45 / Math.max(1, n - 1)) });
  tl.to(rows.filter((_, i) => i !== hi), { opacity: 0.45 }, { at: at.climax, duration: 0.45, ease: "smooth" });
  if (badge) {
    Object.assign(badge.style, { left: `${ctx.safe.left}px`, top: `${headBottom + 24}px` });
    badge.classList.add("is-flat");
    tl.fromTo(badge, { y: 18, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1 }, { at: at.climax + 0.12, duration: 0.5, ease: "out" });
    ctx.cue(at.climax + 0.12, "pop", { weight: 0.4, at: badge });
  }
}
