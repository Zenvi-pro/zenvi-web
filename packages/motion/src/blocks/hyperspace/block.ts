import { random01, type BlockContext } from "../../runtime/index.js";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Streaks are stars at depth z in (0, 1] flying at the camera: screen radius
 * = near / z, so they crawl out of the vanishing point and race at the edge.
 * The tail is the same star a moment earlier (a larger z), so streaks grow
 * with speed. Depth travelled is the integral of the speed curve up to t,
 * summed in fixed steps: a frame depends on t alone.
 */
export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, palette } = ctx;
  const S = ctx.seconds;
  const origin = (p.origin as { x: number; y: number }[])[0] ?? { x: 0.5, y: 0.5 };
  const ox = origin.x * W;
  const oy = origin.y * H;
  const scale = Math.min(W, H) / 1080;
  const reach = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy));
  const given = (p.colors as string[]).filter((c) => HEX.test(c));
  const flash = String(p.flash);

  // Beats: ring draws in → glint ignites → streaks accelerate → held breath → jump → flash.
  const ignite = Math.min(0.7, S * 0.22);
  const jump = S - Math.min(0.62, S * 0.25);
  const breath = jump - Math.min(0.4, (jump - ignite) * 0.35);
  const flashEnd = S - 0.12;
  // The glint ignites, the streaks rise into a held breath, then the jump.
  const point = { x: ox, y: oy };
  ctx.cue(ignite, "glint", { weight: 0.5, at: point });
  ctx.cue(ignite, "whoosh", { weight: 0.6, at: point, until: breath });
  ctx.cue(jump, "whoosh", { weight: 1, at: point });
  if (flash !== "none") ctx.cue(jump + 0.1, "impact", { weight: 0.7, at: point });

  const speedAt = (t: number): number => {
    if (t < ignite) return 0;
    if (t < breath) {
      const u = (t - ignite) / (breath - ignite);
      return 0.08 + 0.92 * u * u;
    }
    if (t < jump) return 1 - 0.45 * Math.sin((Math.PI / 2) * Math.min(1, (t - breath) / 0.12));
    const u = Math.min(1, (t - jump) / 0.25);
    return 0.55 + 5.5 * u * u;
  };
  const STEP = 1 / 240;
  const travelled = (t: number): number => {
    let d = 0;
    for (let s = 0; s < t; s += STEP) d += speedAt(s) * Math.min(STEP, t - s);
    return d;
  };

  // The ring that draws in to the point.
  const ring = ctx.el("div", "hs-ring");
  const ringSize = 300 * scale;
  Object.assign(ring.style, { position: "absolute", left: `${ox - ringSize / 2}px`, top: `${oy - ringSize / 2}px`, width: `${ringSize}px`, height: `${ringSize}px`, borderRadius: "50%", border: `${2 * scale}px solid ${palette.ink}` });
  tl.fromTo(ring, { scale: 0.15, opacity: 0 }, { scale: 1, opacity: 0.9 }, { at: 0.05, duration: ignite * 0.55, ease: "out" });
  tl.to(ring, { scale: 0.04, opacity: 0 }, { at: 0.05 + ignite * 0.55, duration: ignite * 0.45, ease: "in" });

  const canvas = ctx.el("canvas", "hs-canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const count = Number(p.density);
  const pick = (r: number): string => {
    if (given.length > 0) return r < 0.6 || given.length === 1 ? given[0]! : given[1 + Math.floor(((r - 0.6) / 0.4) * (given.length - 1))]!;
    return r < 0.62 ? palette.ink : r < 0.85 ? palette.accent : palette.secondary;
  };
  const stars = Array.from({ length: count }, (_, i) => ({
    angle: random01(ctx.seed, i, 0) * Math.PI * 2,
    near: (0.015 + random01(ctx.seed, i, 1) ** 1.5 * 0.14) * reach,
    z0: random01(ctx.seed, i, 2),
    v: 0.7 + random01(ctx.seed, i, 3) * 0.6,
    width: 0.6 + random01(ctx.seed, i, 4) * 0.8,
    color: pick(random01(ctx.seed, i, 5)),
  }));

  tl.track((t) => {
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (t < ignite) return;
    const speed = speedAt(t);
    const d = travelled(t);
    const presence = Math.min(1, (t - ignite) / 0.5);
    const trail = 0.004 + speed * 0.07;
    g.globalCompositeOperation = "lighter";
    g.lineCap = "round";
    for (const s of stars) {
      const z = Math.max(0.004, 1 - ((s.z0 + d * s.v) % 1));
      const head = s.near / z;
      const tail = s.near / (z + trail * s.v);
      if (tail > reach) continue;
      const near = 1 - z;
      g.globalAlpha = Math.min(1, near ** 1.4 * 1.5) * presence;
      g.strokeStyle = s.color;
      g.lineWidth = (0.8 + 3.4 * near * near) * s.width * scale;
      const c = Math.cos(s.angle);
      const sn = Math.sin(s.angle);
      g.beginPath();
      g.moveTo(ox + c * tail, oy + sn * tail);
      g.lineTo(ox + c * Math.min(head, reach * 1.05), oy + sn * Math.min(head, reach * 1.05));
      g.stroke();
    }
    // The glint: a soft core and a four-point star, pulled in on the breath, blown wide on the jump.
    const pull = t >= breath && t < jump ? 1 - 0.4 * Math.min(1, (t - breath) / 0.15) : 1;
    const blow = t >= jump ? 1 + 4 * Math.min(1, (t - jump) / 0.35) ** 2 : 1;
    const size = (0.6 + 0.4 * Math.min(1, speed)) * pull * blow * presence * scale;
    const glow = g.createRadialGradient(ox, oy, 0, ox, oy, 120 * size);
    glow.addColorStop(0, "rgba(255,255,255,0.95)");
    glow.addColorStop(0.18, "rgba(255,255,255,0.45)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.globalAlpha = 1;
    g.fillStyle = glow;
    g.beginPath();
    g.arc(ox, oy, 120 * size, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    for (const [a, len, w] of [[0, 260, 5], [Math.PI / 2, 260, 5], [Math.PI / 4, 110, 3], [-Math.PI / 4, 110, 3]] as const) {
      g.save();
      g.translate(ox, oy);
      g.rotate(a);
      g.beginPath();
      g.moveTo(-len * size, 0);
      g.quadraticCurveTo(0, -w * size, len * size, 0);
      g.quadraticCurveTo(0, w * size, -len * size, 0);
      g.fill();
      g.restore();
    }
    g.globalCompositeOperation = "source-over";
  });

  if (flash !== "none") {
    // A soft-edged disc from the point that swallows the frame, then holds: the cut lands on it.
    // Solid out to 84 % of 1.2 × reach, so the farthest corner is fully covered on the last frames.
    ctx.ownExit = true;
    const disc = ctx.el("div", "hs-flash");
    const size = reach * 2.4;
    const color = flash === "accent" ? palette.accent : "#ffffff";
    Object.assign(disc.style, { position: "absolute", left: `${ox - size / 2}px`, top: `${oy - size / 2}px`, width: `${size}px`, height: `${size}px`, borderRadius: "50%", background: `radial-gradient(circle closest-side, ${color} 0%, ${color} 84%, transparent 100%)` });
    tl.set(disc, { scale: 0, opacity: 0 }, 0);
    tl.fromTo(disc, { scale: 0.02, opacity: 1 }, { scale: 1, opacity: 1 }, { at: jump + 0.1, duration: flashEnd - jump - 0.1, ease: "in" });
  }
}
