import { particlePosition, random01, type BlockContext } from "../../runtime/index.js";

const HEX = /^#[0-9a-f]{6}$/i;

type Shape = "sparks" | "confetti" | "shards" | "rings" | "lines" | "dots";

interface Burst {
  shape: Shape;
  seed: number;
  count: number;
  /** Ignition, seconds. */
  at: number;
  life: [number, number];
  speed: [number, number];
  size: [number, number];
  gravity: number;
  drag: number;
  /** Launch directions: centre and spread, radians. */
  angle: number;
  spread: number;
  /** Seconds over which particles leave the point. */
  emit: number;
}

function mix(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i]! - v) * k)).join(",")})`;
}

/** One burst at time t: physics from the launch (particlePosition), so any frame is a function of t alone. */
function draw(g: CanvasRenderingContext2D, b: Burst, t: number, ox: number, oy: number, colors: string[], hot: string): void {
  for (let i = 0; i < b.count; i += 1) {
    const r = (k: number): number => random01(b.seed, i, k);
    const age = t - b.at - b.emit * r(0) ** 2;
    const life = b.life[0] + (b.life[1] - b.life[0]) * r(1);
    if (age < 0 || age > life) continue;
    const a = b.angle + (r(2) - 0.5) * b.spread;
    const v = b.speed[0] + (b.speed[1] - b.speed[0]) * r(3) ** 0.7;
    const p = particlePosition(Math.cos(a) * v, Math.sin(a) * v, age, b.drag, b.gravity);
    const k = age / life;
    const x = ox + p.x;
    const y = oy + p.y;
    const size = b.size[0] + (b.size[1] - b.size[0]) * r(4);
    const color = colors[Math.floor(r(5) * colors.length)]!;
    g.globalAlpha = Math.max(0, 1 - k ** 3);
    switch (b.shape) {
      case "sparks": {
        // The streak trails along the current velocity, longer the faster it flies; white-hot, cooling to its colour.
        const decay = Math.exp(-b.drag * age);
        const vx = Math.cos(a) * v * decay;
        const vy = Math.sin(a) * v * decay + b.gravity * age;
        const speed = Math.hypot(vx, vy);
        const len = Math.max(size * 0.6, speed * 0.05);
        const width = Math.max(1.5, size * 0.22 * (1 - 0.5 * k));
        g.strokeStyle = mix(hot, color, Math.min(1, k * 1.8));
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x - (vx / speed) * len, y - (vy / speed) * len);
        g.lineTo(x, y);
        // A wide faint pass under the core stroke: the glow.
        const alpha = g.globalAlpha;
        g.globalAlpha = alpha * 0.22;
        g.lineWidth = width * 4;
        g.stroke();
        g.globalAlpha = alpha;
        g.lineWidth = width;
        g.stroke();
        break;
      }
      case "confetti": {
        // A paper strip tumbling: its width foreshortens as it flips.
        const spin = (r(6) - 0.5) * 22;
        const flip = Math.cos(age * (8 + r(7) * 10) + r(8) * 6.28);
        g.save();
        g.translate(x, y);
        g.rotate(r(9) * 6.28 + age * spin);
        g.scale(1, flip);
        g.fillStyle = flip > 0 ? color : mix(color, "#000000", 0.25);
        g.fillRect(-size / 2, -size * 0.22, size, size * 0.44);
        g.restore();
        break;
      }
      case "shards": {
        // A splinter: three seeded corners, a lit face and a dark one as it turns.
        const turn = Math.cos(age * (4 + r(10) * 6) + r(11) * 6.28);
        g.save();
        g.translate(x, y);
        g.rotate(r(12) * 6.28 + age * (r(13) - 0.5) * 14);
        g.scale(1, 0.25 + 0.75 * Math.abs(turn));
        g.beginPath();
        g.moveTo(0, -size * 0.7);
        g.lineTo(size * (0.25 + r(14) * 0.35), size * (0.2 + r(15) * 0.4));
        g.lineTo(-size * (0.2 + r(16) * 0.35), size * (0.3 + r(17) * 0.3));
        g.closePath();
        g.fillStyle = turn > 0 ? color : mix(color, hot, 0.55);
        g.fill();
        g.restore();
        break;
      }
      default:
        g.fillStyle = color;
        g.beginPath();
        g.arc(x, y, (size / 2) * (1 - 0.5 * k), 0, Math.PI * 2);
        g.fill();
    }
  }
  g.globalAlpha = 1;
}

/**
 * Burst lines: short strokes shot evenly round the point. The head runs out
 * and stops, the tail catches up, so each stroke travels and vanishes.
 */
function drawLines(g: CanvasRenderingContext2D, count: number, seed: number, at: number, t: number, ox: number, oy: number, reach: number, width: number, color: string): void {
  const ease = (u: number): number => 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;
  g.strokeStyle = color;
  g.lineCap = "round";
  for (let ring = 0; ring < 2; ring += 1) {
    const n = ring === 0 ? count : Math.ceil(count / 2);
    const start = at + ring * 0.06;
    const r0 = reach * (ring === 0 ? 0.32 : 0.22);
    const r1 = reach * (ring === 0 ? 1 : 0.62);
    g.lineWidth = width * (ring === 0 ? 1 : 0.7);
    for (let i = 0; i < n; i += 1) {
      const a = ((i + (ring === 0 ? 0 : 0.5)) / n) * Math.PI * 2 + (random01(seed, ring, i) - 0.5) * 0.18 - Math.PI / 2;
      const head = r0 + (r1 - r0) * ease((t - start) / 0.4);
      const tail = r0 + (r1 - r0) * ease((t - start - 0.14) / 0.36);
      if (t < start || head - tail < 0.5) continue;
      g.beginPath();
      g.moveTo(ox + Math.cos(a) * tail, oy + Math.sin(a) * tail);
      g.lineTo(ox + Math.cos(a) * head, oy + Math.sin(a) * head);
      g.stroke();
    }
  }
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, palette } = ctx;
  const origin = (p.origin as { x: number; y: number }[])[0] ?? { x: 0.5, y: 0.5 };
  const x = origin.x * W;
  const y = origin.y * H;
  const shape = String(p.shape) as Shape;
  const given = (p.colors as string[]).filter((c) => HEX.test(c));
  const colors = given.length > 0 ? given : shape === "confetti" ? [palette.accent, palette.secondary, palette.ink] : [palette.accent, palette.secondary];
  const hot = palette.dark ? "#FFFFFF" : palette.ink;
  const count = Number(p.count);
  const scale = Math.min(W, H) / 1080;
  // A beat of stillness before ignition (the core draws in), or after the label lands.
  const at = p.label ? 0.3 : 0.2;

  // The core: a hot point that pinches in, then flares on ignition and fades.
  const core = ctx.el("div", palette.dark ? "pbx-core hot" : "pbx-core");
  Object.assign(core.style, { left: `${x}px`, top: `${y}px` });
  tl.fromTo(core, { scale: 0.5, opacity: 0 }, { scale: 0.32, opacity: 1 }, { at: 0, duration: at, ease: "in" });
  tl.to(core, { scale: 4.5, opacity: 1 }, { at, duration: 0.06, ease: "out" });
  tl.to(core, { scale: 6, opacity: 0 }, { at: at + 0.06, duration: 0.5, ease: "out" });

  if (p.rings || shape === "rings") {
    const n = shape === "rings" ? 4 : 2;
    for (let i = 0; i < n; i += 1) {
      const ring = ctx.el("div", "pbx-ring");
      Object.assign(ring.style, { left: `${x}px`, top: `${y}px`, borderWidth: `${Math.max(1.5, (shape === "rings" ? 10 : 6) - i * 2)}px` });
      tl.set(ring, { opacity: 0 }, 0);
      tl.fromTo(ring, { scale: 0.08, opacity: 0.95 }, { scale: (shape === "rings" ? 1.2 : 1.5) + i * (shape === "rings" ? 0.75 : 0.9), opacity: 0 }, { at: at + i * 0.09, duration: 0.95 + i * 0.15, ease: "out" });
    }
  }

  const canvas = ctx.el("canvas", "pbx-canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const s = scale;
  const gravity = Number(p.gravity) * s;
  const presets: Record<Exclude<Shape, "lines">, Omit<Burst, "seed" | "count" | "at" | "shape">> = {
    sparks: { life: [0.5, 1.3], speed: [1200 * s, 4400 * s], size: [16 * s, 30 * s], gravity: gravity * 0.6, drag: 3.2, angle: -Math.PI / 2, spread: Math.PI * 2, emit: 0.1 },
    confetti: { life: [1.2, 2], speed: [1400 * s, 3800 * s], size: [28 * s, 46 * s], gravity: gravity * 1.3, drag: 3.6, angle: -Math.PI / 2, spread: Math.PI * 1.3, emit: 0.06 },
    shards: { life: [0.8, 1.5], speed: [1000 * s, 2900 * s], size: [26 * s, 58 * s], gravity, drag: 2.4, angle: -Math.PI / 2, spread: Math.PI * 2, emit: 0.03 },
    rings: { life: [0.6, 1.1], speed: [300 * s, 900 * s], size: [6 * s, 12 * s], gravity: 0, drag: 2.5, angle: 0, spread: Math.PI * 2, emit: 0.05 },
    dots: { life: [0.7, 1.5], speed: [900 * s, 2600 * s], size: [12 * s, 28 * s], gravity, drag: 2.6, angle: -Math.PI / 2, spread: Math.PI * 2, emit: 0.05 },
  };
  const bursts: Burst[] =
    shape === "lines"
      ? []
      : shape === "sparks"
        ? // A dense fast core shower and a slower, heavier ember fall.
          [
            { ...presets.sparks, shape, seed: ctx.seed, count: Math.round(count * 0.75), at },
            { ...presets.sparks, shape: "dots", seed: ctx.seed + 7, count: Math.round(count * 0.25), at, speed: [300 * s, 1000 * s], size: [5 * s, 10 * s], life: [0.9, 1.6], gravity: gravity * 1.2 },
          ]
        : [{ ...presets[shape], shape, seed: ctx.seed, count: shape === "rings" ? Math.round(count * 0.4) : count, at }];
  const composite: GlobalCompositeOperation = palette.dark && shape === "sparks" ? "lighter" : "source-over";
  tl.track((t) => {
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.globalCompositeOperation = composite;
    for (const b of bursts) draw(g, b, t, x, y, colors, hot);
    if (shape === "lines") drawLines(g, Math.min(24, Math.max(6, Math.round(count / 6))), ctx.seed, at, t, x, y, 360 * s, 10 * s, colors[0]!);
    g.globalCompositeOperation = "source-over";
  });

  if (p.label) {
    const label = ctx.el("div", "pbx-label", ctx.root, String(p.label));
    Object.assign(label.style, { left: `${x}px`, top: `${y}px` });
    tl.fromTo(label, { xPercent: -50, yPercent: -50, scale: 0.3, opacity: 0 }, { xPercent: -50, yPercent: -50, scale: 1, opacity: 1 }, { at: 0, duration: 0.3, ease: "back-out" });
    // The ignition kicks the label: a press, then a settle.
    tl.to(label, { scale: 0.92 }, { at, duration: 0.06, ease: "out" });
    tl.to(label, { scale: 1 }, { at: at + 0.06, duration: 0.3, ease: "back-out" });
  }
}
