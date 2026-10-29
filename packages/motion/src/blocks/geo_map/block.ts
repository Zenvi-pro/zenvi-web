import { formatNumber, resolveEase, splitText, type BlockContext } from "../../runtime/index.js";
import { mixHex } from "../ui.js";
import { angleBetween, fitView, globeArc, mixView, projector, ringPoints, slerp, toLonLat, toVec, worldView, type LonLat, type Projected, type ProjectionKind, type View } from "./geo.js";
import { atlas, planGeoMap, type GeoMarker } from "./plan.js";

const SVG = "http://www.w3.org/2000/svg";

function node<K extends keyof SVGElementTagNameMap>(ctx: BlockContext, parent: Element, tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = ctx.doc.createElementNS(SVG, tag);
  for (const [key, v] of Object.entries(attrs)) el.setAttribute(key, String(v));
  parent.append(el);
  return el;
}

const r1 = (v: number): string => (Math.round(v * 10) / 10).toString();

/** SVG path data for closed rings. */
function ringsD(rings: readonly (readonly Projected[])[], cx: number, cy: number): string {
  let d = "";
  for (const ring of rings) {
    ring.forEach((p, i) => {
      d += `${i === 0 ? "M" : "L"}${r1(cx + p.x)} ${r1(cy + p.y)}`;
    });
    d += "Z";
  }
  return d;
}

/** SVG path data for an open line, broken where it goes behind the globe. */
function lineD(points: readonly Projected[], cx: number, cy: number): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p.visible) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${r1(cx + p.x)} ${r1(cy + p.y)}`;
    pen = true;
  }
  return d;
}

interface Arc {
  from: number;
  to: number;
  samples: LonLat[];
  at: number;
  duration: number;
  /** Peak height on the globe, a fraction of its radius. */
  height: number;
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const plan = planGeoMap(p);
  // checkParams refuses unknown places before a block is built.
  if ("error" in plan) throw new Error(plan.error);
  const a = atlas();
  const kind = String(p.projection) as ProjectionKind;
  // Short blocks run the same move faster.
  const k = Math.min(1, ctx.seconds / 6);
  const pushAt = 0.25;
  const pushFor = 2.8 * k;
  const push = resolveEase("in-out");

  const land = mixHex(palette.paper, palette.ink, palette.dark ? 0.17 : 0.13);
  const ocean = mixHex(palette.paper, palette.ink, palette.dark ? 0.05 : 0.035);
  const accent = palette.accent;

  // Title and legend sit on scrims so they read over land.
  const legendH = plan.values.size > 0 ? 130 : 0;
  const scrims = [p.title ? "is-top" : "", legendH ? "is-bottom" : ""].filter(Boolean).map((side) => ctx.el("div", `gm-scrim ${side}`));
  const head = p.title ? ctx.el("div", "gm-title", ctx.root, String(p.title)) : null;
  if (head) Object.assign(head.style, { left: `${safe.left}px`, top: `${safe.top}px`, width: `${W - safe.left - safe.right}px` });
  const headBottom = head ? safe.top + head.getBoundingClientRect().height : safe.top;
  const region = { x: safe.left, y: head ? headBottom + 40 : safe.top, w: W - safe.left - safe.right, h: 0 };
  region.h = Math.max(200, H - safe.bottom - legendH - region.y);
  const cx = region.x + region.w / 2;
  const cy = region.y + region.h / 2;

  // Views: the whole world (or `start`) to the focus.
  const world = (lon: number, lat: number): View => worldView(kind, region.w, region.h, lon, lat, 0.84);
  // Labelled markers need room beside them at the frame's edges.
  const fill = plan.markers.some((m) => m.label) ? 0.7 : 0.84;
  const fit = (pts: readonly LonLat[]): View => fitView(kind, pts, region.w, region.h, fill, 6);
  const focusPts = plan.focus && !(plan.focus.kind === "area" && plan.focus.world)
    ? a.outline(plan.focus)
    : [...plan.markers.map((m) => m.at), ...[...plan.highlight, ...plan.values.keys()].flatMap((i) => a.countries[i]!.core.flat())];
  const focusWorld = plan.focus?.kind === "area" && plan.focus.world;
  // The whole world still turns to face what is on it.
  const facing = focusPts.length > 0 && kind === "globe" ? centreOf(focusPts) : ([10, 20] as LonLat);
  const end = focusWorld ? world(facing[0], Math.max(-35, Math.min(35, facing[1]))) : fit(focusPts);
  const start = plan.start
    ? plan.start.kind === "area" && plan.start.world
      ? world(end.lon - 45, end.lat * 0.4)
      : fit(a.outline(plan.start))
    : world(kind === "globe" ? end.lon - 45 : 10, end.lat * 0.4);
  const viewAt = (t: number): View => {
    const v = mixView(start, end, push(Math.min(1, Math.max(0, (t - pushAt) / pushFor))));
    // A slow drift after the push so the frame never freezes.
    const drift = t / ctx.seconds;
    return { lon: v.lon + (kind === "globe" ? 4 * drift : 0), lat: v.lat, zoom: v.zoom * (1 + 0.05 * drift) };
  };
  const moved = angleBetween([start.lon, start.lat], [end.lon, end.lat]) > 8 || Math.abs(Math.log(end.zoom / start.zoom)) > 0.4;
  if (moved) ctx.cue(pushAt, "whoosh", { weight: 0.6 });

  // Layers, bottom up: atmosphere and ocean, graticule, countries, routes; markers and text are HTML.
  const svg = node(ctx, ctx.root, "svg", { class: "gm-svg", viewBox: `0 0 ${W} ${H}`, width: W, height: H });
  const defs = node(ctx, svg, "defs");
  const glowId = `gm-glow-${ctx.seed}`;
  const glow = node(ctx, defs, "radialGradient", { id: glowId });
  node(ctx, glow, "stop", { offset: "0.86", "stop-color": accent, "stop-opacity": 0.22 });
  node(ctx, glow, "stop", { offset: "1", "stop-color": accent, "stop-opacity": 0 });
  const atmosphere = kind === "globe" ? node(ctx, svg, "circle", { fill: `url(#${glowId})` }) : null;
  const sphere = kind === "globe" ? node(ctx, svg, "circle", { class: "gm-sphere" }) : null;
  sphere?.style.setProperty("fill", ocean);
  const graticule = kind === "globe" ? node(ctx, svg, "path", { class: "gm-graticule" }) : null;
  const gratLines: LonLat[][] = [];
  if (graticule) {
    for (let lon = -180; lon < 180; lon += 30) gratLines.push(Array.from({ length: 61 }, (_, i) => [lon, -90 + i * 3] as LonLat));
    for (let lat = -60; lat <= 60; lat += 30) gratLines.push(Array.from({ length: 121 }, (_, i) => [-180 + i * 3, lat] as LonLat));
  }

  const lit = new Set([...plan.highlight, ...plan.values.keys()]);
  const countryG = node(ctx, svg, "g", { class: "gm-land" });
  const paths = a.countries.map((c, i) => {
    const path = node(ctx, countryG, "path", { "fill-rule": "evenodd" });
    path.style.fill = land;
    path.style.stroke = palette.paper;
    return { path, country: c, lit: lit.has(i) };
  });
  // Filled countries draw last so their borders are not covered.
  for (const entry of paths) if (entry.lit) countryG.append(entry.path);

  // The fills: highlights take the accent, values a ramp from the land tone, sweeping west to east.
  const fillAt = pushAt + pushFor * 0.45;
  const order = [...lit].sort((x, y) => a.countries[x]!.label[0] - a.countries[y]!.label[0]);
  const vals = [...plan.values.values()];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const ramp = (v: number): string => mixHex(mixHex(land, accent, 0.25), accent, hi > lo ? (v - lo) / (hi - lo) : 1);
  const sweep = order.length > 1 ? Math.min(0.9 * k, 0.08 * (order.length - 1)) : 0;
  order.forEach((i, n) => {
    const target = plan.values.has(i) ? ramp(plan.values.get(i)!) : accent;
    const at = fillAt + (order.length > 1 ? (sweep * n) / (order.length - 1) : 0);
    tl.fromTo(paths[i]!.path, { fill: land }, { fill: target }, { at, duration: 0.5, ease: "smooth" });
  });
  if (order.length > 0) ctx.cue(fillAt, "reveal", { weight: 0.4 });

  // Markers pop 0.2 s apart while the camera is still pushing in.
  const markAt = pushAt + pushFor * 0.55;
  const n = plan.markers.length;
  const stagger = n > 1 ? Math.min(0.2, (ctx.seconds * 0.3) / (n - 1)) : 0;
  const popAt = plan.markers.map((_, i) => markAt + i * stagger);
  const routeG = node(ctx, svg, "g", { class: "gm-routes" });
  const pairs: [number, number][] = p.route === "path" ? plan.markers.slice(1).map((_, i) => [i, i + 1]) : p.route === "hub" ? plan.markers.slice(1).map((_, i) => [0, i + 1]) : [];
  const arcs: (Arc & { line: SVGPathElement; head: SVGCircleElement })[] = pairs.map(([from, to]) => {
    const at = Math.max(popAt[from]!, popAt[to]!) + 0.1;
    const samples = Array.from({ length: 49 }, (_, s) => slerp(plan.markers[from]!.at, plan.markers[to]!.at, s / 48));
    const line = node(ctx, routeG, "path", { class: "gm-route" });
    line.style.stroke = accent;
    const head = node(ctx, routeG, "circle", { r: 7, class: "gm-route-head" });
    head.style.fill = accent;
    ctx.cue(at, "whoosh", { weight: 0.25 });
    // Longer flights fly higher.
    const height = 0.25 * Math.sin((angleBetween(plan.markers[from]!.at, plan.markers[to]!.at) * Math.PI) / 360);
    return { from, to, samples, at, duration: 0.45 + 0.35 * k, height, line, head };
  });

  // Labels are placed for the last frame, where the drift has carried the pins furthest out.
  const finalProject = projector(kind, viewAt(ctx.seconds));
  const markers = plan.markers.map((m, i) => marker(ctx, m, popAt[i]!, finalProject, cx, cy));
  placeLabels(markers, W);
  // Text reads over land: scrims, then the title, above the map and the pins.
  for (const scrim of scrims) {
    scrim.style.background = `linear-gradient(${scrim.classList.contains("is-top") ? "180deg" : "0deg"}, ${palette.paper}, ${palette.paper}00)`;
    ctx.root.append(scrim);
  }
  if (head) ctx.root.append(head);

  // Every frame: re-project the world for the camera.
  const draw = resolveEase("in-out");
  tl.track((t) => {
    const view = viewAt(t);
    const project = projector(kind, view);
    if (sphere && atmosphere) {
      for (const [el, r] of [[sphere, view.zoom], [atmosphere, view.zoom * 1.16]] as const) {
        el.setAttribute("cx", r1(cx));
        el.setAttribute("cy", r1(cy));
        el.setAttribute("r", r1(r));
      }
    }
    if (graticule) graticule.setAttribute("d", gratLines.map((l) => lineD(l.map(([lon, lat]) => project(lon, lat)), cx, cy)).join(""));
    const strokeW = Math.max(0.6, Math.min(2.2, view.zoom / 900));
    for (const { path, country } of paths) {
      path.style.strokeWidth = r1(strokeW);
      // Mercator blows Antarctica up into a band along the bottom; flat maps leave it out.
      if (kind === "flat" && country.a3 === "ATA") continue;
      // The far side of the globe is skipped whole when the country's label point is well behind it.
      if (kind === "globe" && angleBetween(country.label, [view.lon, view.lat]) > 135) {
        path.setAttribute("d", "");
        continue;
      }
      const rings = country.rings.map((ring) => ringPoints(kind, view, project, ring)).filter((r): r is Projected[] => r !== null);
      path.setAttribute("d", ringsD(rings, cx, cy));
    }
    for (const m of markers) {
      const q = project(m.at[0], m.at[1]);
      m.el.style.left = `${r1(cx + q.x)}px`;
      m.el.style.top = `${r1(cy + q.y)}px`;
      m.el.style.visibility = q.visible ? "visible" : "hidden";
    }
    for (const arc of arcs) {
      const f = draw(Math.min(1, Math.max(0, (t - arc.at) / arc.duration)));
      if (f <= 0) {
        arc.line.setAttribute("d", "");
        arc.head.style.opacity = "0";
        continue;
      }
      const pts = kind === "globe" ? globeArc(view, arc.samples, arc.height) : bow(arc.samples.map(([lon, lat]) => project(lon, lat)));
      const upTo = Math.max(2, Math.round(f * (pts.length - 1)) + 1);
      arc.line.setAttribute("d", lineD(pts.slice(0, upTo), cx, cy));
      const tip = pts[upTo - 1]!;
      arc.head.setAttribute("cx", r1(cx + tip.x));
      arc.head.setAttribute("cy", r1(cy + tip.y));
      arc.head.style.opacity = f >= 1 || !tip.visible ? "0" : "1";
    }
  });

  if (head) {
    const split = splitText(head, { lines: true });
    tl.fromTo(split.lineInners, { yPercent: 105 }, { yPercent: 0 }, { at: 0.1, duration: 0.7, ease: "out", stagger: 0.12 });
  }
  if (legendH > 0) legend(ctx, lo, hi, land, accent, ramp, fillAt);
}

/** A route on the flat map bowed upward off its chord, like a flight-map arc. */
function bow(points: Projected[]): Projected[] {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return points;
  const flip = dx >= 0 ? 1 : -1;
  const n = points.length - 1;
  return points.map((p, i) => {
    const h = 0.2 * len * Math.sin((Math.PI * i) / n);
    return { x: p.x + (dy / len) * h * flip, y: p.y - (dx / len) * h * flip, visible: p.visible };
  });
}

function centreOf(points: readonly LonLat[]): LonLat {
  const s = points.reduce<[number, number, number]>((acc, [lon, lat]) => {
    const v = toVec(lon, lat);
    return [acc[0] + v[0], acc[1] + v[1], acc[2] + v[2]];
  }, [0, 0, 0]);
  return toLonLat(s);
}

interface MarkerEl {
  el: HTMLElement;
  at: LonLat;
  label: HTMLElement | null;
  /** Where the marker is on the last frame (labels are placed for it). */
  x: number;
  y: number;
}

function marker(ctx: BlockContext, m: GeoMarker, at: number, project: ReturnType<typeof projector>, cx: number, cy: number): MarkerEl {
  const { tl } = ctx;
  const el = ctx.el("div", "gm-marker");
  const pin = ctx.el("div", "gm-pin", el);
  const pulse = ctx.el("div", "gm-pulse", pin);
  ctx.el("div", "gm-dot", pin);
  tl.fromTo(pin, { scale: 0 }, { scale: 1 }, { at, duration: 0.35, ease: "back-out" });
  tl.fromTo(pulse, { scale: 1, opacity: 0.55 }, { scale: 3.2, opacity: 0 }, { at: at + 0.1, duration: 0.9, ease: "out" });
  ctx.cue(at, "pop", { weight: 0.3, at: pin });
  const label = m.label ? ctx.el("div", "gm-label", el, m.label) : null;
  if (label) tl.fromTo(label, { opacity: 0, x: -14 }, { opacity: 1, x: 0 }, { at: at + 0.08, duration: 0.4, ease: "out" });
  const q = project(m.at[0], m.at[1]);
  return { el, at: m.at, label, x: cx + q.x, y: cy + q.y };
}

/** Labels go right of their pin, else left (first near the right edge), above or below, whichever covers no pin or earlier label. */
function placeLabels(markers: readonly MarkerEl[], width: number): void {
  // Pins are obstacles too: a label never covers another place's dot.
  const boxes = markers.map((m) => ({ x0: m.x - 20, x1: m.x + 20, y0: m.y - 20, y1: m.y + 20 }));
  const overlaps = (b: (typeof boxes)[number]): boolean => boxes.some((o) => b.x0 < o.x1 && o.x0 < b.x1 && b.y0 < o.y1 && o.y0 < b.y1);
  for (const m of markers) {
    if (!m.label) continue;
    const w = m.label.getBoundingClientRect().width || m.label.textContent!.length * 18;
    const h = 52;
    const right = { x0: m.x + 26, x1: m.x + 26 + w, y0: m.y - h / 2, y1: m.y + h / 2 };
    const left = { x0: m.x - 26 - w, x1: m.x - 26, y0: m.y - h / 2, y1: m.y + h / 2 };
    const below = { x0: m.x - w / 2, x1: m.x + w / 2, y0: m.y + 26, y1: m.y + 26 + h };
    const above = { x0: m.x - w / 2, x1: m.x + w / 2, y0: m.y - 26 - h, y1: m.y - 26 };
    const prefer = m.x + 26 + w > width - 40 ? [left, right, above, below] : [right, left, above, below];
    // Inside the frame, then clear of pins and earlier labels.
    const inside = prefer.filter((b) => b.x0 >= 48 && b.x1 <= width - 48);
    const box = inside.find((b) => !overlaps(b)) ?? prefer.find((b) => !overlaps(b)) ?? inside[0] ?? prefer[0]!;
    boxes.push(box);
    const side = box === right ? "right" : box === left ? "left" : box === above ? "above" : "below";
    m.label.classList.add(`is-${side}`);
  }
}

function legend(ctx: BlockContext, lo: number, hi: number, land: string, accent: string, ramp: (v: number) => string, at: number): void {
  const { tl, safe, width: W, height: H, params: p } = ctx;
  const fmt = { prefix: String(p.prefix ?? ""), suffix: String(p.suffix ?? ""), decimals: Math.abs(hi - lo) < 10 && !Number.isInteger(lo + hi) ? 1 : 0 };
  const band = ctx.el("div", "gm-legend");
  const w = Math.min(W - safe.left - safe.right, 760);
  Object.assign(band.style, { left: `${safe.left}px`, top: `${H - safe.bottom - 110}px`, width: `${w}px` });
  if (p.legend) ctx.el("div", "gm-legend-title", band, String(p.legend));
  const bar = ctx.el("div", "gm-ramp", band);
  bar.style.background = `linear-gradient(90deg, ${mixHex(land, accent, 0.25)}, ${ramp((lo + hi) / 2)}, ${accent})`;
  const ends = ctx.el("div", "gm-ends", band);
  ctx.el("span", "", ends, formatNumber(lo, fmt));
  ctx.el("span", "", ends, formatNumber(hi, fmt));
  tl.fromTo(band, { y: 24, opacity: 0 }, { y: 0, opacity: 1 }, { at, duration: 0.6, ease: "out" });
  tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1 }, { at: at + 0.1, duration: 0.8, ease: "in-out" });
}
