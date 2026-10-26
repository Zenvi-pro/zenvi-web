import { mulberry32, random01, type BlockContext } from "../../runtime/index.js";

const HEX = /^#[0-9a-f]{6}$/i;

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Mix two #rrggbb colours. */
function mix(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

interface Orb {
  x: number;
  y: number;
  r: number;
  ax: number;
  ay: number;
  w: number;
  phase: number;
  color: string;
  stretch: number;
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, palette } = ctx;
  const given = (p.colors as string[]).filter((c) => HEX.test(c));
  const paper = HEX.test(palette.paper) ? palette.paper : "#F7F7F5";
  const colors = given.length > 0 ? given : [palette.accent, palette.secondary, mix(palette.accent, paper, 0.55), mix(palette.secondary, paper, 0.5), mix(palette.accent, palette.secondary, 0.5)].filter((c) => HEX.test(c));
  const style = String(p.style);
  const speed = Number(p.speed);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const canvas = ctx.el("canvas", "gf-canvas");
  // Soft fields need little resolution: draw at half size, the browser upsamples smoothly.
  const scale = dpr * 0.5;
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const g = canvas.getContext("2d")!;

  const rand = mulberry32(ctx.seed * 7919 + 1);
  const big = Math.max(W, H);
  const count = style === "bokeh" ? 42 : style === "aurora" ? 4 : 5;
  const orbs: Orb[] = Array.from({ length: count }, (_, i) => {
    const bokeh = style === "bokeh";
    return {
      x: rand() * W,
      y: style === "aurora" ? H * (0.2 + 0.6 * rand()) : rand() * H,
      r: bokeh ? big * (0.012 + 0.035 * rand()) : big * (0.32 + 0.22 * rand()),
      ax: (bokeh ? 0.05 : 0.18) * W * (0.5 + rand()),
      ay: (bokeh ? 0.08 : 0.14) * H * (0.5 + rand()),
      w: ((Math.PI * 2) / (8 + 6 * rand())) * (rand() < 0.5 ? 1 : -1),
      phase: rand() * Math.PI * 2,
      color: colors[i % colors.length]!,
      stretch: style === "aurora" ? 2.4 + rand() : 1,
    };
  });

  tl.track((t) => {
    const s = t * speed;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const base = g.createLinearGradient(0, 0, 0, canvas.height);
    base.addColorStop(0, palette.dark ? mix(paper, "#000000", 0.2) : mix(paper, "#ffffff", 0.4));
    base.addColorStop(1, paper);
    g.fillStyle = base;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.globalCompositeOperation = palette.dark ? "screen" : "source-over";
    orbs.forEach((o, i) => {
      const x = o.x + o.ax * Math.sin(o.w * s + o.phase);
      const y = o.y + o.ay * Math.cos(o.w * 0.8 * s + o.phase * 1.3);
      const alpha = style === "bokeh" ? 0.35 + 0.35 * Math.sin(s * 1.7 + i) ** 2 : palette.dark ? 0.55 : 0.75;
      g.save();
      g.translate(x, y);
      g.rotate(style === "aurora" ? Math.sin(o.w * 0.5 * s + o.phase) * 0.25 : 0);
      g.scale(o.stretch, 1 / Math.sqrt(o.stretch));
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, o.r);
      if (style === "bokeh") {
        grad.addColorStop(0, rgba(o.color, alpha));
        grad.addColorStop(0.7, rgba(o.color, alpha * 0.8));
        grad.addColorStop(1, rgba(o.color, 0));
      } else {
        grad.addColorStop(0, rgba(o.color, alpha));
        grad.addColorStop(0.5, rgba(o.color, alpha * 0.45));
        grad.addColorStop(1, rgba(o.color, 0));
      }
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0, 0, o.r, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
    g.globalCompositeOperation = "source-over";
  });

  if (p.dots) {
    const dots = ctx.el("div", "gf-dots");
    tl.fromTo(dots, { opacity: 0 }, { opacity: 1 }, { at: 0, duration: 1.2, ease: "smooth" });
  }
  if (p.grain) {
    const grain = ctx.el("canvas", "gf-grain");
    const size = 256;
    grain.width = size;
    grain.height = size;
    grain.style.backgroundSize = "auto";
    const gg = grain.getContext("2d")!;
    const img = gg.createImageData(size, size);
    // Grain changes every other frame (12-15 per second reads as film, not fizz).
    tl.track((t) => {
      const tick = Math.floor((t * ctx.fps) / 2);
      for (let i = 0; i < size * size; i += 1) {
        const v = Math.floor(random01(ctx.seed, tick, i) * 255);
        img.data[i * 4] = v;
        img.data[i * 4 + 1] = v;
        img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      gg.putImageData(img, 0, 0);
    });
  }
  // A background holds to the end: no exit fade.
  ctx.ownExit = true;
}
