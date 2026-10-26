import { particles, type BlockContext, type ParticleOptions } from "../../runtime/index.js";

const HEX = /^#[0-9a-f]{6}$/i;

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, palette } = ctx;
  const origin = (p.origin as { x: number; y: number }[])[0] ?? { x: 0.5, y: 0.5 };
  const x = origin.x * W;
  const y = origin.y * H;
  const given = (p.colors as string[]).filter((c) => HEX.test(c));
  const colors = given.length > 0 ? given : [palette.accent, palette.secondary, palette.ink];
  const count = Number(p.count);
  const at = p.label ? 0.22 : 0.05;
  const scale = Math.min(W, H) / 1080;

  if (p.rings) {
    for (let i = 0; i < 2; i += 1) {
      const ring = ctx.el("div", "pbx-ring");
      Object.assign(ring.style, { left: `${x}px`, top: `${y}px` });
      tl.set(ring, { opacity: 0 }, 0);
      tl.fromTo(ring, { scale: 0.1, opacity: 0.9 }, { scale: 1.6 + i * 0.9, opacity: 0 }, { at: at + i * 0.12, duration: 0.9 + i * 0.2, ease: "out" });
      ring.style.borderWidth = `${6 - i * 2}px`;
    }
  }

  const canvas = ctx.el("canvas", "pbx-canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const base: Omit<ParticleOptions, "shape" | "count" | "seed"> = {
    x,
    y,
    at,
    colors,
    life: [0.7, 1.5],
    speed: [500 * scale, 1500 * scale],
    gravity: Number(p.gravity) * scale,
    drag: 2.6,
    size: [14 * scale, 30 * scale],
    emit: 0.05,
  };
  const shape = String(p.shape);
  const bursts: ParticleOptions[] =
    shape === "mixed"
      ? [
          { ...base, seed: ctx.seed, count: Math.round(count * 0.5), shape: "dot" },
          { ...base, seed: ctx.seed + 1, count: Math.round(count * 0.35), shape: "square" },
          { ...base, seed: ctx.seed + 2, count: Math.round(count * 0.15), shape: "streak", gravity: 0, speed: [1200 * scale, 2000 * scale], life: [0.3, 0.55] },
        ]
      : shape === "sparkle"
        ? // Short rays shot evenly round the origin, no fall: the hand-drawn "sparkle" accent.
          [{ ...base, seed: ctx.seed, count: Math.min(count, 14), shape: "streak", gravity: 0, drag: 7, speed: [1500 * scale, 1700 * scale], life: [0.42, 0.5], emit: 0, size: [12 * scale, 14 * scale] }]
        : [{ ...base, seed: ctx.seed, count, shape: shape as ParticleOptions["shape"] }];
  tl.track(particles(canvas, bursts, dpr));

  if (p.label) {
    const label = ctx.el("div", "pbx-label", ctx.root, String(p.label));
    Object.assign(label.style, { left: `${x}px`, top: `${y}px` });
    tl.fromTo(label, { xPercent: -50, yPercent: -50, scale: 0.2, opacity: 0, rotate: -8 }, { xPercent: -50, yPercent: -50, scale: 1, opacity: 1, rotate: 0 }, { at: 0, duration: 0.5, ease: "back-out" });
    tl.to(label, { scale: 0.94 }, { at: at, duration: 0.08, ease: "out" });
    tl.to(label, { scale: 1 }, { at: at + 0.08, duration: 0.3, ease: "back-out" });
  }
}
