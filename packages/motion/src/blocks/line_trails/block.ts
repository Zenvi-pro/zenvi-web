import { drawTrail, EASES, measure, pointAlong, random01, sampleCurve, slice, type BlockContext, type Curve, type PathLine } from "../../runtime/index.js";

const HEX = /^#[0-9a-f]{6}$/i;

/** Line i's figure; `v` (0..1, seeded) varies it so lines cross instead of moving in lockstep. */
function curveFor(pattern: string, i: number, count: number, turns: number, v: number): Curve {
  const f = i / count;
  switch (pattern) {
    case "orbit":
      return { kind: "orbit", turns: turns * (0.8 + 0.4 * v), squash: 0.24 + 0.2 * v, precession: 0.4 + 0.3 * v, rotate: Math.PI * f };
    case "lissajous": {
      const a = Math.max(1, Math.round(turns));
      // Neighbouring phases: the lines run side by side as a ribbon.
      return { kind: "lissajous", a, b: a + 1, phase: Math.PI / 2 + f * 0.9 };
    }
    case "rose":
      return { kind: "rose", k: Math.max(2, Math.round(turns)), turns: 1, rotate: (f * Math.PI) / Math.max(2, Math.round(turns)) };
    default:
      // Every other arm winds the other way: the arms cross into a moiré.
      return { kind: "spiral", turns: turns * (0.75 + 0.5 * v) * (count > 3 && i % 2 === 1 ? -1 : 1), inner: 0.02, rotate: Math.PI * 2 * f };
  }
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const pattern = String(p.pattern);
  const count = Number(p.count);
  const turns = Number(p.turns);
  const cx = W / 2;
  const cy = safe.top + (H - safe.top - safe.bottom) / 2;
  const rx = ((W - safe.left - safe.right) / 2) * Number(p.size);
  const ry = ((H - safe.top - safe.bottom) / 2) * Number(p.size);
  const r = Math.min(rx, ry);
  const scale = Math.min(W, H) / 1080;
  const given = (p.colors as string[]).filter((c) => HEX.test(c));
  const color = (i: number): string => (given.length > 0 ? given[i % given.length]! : i % 4 === 3 ? palette.accent : palette.ink);
  const paths: PathLine[] = Array.from({ length: count }, (_, i) => {
    const v = random01(ctx.seed, i, 0);
    const curve = curveFor(pattern, i, count, turns, v);
    const samples = Math.round(240 + 160 * turns);
    // Lissajous fills the frame; the round figures nest at radii from 55 to 100 %.
    const k = pattern === "lissajous" ? 1 : 0.55 + 0.45 * random01(ctx.seed, i, 1);
    return measure(curve.kind === "lissajous" ? sampleCurve(curve, cx, cy, rx, ry, samples) : sampleCurve(curve, cx, cy, r * k, r * k, samples));
  });

  const canvas = ctx.el("canvas", "ltx-canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  // Lines leave at seeded times over the first 0.7 s; each travels its whole figure by 0.5 s before the end.
  const starts = paths.map((_, i) => (count > 1 ? 0.7 * random01(ctx.seed, i, 2) : 0));
  const end = Math.max(0.8, ctx.seconds - 0.5);
  const ease = EASES["in-out"];
  const width = Number(p.width) * scale;
  const tail = Number(p.tail);
  tl.track((t) => {
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paths.forEach((path, i) => {
      const start = starts[i]!;
      const span = end - start;
      const q = Math.min(1, Math.max(0, (t - start) / span));
      if (q <= 0) return;
      const head = ease(q);
      // Tails stretch with the head's speed (in units of the average speed), vanishing as it settles.
      const speed = (ease(Math.min(1, q + 0.01)) - ease(Math.max(0, q - 0.01))) / (Math.min(1, q + 0.01) - Math.max(0, q - 0.01));
      const c = color(i);
      if (p.trace) {
        const pts = slice(path, 0, head);
        if (pts.length > 1) {
          g.save();
          g.globalAlpha = 0.28;
          g.strokeStyle = c;
          g.lineWidth = Math.max(1, width * 0.22);
          g.lineJoin = "round";
          g.beginPath();
          g.moveTo(pts[0]!.x, pts[0]!.y);
          for (const pt of pts.slice(1)) g.lineTo(pt.x, pt.y);
          g.stroke();
          g.restore();
        }
      }
      drawTrail(g, path, head, { color: c, width, tail: tail * Math.min(1.6, speed) });
      if (p.heads && speed > 0.05) {
        const h = pointAlong(path, head);
        g.save();
        g.fillStyle = c;
        g.globalAlpha = 0.22 * Math.min(1, speed);
        g.beginPath();
        g.arc(h.x, h.y, width * 2.6, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        g.beginPath();
        g.arc(h.x, h.y, width * 1.2, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    });
  });
}
