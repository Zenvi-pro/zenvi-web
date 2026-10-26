import { random01, type BlockContext } from "../../runtime/index.js";
import { FONT_STACKS } from "../../tokens.js";
import { ICONS } from "../ui.js";

const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));
const out = (u: number): number => 1 - (1 - clamp01(u)) ** 3;
/** easeOutBack peaking ~6 % past the end (TASTE.md §2). */
const backOut = (u: number): number => {
  const x = clamp01(u) - 1;
  return 1 + 2.3 * x * x * x + 1.3 * x * x;
};

function tint(hex: string, white: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${c.map((v) => Math.round(v + (255 - v) * white)).join(",")})`;
}

async function loaded(doc: Document, src: string): Promise<HTMLImageElement | null> {
  const img = doc.createElement("img");
  img.src = src;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/**
 * Drawn on a canvas so the last beat can break the finished picture into
 * pieces: every frame is composed off screen, then copied whole or cell by
 * cell, each cell leaving at its own time (centre first) and blowing outward.
 */
export async function build(ctx: BlockContext): Promise<void> {
  const { tl, params: p, width: W, height: H, palette } = ctx;
  const S = ctx.seconds;
  const scale = Math.min(W, H) / 1080;
  const cx = W / 2;
  const cy = H / 2;
  const R = 170 * scale;
  const cover = Math.hypot(cx, cy);
  const dissolve = p.dissolve !== false;
  if (dissolve) ctx.ownExit = true;

  const ref = ctx.media.logo;
  const glyphSvg = ICONS[String(p.glyph) as keyof typeof ICONS].replace(/currentColor/g, palette.accent).replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" `);
  const markImg = ref?.kind === "image" ? await loaded(ctx.doc, ref.url) : p.mark ? null : await loaded(ctx.doc, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(glyphSvg)}`);
  const markText = !ref && p.mark ? String(p.mark) : "";

  const canvas = ctx.el("canvas", "rl-canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const src = ctx.doc.createElement("canvas");
  src.width = canvas.width;
  src.height = canvas.height;

  // Beats: the field opens, the badge punches in, rings roll out, (stillness of the held badge), the dissolve.
  const badgeAt = 0.25;
  const ringsAt = 0.6;
  const ringEvery = 0.42;
  const dissolveAt = dissolve ? Math.max(ringsAt + 0.5, S - 1.4) : Infinity;
  const ringColor = tint(palette.accent, 0.16);
  const haloColor = tint(palette.accent, 0.08);

  const compose = (g: CanvasRenderingContext2D, t: number): void => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, src.width, src.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const field = cover * out(t / 0.45);
    if (field <= 0) return;
    g.save();
    g.beginPath();
    g.arc(cx, cy, field, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = palette.accent;
    g.fillRect(0, 0, W, H);
    // Ripples: wide tonal bands leaving the badge, fading as they spread.
    for (let born = ringsAt; born <= t; born += ringEvery) {
      const age = t - born;
      const radius = R * 1.15 + age * 520 * scale;
      const alpha = 0.55 * (1 - age / 2.6);
      if (alpha <= 0 || radius > cover + R) continue;
      g.globalAlpha = alpha * out(age / 0.25);
      g.strokeStyle = ringColor;
      g.lineWidth = R * 0.34;
      g.beginPath();
      g.arc(cx, cy, radius, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    const b = R * backOut((t - badgeAt) / 0.4);
    if (b > 0) {
      g.fillStyle = haloColor;
      g.beginPath();
      g.arc(cx, cy, b * 1.32, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#FFFFFF";
      g.beginPath();
      g.arc(cx, cy, b, 0, Math.PI * 2);
      g.fill();
      const m = out((t - badgeAt - 0.1) / 0.45);
      if (m > 0) {
        g.save();
        g.translate(cx, cy);
        g.scale(m, m);
        if (markImg) {
          const k = Math.min((R * 1.3) / markImg.naturalWidth, (R * 1.3) / markImg.naturalHeight);
          g.drawImage(markImg, (-markImg.naturalWidth * k) / 2, (-markImg.naturalHeight * k) / 2, markImg.naturalWidth * k, markImg.naturalHeight * k);
        } else if (markText) {
          g.fillStyle = palette.accent;
          g.textAlign = "center";
          g.textBaseline = "middle";
          g.font = `700 ${R * (markText.length > 1 ? 0.9 : 1.2)}px ${FONT_STACKS[ctx.display]}`;
          g.fillText(markText, 0, R * 0.04);
        }
        g.restore();
      }
    }
    g.restore();
  };

  const cell = Number(p.grain) * scale;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  const LIFE = 0.6;
  const cells = Array.from({ length: cols * rows }, (_, n) => {
    const x = (n % cols) * cell;
    const y = Math.floor(n / cols) * cell;
    const dx = x + cell / 2 - cx;
    const dy = y + cell / 2 - cy;
    const d = Math.hypot(dx, dy) || 1;
    const turn = (random01(ctx.seed, n, 0) - 0.5) * 0.7;
    const a = Math.atan2(dy, dx) + turn;
    return { x, y, start: dissolveAt + 0.6 * Math.min(1, d / cover) + 0.18 * random01(ctx.seed, n, 1), ux: Math.cos(a), uy: Math.sin(a), spin: (random01(ctx.seed, n, 2) - 0.5) * 9 };
  });

  tl.track((t) => {
    const view = canvas.getContext("2d");
    const g = src.getContext("2d");
    if (!view || !g) return;
    compose(g, t);
    view.setTransform(1, 0, 0, 1, 0, 0);
    view.clearRect(0, 0, canvas.width, canvas.height);
    if (t < dissolveAt) {
      view.drawImage(src, 0, 0);
      return;
    }
    view.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sc = cell * dpr;
    for (const c of cells) {
      const age = t - c.start;
      if (age < 0) {
        view.drawImage(src, c.x * dpr, c.y * dpr, sc, sc, c.x, c.y, cell, cell);
        continue;
      }
      if (age > LIFE) continue;
      const travel = 140 * scale * age + 0.5 * 2800 * scale * age * age;
      const k = 1 - age / LIFE;
      view.globalAlpha = 1 - (age / LIFE) ** 2;
      view.save();
      view.translate(c.x + cell / 2 + c.ux * travel, c.y + cell / 2 + c.uy * travel);
      view.rotate(c.spin * age);
      view.scale(k, k);
      view.drawImage(src, c.x * dpr, c.y * dpr, sc, sc, -cell / 2, -cell / 2, cell, cell);
      view.restore();
    }
    view.globalAlpha = 1;
  });
}
