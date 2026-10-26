import { caretBlink, typewriter, videoTrack, type BlockContext } from "../../runtime/index.js";
import { ART_THEMES, artImage, type ArtKind } from "../art.js";
import { icon } from "../ui.js";

const clamp01 = (u: number): number => Math.min(1, Math.max(0, u));
const out = (u: number): number => 1 - (1 - clamp01(u)) ** 4;
const inOut = (u: number): number => {
  const x = clamp01(u);
  return x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2;
};

interface Geometry {
  /** Centre, design px. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  r: number;
}

/** The backdrop as pixels the size of the frame: sharp and frosted. */
interface Backdrop {
  sharp: Uint8ClampedArray;
  frost: Uint8ClampedArray;
}

function backdrop(source: CanvasImageSource, sw: number, sh: number, W: number, H: number, blur: number, doc: Document): Backdrop | null {
  const canvas = doc.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  if (!g || !sw || !sh) return null;
  const k = Math.max(W / sw, H / sh);
  const cw = W / k;
  const ch = H / k;
  g.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
  const sharp = g.getImageData(0, 0, W, H).data;
  g.filter = `blur(${blur}px)`;
  g.drawImage(canvas, 0, 0);
  const frost = g.getImageData(0, 0, W, H).data;
  return { sharp, frost };
}

/**
 * The lens, drawn per pixel so it is the same in every browser: inside a
 * bezel along the rim each pixel samples the backdrop pushed outward along
 * the edge normal (more the closer to the edge, red a little more than
 * blue), the face mixes in the frosted backdrop, and a bevel facing the
 * light (top left) brightens.
 */
function drawLens(img: ImageData, geo: Geometry, left: number, top: number, bd: Backdrop, W: number, H: number, zoom: number, bend: number, frost: number, dark: boolean): void {
  const { w, h, r } = geo;
  const data = img.data;
  const stride = img.width;
  const bezel = Math.min(h / 2, 50);
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const fcx = W / 2;
  const fcy = H / 2;
  const tint = dark ? 0.86 : 1.04;
  const lx = -0.6;
  const ly = -0.8;
  const sample = (src: Uint8ClampedArray, qx: number, qy: number, c: number): number => {
    const bx = Math.min(W - 1, Math.max(0, Math.round(fcx + (qx - fcx) / zoom)));
    const by = Math.min(H - 1, Math.max(0, Math.round(fcy + (qy - fcy) / zoom)));
    return src[(by * W + bx) * 4 + c]!;
  };
  const iw = Math.ceil(w);
  const ih = Math.ceil(h);
  for (let y = 0; y < ih; y += 1) {
    const v = y + 0.5 - h / 2;
    const qy0 = Math.abs(v) - hy;
    for (let x = 0; x < iw; x += 1) {
      const o = (y * stride + x) * 4;
      const u = x + 0.5 - w / 2;
      const qx0 = Math.abs(u) - hx;
      const ox = Math.max(qx0, 0);
      const oy = Math.max(qy0, 0);
      const outside = Math.hypot(ox, oy);
      const sd = outside + Math.min(Math.max(qx0, qy0), 0) - r;
      if (sd > 0.5) {
        data[o + 3] = 0;
        continue;
      }
      let nx: number;
      let ny: number;
      if (outside > 0) {
        nx = (ox / outside) * Math.sign(u);
        ny = (oy / outside) * Math.sign(v);
      } else if (qx0 > qy0) {
        nx = Math.sign(u);
        ny = 0;
      } else {
        nx = 0;
        ny = Math.sign(v);
      }
      const d = -sd;
      const rim = d < bezel ? 1 - d / bezel : 0;
      const push = bend * rim * rim;
      const px = left + x + 0.5;
      const py = top + y + 0.5;
      const mixF = frost * (1 - rim * 0.7);
      const spec = rim > 0 ? Math.max(0, nx * lx + ny * ly) ** 2 * rim ** 3 * 150 + Math.max(0, -(nx * lx + ny * ly)) * rim ** 4 * 50 : 0;
      for (let c = 0; c < 3; c += 1) {
        const k = 1.1 - c * 0.1;
        const qx = px + nx * push * k;
        const qy = py + ny * push * k;
        const value = sample(bd.sharp, qx, qy, c) * (1 - mixF) + sample(bd.frost, qx, qy, c) * mixF;
        data[o + c] = value * tint + spec + (d < 1.5 ? 40 : 0);
      }
      data[o + 3] = Math.round(255 * clamp01(d + 0.5));
    }
  }
}

export async function build(ctx: BlockContext): Promise<void> {
  const { tl, params: p, width: W, height: H, palette, safe } = ctx;
  const S = ctx.seconds;
  const scale = Math.min(W, H) / 1080;
  const results = (p.results as string[]).filter((s) => s.trim());
  const text = String(p.text);

  // The scene behind, settling from 108 % over the whole shot.
  const stage = ctx.el("div", "lg-stage");
  const bg = ctx.el("img", "lg-bg", stage);
  bg.alt = "";
  const ref = ctx.media.background;
  if (ref?.kind === "image") bg.src = ref.url;
  else if (!ref) bg.src = await artImage(ctx.doc, String(p.scene) as ArtKind, ART_THEMES[(ctx.seed - 1) % ART_THEMES.length]!, W, H, ctx.seed);
  else tl.track(videoTrack(bg, ref, ctx.pending));
  tl.fromTo(stage, { scale: 1.08 }, { scale: 1 }, { at: 0, duration: S, ease: "out" });
  const zoomAt = (t: number): number => Number(tl.valuesAt(stage, t).get("scale") ?? 1);

  // Geometry: a pill that rises into place, then (with results) flows open into a card about its centre.
  const pillW = Math.min(W - safe.left - safe.right + 60 * scale, 1180 * scale);
  const pillH = 132 * scale;
  const rowGap = 26 * scale;
  const rowH = 44 * scale;
  const cardH = results.length > 0 ? pillH + 40 * scale + results.length * (rowH + rowGap) + 30 * scale : pillH;
  const cardR = 56 * scale;
  const enterAt = 0.2;
  const enterEnd = enterAt + 0.9;
  const typeAt = enterEnd + 0.15;
  const cps = Math.max(18, Array.from(text).length / Math.max(0.8, S * 0.38));
  const typedEnd = typeAt + Array.from(text).length / cps;
  const sendAt = typedEnd + 0.3;
  const openAt = sendAt + 0.2;
  const open = Math.min(0.75, Math.max(0.4, S - openAt - 1.4));
  const geometry = (t: number): Geometry => {
    const k = results.length > 0 ? inOut((t - openAt) / open) : 0;
    const rise = (1 - out((t - enterAt) / 0.9)) * H * 0.06;
    return { cx: W / 2, cy: H / 2 + rise, w: pillW, h: pillH + (cardH - pillH) * k, r: pillH / 2 + (cardR - pillH / 2) * k };
  };

  const glass = ctx.el("div", "lg-glass");
  const lens = ctx.el("canvas", "lg-lens", glass);
  lens.width = Math.ceil(pillW);
  lens.height = Math.ceil(cardH);
  ctx.el("div", "lg-rim", glass);
  const sweep = ctx.el("div", "lg-sweep", glass);
  const streak = ctx.el("i", "", sweep);
  const row = ctx.el("div", "lg-row", glass);
  row.style.height = `${pillH}px`;
  icon(ctx, "sparkle", "", ctx.el("div", "lg-icon", row));
  const field = ctx.el("div", "lg-text", row);
  const typed = ctx.el("span", "", field);
  const caret = ctx.el("span", "lg-caret", field);
  const send = ctx.el("div", "lg-send", row);
  icon(ctx, "arrowUp", "", send);
  const divider = results.length > 0 ? ctx.el("div", "lg-divider", glass) : null;
  if (divider) divider.style.top = `${pillH + 4 * scale}px`;
  const list = ctx.el("div", "lg-results", glass);
  list.style.top = `${pillH + 40 * scale}px`;
  const rows = results.map((line) => {
    const r = ctx.el("div", "lg-result", list);
    icon(ctx, "check", "", ctx.el("div", "lg-check", r));
    ctx.el("span", "", r, line);
    return r;
  });

  // Fit the prompt on one line: measure it typed in full, then empty the field.
  Object.assign(glass.style, { left: "0px", top: "0px", width: `${pillW}px`, height: `${pillH}px` });
  typed.textContent = text;
  const room = field.clientWidth - 12 * scale;
  const wide = typed.getBoundingClientRect().width;
  if (wide > room && room > 0) field.style.fontSize = `${Math.max(24, 42 * (room / wide))}px`;
  typed.textContent = "";

  tl.fromTo(glass, { opacity: 0, blur: 14 }, { opacity: 1, blur: 0 }, { at: enterAt, duration: 0.5, ease: "out" });
  // One highlight runs across the rim as the glass settles.
  tl.fromTo(streak, { xPercent: -120, rotate: 18 }, { xPercent: 420, rotate: 18 }, { at: enterEnd - 0.35, duration: 0.9, ease: "in-out" });
  tl.track(typewriter(typed, text, { at: typeAt, cps }));
  tl.track(caretBlink(caret, (t) => t >= typeAt && t < typedEnd + 0.1));
  tl.to(caret, { opacity: 0 }, { at: sendAt, duration: 0.15, ease: "smooth" });
  tl.set(send, { backgroundColor: palette.ink }, 0);
  tl.to(send, { scale: 0.86, backgroundColor: palette.accent }, { at: sendAt, duration: 0.08, ease: "out" });
  tl.to(send, { scale: 1 }, { at: sendAt + 0.08, duration: 0.3, ease: "back-out" });
  if (divider) tl.fromTo(divider, { opacity: 0, scaleX: 0.6 }, { opacity: 1, scaleX: 1 }, { at: openAt + open * 0.5, duration: 0.5, ease: "out" });
  tl.fromTo(rows, { opacity: 0, y: 18 * scale, blur: 6 }, { opacity: 1, y: 0, blur: 0 }, { at: openAt + open * 0.6, duration: 0.5, ease: "out", stagger: 0.12 });

  let image: ImageData | null = null;
  let still: Backdrop | null = null;
  const bendPx = Number(p.bend) * scale;
  const frost = Number(p.frost);
  const paint = (t: number, bd: Backdrop | null): void => {
    const geo = geometry(t);
    const left = geo.cx - geo.w / 2;
    const top = geo.cy - geo.h / 2;
    Object.assign(glass.style, { left: `${left}px`, top: `${top}px`, width: `${geo.w}px`, height: `${geo.h}px`, borderRadius: `${geo.r}px` });
    const g = lens.getContext("2d");
    if (!g || !bd) return;
    image ??= g.createImageData(lens.width, lens.height);
    drawLens(image, geo, left, top, bd, W, H, zoomAt(t), bendPx, frost, palette.dark);
    g.clearRect(0, 0, lens.width, lens.height);
    g.putImageData(image, 0, 0, 0, 0, Math.ceil(geo.w), Math.ceil(geo.h));
  };
  if (ref?.kind === "video") {
    // A video's backdrop changes every frame: read it once the frame has decoded, before the capture.
    tl.track((t) => {
      const ready = (bg.decode?.() ?? Promise.resolve()).catch(() => undefined).then(() => paint(t, backdrop(bg, bg.naturalWidth, bg.naturalHeight, W, H, 18 * scale, ctx.doc)));
      ctx.pending.add(ready);
      void ready.finally(() => ctx.pending.delete(ready));
    });
  } else {
    await (bg.decode?.() ?? Promise.resolve()).catch(() => undefined);
    still = backdrop(bg, bg.naturalWidth, bg.naturalHeight, W, H, 18 * scale, ctx.doc);
    tl.track((t) => paint(t, still));
  }
}
