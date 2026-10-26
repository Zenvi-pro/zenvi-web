import { mulberry32, type BlockContext } from "../../runtime/index.js";
import { ART_KINDS, ART_THEMES, artImage } from "../art.js";
import { icon, pointer } from "../ui.js";

/** Card heights as a share of the column width: a masonry board mixes portrait, square and tall pictures. */
const SHAPES = [1.32, 1.0, 1.56, 1.2, 0.82, 1.42];
const SCENES = ART_KINDS.filter((k) => k !== "mascot");

interface Card {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function build(ctx: BlockContext): Promise<void> {
  const { tl, params: p, width: W, height: H } = ctx;
  const S = ctx.seconds;
  const scale = Math.min(W, H) / 1080;
  const rnd = mulberry32(ctx.seed);
  const cols = Number(p.columns) || (ctx.portrait ? 3 : 5);
  const margin = 22 * scale;
  const gap = 16 * scale;
  const colW = (W - 2 * margin - (cols - 1) * gap) / cols;

  // Columns start at staggered heights and run past the bottom of the frame.
  const cards: Card[] = [];
  for (let c = 0; c < cols; c += 1) {
    let y = -rnd() * colW * 0.7;
    while (y < H + gap) {
      const h = colW * SHAPES[Math.floor(rnd() * SHAPES.length)]!;
      cards.push({ x: margin + c * (colW + gap), y, w: colW, h });
      y += h + gap;
    }
  }
  const dist = (k: Card): number => Math.hypot(k.x + k.w / 2 - W / 2, k.y + k.h / 2 - H / 2);
  const hero = cards.reduce((best, k) => (dist(k) < dist(best) ? k : best), cards[0]!);
  const others = cards.filter((k) => k !== hero).sort((a, b) => dist(a) - dist(b));

  const board = ctx.el("div", "mg-board");
  const heroCx = hero.x + hero.w / 2;
  const heroCy = hero.y + hero.h / 2;
  board.style.transformOrigin = `${heroCx}px ${heroCy}px`;
  const mediaNames = Array.from({ length: 8 }, (_, i) => `media_${i + 1}`).filter((n) => ctx.media[n]);
  const els = new Map<Card, HTMLElement>();
  const ordered = [hero, ...others];
  for (const [i, card] of ordered.entries()) {
    const el = ctx.el("div", card === hero ? "mg-card mg-hero" : "mg-card", board);
    Object.assign(el.style, { left: `${card.x}px`, top: `${card.y}px`, width: `${card.w}px`, height: `${card.h}px` });
    if (mediaNames.length > 0) {
      ctx.mediaImg(mediaNames[i % mediaNames.length]!, "", el);
    } else {
      const img = ctx.el("img", "", el);
      img.alt = "";
      // The hero is the one character on the board; the rest are scenes.
      const kind = card === hero ? "mascot" : SCENES[(i * 3 + ctx.seed) % SCENES.length]!;
      img.src = await artImage(ctx.doc, kind, ART_THEMES[(i * 5 + ctx.seed) % ART_THEMES.length]!, card.w, card.h, ctx.seed * 31 + i);
    }
    els.set(card, el);
  }
  const heroEl = els.get(hero)!;
  const shadow = ctx.el("div", "mg-shadow", heroEl.parentElement);
  Object.assign(shadow.style, { left: `${hero.x}px`, top: `${hero.y}px`, width: `${hero.w}px`, height: `${hero.h}px` });

  // The camera: close on the hero card, then back to the whole board (a move between two rests).
  const pull = Math.min(2.4, (W * 0.62) / hero.w);
  const pullAt = 0.5;
  tl.fromTo(board, { x: W / 2 - heroCx, y: H / 2 - heroCy, scale: pull }, { x: 0, y: 0, scale: 1 }, { at: pullAt, duration: 1.3, ease: "in-out" });
  tl.fromTo(heroEl, { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1 }, { at: 0.05, duration: 0.5, ease: "out" });
  // The rest fly up into their columns, nearest first, 0.45 s from first to last.
  tl.fromTo(
    others.map((k) => els.get(k)!),
    { y: 180 * scale, opacity: 0, scale: 0.94 },
    { y: 0, opacity: 1, scale: 1 },
    { at: pullAt + 0.2, duration: 0.75, ease: "out", stagger: others.length > 1 ? 0.45 / (others.length - 1) : 0 },
  );

  // The lift: the pointer comes to the hero card, it rises off the board, the rest fall back.
  const hoverAt = Math.min(2.5, S * 0.48);
  tl.to(heroEl, { scale: 1.06 }, { at: hoverAt, duration: 0.45, ease: "out" });
  tl.fromTo(shadow, { opacity: 0, scale: 1 }, { opacity: 1, scale: 1.06 }, { at: hoverAt, duration: 0.45, ease: "out" });
  tl.to(others.map((k) => els.get(k)!), { opacity: 0.42 }, { at: hoverAt, duration: 0.45, ease: "smooth" });

  const save = String(p.save);
  const heroRect = { x: hero.x, y: hero.y, w: hero.w, h: hero.h };
  if (save) {
    const button = ctx.el("div", "mg-save", heroEl);
    const label = ctx.el("span", "mg-label", button, save);
    const done = ctx.el("span", "mg-label", button);
    icon(ctx, "check", "", done);
    ctx.el("span", "", done, String(p.saved));
    Object.assign(done.style, { display: "flex", alignItems: "center", gap: "8px", position: "absolute", left: "28px", opacity: "0" });
    // Size the button for the wider of its two labels.
    const wideW = Math.max(label.getBoundingClientRect().width, done.getBoundingClientRect().width);
    if (wideW > 0) button.style.width = `${wideW + 56}px`;
    tl.fromTo(button, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1 }, { at: hoverAt + 0.15, duration: 0.3, ease: "back-out" });

    // Pointer: in from below right, to the card, to the button (frame px: the board is at rest by now).
    const bx = heroRect.x + heroRect.w - 18 * scale - 60 * scale;
    const by = heroRect.y + 18 * scale + 32 * scale;
    const ptr = pointer(ctx, { x: heroRect.x + heroRect.w * 0.9, y: Math.min(H - 40, heroRect.y + heroRect.h + 260 * scale) }, hoverAt - 0.7);
    ptr.moveTo(heroRect.x + heroRect.w * 0.55, heroRect.y + heroRect.h * 0.55, hoverAt - 0.55, 0.6);
    const clickAt = hoverAt + 0.95;
    ptr.moveTo(bx, by, clickAt - 0.5, 0.45);
    ptr.click(clickAt);
    // Colours have no rest value in the timeline: state the starting one, so seeking back restores it.
    tl.set(button, { backgroundColor: ctx.palette.accent }, 0);
    tl.to(button, { scale: 0.92 }, { at: clickAt, duration: 0.08, ease: "out" });
    tl.to(button, { scale: 1, backgroundColor: ctx.palette.ink }, { at: clickAt + 0.08, duration: 0.3, ease: "back-out" });
    tl.to(label, { opacity: 0, y: -10 }, { at: clickAt + 0.05, duration: 0.2, ease: "exit" });
    tl.fromTo(done, { opacity: 0, y: 10 }, { opacity: 1, y: 0 }, { at: clickAt + 0.12, duration: 0.3, ease: "out" });
  }
}
