import { frameUrl, videoTrack, type BlockContext } from "../../runtime/index.js";
import { ART_THEMES, artImage, type ArtKind } from "../art.js";

const ease = (u: number): number => 1 - (1 - Math.min(1, Math.max(0, u))) ** 3;
const easeIn = (u: number): number => Math.min(1, Math.max(0, u)) ** 2;

interface Cell {
  x: number;
  y: number;
  /** 0 at the first dot, 1 at the farthest cell. */
  dist: number;
  rgb: [number, number, number];
  /** Halftone radius as a fraction of the cell. */
  tone: number;
}

/** The picture's colour per grid cell, cropped like `object-fit: cover`. Null when the page cannot read pixels. */
async function sample(doc: Document, url: string, cols: number, rows: number, W: number, H: number): Promise<Uint8ClampedArray | null> {
  const img = doc.createElement("img");
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const canvas = doc.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g || !img.naturalWidth) return null;
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const sw = W / k;
  const sh = H / k;
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, cols, rows);
  return g.getImageData(0, 0, cols, rows).data;
}

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

export async function build(ctx: BlockContext): Promise<void> {
  const { tl, params: p, width: W, height: H, palette } = ctx;
  const S = ctx.seconds;
  const cell = Number(p.cell);
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  const offX = (W - (cols - 1) * cell) / 2;
  const offY = (H - (rows - 1) * cell) / 2;
  const cx = W / 2;
  const cy = H / 2;

  const stage = ctx.el("div", "dg-stage");
  const photo = ctx.el("img", "dg-photo", stage);
  photo.alt = "";
  const ref = ctx.media.media;
  let url: string;
  if (ref?.kind === "video") url = frameUrl(ref, 0);
  else if (ref?.kind === "image") url = ref.url;
  else url = await artImage(ctx.doc, String(p.scene) as ArtKind, ART_THEMES[(ctx.seed - 1) % ART_THEMES.length]!, W, H, ctx.seed);
  photo.src = url;
  const canvas = ctx.el("canvas", "dg-canvas", stage);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);

  const pixels = await sample(ctx.doc, url, cols, rows, W, H);
  const accent = hexRgb(palette.accent);
  const mono = p.dots === "accent";
  const maxDist = Math.hypot(cx, cy);
  const rgbAt = (o: number): [number, number, number] => (pixels ? [pixels[o]!, pixels[o + 1]!, pixels[o + 2]!] : [128, 128, 128]);
  const lums = Array.from({ length: cols * rows }, (_, n) => {
    const [r, g, b] = rgbAt(n * 4);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
  // Levels: the picture's 5th to 95th percentile spans the whole tone range, so a low-contrast picture still reads.
  const sorted = [...lums].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)]!;
  const hi = Math.max(lo + 0.05, sorted[Math.floor(sorted.length * 0.95)]!);
  const cells: Cell[] = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = offX + i * cell;
      const y = offY + j * cell;
      const n = j * cols + i;
      const lum = Math.min(1, Math.max(0, (lums[n]! - lo) / (hi - lo)));
      // On dark paper light areas get the big dots; on light paper dark areas do (ink on paper).
      const ink = palette.dark ? lum : 1 - lum;
      cells.push({ x, y, dist: Math.hypot(x - cx, y - cy) / maxDist, rgb: mono ? accent : rgbAt(n * 4), tone: 0.08 + 0.5 * Math.sqrt(ink) });
    }
  }

  // Beats: the dot lands, holds still, multiplies outward, turns into the halftone, holds, closes into the picture.
  const land = 0.15;
  const multiply = 0.75;
  const tone = multiply + 0.6;
  const resolve = p.resolve !== false;
  const close = Math.max(tone + 0.8, S - 1.85);
  const seed0 = cell * 0.18;

  tl.track((t) => {
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The first dot: pops in big, then shrinks to its place in the grid as the others arrive.
    if (t >= land && t < multiply + 0.4) {
      const pop = Math.min(1, (t - land) / 0.3);
      const back = 1 + 0.06 * Math.sin(Math.PI * pop) * (pop < 1 ? 1 : 0);
      const shrink = ease((t - multiply) / 0.4);
      const r = (cell * 1.4 * ease(pop) * back) * (1 - shrink) + seed0 * shrink;
      g.fillStyle = palette.accent;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }
    if (t < multiply) return;
    const closing = resolve ? easeIn((t - close) / 0.9) : 0;
    for (const c of cells) {
      const born = multiply + c.dist * 0.5;
      if (t < born) continue;
      const grow = ease((t - born) / 0.35);
      const toned = ease((t - tone - c.dist * 0.3) / 0.5);
      const radius = cell * ((0.18 * (1 - toned) + c.tone * toned) * (1 - closing) + 0.75 * closing) * grow;
      if (radius < 0.4) continue;
      const k = toned;
      g.fillStyle = `rgb(${Math.round(accent[0] + (c.rgb[0] - accent[0]) * k)},${Math.round(accent[1] + (c.rgb[1] - accent[1]) * k)},${Math.round(accent[2] + (c.rgb[2] - accent[2]) * k)})`;
      g.beginPath();
      g.arc(c.x, c.y, radius, 0, Math.PI * 2);
      g.fill();
    }
  });

  if (ref?.kind === "video") tl.track(videoTrack(photo, ref, ctx.pending, close + 0.4));
  tl.set(photo, { opacity: 0 }, 0);
  if (resolve) {
    tl.fromTo(photo, { opacity: 0 }, { opacity: 1 }, { at: close + 0.4, duration: 0.4, ease: "smooth" });
    tl.to(canvas, { opacity: 0 }, { at: close + 0.6, duration: 0.3, ease: "smooth" });
  }
  // The camera settles back over the whole shot: one slow move, no drift back.
  tl.fromTo(stage, { scale: 1.06 }, { scale: 1 }, { at: 0, duration: S, ease: "out" });
}
