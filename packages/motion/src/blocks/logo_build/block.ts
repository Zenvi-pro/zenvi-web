import {
  centroid,
  circle,
  drawTrail,
  EASES,
  measure,
  morphRings,
  outlinePath,
  pointAlong,
  prepareMorph,
  ringsPath,
  roundRect,
  sector,
  toOutline,
  transformOutline,
  transformRing,
  type BlockContext,
  type Outline,
  type PathLine,
  type Point,
} from "../../runtime/index.js";

const HEX = /^#[0-9a-f]{6}$/i;
const SVG = "http://www.w3.org/2000/svg";

/** A teardrop from near the centre out to radius 1 along +x, fat end out. */
function petal(): Point[] {
  return Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2;
    // Thinner toward the centre (cos a = -1).
    return { x: 0.56 + 0.44 * Math.cos(a), y: 0.36 * Math.sin(a) * (0.62 + 0.38 * Math.cos(a)) };
  });
}

/** The mark's four pieces, about the origin within radius ~1, and how far the mark turns as it locks. */
function markPieces(mark: string): { pieces: Outline[]; turn: number } {
  switch (mark) {
    case "pinwheel":
      // Quarter discs, each slid out along its leading edge: a windmill.
      return {
        pieces: [0, 1, 2, 3].map((k) => {
          const a = (k * Math.PI) / 2;
          return toOutline([transformRing(sector(0, 90, 0.8), { rotate: k * 90, x: Math.cos(a) * 0.2 - 0.1, y: Math.sin(a) * 0.2 - 0.1 })]);
        }),
        turn: 90,
      };
    case "stack":
      // Right-aligned bars shortening downward: motion lines.
      return {
        pieces: [1.9, 1.45, 1.05, 0.62].map((w, k) => toOutline([transformRing(roundRect(w, 0.34, 0.17), { x: 0.95 - w / 2, y: -0.69 + k * 0.46 })])),
        turn: 0,
      };
    case "kit":
      return {
        pieces: [
          toOutline([transformRing(circle(0.42), { x: -0.48, y: -0.48 })]),
          toOutline([transformRing(roundRect(0.84, 0.84, 0.14), { x: 0.48, y: -0.48 })]),
          toOutline([transformRing(sector(-90, 0, 0.88), { x: -0.9, y: 0.92 })]),
          toOutline([transformRing(roundRect(0.84, 0.4, 0.2), { x: 0.48, y: 0.48, rotate: 90 })]),
        ],
        turn: 0,
      };
    default:
      return { pieces: [0, 1, 2, 3].map((k) => toOutline([transformRing(petal(), { rotate: 45 + k * 90 })])), turn: 90 };
  }
}

/** A quadratic Bézier from a to b bending through c, as a polyline. */
function bezier(a: Point, c: Point, b: Point, n = 64): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const v = 1 - u;
    return { x: v * v * a.x + 2 * v * u * c.x + u * u * b.x, y: v * v * a.y + 2 * v * u * c.y + u * u * b.y };
  });
}

/** A circle of radius r at p, smeared along `angle` by `stretch` (area kept). */
function smear(p: Point, r: number, angle: number, stretch: number): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return circle(r, 48).map((q) => {
    const x = q.x * stretch;
    const y = q.y / Math.sqrt(stretch);
    return { x: p.x + x * cos - y * sin, y: p.y + x * sin + y * cos };
  });
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette, doc } = ctx;
  const cx = W / 2;
  const cy = safe.top + (H - safe.top - safe.bottom) / 2;
  const named = String(p.name).trim() !== "";
  // The wordmark goes under the mark unless the frame is clearly landscape (beside it, a 1:1 squeezes the name).
  const stacked = W < H * 1.3;
  // The mark's radius once the wordmark sits beside it; it builds larger, alone.
  const R = Math.min(W, H) * (stacked ? 0.17 : 0.18);
  const BIG = named ? 1.45 : 1.6;
  const given = (p.colors as string[]).filter((c) => HEX.test(c));
  const colors = [0, 1, 2, 3].map((k) => given[k % Math.max(1, given.length)] ?? [palette.accent, palette.secondary, palette.ink, palette.muted][k]!);
  const { pieces: unit, turn } = markPieces(String(p.mark));
  const pieces = unit.map((o) => transformOutline(o, { scale: R, x: cx, y: cy }));
  const slots = pieces.map((o) => centroid(o.solids[0]!));
  const dotR = R * 0.2;

  // Flights (stage coordinates): from off-frame, bending in, landing on each piece's centre.
  const reach = (Math.hypot(W, H) * 0.6) / BIG;
  const flights: { path: PathLine; at: number }[] = slots.map((s, k) => {
    const a = (-0.75 + k * 0.5) * Math.PI + 0.3;
    const from = { x: cx + Math.cos(a) * reach, y: cy + Math.sin(a) * reach };
    const mid = { x: (from.x + s.x) / 2, y: (from.y + s.y) / 2 };
    const bend = 0.35 * Math.hypot(s.x - from.x, s.y - from.y);
    const n = Math.atan2(s.y - from.y, s.x - from.x) + Math.PI / 2;
    return { path: measure(bezier(from, { x: mid.x + Math.cos(n) * bend, y: mid.y + Math.sin(n) * bend }, s)), at: 0.05 + k * 0.09 };
  });
  const FLY = 0.72;
  const landed = flights.map((f) => f.at + FLY);
  // The first dots start morphing as the last one lands: one continuous gesture.
  const morphAt = Math.max(...landed) - 0.08;
  const MORPH = 0.6;
  const morphs = pieces.map((o, k) => prepareMorph(toOutline([circle(dotR, 64).map((q) => ({ x: q.x + slots[k]!.x, y: q.y + slots[k]!.y }))]), o));
  const lockAt = morphAt + MORPH + 3 * 0.06;
  const revealAt = lockAt + 0.45;

  const stage = ctx.el("div", "lbx-stage");
  const canvas = ctx.el("canvas", "lbx-trails", stage);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  stage.append(svg);
  const group = doc.createElementNS(SVG, "g");
  svg.append(group);
  const paths = pieces.map((_, k) => {
    const el = doc.createElementNS(SVG, "path");
    el.setAttribute("fill", colors[k]!);
    group.append(el);
    return el;
  });

  // The mark: built big, a punch and a turn as it locks, then aside for the wordmark. It moves by
  // drawing transforms about (cx, cy), not a CSS transform on the stage: the canvas makes the stage a
  // composited layer, and Chrome rasterises a composited layer whose scale changes at a scale that
  // depends on the frames before it, so the same t could capture different pixels.
  const mark = { x: 0, y: 0, scale: BIG, rotate: 0 };
  tl.set(mark, { scale: BIG }, 0);
  tl.to(mark, { scale: BIG * 1.06 }, { at: lockAt, duration: 0.16, ease: "out" });
  tl.to(mark, { scale: BIG }, { at: lockAt + 0.16, duration: 0.36, ease: "back-out" });
  if (turn) tl.fromTo(mark, { rotate: 0 }, { rotate: -turn }, { at: lockAt, duration: 0.6, ease: "back-out" });

  if (named) {
    const word = ctx.el("div", "lbx-word");
    const name = ctx.el("div", "lbx-name", word);
    const chars = Array.from(String(p.name)).map((c) => ctx.el("span", "char", name, c === " " ? " " : c));
    name.style.fontSize = `${Math.round(R * (stacked ? 1.25 : 1.3))}px`;
    if (stacked) Object.assign(word.style, { alignItems: "center", textAlign: "center" });
    name.style.fontWeight = ctx.display === "display" || ctx.display === "serif" ? "400" : String(p.weight);
    const tag = p.tagline ? ctx.el("div", "lbx-tag", word, String(p.tagline)) : null;
    // Fit the wordmark to the safe width beside (or under) the mark.
    const room = W - safe.left - safe.right - (stacked ? 0 : 2 * R + R * 0.55);
    const wide = word.getBoundingClientRect().width;
    if (wide > room && wide > 0) name.style.fontSize = `${(parseFloat(name.style.fontSize) * room) / wide}px`;
    const box = word.getBoundingClientRect();
    const gap = R * 0.55;
    let markX = cx;
    let markY = cy;
    if (stacked) {
      const total = 2 * R + gap + box.height;
      markY = cy - total / 2 + R;
      Object.assign(word.style, { left: `${cx - box.width / 2}px`, top: `${markY + R + gap}px` });
    } else {
      const total = 2 * R + gap + box.width;
      markX = cx - total / 2 + R;
      Object.assign(word.style, { left: `${markX + R + gap}px`, top: `${cy - box.height / 2}px` });
    }
    tl.to(mark, { x: markX - cx, y: markY - cy, scale: 1 }, { at: revealAt, duration: 0.8, ease: "in-out" });
    // The letters rise once the mark has slid (and shrunk) clear of them; earlier, the first ones cross it.
    const rise = revealAt + 0.5;
    tl.fromTo(chars, { yPercent: 115, rotate: 6 }, { yPercent: 0, rotate: 0 }, { at: rise, duration: 0.7, ease: "out", stagger: 0.035 });
    if (tag) tl.fromTo(tag, { opacity: 0, y: 14 }, { opacity: 1, y: 0 }, { at: rise + 0.25 + chars.length * 0.035, duration: 0.6, ease: "out" });
  }

  const out = EASES.out;
  const inOut = EASES["in-out"];
  tl.track((t) => {
    group.setAttribute("transform", `translate(${cx + mark.x} ${cy + mark.y}) rotate(${mark.rotate}) scale(${mark.scale}) translate(${-cx} ${-cy})`);
    const g = canvas.getContext("2d");
    if (g) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.translate(cx + mark.x, cy + mark.y);
      g.rotate((mark.rotate * Math.PI) / 180);
      g.scale(mark.scale, mark.scale);
      g.translate(-cx, -cy);
    }
    flights.forEach((f, k) => {
      const q = (t - f.at) / FLY;
      if (q < 1) {
        if (q <= 0) {
          paths[k]!.setAttribute("d", "");
          return;
        }
        const head = out(q);
        const speed = (out(Math.min(1, q + 0.01)) - out(Math.max(0, q - 0.01))) / 0.02;
        const at = pointAlong(f.path, head);
        // Fast dots smear along their path and drag a tail; both settle as they land.
        if (g) drawTrail(g, f.path, head, { color: colors[k]!, width: dotR * 1.5, tail: 0.32 * Math.min(1, speed / 3), taper: 0.05, opacity: 0.85 });
        paths[k]!.setAttribute("d", ringsPath([smear(at, dotR, at.angle, 1 + 0.5 * Math.min(1, speed / 4))]));
        return;
      }
      const m = (t - morphAt - k * 0.06) / MORPH;
      if (m <= 0) {
        // A landing squash on the slot (TASTE.md: settle within 0.25 s).
        const since = t - landed[k]!;
        const squash = since < 0.25 ? 1 - 0.18 * Math.sin((Math.PI * since) / 0.25) * (1 - since / 0.25) : 1;
        paths[k]!.setAttribute("d", ringsPath([smear(slots[k]!, dotR, Math.PI / 2, squash)]));
      } else if (m < 1) {
        paths[k]!.setAttribute("d", ringsPath(morphRings(morphs[k]!, m, { ease: inOut, smooth: 4 })));
      } else {
        paths[k]!.setAttribute("d", outlinePath(pieces[k]!));
      }
    });
  });
}
