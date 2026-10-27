import type { BlockContext } from "../../runtime/index.js";
import { icon, onColor } from "../ui.js";

/** Cards deeper than this have faded out under the stack. */
const VISIBLE = 4;
const GAP = 16;

/** Scale, opacity and blur of a card `depth` cards below the newest. */
function depthLook(depth: number): { scale: number; opacity: number; blur: number } {
  return { scale: 1 - 0.035 * depth, opacity: depth >= VISIBLE ? 0 : 1 - 0.14 * depth, blur: depth >= 2 ? (depth - 1) * 1.5 : 0 };
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export function build(ctx: BlockContext): void {
  const { tl, params: p, width: W, height: H, safe, palette } = ctx;
  const items = (p.items as string[]).map((s) => {
    const i = s.indexOf(":");
    return i > 0 ? { title: s.slice(0, i).trim(), body: s.slice(i + 1).trim() } : { title: "", body: s.trim() };
  });
  const n = items.length;
  const dm = p.style === "dm";
  const hot = p.highlight_last !== false && n > 1;
  const onAccent = onColor(palette.accent);

  const pos = p.position === "auto" ? (ctx.portrait || W <= H * 1.3 ? "top" : "right") : String(p.position);
  const cardW = pos === "right" ? Math.min(780, W * 0.4) : Math.min(860, W - safe.left - safe.right);
  const stack = ctx.el("div", "ns-stack");
  stack.style.width = `${cardW}px`;
  // Phone-sized type on vertical frames reads at a glance; desktop-sized on landscape.
  stack.style.fontSize = `${pos === "right" ? 34 : ctx.portrait ? 37 : 33}px`;
  stack.style.left = `${pos === "right" ? W - safe.right - cardW : (W - cardW) / 2}px`;

  // Avatar fills cycle through the palette (DMs), so neighbours never match.
  const fills = [palette.secondary, palette.ink, palette.muted, palette.accent];
  const cards = items.map((item, i) => {
    const card = ctx.el("div", "ns-card", stack);
    if (dm) {
      const row = ctx.el("div", "ns-dm", card);
      const avatar = ctx.el("div", "ns-avatar", row, initials(item.title || "?"));
      const fill = fills[i % fills.length]!;
      Object.assign(avatar.style, { background: fill, color: onColor(fill.startsWith("#") ? fill : palette.ink) });
      const text = ctx.el("div", "ns-text", row);
      const headRow = ctx.el("div", "ns-head", text);
      ctx.el("div", "ns-title", headRow, item.title);
      ctx.el("span", "ns-time", headRow, String(p.time));
      ctx.el("span", "ns-dot", headRow);
      ctx.el("div", "ns-body", text, item.body);
    } else {
      const meta = ctx.el("div", "ns-meta", card);
      const tile = ctx.el("span", "ns-tile", meta);
      tile.style.color = onAccent;
      icon(ctx, "bell", "", tile);
      ctx.el("span", "ns-app", meta, String(p.app));
      ctx.el("span", "ns-time", meta, String(p.time));
      if (item.title) ctx.el("div", "ns-title", card, item.title);
      ctx.el("div", "ns-body", card, item.body);
    }
    if (hot && i === n - 1) {
      card.classList.add("is-hot");
      card.style.color = onAccent;
    }
    card.style.zIndex = String(i + 1);
    return card;
  });
  const heights = cards.map((c) => c.getBoundingClientRect().height);
  const total = heights.reduce((a, b) => a + b + GAP, 0);
  stack.style.top = `${pos === "center" ? Math.max(safe.top, (H - Math.min(total, heights.reduce((a, b) => Math.max(a, b), 0) * 3)) / 2) : safe.top}px`;

  // Arrivals: evenly spaced, the punchline after an extra beat of stillness; the stack then holds.
  const first = 0.15;
  const last = Math.max(first, ctx.seconds - (p.exit === false ? 1.2 : 1.6));
  const pause = hot ? 0.35 : 0;
  // Past the 0.4 s floor, many cards arrive faster rather than land the punchline in the exit.
  const fit = n > 1 ? (ctx.seconds - (p.exit === false ? 0 : 0.4) - 0.6 - first - pause) / (n - 1) : 0;
  const interval = n > 1 ? Math.max(0.15, Math.min(1.4, Math.max(0.4, (last - first - pause) / (n - 1)), fit)) : 0;
  const arrive = items.map((_, i) => first + i * interval + (hot && i === n - 1 ? pause : 0));

  cards.forEach((card, i) => {
    const h = heights[i]!;
    // In: dropping from above into the top slot, focusing as it lands.
    tl.fromTo(card, { y: -h * 0.6, scale: 0.94, opacity: 0, blur: 10 }, { y: 0, scale: 1, opacity: 1, blur: 0 }, { at: arrive[i]!, duration: 0.6, ease: "out" });
    ctx.cue(arrive[i]!, "pop", { weight: hot && i === n - 1 ? 0.6 : 0.45, at: card });
    // Each later arrival pushes it one slot down and one step back.
    for (let j = i + 1; j < n; j += 1) {
      let y = 0;
      for (let k = j; k > i; k -= 1) y += heights[k]! * depthLook(j - k).scale + GAP;
      tl.to(card, { y, ...depthLook(j - i) }, { at: arrive[j]!, duration: 0.6, ease: "out" });
    }
  });
}
