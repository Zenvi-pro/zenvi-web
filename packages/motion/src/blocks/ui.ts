/** UI pieces several blocks share: a pointer that moves and clicks, and small icons. */

import type { BlockContext } from "../runtime/index.js";

export const ICONS = {
  arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  pointer: `<svg viewBox="0 0 28 28"><path d="M6 3.5v19.2l5.1-4.6 3.3 7.4 3.4-1.5-3.3-7.3 6.9-.4z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
} as const;

/** An element holding an inline icon. */
export function icon(ctx: BlockContext, name: keyof typeof ICONS, className: string, parent: HTMLElement): HTMLElement {
  const el = ctx.el("span", `icon ${className}`, parent);
  el.innerHTML = ICONS[name];
  return el;
}

export interface Pointer {
  el: HTMLElement;
  /** Glide to (x, y) design px, tip first, ending at `at + duration`. */
  moveTo(x: number, y: number, at: number, duration?: number): void;
  /** Press at `at`: the pointer dips and a ring ripples out from the tip. */
  click(at: number): void;
}

/** A mouse pointer that enters from `from` (design px) at `at`. */
export function pointer(ctx: BlockContext, from: { x: number; y: number }, at: number): Pointer {
  const el = ctx.el("div", "cursor");
  el.innerHTML = ICONS.pointer;
  const ring = ctx.el("div", "cursor-ring");
  Object.assign(ring.style, { position: "absolute", left: "0", top: "0", width: "84px", height: "84px", marginLeft: "-42px", marginTop: "-42px", borderRadius: "50%", border: "3px solid var(--accent)", zIndex: "49", opacity: "0" });
  // The SVG's tip is at (6, 3.5) of 28: offset so x, y is the tip.
  const tip = (x: number, y: number): { x: number; y: number } => ({ x: x - 12, y: y - 7 });
  let last = from;
  ctx.tl.fromTo(el, { ...tip(from.x, from.y), opacity: 0, scale: 0.8 }, { ...tip(from.x, from.y), opacity: 1, scale: 1 }, { at, duration: 0.3, ease: "out" });
  return {
    el,
    moveTo(x, y, start, duration = 0.7) {
      ctx.tl.to(el, tip(x, y), { at: start, duration, ease: "in-out" });
      last = { x, y };
    },
    click(when) {
      ctx.tl.to(el, { scale: 0.86 }, { at: when, duration: 0.08, ease: "out" });
      ctx.tl.to(el, { scale: 1 }, { at: when + 0.08, duration: 0.22, ease: "out" });
      const p = last;
      ctx.tl.set(ring, { x: p.x, y: p.y }, when);
      ctx.tl.fromTo(ring, { scale: 0.3, opacity: 0.9 }, { scale: 1.4, opacity: 0 }, { at: when, duration: 0.5, ease: "out" });
    },
  };
}

/** A font size that fits `text` on `lines` lines of `width` px, between min and max (a rough per-face width ratio). */
export function fitFontSize(text: string, width: number, lines: number, min: number, max: number, charWidth = 0.52): number {
  const chars = Math.max(1, Array.from(text).length);
  const size = (width * lines) / (chars * charWidth);
  return Math.round(Math.max(min, Math.min(max, size)));
}
