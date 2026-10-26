import type { BlockContext } from "../../runtime/index.js";
import { ART_THEMES, artImage } from "../art.js";

/** Holds between the quick flips, shrinking: the shuffle speeds up before its pause. */
const GAPS = [0.42, 0.34, 0.28, 0.24, 0.22];
/** Drawn colourways in turn (art themes), ending on the most saturated one; the default names follow them. */
const COLOURWAYS = [5, 2, 3, 0, 1, 4];

export async function build(ctx: BlockContext): Promise<void> {
  const { tl, params: p, width: W, height: H, safe } = ctx;
  const S = ctx.seconds;
  const scale = Math.min(W, H) / 1080;
  const names = (p.names as string[]).filter((s) => s.trim());
  const mediaNames = Array.from({ length: 6 }, (_, i) => `media_${i + 1}`).filter((n) => ctx.media[n]);
  const n = mediaNames.length > 0 ? mediaNames.length : Number(p.variants);

  // The card, centred a little above the middle to leave room for the name.
  const nameSize = (ctx.portrait ? 76 : 64) * scale;
  const cardH = Math.min(H - safe.top - safe.bottom - nameSize * 2.4, ctx.portrait ? 1000 * scale : 720 * scale);
  const cardW = cardH * 0.75;
  const left = (W - cardW) / 2;
  const top = safe.top + (H - safe.top - safe.bottom - cardH - nameSize * 2) / 2;
  const stage = ctx.el("div", "cs-stage");
  const shadow = ctx.el("div", "cs-shadow", stage);
  Object.assign(shadow.style, { left: `${left - cardW * 0.05}px`, top: `${top + cardH - cardH * 0.03}px`, width: `${cardW * 1.1}px`, height: `${cardH * 0.12}px` });
  const card = ctx.el("div", "cs-card", stage);
  Object.assign(card.style, { left: `${left}px`, top: `${top}px`, width: `${cardW}px`, height: `${cardH}px` });
  const layers: HTMLElement[] = [];
  for (let i = 0; i < n; i += 1) {
    if (mediaNames.length > 0) {
      layers.push(ctx.mediaImg(mediaNames[i]!, "", card)!);
    } else {
      // One character, a new colourway each time (the same seed keeps its shape).
      const img = ctx.el("img", "", card);
      img.alt = "";
      img.src = await artImage(ctx.doc, "mascot", ART_THEMES[(COLOURWAYS[i]! + ctx.seed - 1) % ART_THEMES.length]!, cardW, cardH, ctx.seed);
      layers.push(img);
    }
  }
  const shine = ctx.el("div", "cs-shine", card);

  const namesBox = names.length > 0 ? ctx.el("div", "cs-names", stage) : null;
  const nameEls = namesBox
    ? Array.from({ length: n }, (_, i) => {
        const el = ctx.el("div", "cs-name", namesBox, names[i % names.length]!);
        el.style.fontSize = `${nameSize}px`;
        return el;
      })
    : [];
  if (namesBox) Object.assign(namesBox.style, { top: `${top + cardH + nameSize * 0.7}px`, height: `${nameSize * 1.3}px` });

  // Beats: rise in → quick flips, faster each time → a held breath → the last flip lands with a pop.
  const enter = 0.75;
  const finalFlip = 0.5;
  const hold = 1.0;
  const pause = 0.55;
  const gaps = GAPS.slice(0, Math.max(0, n - 2));
  const room = S - enter - pause - finalFlip - hold;
  const fit = gaps.length > 0 ? Math.min(1, Math.max(0.4, room / gaps.reduce((a, g) => a + g, 0))) : 1;
  const swaps: number[] = [];
  let at = enter + 0.1;
  for (const g of gaps) {
    swaps.push(at);
    at += g * fit;
  }
  swaps.push(at + pause * fit);

  tl.fromTo(card, { y: H * 0.05, opacity: 0, blur: 12 }, { y: 0, opacity: 1, blur: 0 }, { at: 0, duration: enter, ease: "out" });
  tl.fromTo(shadow, { opacity: 0 }, { opacity: 1 }, { at: 0.1, duration: enter, ease: "out" });
  layers.forEach((l, i) => tl.set(l, { opacity: i === 0 ? 1 : 0 }, 0));
  nameEls.forEach((el) => tl.set(el, { opacity: 0 }, 0));
  if (nameEls[0]) tl.fromTo(nameEls[0], { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1 }, { at: 0.25, duration: 0.5, ease: "out" });

  swaps.forEach((s, k) => {
    const last = k === swaps.length - 1;
    const half = last ? 0.16 : 0.09;
    const land = last ? 0.34 : 0.17;
    const mid = s + half;
    tl.to(card, { rotateY: 90 }, { at: s, duration: half, ease: "in" });
    tl.set(card, { rotateY: -90 }, mid);
    tl.to(card, { rotateY: 0 }, { at: mid, duration: land, ease: last ? "back-out" : "out" });
    tl.set(layers[k]!, { opacity: 0 }, mid);
    tl.set(layers[k + 1]!, { opacity: 1 }, mid);
    const from = nameEls[k];
    const to = nameEls[k + 1];
    if (from && to) {
      tl.to(from, { yPercent: -100, opacity: 0 }, { at: s, duration: half + 0.06, ease: "in" });
      tl.fromTo(to, { yPercent: 100, opacity: 0 }, { yPercent: 0, opacity: 1 }, { at: mid, duration: land + 0.1, ease: "out" });
    }
    if (last) {
      // The landing: a pop (6 % at most, TASTE.md §2) and one light sweep across the face.
      tl.to(card, { scale: 1.06 }, { at: mid, duration: 0.14, ease: "out" });
      tl.to(card, { scale: 1 }, { at: mid + 0.14, duration: 0.4, ease: "back-out" });
      tl.fromTo(shine, { xPercent: -110 }, { xPercent: 110 }, { at: mid + 0.1, duration: 0.7, ease: "in-out" });
    }
  });
  tl.set(shine, { xPercent: -110 }, 0);
  // The shadow narrows with the card as it turns edge-on.
  tl.track((t) => {
    const ry = Number(tl.valuesAt(card, t).get("rotateY") ?? 0);
    shadow.style.transform = `scaleX(${Math.max(0.3, Math.abs(Math.cos((ry * Math.PI) / 180))).toFixed(4)})`;
  });
}
