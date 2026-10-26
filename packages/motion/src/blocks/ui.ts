/** UI pieces several blocks share: a pointer that moves and clicks, and small icons. */

import type { BlockContext } from "../runtime/index.js";

export const ICONS = {
  arrowUp: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  film: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/></svg>`,
  note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/></svg>`,
  captions: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 11h4M13 11h4M7 15h7"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>`,
  wave: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"/></svg>`,
  pen: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.2-4.6L15.6 5a2.1 2.1 0 013 3L8.2 18.4z"/><path d="M13.5 7l3.5 3.5"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5h16v11H10l-5 4v-4H4z"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="3.5"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2L5 13.5h6L10 22l9-12h-6.2z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 001.5.86l10.4-6.5a1 1 0 000-1.72L9.5 4.64A1 1 0 008 5.5z"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>`,
  bubble: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>`,
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

/** A mouse pointer that enters from `from` (design px) at `at`; `size` is its box, px (default 64). */
export function pointer(ctx: BlockContext, from: { x: number; y: number }, at: number, size = 64): Pointer {
  const el = ctx.el("div", "cursor");
  el.innerHTML = ICONS.pointer;
  const ringSize = Math.round(size * 1.3);
  if (size !== 64) Object.assign(el.style, { width: `${size}px`, height: `${size}px` });
  const ring = ctx.el("div", "cursor-ring");
  Object.assign(ring.style, { position: "absolute", left: "0", top: "0", width: `${ringSize}px`, height: `${ringSize}px`, marginLeft: `${-ringSize / 2}px`, marginTop: `${-ringSize / 2}px`, borderRadius: "50%", border: "3px solid var(--accent)", zIndex: "49", opacity: "0" });
  // The SVG's tip is at (6, 3.5) of 28: offset so x, y is the tip.
  const tip = (x: number, y: number): { x: number; y: number } => ({ x: x - Math.round((size * 6) / 28), y: y - Math.round((size * 3.5) / 28) });
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

/** One run of a rich line: plain, or *emphasised* (the second face, accent). */
export interface RichRun {
  text: string;
  em: boolean;
}

/**
 * Lines of runs from the rich text blocks take: `/` or a newline breaks a
 * line, `*words*` are emphasised.
 */
export function parseRich(text: string): RichRun[][] {
  return text
    .split(/\s*(?:\/|\n)\s*/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const runs: RichRun[] = [];
      line.split(/(\*[^*]+\*)/).forEach((part) => {
        if (!part) return;
        const em = part.startsWith("*") && part.endsWith("*") && part.length > 2;
        runs.push({ text: em ? part.slice(1, -1) : part, em });
      });
      return runs;
    });
}

/** The rich text without its markup. */
export function plainRich(text: string): string {
  return parseRich(text)
    .map((runs) => runs.map((r) => r.text).join(""))
    .join(" ");
}

/**
 * Scale `el`'s font size so its widest line (`lines`, laid out with
 * `white-space: nowrap`) fits `maxWidth`, at most `maxSize` px. Needs layout.
 */
export function fitWidth(el: HTMLElement, lines: readonly HTMLElement[], maxWidth: number, maxSize: number, minSize = 24): number {
  const probe = 100;
  el.style.fontSize = `${probe}px`;
  const widest = Math.max(1, ...lines.map((l) => l.scrollWidth || l.getBoundingClientRect().width));
  const size = Math.max(minSize, Math.min(maxSize, (probe * maxWidth) / widest));
  el.style.fontSize = `${size}px`;
  return size;
}

/** Black or white, whichever reads better on the hex colour `bg` (WCAG relative luminance). */
export function onColor(bg: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(bg.trim());
  if (!m) return "#FFFFFF";
  const lin = (i: number): number => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  // Contrast against white (1.05 / (l + 0.05)) vs black ((l + 0.05) / 0.05).
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#FFFFFF" : "#0B0B0F";
}
